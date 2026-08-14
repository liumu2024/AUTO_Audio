import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DPL304_LOCAL_MODE = 'true'
const localDataDir = await mkdtemp(path.join(tmpdir(), 'dpl304-director-idempotency-'))
process.env.DPL304_LOCAL_DATA_DIR = localDataDir

try {
  const {
    prepareDirectorTurn,
    streamPreparedDirectorTurn,
  } = await import('../src/modules/director-agent/director-turn-idempotency.js')
  const { V2IdempotencyConflictError } = await import('../src/pipeline-v2/idempotency-repository.js')

  const request = {
    prompt: '生成一个科技宣传片方案',
    workspaceSessionId: 'workspace_idempotency_1',
    workspaceStateRevision: 0,
    turnRequestId: 'turn_request_1',
    userId: 1,
    context: {
      materials: [],
      userIntent: {},
      slots: {
        sampleVideoStatus: 'missing', materialStatus: 'missing', contentDomain: 'general',
        aspectRatio: '16:9', durationSec: 15, styleIntensity: 'medium',
      },
    },
    runtime: {
      backendEnabled: true, sampleUrl: '', sampleName: '', isSampleParsed: false,
      hasV2Timeline: false, hasVisualMaterial: false, materialCount: 0,
    },
  } as const

  let executions = 0
  const execute = async function* () {
    executions += 1
    yield { type: 'thought', title: '处理中', content: '仅首次执行可见' } as const
    yield {
      type: 'tool_proposed', callId: 'patch_call', toolId: 'timeline.patch',
      requestedMode: 'preview', effectiveMode: 'preview', modeNormalized: false,
      revisionIntent: {
        callId: 'patch_call', originalRequest: '修改字幕', scope: 'subtitle',
        targetDisplay: ['caption_1 · 字幕'], expectedImpact: '目标字幕', protectedBoundary: '其他内容保持不变',
      },
    } as const
    yield {
      type: 'tool_result', actionRef: 'patch', status: 'succeeded', callId: 'patch_call',
      toolId: 'timeline.patch', ok: true, summary: '字幕已修改',
      revisionReceipt: {
        callId: 'patch_call', originalRequest: '修改字幕', scope: 'subtitle',
        targetDisplay: ['caption_1 · 字幕'], expectedImpact: '目标字幕', protectedBoundary: '其他内容保持不变',
        status: 'succeeded', summary: '字幕已修改',
        actualDiff: { scenes: [], visibleText: ['caption_1'], transitions: [], audio: [], other: [] },
      },
    } as const
    yield { type: 'assistant_reply', message: '方案已完成' } as const
    yield { type: 'done' } as const
  }

  const first = await prepareDirectorTurn(request)
  assert.equal(first.reservation.kind, 'reserved')
  const runningReplay = await prepareDirectorTurn(request)
  const runningEvents = []
  for await (const event of streamPreparedDirectorTurn(runningReplay, execute)) runningEvents.push(event)
  assert.deepEqual(runningEvents.map((event) => event.type), ['turn_receipt', 'done'])
  assert.equal(runningEvents[0]?.type === 'turn_receipt' && runningEvents[0].status, 'running')
  assert.equal(executions, 0, 'a concurrent replay must not start a second Director execution')
  const firstEvents = []
  for await (const event of streamPreparedDirectorTurn(first, execute)) firstEvents.push(event)
  assert.equal(executions, 1)
  assert.equal(firstEvents[0]?.type, 'turn_receipt')
  assert.equal(firstEvents.some((event) => event.type === 'thought'), true)

  const replay = await prepareDirectorTurn(request)
  assert.equal(replay.reservation.kind, 'replay')
  const replayEvents = []
  for await (const event of streamPreparedDirectorTurn(replay, execute)) replayEvents.push(event)
  assert.equal(executions, 1)
  assert.deepEqual(
    replayEvents.map((event) => event.type),
    ['turn_receipt', 'tool_proposed', 'tool_result', 'assistant_reply', 'done'],
  )
  assert.equal(
    replayEvents.find((event) => event.type === 'tool_result')?.revisionReceipt?.actualDiff?.visibleText[0],
    'caption_1',
  )
  assert.equal(replayEvents[0]?.type === 'turn_receipt' && replayEvents[0].status, 'replayed')

  await assert.rejects(
    prepareDirectorTurn({ ...request, prompt: '同一个 key 的不同请求' }),
    V2IdempotencyConflictError,
  )

  const failedRequest = {
    ...request,
    workspaceSessionId: 'workspace_failed_turn',
    turnRequestId: 'turn_failed_once',
  }
  const failedReservation = await prepareDirectorTurn(failedRequest)
  const failWithInternalError = async function* () {
    throw new Error('Provider input_asset_id internal failure')
    yield { type: 'done' } as const
  }
  const firstFailureEvents = []
  for await (const event of streamPreparedDirectorTurn(failedReservation, failWithInternalError)) {
    firstFailureEvents.push(event)
  }
  const replayedFailureEvents = []
  for await (const event of streamPreparedDirectorTurn(await prepareDirectorTurn(failedRequest), execute)) {
    replayedFailureEvents.push(event)
  }
  for (const events of [firstFailureEvents, replayedFailureEvents]) {
    const message = events.find((event) => event.type === 'error')?.message ?? ''
    assert.match(message, /这轮处理暂时没有完成/)
    assert.doesNotMatch(message, /Provider|input_asset_id|internal/)
  }

  let activeExecutions = 0
  let maximumConcurrentExecutions = 0
  const serializedExecute = (label: string) => async function* () {
    activeExecutions += 1
    maximumConcurrentExecutions = Math.max(maximumConcurrentExecutions, activeExecutions)
    await new Promise((resolve) => setTimeout(resolve, 25))
    activeExecutions -= 1
    yield { type: 'assistant_reply', message: label } as const
    yield { type: 'done' } as const
  }
  const [serializedA, serializedB] = await Promise.all([
    prepareDirectorTurn({
      ...request,
      workspaceSessionId: 'workspace_serialized_turns',
      turnRequestId: 'turn_serialized_a',
    }),
    prepareDirectorTurn({
      ...request,
      workspaceSessionId: 'workspace_serialized_turns',
      turnRequestId: 'turn_serialized_b',
    }),
  ])
  await Promise.all([
    (async () => { for await (const _event of streamPreparedDirectorTurn(serializedA, serializedExecute('A'))) { /* consume */ } })(),
    (async () => { for await (const _event of streamPreparedDirectorTurn(serializedB, serializedExecute('B'))) { /* consume */ } })(),
  ])
  assert.equal(maximumConcurrentExecutions, 1, 'different turns in one workspace must not execute side effects concurrently')
} finally {
  await rm(localDataDir, { recursive: true, force: true })
}

console.info('[smoke-v2-director-turn-idempotency] OK')
