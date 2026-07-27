import assert from 'node:assert/strict'
import path from 'node:path'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'true'
process.env.V2_DIRECTOR_SESSION_DIR = path.join('tmp', 'v2-director-smoke-session')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
const { env } = await import('../src/config/env.js')

assert.equal(env.directorAgentEnabled, true)
assert.equal(env.directorAgentResponseContinuity, true)

const baseContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' as const, constraints: ['字幕基于画面创作'] },
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
      intent: 'generate_timeline', confidence: 0.95, contentDomain: 'general', slotsPatch: { generationMode: 'text_to_video' },
      missingSlots: [], requiresConfirmation: false, executionEffect: 'draft_change',
      authorizationEvidence: '请生成一版方案', nextAction: 'GENERATE_TIMELINE',
      assistantMessage: '我会先给出一版可编辑方案。', publicThoughts: [],
      conversationIntent: 'create', statePatch: { context: { userIntent: { constraints: ['字幕基于画面创作'] } } },
      nextStep: 'plan_create', requirements: [],
    }),
  },
  {
    id: 'resp_2',
    output_text: JSON.stringify({
      intent: 'unknown', confidence: 0.9, contentDomain: 'general', slotsPatch: {},
      missingSlots: [], requiresConfirmation: false, executionEffect: 'none',
      nextAction: 'ACKNOWLEDGE', assistantMessage: '当前方案会把字幕作为独立文字层处理。', publicThoughts: [],
      conversationIntent: 'chat', statePatch: {}, nextStep: 'discuss', requirements: [],
    }),
  },
  {
    id: 'resp_3',
    output_text: JSON.stringify({
      intent: 'revise_timeline', confidence: 0.94, contentDomain: 'general', slotsPatch: { subtitlePolicy: 'rewrite' },
      missingSlots: [], requiresConfirmation: false, executionEffect: 'draft_change',
      authorizationEvidence: '请把字幕改成更简洁的两行', nextAction: 'REVISE_TIMELINE',
      assistantMessage: '我会保留当前方案并只调整字幕策略。', publicThoughts: [],
      conversationIntent: 'revise', statePatch: {}, nextStep: 'plan_revise', requirements: [],
    }),
  },
  new Error('mock director outage'),
  {
    id: 'resp_5',
    output_text: JSON.stringify({
      intent: 'unknown', confidence: 0.9, contentDomain: 'general', slotsPatch: {},
      missingSlots: [], requiresConfirmation: false, executionEffect: 'none',
      nextAction: 'ACKNOWLEDGE', assistantMessage: '可以继续讨论这版方案的节奏。', publicThoughts: [],
      conversationIntent: 'chat', statePatch: {}, nextStep: 'discuss', requirements: [],
    }),
  },
  {
    id: 'resp_6',
    output_text: JSON.stringify({
      intent: 'render', confidence: 0.96, contentDomain: 'general', slotsPatch: {},
      missingSlots: [], requiresConfirmation: false, executionEffect: 'delivery',
      authorizationEvidence: '请渲染当前方案', nextAction: 'RENDER',
      assistantMessage: '我会提交当前已确认版本渲染。', publicThoughts: [],
      conversationIntent: 'execute', statePatch: {}, nextStep: 'execute', requirements: [],
    }),
  },
]
const originalFetch = globalThis.fetch
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
  const reply = replies.shift()
  if (reply instanceof Error) throw reply
  return new Response(JSON.stringify(reply), { status: 200 })
}

async function turn(prompt: string, context = baseContext, overrides: Partial<typeof runtime> = {}) {
  const events = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt,
    context,
    runtime: { ...runtime, ...overrides },
    workspaceSessionId: sessionId,
    userId: 1,
  })) events.push(event)
  return events
}

try {
  const created = await turn('请生成一版 15 秒的校园介绍方案')
  assert.equal(created.some((event) => event.type === 'action_plan'), true)
  const createdSession = created.find((event) => event.type === 'workspace_session')!
  assert.equal((createdSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal('generationMode' in (createdSession.state as { context: { slots: object } }).context.slots, false)

  const asked = await turn('这版会加入什么字幕？', {
    ...baseContext,
    slots: { ...baseContext.slots, durationSec: undefined },
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal(asked.some((event) => event.type === 'action_plan'), false)
  const askedSession = asked.find((event) => event.type === 'workspace_session')!
  assert.equal((askedSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal(requests[1]?.previous_response_id, 'resp_1')

  const revised = await turn('请把字幕改成更简洁的两行', {
    ...baseContext,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal((revised.find((event) => event.type === 'action_plan') as { action: { type: string } }).action.type, 'REVISE_TIMELINE')

  const failed = await turn('现在能否继续讨论节奏？')
  assert.equal(failed.some((event) => event.type === 'action_plan'), false)
  assert.equal((failed.find((event) => event.type === 'workspace_session') as { modelCalled: boolean }).modelCalled, true)

  const recovered = await turn('继续讨论这一版的节奏')
  assert.match(String((recovered.find((event) => event.type === 'done') as { message: string }).message), /继续讨论/)
  assert.equal((recovered.find((event) => event.type === 'workspace_session') as { state: { pendingQuestion?: unknown } }).state.pendingQuestion, undefined)
  const executable = await turn('请渲染当前方案', {
    ...baseContext,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 2 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal((executable.find((event) => event.type === 'action_plan') as { action: { type: string } }).action.type, 'RENDER_VIDEO')
  assert.equal(requests.length, 6)
} finally {
  globalThis.fetch = originalFetch
}

console.log('[smoke] V2 director multi-turn session passed')
