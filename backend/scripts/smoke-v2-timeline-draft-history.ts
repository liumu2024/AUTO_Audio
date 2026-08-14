import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DPL304_LOCAL_MODE = 'true'
const localDataDir = await mkdtemp(path.join(tmpdir(), 'dpl304-v2-history-'))
process.env.DPL304_LOCAL_DATA_DIR = localDataDir
let idempotentOutputDir = ''

try {
const { buildDeterministicRemotionTimelineSpec } = await import(
  '../src/pipeline-v2/remotion-timeline-planner.js'
)
const { createV2TimelineDraftRepository } = await import(
  '../src/pipeline-v2/timeline-draft-repository.js'
)
const { prisma } = await import('../src/shared/prisma.service.js')
const { postV2TimelinePreview } = await import('../src/pipeline-v2/controller.js')
const { executeV2TimelineDraftRun } = await import('../src/pipeline-v2/timeline-draft-runner.js')
const {
  createV2IdempotencyRepository,
  executeV2JsonIdempotentOperation,
  V2IdempotencyConflictError,
  V2IdempotencyOperationFailedError,
} = await import('../src/pipeline-v2/idempotency-repository.js')
const {
  promoteRenderComponent,
  registerRenderComponent,
  RENDER_COMPONENT_VISUAL_POLICY_VERSION,
} = await import(
  '../src/modules/render-components/component-registry.js'
)
const {
  deleteV2TimelineDraft,
  getV2TimelineDraft,
  getV2TimelineDrafts,
  postV2TimelineDraftRun,
  postV2TimelineDraftPreview,
  putV2TimelineDraft,
} = await import('../src/pipeline-v2/timeline-draft-controller.js')

function request(input: {
  userId?: string
  draftId?: string
  limit?: string
  idempotencyKey?: string
  body?: unknown
}) {
  return {
    headers: {
      'x-user-id': input.userId ?? '1',
      ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
    },
    params: input.draftId ? { draftId: input.draftId } : {},
    query: input.limit ? { limit: input.limit } : {},
    body: input.body,
  } as never
}

function response() {
  let statusCode = 200
  let body: unknown
  const res = {
    status(code: number) {
      statusCode = code
      return res
    },
    json(value: unknown) {
      body = value
      return res
    },
  }
  return {
    res: res as never,
    result: () => ({ statusCode, body }),
  }
}

const repository = createV2TimelineDraftRepository()
const plannerInput = {
  taskId: `v2_history_${Date.now()}`,
  creationMode: 'text_to_video' as const,
  prompt: '雾气穿过山谷，镜头缓慢推进。',
  plannerMode: 'deterministic' as const,
}
const spec = buildDeterministicRemotionTimelineSpec(plannerInput)
const ephemeralPreviewRequest = request({
  idempotencyKey: 'ephemeral-preview-idempotency',
  body: {
    prompt: '无持久化幂等预览', plannerMode: 'deterministic', durationSec: 6,
    canvas: { width: 640, height: 360, fps: 12 },
  },
})
const ephemeralPreviewA = response()
await postV2TimelinePreview(ephemeralPreviewRequest, ephemeralPreviewA.res)
const ephemeralPreviewB = response()
await postV2TimelinePreview(ephemeralPreviewRequest, ephemeralPreviewB.res)
assert.deepEqual(
  ephemeralPreviewB.result().body,
  JSON.parse(JSON.stringify(ephemeralPreviewA.result().body)),
)
const previewRequest = request({
  idempotencyKey: 'draft-preview-idempotency',
  body: {
    prompt: '幂等预览草稿',
    plannerMode: 'deterministic',
    durationSec: 8,
    canvas: { width: 640, height: 360, fps: 12 },
  },
})
const previewResponseA = response()
await postV2TimelineDraftPreview(previewRequest, previewResponseA.res)
const previewResponseB = response()
await postV2TimelineDraftPreview(previewRequest, previewResponseB.res)
assert.equal(previewResponseA.result().statusCode, 200)
assert.deepEqual(
  previewResponseB.result().body,
  JSON.parse(JSON.stringify(previewResponseA.result().body)),
)
const previewDraft = (previewResponseA.result().body as { draft: { draftId: string; revision: number; spec: typeof spec } }).draft
const saveRequest = request({
  draftId: previewDraft.draftId,
  idempotencyKey: 'draft-save-idempotency',
  body: {
    baseRevision: previewDraft.revision,
    spec: { ...previewDraft.spec, task_id: `${previewDraft.spec.task_id}_saved` },
  },
})
const saveResponseA = response()
await putV2TimelineDraft(saveRequest, saveResponseA.res)
const saveResponseB = response()
await putV2TimelineDraft(saveRequest, saveResponseB.res)
assert.equal(saveResponseA.result().statusCode, 200)
assert.deepEqual(saveResponseB.result().body, JSON.parse(JSON.stringify(saveResponseA.result().body)))
assert.equal(await repository.deleteDraft(previewDraft.draftId, 1), true)
const legacySpec = structuredClone(spec)
delete legacySpec.creative_brief
const hydratedLegacyDraft = await repository.createDraft({
  userId: 1,
  plannerInput,
  spec: legacySpec,
  plannerSource: 'legacy',
  review: { summary_zh: 'legacy fixture' },
  traceDir: 'legacy-preview-trace',
})
assert.equal(hydratedLegacyDraft.spec.creative_brief?.direction, plannerInput.prompt)
assert.deepEqual(hydratedLegacyDraft.spec.creative_brief?.image_references, [])
assert.deepEqual(hydratedLegacyDraft.spec.creative_brief?.sample_methods, [])
const hydratedLegacyRevision = await repository.getRevision(hydratedLegacyDraft.id, 1, 1)
assert.equal(hydratedLegacyRevision?.spec.creative_brief?.direction, plannerInput.prompt)
const legacyModeUpdate = await prisma.v2TimelineDraft.updateMany({
  where: { id: hydratedLegacyDraft.id },
  data: {
    plannerInputJson: { ...plannerInput, creationMode: 'material_brief' },
  },
})
assert.equal(legacyModeUpdate.count, 1)
assert.equal((await repository.getDraft(hydratedLegacyDraft.id, 1))?.creationMode, 'material_brief')
assert.equal(await repository.deleteDraft(hydratedLegacyDraft.id, 1), true)
const legacyMaterialInput = {
  ...plannerInput,
  taskId: `${plannerInput.taskId}_material`,
  creationMode: 'material_brief' as const,
  materials: [{ id: 'mat_legacy_image', type: 'image' as const, src: '/uploads/legacy.png' }],
}
const legacyMaterialSpec = buildDeterministicRemotionTimelineSpec(legacyMaterialInput)
delete legacyMaterialSpec.creative_brief
const hydratedLegacyMaterialDraft = await repository.createDraft({
  userId: 1,
  plannerInput: legacyMaterialInput,
  spec: legacyMaterialSpec,
  plannerSource: 'legacy',
  review: { summary_zh: 'legacy material fixture' },
  traceDir: 'legacy-material-preview-trace',
})
assert.deepEqual(
  hydratedLegacyMaterialDraft.spec.creative_brief?.image_references.map((item) => item.asset_id),
  ['mat_legacy_image'],
)
assert.equal(await repository.deleteDraft(hydratedLegacyMaterialDraft.id, 1), true)
const danglingAssetSpec = structuredClone(spec)
danglingAssetSpec.scenes[0] = {
  ...danglingAssetSpec.scenes[0]!,
  asset_id: 'missing_server_asset',
}
await assert.rejects(
  repository.createDraft({
    userId: 1,
    plannerInput,
    spec: danglingAssetSpec,
    plannerSource: 'deterministic',
  }),
  /asset_id/,
  'The repository must reject a timeline whose persisted resource graph is not closed.',
)
await registerRenderComponent({
  id: 'cmp_history_transition',
  purpose: 'transition',
  displayName: '历史圆形渐变',
  effectBrief: '历史圆形渐变',
  effectSummary: '历史测试用圆形渐变转场',
  acceptanceCriteria: ['测试 fixture'],
  source: 'export default function HistoryTransition({children}) { return children }',
})
await promoteRenderComponent({
  id: 'cmp_history_transition',
  previewEvidence: {
    verdict: 'passed',
    policyVersion: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
    canvas: { width: spec.canvas.width, height: spec.canvas.height },
    frameCount: 5, summary: 'fixture', reviewedAt: new Date().toISOString(),
    criteria: [{ criterion: '测试 fixture', passed: true, evidence: 'fixture' }],
  },
})
spec.transitions[0]!.custom_render = {
  component_id: 'cmp_history_transition',
  display_name: '创建时伪造名称',
}
const draft = await repository.createDraft({
  userId: 1,
  plannerInput,
  spec,
  plannerSource: 'deterministic',
  review: { summary_zh: '历史 smoke 草稿' },
  traceDir: 'history-preview-trace',
})
await assert.rejects(
  repository.saveDraft({
    draftId: draft.id,
    userId: 1,
    baseRevision: draft.revision,
    kind: 'user_edit',
    spec: danglingAssetSpec,
  }),
  /asset_id/,
  'The repository save boundary must reject the same open resource graph.',
)
assert.equal(draft.spec.transitions[0]?.custom_render?.display_name, '历史圆形渐变')
const saved = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: draft.revision,
  kind: 'user_edit',
  plannerInput: { ...plannerInput, creationMode: 'material_brief' },
  spec: {
    ...draft.spec,
    transitions: draft.spec.transitions.map((transition) => ({
      ...transition,
      custom_render: transition.custom_render
        ? { ...transition.custom_render, display_name: '修订时伪造名称' }
        : undefined,
    })),
  },
})
assert.equal(saved.spec.transitions[0]?.custom_render?.display_name, '历史圆形渐变')
assert.equal(saved.creationMode, 'material_brief')
const source = await repository.getRevision(saved.id, saved.revision, 1)
assert.ok(source)
const idempotency = createV2IdempotencyRepository()
const directorRequest = {
  userId: 1,
  operation: 'director.turn',
  idempotencyKey: 'director-turn-without-draft',
  resourceKey: 'workspace-session-1',
  requestHash: 'director-request-a',
}
const directorReservations = await Promise.all([
  idempotency.reserve(directorRequest),
  idempotency.reserve(directorRequest),
])
assert.equal(directorReservations.filter((item) => item.kind === 'reserved').length, 1)
assert.equal(directorReservations.filter((item) => item.kind === 'replay').length, 1)
const completedDirectorReceipt = await idempotency.update({
  id: directorReservations[0]!.receipt.id,
  status: 'completed',
  resultJson: {
    assistantReply: '已完成',
    events: [{ type: 'done' }],
  },
})
assert.equal(completedDirectorReceipt.draftId, undefined)
assert.deepEqual(completedDirectorReceipt.resultJson, {
  assistantReply: '已完成',
  events: [{ type: 'done' }],
})
await assert.rejects(
  () => idempotency.reserve({
    ...directorRequest,
    resourceKey: 'workspace-session-2',
    requestHash: 'director-request-b',
  }),
  V2IdempotencyConflictError,
)
let previewExecutions = 0
const previewOperation = () => executeV2JsonIdempotentOperation({
  repository: idempotency,
  reservation: {
    userId: 1,
    operation: 'timeline.preview',
    idempotencyKey: 'preview-result-replay',
    resourceKey: 'new-preview',
    requestHash: 'preview-request-a',
  },
  execute: async () => {
    previewExecutions += 1
    return { previewId: 'preview_1', ok: true }
  },
})
assert.equal((await previewOperation()).kind, 'executed')
const previewReplay = await previewOperation()
assert.equal(previewReplay.kind, 'replayed')
assert.deepEqual(previewReplay.kind === 'replayed' ? previewReplay.value : null, {
  previewId: 'preview_1', ok: true,
})
assert.equal(previewExecutions, 1)
let thrownExecutions = 0
const thrownOperation = () => executeV2JsonIdempotentOperation({
  repository: idempotency,
  reservation: {
    userId: 1,
    operation: 'timeline.preview',
    idempotencyKey: 'preview-thrown-failure-replay',
    resourceKey: 'failed-preview',
    requestHash: 'failed-preview-request',
  },
  execute: async () => {
    thrownExecutions += 1
    throw new Error('stable preview failure')
  },
})
for (let attempt = 0; attempt < 2; attempt += 1) {
  await assert.rejects(
    thrownOperation,
    (error: unknown) => error instanceof V2IdempotencyOperationFailedError
      && error.code === 'operation_failed'
      && error.message === 'stable preview failure',
  )
}
assert.equal(thrownExecutions, 1, 'a thrown idempotent failure must replay without executing again')
const firstReservation = await idempotency.reserve({
  userId: 1, draftId: draft.id, operation: 'timeline.render', idempotencyKey: 'history-key',
  resourceKey: `${draft.id}:${source.revision}`, requestHash: 'request-a', resultRef: 'run-a',
})
assert.equal(firstReservation.kind, 'reserved')
assert.equal((await idempotency.reserve({
  userId: 1, draftId: draft.id, operation: 'timeline.render', idempotencyKey: 'history-key',
  resourceKey: `${draft.id}:${source.revision}`, requestHash: 'request-a', resultRef: 'run-b',
})).kind, 'replay')
await assert.rejects(() => idempotency.reserve({
  userId: 1, draftId: draft.id, operation: 'timeline.render', idempotencyKey: 'history-key',
  resourceKey: `${draft.id}:999`, requestHash: 'request-b', resultRef: 'run-c',
}), /different request/i)
const staleRunResponse = response()
await postV2TimelineDraftRun(request({
  draftId: draft.id,
  idempotencyKey: 'stale-http-render',
  body: { revision: 1 },
}), staleRunResponse.res)
assert.equal(staleRunResponse.result().statusCode, 409, 'HTTP render must reject a stale confirmed revision')
const run = await repository.createRenderRun({
  id: `v2_history_run_${Date.now()}`,
  draftId: draft.id,
  userId: 1,
  sourceRevision: source.revision,
  sourceSpec: source.spec,
})
await repository.completeRenderRun({
  id: run.id,
  resolvedSpec: spec,
  outputPath: 'history.mp4',
  outputUrl: '/v2-renders/history.mp4',
  traceDir: 'history-run-trace',
  materialResolution: { ok: true },
  evaluation: { ok: true },
})

let idempotentRenderCalls = 0
const idempotentKey = `render-key-${Date.now()}`
const isolatedRenderRoot = path.resolve('tmp', `v2-history-render-${Date.now()}`)
const runIdempotently = (idempotencyRepository = idempotency) => executeV2TimelineDraftRun({
  repository,
  idempotency: idempotencyRepository,
  idempotencyKey: idempotentKey,
  draftId: draft.id,
  revision: source.revision,
  userId: 1,
  renderOutputBaseDir: isolatedRenderRoot,
  runTimeline: async (input, options) => {
    assert.equal(options.outputBaseDir, isolatedRenderRoot)
    idempotentRenderCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    idempotentOutputDir = path.resolve('v2-renders', input.taskId)
    await mkdir(idempotentOutputDir, { recursive: true })
    const outputPath = path.join(idempotentOutputDir, `${input.taskId}.mp4`)
    await writeFile(outputPath, 'idempotent render', 'utf8')
    return {
      ok: true, taskId: input.taskId, plannerSource: 'override', spec: input.timelineSpecOverride!,
      outputPath, traceDir: 'idempotent-trace', review: {}, validation: { ok: true },
      materialResolution: { ok: true, generation_trace: [] }, standardizedAssets: [],
      evaluation: { ok: true, metrics: {}, warnings: [] },
    } as never
  },
})
const pendingIdempotentA = runIdempotently()
await assert.rejects(() => executeV2TimelineDraftRun({
  repository,
  idempotency,
  idempotencyKey: idempotentKey,
  draftId: draft.id,
  revision: source.revision + 1,
  userId: 1,
  runTimeline: async () => { throw new Error('conflicting request must not execute') },
}), V2IdempotencyConflictError)
const [idempotentA, idempotentB] = await Promise.all([pendingIdempotentA, runIdempotently()])
assert.equal(idempotentRenderCalls, 1)
assert.equal(idempotentA.renderRunId, idempotentB.renderRunId)

const listResponse = response()
await getV2TimelineDrafts(request({ limit: '10' }), listResponse.res)
const list = listResponse.result()
assert.equal(list.statusCode, 200)
const listed = list.body as { drafts: Array<Record<string, unknown>> }
assert.equal(listed.drafts.length, 1)
assert.equal(listed.drafts[0]?.draftId, draft.id)
assert.equal(listed.drafts[0]?.revision, 2)
assert.equal(listed.drafts[0]?.creationMode, 'material_brief')
assert.equal((listed.drafts[0]?.latestRun as { id?: string })?.id, idempotentA.renderRunId)

const getResponse = response()
await getV2TimelineDraft(request({ draftId: draft.id }), getResponse.res)
const loaded = getResponse.result()
assert.equal(loaded.statusCode, 200)
const loadedDraft = (loaded.body as { draft: Record<string, unknown> }).draft
assert.ok(loadedDraft.spec)
assert.equal((loadedDraft.latestRevision as { revision?: number })?.revision, 2)

let failedOutputDir = ''
await assert.rejects(() => executeV2TimelineDraftRun({
  repository,
  draftId: draft.id,
  revision: saved.revision,
  userId: 1,
  idempotencyKey: `failed-render-${Date.now()}`,
  runTimeline: async (input) => {
    failedOutputDir = path.resolve('v2-renders', input.taskId)
    await mkdir(failedOutputDir, { recursive: true })
    await writeFile(path.join(failedOutputDir, 'partial.tmp'), 'partial render', 'utf8')
    throw new Error('expected render failure')
  },
}))
await assert.rejects(() => stat(failedOutputDir), 'a failed RenderRun must remove its task-local output directory')

const beforeIdempotentReplay = await repository.getDraft(draft.id, 1)
assert.ok(beforeIdempotentReplay)
await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: beforeIdempotentReplay.revision,
  kind: 'user_edit',
  spec: { ...beforeIdempotentReplay.spec, notes: ['advanced after completed render'] },
})
const replayedAfterDraftAdvance = await runIdempotently()
assert.equal(replayedAfterDraftAdvance.renderRunId, idempotentA.renderRunId)
assert.equal(replayedAfterDraftAdvance.plannerSource, idempotentA.plannerSource)
assert.equal(idempotentRenderCalls, 1, 'completed render replay must not execute again after the draft advances')

let racingReceiptReads = 0
const racingIdempotency = {
  ...idempotency,
  get: async (input: Parameters<typeof idempotency.get>[0]) => {
    racingReceiptReads += 1
    return racingReceiptReads === 1 ? null : idempotency.get(input)
  },
  reserve: async () => {
    throw new Error('a raced completed receipt must be rechecked before returning a revision conflict')
  },
}
const racedReplay = await runIdempotently(racingIdempotency)
assert.equal(racedReplay.renderRunId, idempotentA.renderRunId)
assert.equal(racedReplay.plannerSource, idempotentA.plannerSource)
assert.equal(racingReceiptReads, 2)

let pendingRaceReceiptReads = 0
const pendingRaceIdempotency = {
  ...idempotency,
  get: async (input: Parameters<typeof idempotency.get>[0]) => {
    pendingRaceReceiptReads += 1
    return pendingRaceReceiptReads === 1 ? null : idempotency.get(input)
  },
  reserve: async () => {
    throw new Error('a raced completed receipt must be rechecked before mutable readiness rejection')
  },
}
const pendingRaceRepository = {
  ...repository,
  getDraft: async (draftId: string, userId: number) => {
    const current = await repository.getDraft(draftId, userId)
    return current ? {
      ...current,
      revision: source.revision,
      pendingTimelineRevisions: [{
        callId: 'raced_pending_call',
        instruction: 'raced pending change',
        baseRevision: source.revision,
        createdAt: new Date().toISOString(),
      }],
    } : current
  },
}
const pendingRaceReplay = await executeV2TimelineDraftRun({
  repository: pendingRaceRepository,
  idempotency: pendingRaceIdempotency,
  idempotencyKey: idempotentKey,
  draftId: draft.id,
  revision: source.revision,
  userId: 1,
  runTimeline: async () => { throw new Error('raced replay must not execute') },
})
assert.equal(pendingRaceReplay.renderRunId, idempotentA.renderRunId)
assert.equal(pendingRaceReceiptReads, 2)

const foreignDeleteResponse = response()
await deleteV2TimelineDraft(request({ userId: '2', draftId: draft.id }), foreignDeleteResponse.res)
assert.equal(foreignDeleteResponse.result().statusCode, 404)
assert.ok(await repository.getDraft(draft.id, 1))

const deleteResponse = response()
await deleteV2TimelineDraft(request({ draftId: draft.id }), deleteResponse.res)
assert.equal(deleteResponse.result().statusCode, 200)
assert.deepEqual(deleteResponse.result().body, { draftId: draft.id, deleted: true })
assert.equal(await repository.getDraft(draft.id, 1), null)

console.info('[smoke-v2-timeline-draft-history] OK')
} finally {
  await Promise.all([
    rm(localDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    idempotentOutputDir
      ? rm(idempotentOutputDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      : Promise.resolve(),
  ])
}
