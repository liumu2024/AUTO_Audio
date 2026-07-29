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
          intent: 'analyze_materials',
          confidence: 0.96,
          contentDomain: 'product_marketing',
          slotsPatch: {},
          missingSlots: [],
          requiresConfirmation: false,
          executionEffect: 'workspace_change',
          nextAction: 'ACKNOWLEDGE',
          assistantMessage: '我先读取当前选中的素材事实。',
          publicThoughts: [],
          conversationIntent: 'execute',
          statePatch: {},
          nextStep: 'execute',
          requirements: [],
          skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '读取当前 V2 素材事实' }],
          toolRequests: [{
            callId: 'inspect_loop_001',
            toolId: 'material.inspect',
            skillId: 'v2-timeline-authoring',
            arguments: { materialIds: ['material_1'] },
            requestedMode: 'preview',
          }],
        }
      : call === 2
        ? {
          assistantMessage: '已读取产品图，它现在是可用于后续方案的候选视觉素材。',
          publicThoughts: ['最终回复来自真实 material.inspect 结果。'],
        }
        : call === 3
          ? {
              intent: 'analyze_sample',
              confidence: 0.96,
              contentDomain: 'product_marketing',
              slotsPatch: {},
              missingSlots: [],
              requiresConfirmation: false,
              executionEffect: 'workspace_change',
              nextAction: 'ANALYZE_SAMPLE',
              assistantMessage: '我先读取当前选中的样例。',
              publicThoughts: [],
              conversationIntent: 'execute',
              statePatch: {},
              nextStep: 'execute',
              requirements: [],
              skillRequests: [{ skillId: 'sample-reference-analysis', purpose: '理解用户选中的样例' }],
              toolRequests: [{
                callId: 'sample_loop_001',
                toolId: 'sample.analyze',
                skillId: 'sample-reference-analysis',
                arguments: { sampleId: 'sample_missing' },
                requestedMode: 'preview',
              }],
            }
          : {
              assistantMessage: '样例文件当前无法读取；会话与已有方案没有被改写，修复文件后可继续分析。',
              publicThoughts: ['最终回复明确依据 sample.analyze 的失败结果。'],
            }
    return new Response(JSON.stringify({
      id: call === 1
        ? 'resp_loop_decision'
        : call === 2
          ? 'resp_loop_feedback'
          : call === 3
            ? 'resp_sample_decision'
            : 'resp_sample_feedback',
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
    '已读取产品图，它现在是可用于后续方案的候选视觉素材。',
  )
  assert.equal(responseBodies[1]?.previous_response_id, 'resp_loop_decision')
  const workspaceEvent = events.find((event) => event.type === 'workspace_session')
  assert.equal(workspaceEvent?.responseId, 'resp_loop_feedback')

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
  assert.equal(
    failedEvents.find((event) => event.type === 'assistant_reply')?.message,
    '样例文件当前无法读取；会话与已有方案没有被改写，修复文件后可继续分析。',
  )
  assert.equal(responseBodies[3]?.previous_response_id, 'resp_sample_decision')
  const failedWorkspace = failedEvents.find((event) => event.type === 'workspace_session')
  assert.equal(failedWorkspace?.responseId, 'resp_sample_feedback')
  assert.match(failedWorkspace?.state.recentFailure?.reason ?? '', /Tool 执行异常/)
} finally {
  globalThis.fetch = originalFetch
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log('V2 Director Skill/Tool closed-loop smoke passed.')
