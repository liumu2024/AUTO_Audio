import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'true'
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join('tmp', 'v2-director-smoke-local-data')
process.env.V2_DIRECTOR_SESSION_DIR = path.join('tmp', 'v2-director-smoke-session')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
const { env } = await import('../src/config/env.js')

assert.equal(env.directorAgentEnabled, true)
assert.equal(env.directorAgentResponseContinuity, true)

const baseContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' as const },
  slots: { ...createDefaultDirectorSlots(), durationSec: 15, styleIntensity: 'strong' as const },
}
const runtime = {
  backendEnabled: true,
  sampleUrl: '',
  isSampleParsed: false,
  hasV2Timeline: false,
  hasVisualMaterial: false,
  materialCount: 0,
}
const sessionId = `v2_multiturn_${Date.now()}`
const requests: Array<Record<string, unknown>> = []
const replies = [
  {
    id: 'resp_1',
    output_text: JSON.stringify({
      replyDraft: '我会先记录本轮确认的字幕方向。', intent: 'create', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'add', statement: '字幕基于画面创作' }] }],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_2',
    output_text: JSON.stringify({
      replyDraft: '好的，我已记录新的字幕策略要求。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_3',
    output_text: JSON.stringify({
      replyDraft: '我会保留当前方案并只调整字幕策略。', intent: 'revise',
      creativeConfigDelta: { subtitlePolicy: 'rewrite' }, stateActions: [],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  new Error('mock director outage'),
  {
    id: 'resp_5',
    output_text: JSON.stringify({
      replyDraft: '已作废的颜色偏好是暖色，仍有效的是中性低饱和。', intent: 'chat',
      creativeConfigDelta: {}, stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_6',
    output_text: JSON.stringify({
      replyDraft: '我会提交当前已确认版本渲染。', intent: 'execute', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'replace', targetRequirementId: 'timeline_element_random', statement: '中性低饱和' }] }],
      skillRequests: [{ skillId: 'v2-render-delivery', purpose: '渲染当前版本' }],
      toolRequests: [{ ref: 'render', toolId: 'timeline.render', skillId: 'v2-render-delivery', arguments: {}, requestedMode: 'execute', dependsOn: [] }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_7',
    output_text: JSON.stringify({
      replyDraft: '我会记录这条要求。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'add', statement: '语气自然' }] }],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_8',
    output_text: JSON.stringify({
      replyDraft: 'apply isolated actions', intent: 'create', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'revoke', targetRequirementId: 'missing_requirement' }] }],
      memoryActions: [{
        ref: 'invalid_memory', operation: 'add', scopeType: 'user',
        statement: '偏好克制表达', status: 'active', origin: 'inferred',
        sourceTurnIds: ['not_the_current_turn'],
      }],
      skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'plan the current request' }],
      toolRequests: [
        { ref: 'requires_requirement', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: ['requirements'] },
        { ref: 'failing_independent', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
        { ref: 'requires_failed_tool', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: ['failing_independent'] },
        { ref: 'successful_independent', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
      ],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_9',
    output_text: JSON.stringify({
      replyDraft: '当前是讨论模式；我不会记录任何偏好，也不会修改草稿。',
      intent: 'chat', creativeConfigDelta: {}, stateActions: [], memoryActions: [],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
]
const originalFetch = globalThis.fetch
let dispatchCount = 0
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
  const reply = replies.shift()
  if (reply instanceof Error) throw reply
  return new Response(JSON.stringify(reply), { status: 200 })
}

async function turn(
  prompt: string,
  context = baseContext,
  overrides: Partial<typeof runtime> = {},
  failedRefs = new Set<string>(),
) {
  const events = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt,
    context,
    runtime: { ...runtime, ...overrides },
    workspaceSessionId: sessionId,
    userId: 1,
  }, {
    dispatchTool: async ({ stage }) => {
      dispatchCount += 1
      const ok = !failedRefs.has(stage.toolRequest.ref)
      return {
        callId: stage.toolRequest.callId,
        toolId: stage.toolRequest.toolId,
        ok,
        summary: ok ? 'V2 正式渲染已完成。' : 'mock tool failure',
      }
    },
  })) events.push(event)
  return events
}

try {
  const created = await turn('请生成一版 15 秒的校园介绍方案')
  assert.equal(created.some((event) => event.type === 'tool_started'), false)
  const createdSession = created.find((event) => event.type === 'workspace_session')!
  assert.equal((createdSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal('generationMode' in (createdSession.state as { context: { slots: object } }).context.slots, false)
  assert.deepEqual(
    (createdSession.state as { confirmedRequirements: Array<{ statement: string; status: string }> })
      .confirmedRequirements.map(({ statement, status }) => ({ statement, status })),
    [{ statement: '字幕基于画面创作', status: 'active' }],
  )
  assert.match(
    String((created.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /已记录.*字幕基于画面创作/,
  )

  const asked = await turn('这版会加入什么字幕？', {
    ...baseContext,
    slots: { ...baseContext.slots, durationSec: undefined },
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  const askedSession = asked.find((event) => event.type === 'workspace_session')!
  assert.equal((askedSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal(requests[1]?.previous_response_id, 'resp_1')
  assert.match(
    String((asked.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /没有产生可验证的要求变更/,
  )
  const askedTrace = JSON.parse(await readFile(
    path.join((askedSession as { traceDir: string }).traceDir, '00-director-turn', 'turn-result.json'),
    'utf8',
  )) as { requirement_changes: Record<string, unknown[]> }
  assert.deepEqual(askedTrace.requirement_changes, {
    added: [], replaced: [], revoked: [], unchanged: [], rejected: [],
  })

  const revised = await turn('请把字幕改成更简洁的两行', {
    ...baseContext,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal(revised.some((event) => event.type === 'tool_started'), false)

  const failed = await turn('现在能否继续讨论节奏？')
  assert.equal((failed.find((event) => event.type === 'workspace_session') as { modelCalled: boolean }).modelCalled, true)

  const recovered = await turn('继续讨论这一版的节奏')
  assert.equal(
    String((recovered.find((event) => event.type === 'done') as { message: string }).message),
    '已作废的颜色偏好是暖色，仍有效的是中性低饱和。',
  )
  assert.equal((recovered.find((event) => event.type === 'workspace_session') as { state: { pendingQuestion?: unknown } }).state.pendingQuestion, undefined)
  const executable = await turn('请渲染当前方案', {
    ...baseContext,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 2 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal(executable.some((event) => event.type === 'tool_started'), true)
  assert.equal(dispatchCount, 1)
  assert.match(
    String((executable.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /要求变更未通过校验.*渲染已完成/,
  )
  const unsaved = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '请记录语气自然',
    context: baseContext,
    runtime,
    workspaceSessionId: `${sessionId}_save_failure`,
    userId: 1,
  }, {
    saveWorkspace: async () => { throw new Error('mock save failure') },
  })) unsaved.push(event)
  assert.equal(unsaved.some((event) => event.type === 'workspace_snapshot'), false)
  assert.equal(
    (unsaved.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '工作区保存失败，本轮要求和状态均不能确认为已保存，请稍后重试。',
  )
  const isolated = await turn(
    'apply independent and dependent actions',
    baseContext,
    {},
    new Set(['failing_independent']),
  )
  assert.deepEqual(
    isolated
      .filter((event) => event.type === 'tool_result')
      .map((event) => ({ ref: event.actionRef, status: event.status })),
    [
      { ref: 'requires_requirement', status: 'skipped' },
      { ref: 'failing_independent', status: 'failed' },
      { ref: 'requires_failed_tool', status: 'skipped' },
      { ref: 'successful_independent', status: 'succeeded' },
    ],
  )
  assert.equal(dispatchCount, 3)
  const isolatedSession = isolated.find((event) => event.type === 'workspace_session') as { traceDir: string }
  const isolatedTrace = JSON.parse(await readFile(
    path.join(isolatedSession.traceDir, '00-director-turn', 'turn-result.json'),
    'utf8',
  )) as { creative_memory_changes: Array<{ ref: string; status: string }> }
  assert.deepEqual(isolatedTrace.creative_memory_changes, [
    { ref: 'invalid_memory', operation: 'add', status: 'failed', reason: 'Creative memory action must cite the current source turn.' },
  ])
  const negatedPersistence = await turn('说明当前模式，不要记录偏好或修改草稿。')
  assert.equal(
    (negatedPersistence.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '当前是讨论模式；我不会记录任何偏好，也不会修改草稿。',
  )
  assert.equal(requests.length, 9)
} finally {
  globalThis.fetch = originalFetch
}

console.log('[smoke] V2 director multi-turn session passed')
