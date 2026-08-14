import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DPL304_LOCAL_MODE = 'true'
const testRoot = await mkdtemp(path.join(tmpdir(), 'dpl304-v2-creation-summary-'))
process.env.DPL304_LOCAL_DATA_DIR = path.join(testRoot, 'data')
process.env.V2_DIRECTOR_SESSION_DIR = path.join(testRoot, 'sessions')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')

const sessionId = `creation_summary_${Date.now()}`
const turnRequestId = `turn_${Date.now()}`
const context = {
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

const originalFetch = globalThis.fetch
let modelCalls = 0
let toolCalls = 0
let failRequirementOnNextModelCall = false
globalThis.fetch = async () => {
  modelCalls += 1
  const failRequirement = failRequirementOnNextModelCall
  failRequirementOnNextModelCall = false
  return new Response(JSON.stringify({
    id: 'creation-summary-response',
    output_text: JSON.stringify({
      replyDraft: '我先把创作方向整理给你确认。',
      intent: 'create',
      creationSummary: {
        goal: '创作一支面向高校新生的十五秒校园科技宣传片',
        audience: '高校新生',
        openQuestions: [],
      },
      creativeConfigDelta: {},
      stateActions: [{
        ref: 'requirements',
        kind: 'requirements.update',
        operations: failRequirement
          ? [{ operation: 'replace', targetRequirementId: 'missing_requirement', statement: '保留校园科技感' }]
          : [{ operation: 'add', statement: '保留校园科技感' }],
      }],
      memoryActions: [],
      skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '生成首次方案' }],
      toolRequests: [{
        ref: 'plan', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring',
        arguments: {}, requestedMode: 'preview', dependsOn: ['requirements'],
      }],
      missingInformation: [],
    }),
  }), { status: 200 })
}

async function collect(input: Parameters<typeof streamDirectorAgentChat>[0]) {
  const events = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat(input, {
    composeFinalReply: async ({ fallbackMessage }) => ({ message: fallbackMessage, source: 'fallback' }),
    dispatchTool: async (dispatchInput) => {
      toolCalls += 1
      return {
        callId: dispatchInput.stage.toolRequest.callId,
        toolId: dispatchInput.stage.toolRequest.toolId,
        ok: true,
        summary: '方案已生成。',
      }
    },
  })) events.push(event)
  return events
}

try {
  const proposed = await collect({
    prompt: '给高校新生做一支十五秒校园科技宣传片，保留校园科技感。',
    context,
    runtime,
    workspaceSessionId: sessionId,
    turnRequestId,
    userId: 1,
  })
  const proposal = proposed.find((event) => event.type === 'tool_proposed') as {
    creationSummary?: { goal: string; audience?: string; durationSec?: number; mustKeep: string[] }
    creationConfirmationId?: string
  }
  assert.equal(toolCalls, 0, 'first-plan Tools must wait for the creative summary decision')
  assert.equal(proposal.creationSummary?.goal, '创作一支面向高校新生的十五秒校园科技宣传片')
  assert.equal(proposal.creationSummary?.audience, '高校新生')
  assert.equal(proposal.creationSummary?.durationSec, 15)
  assert.deepEqual(proposal.creationSummary?.mustKeep, ['保留校园科技感'])
  assert.ok(proposal.creationConfirmationId)

  const workspace = proposed.find((event) => event.type === 'workspace_session') as {
    stateRevision: number
    state: { pendingTimelinePlanConfirmation?: { confirmationId: string } }
  }
  assert.equal(
    workspace.state.pendingTimelinePlanConfirmation?.confirmationId,
    proposal.creationConfirmationId,
  )

  const confirmed = await collect({
    prompt: '确认这份创作摘要并生成方案。',
    context,
    runtime,
    workspaceSessionId: sessionId,
    workspaceStateRevision: workspace.stateRevision,
    timelinePlanDecision: { confirmationId: proposal.creationConfirmationId!, action: 'confirm' },
    userId: 1,
  })
  assert.equal(modelCalls, 1, 'confirmation must not rerun the Director model')
  assert.equal(toolCalls, 1)
  assert.equal(confirmed.some((event) => event.type === 'tool_result'), true)
  assert.equal(
    (confirmed.find((event) => event.type === 'workspace_session') as {
      state: { pendingTimelinePlanConfirmation?: unknown }
    }).state.pendingTimelinePlanConfirmation,
    undefined,
  )

  const rejectedSessionId = `${sessionId}_rejected`
  const rejectedProposalEvents = await collect({
    prompt: '给高校新生做一支十五秒校园科技宣传片，保留校园科技感。',
    context,
    runtime,
    workspaceSessionId: rejectedSessionId,
    turnRequestId: `${turnRequestId}_rejected`,
    userId: 1,
  })
  const rejectedProposal = rejectedProposalEvents.find((event) => event.type === 'tool_proposed') as {
    creationConfirmationId: string
  }
  const rejectedWorkspace = rejectedProposalEvents.find((event) => event.type === 'workspace_session') as {
    stateRevision: number
  }
  const rejected = await collect({
    prompt: '暂不按这份创作摘要生成方案。',
    context,
    runtime,
    workspaceSessionId: rejectedSessionId,
    workspaceStateRevision: rejectedWorkspace.stateRevision,
    timelinePlanDecision: { confirmationId: rejectedProposal.creationConfirmationId, action: 'reject' },
    userId: 1,
  })
  assert.equal(modelCalls, 2, 'rejecting must not rerun the Director model')
  assert.equal(toolCalls, 1, 'rejecting must not dispatch the held plan')
  assert.match(
    String((rejected.find((event) => event.type === 'assistant_reply') as { message?: string }).message),
    /尚未开始规划/,
  )

  failRequirementOnNextModelCall = true
  const invalidRequirementSessionId = `${sessionId}_invalid_requirement`
  const invalidRequirement = await collect({
    prompt: '更新已有要求后生成方案。',
    context,
    runtime,
    workspaceSessionId: invalidRequirementSessionId,
    turnRequestId: `${turnRequestId}_invalid_requirement`,
    userId: 1,
  })
  assert.equal(
    (invalidRequirement.find((event) => event.type === 'workspace_session') as {
      state: { pendingTimelinePlanConfirmation?: unknown }
    }).state.pendingTimelinePlanConfirmation,
    undefined,
    'a plan that depends on a failed requirement update must not become confirmable',
  )
  assert.equal(invalidRequirement.some((event) => event.type === 'tool_started'), false)
  assert.equal(toolCalls, 1)
} finally {
  globalThis.fetch = originalFetch
  await rm(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

console.info('[smoke-v2-director-creation-summary] OK')
