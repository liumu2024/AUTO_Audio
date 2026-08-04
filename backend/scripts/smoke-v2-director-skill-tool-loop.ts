import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'v2-director-skill-tool-loop-'))
process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_API_KEY = 'test-key'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'true'
process.env.V2_DIRECTOR_SESSION_DIR = path.join(temporaryRoot, 'sessions')
process.env.V2_TRACE_BASE_DIR = path.join(temporaryRoot, 'traces')

const originalFetch = globalThis.fetch
const responseBodies: Array<Record<string, unknown>> = []

try {
  let call = 0
  globalThis.fetch = async (_url, init) => {
    responseBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    call += 1
    const output = call === 1
      ? {
          replyDraft: '我先读取当前选中的素材事实。',
          intent: 'execute',
          creativeConfigDelta: { contentDomain: 'product_marketing' },
          stateActions: [],
          skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '读取当前 V2 素材事实' }],
          toolRequests: [{
            ref: 'inspect_loop_001',
            toolId: 'material.inspect',
            skillId: 'v2-timeline-authoring',
            arguments: {},
            requestedMode: 'preview',
            dependsOn: [],
          }],
          missingInformation: [],
        }
      : {
          replyDraft: '我先读取当前选中的样例。',
          intent: 'execute',
          creativeConfigDelta: { contentDomain: 'product_marketing' },
          stateActions: [],
          skillRequests: [{ skillId: 'sample-reference-analysis', purpose: '理解用户选中的样例' }],
          toolRequests: [{
            ref: 'sample_loop_001',
            toolId: 'sample.analyze',
            skillId: 'sample-reference-analysis',
            arguments: {},
            requestedMode: 'preview',
            dependsOn: [],
          }],
          missingInformation: [],
        }
    return new Response(JSON.stringify({
      id: call === 1 ? 'resp_loop_decision' : 'resp_sample_decision',
      output_text: JSON.stringify(output),
    }), { status: 200 })
  }

  const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
  const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
  const events = []
  for await (const event of streamDirectorAgentChat({
    workspaceSessionId: 'loop_session_001',
    userId: 1,
    prompt: '检查我刚上传的产品图，告诉我它能不能用于后续方案',
    context: {
      materials: [{ id: 'material_1', type: 'image', url: '/uploads/product.png', name: '产品图' }],
      userIntent: {},
      slots: createDefaultDirectorSlots(),
    },
    runtime: {
      backendEnabled: true,
      sampleUrl: '',
      isSampleParsed: false,
      hasV2Timeline: false,
      hasVisualMaterial: true,
      materialCount: 1,
    },
  })) {
    events.push(event)
  }

  const eventTypes = events.map((event) => event.type)
  assert.ok(eventTypes.indexOf('skill_selected') < eventTypes.indexOf('skill_loaded'))
  assert.ok(eventTypes.indexOf('skill_loaded') < eventTypes.indexOf('tool_started'))
  assert.ok(eventTypes.indexOf('tool_started') < eventTypes.indexOf('tool_result'))
  assert.ok(eventTypes.indexOf('tool_result') < eventTypes.indexOf('assistant_reply'))
  assert.equal(events.find((event) => event.type === 'tool_result')?.ok, true)
  assert.equal(
    events.find((event) => event.type === 'assistant_reply')?.message,
    '已检查 1 个 V2 候选素材。',
  )
  assert.equal(responseBodies.length, 1)
  const workspaceEvent = events.find((event) => event.type === 'workspace_session')
  assert.equal(workspaceEvent?.responseId, 'resp_loop_decision')

  const failedEvents = []
  const missingSamplePath = path.join(temporaryRoot, 'missing-sample.mp4')
  for await (const event of streamDirectorAgentChat({
    workspaceSessionId: 'loop_session_002',
    userId: 1,
    prompt: '分析我选中的样例，说明可以借鉴的节奏',
    context: {
      sampleVideo: { id: 'sample_missing', url: missingSamplePath, name: '不存在的样例.mp4' },
      materials: [],
      userIntent: {},
      slots: createDefaultDirectorSlots(),
    },
    runtime: {
      backendEnabled: true,
      sampleUrl: missingSamplePath,
      isSampleParsed: false,
      hasV2Timeline: false,
      hasVisualMaterial: false,
      materialCount: 0,
    },
  })) {
    failedEvents.push(event)
  }
  const failedResult = failedEvents.find((event) => event.type === 'tool_result')
  assert.equal(failedResult?.ok, false)
  assert.match(failedResult?.summary ?? '', /Tool 执行异常/)
  assert.match(
    failedEvents.find((event) => event.type === 'assistant_reply')?.message ?? '',
    /Tool 执行异常/,
  )
  assert.equal(responseBodies.length, 2)
  const failedWorkspace = failedEvents.find((event) => event.type === 'workspace_session')
  assert.equal(failedWorkspace?.responseId, 'resp_sample_decision')
  assert.match(failedWorkspace?.state.recentFailure?.reason ?? '', /Tool 执行异常/)
} finally {
  globalThis.fetch = originalFetch
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log('V2 Director Skill/Tool closed-loop smoke passed.')
