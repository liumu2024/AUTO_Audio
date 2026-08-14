import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  let decisionCall = 0
  let finalReplyCall = 0
  let rejectFinalReplySchema = false
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    responseBodies.push(body)
    const formatName = ((body.text as { format?: { name?: string } } | undefined)?.format?.name)
    if (formatName === 'v2_director_final_reply') {
      if (rejectFinalReplySchema) {
        return new Response(JSON.stringify({ error: 'schema unsupported' }), { status: 400 })
      }
      finalReplyCall += 1
      const finalReplies = [
        {
          opening: '我看过这次的处理结果了',
          outcomes: [{ ref: 'inspect_loop_001', status: 'succeeded', connector: '' }],
          nextStep: '你可以继续告诉我接下来想怎么调整',
        },
        {
          opening: '这个样例现在可以正常使用',
          outcomes: [{ ref: 'sample_loop_001', status: 'failed', connector: '' }],
          nextStep: '你可以先看看当前结果，再决定下一步',
        },
        {
          opening: '我把这次的处理结果整理好了',
          outcomes: [
            { ref: 'inspect_mixed_001', status: 'succeeded', connector: '' },
            { ref: 'sample_mixed_001', status: 'failed', connector: '不过，' },
          ],
          nextStep: '你可以先看看当前结果，再决定下一步',
        },
        {
          opening: '我把这次的处理结果整理好了',
          outcomes: [
            { ref: 'second', status: 'failed', connector: '' },
            { ref: 'first', status: 'succeeded', connector: '不过，' },
          ],
          nextStep: '你可以先看看当前结果，再决定下一步',
        },
      ]
      return new Response(JSON.stringify({
        id: `resp_final_${finalReplyCall}`,
        output_text: JSON.stringify(finalReplies[finalReplyCall - 1]),
      }), { status: 200 })
    }

    decisionCall += 1
    const output = decisionCall === 1
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
      : decisionCall === 2 ? {
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
        } : decisionCall === 3 ? {
          replyDraft: '我会分别检查产品图和样例。',
          intent: 'execute',
          creativeConfigDelta: { contentDomain: 'product_marketing' },
          stateActions: [],
          skillRequests: [
            { skillId: 'v2-timeline-authoring', purpose: '读取当前素材事实' },
            { skillId: 'sample-reference-analysis', purpose: '理解用户选中的样例' },
          ],
          toolRequests: [
            {
              ref: 'inspect_mixed_001', toolId: 'material.inspect', skillId: 'v2-timeline-authoring',
              arguments: {}, requestedMode: 'preview', dependsOn: [],
            },
            {
              ref: 'sample_mixed_001', toolId: 'sample.analyze', skillId: 'sample-reference-analysis',
              arguments: {}, requestedMode: 'preview', dependsOn: [],
            },
          ],
          missingInformation: [],
        } : {
          replyDraft: 'V4 Tool 已读取 scene_001，revision 7 已由 Backend 保存。',
          intent: 'chat',
          creativeConfigDelta: {},
          stateActions: [],
          skillRequests: [],
          toolRequests: [],
          missingInformation: [],
        }
    return new Response(JSON.stringify({
      id: decisionCall === 1 ? 'resp_loop_decision' : 'resp_sample_decision',
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
    '我看过这次的处理结果了。已检查 1 个候选素材。你可以继续告诉我接下来想怎么调整。',
  )
  assert.equal(responseBodies.length, 2)
  assert.equal(responseBodies[1]?.max_output_tokens, 512)
  const workspaceEvent = events.find((event) => event.type === 'workspace_session')
  assert.equal(workspaceEvent?.responseId, 'resp_final_1')

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
  assert.match(failedResult?.summary ?? '', /处理过程中遇到异常/)
  assert.match(
    failedEvents.find((event) => event.type === 'assistant_reply')?.message ?? '',
    /这次没能完成这项操作.*当前对话和方案保持不变/,
  )
  assert.equal(responseBodies.length, 4, 'an invalid final reply must fall back without another model call')
  const failedWorkspace = failedEvents.find((event) => event.type === 'workspace_session')
  assert.match(failedWorkspace?.state.recentFailure?.reason ?? '', /处理过程中遇到异常/)
  const failedToolTrace = JSON.parse(await readFile(
    path.join(
      String(failedWorkspace?.traceDir),
      '00-director-turn',
      `tool-${String(failedResult?.callId)}.json`,
    ),
    'utf8',
  )) as { result?: { internal_error?: { message?: string; stack?: string } | null } }
  assert.match(failedToolTrace.result?.internal_error?.message ?? '', /missing-sample\.mp4|ENOENT/i)
  assert.doesNotMatch(
    failedEvents.find((event) => event.type === 'assistant_reply')?.message ?? '',
    /missing-sample\.mp4|ENOENT|input_asset_id/i,
  )

  const mixedEvents = []
  for await (const event of streamDirectorAgentChat({
    workspaceSessionId: 'loop_session_003',
    userId: 1,
    prompt: '检查产品图和样例，分别告诉我结果',
    context: {
      sampleVideo: { id: 'sample_missing', url: missingSamplePath, name: '不存在的样例.mp4' },
      materials: [{ id: 'material_1', type: 'image', url: '/uploads/product.png', name: '产品图' }],
      userIntent: {},
      slots: createDefaultDirectorSlots(),
    },
    runtime: {
      backendEnabled: true, sampleUrl: missingSamplePath, isSampleParsed: false,
      hasV2Timeline: false, hasVisualMaterial: true, materialCount: 1,
    },
  })) mixedEvents.push(event)
  const mixedReply = mixedEvents.find((event) => event.type === 'assistant_reply')?.message ?? ''
  assert.match(mixedReply, /已检查 1 个候选素材/)
  assert.match(mixedReply, /这次没能完成这项操作.*处理过程中遇到异常/)
  assert.match(mixedReply, /不过，/)
  assert.equal(responseBodies.length, 6)

  const { composeDirectorFinalReply } = await import('../src/modules/director-agent/llm-intent-router.js')
  const reordered = await composeDirectorFinalReply({
    userPrompt: '先检查素材，再分析样例',
    replyDraft: '我来处理。',
    facts: [
      { ref: 'first', status: 'succeeded', summary: '素材检查完成。' },
      { ref: 'second', status: 'failed', summary: '样例分析没有完成。' },
    ],
    fallbackMessage: '素材检查完成；样例分析没有完成。',
  })
  assert.equal(reordered.source, 'fallback')
  assert.equal(reordered.message, '素材检查完成；样例分析没有完成。')
  assert.equal(responseBodies.length, 7, 'final reply ordering must be checked in one bounded model call')
  assert.equal(responseBodies[6]?.max_output_tokens, 512)

  rejectFinalReplySchema = true
  const schemaRejected = await composeDirectorFinalReply({
    userPrompt: '检查结果',
    replyDraft: '我来整理',
    facts: [{ ref: 'schema_rejected', status: 'failed', summary: '这次没有完成。' }],
    fallbackMessage: '这次没有完成。',
  })
  rejectFinalReplySchema = false
  assert.equal(schemaRejected.source, 'fallback')
  assert.equal(responseBodies.length, 8, 'final reply schema rejection must not trigger a second HTTP request')

  const chatEvents = []
  for await (const event of streamDirectorAgentChat({
    workspaceSessionId: 'loop_session_004',
    userId: 1,
    prompt: '简单说说当前状态',
    context: { materials: [], userIntent: {}, slots: createDefaultDirectorSlots() },
    runtime: {
      backendEnabled: true, sampleUrl: '', isSampleParsed: false,
      hasV2Timeline: false, hasVisualMaterial: false, materialCount: 0,
    },
  })) chatEvents.push(event)
  const safeChatReply = chatEvents.find((event) => event.type === 'assistant_reply')?.message ?? ''
  assert.doesNotMatch(safeChatReply, /V4|Tool|scene_001|revision|Backend/i)
  assert.match(safeChatReply, /当前方案|目标镜头|创作服务/)
} finally {
  globalThis.fetch = originalFetch
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log('V2 Director Skill/Tool closed-loop smoke passed.')
