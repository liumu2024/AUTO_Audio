import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DPL304_LOCAL_MODE = 'true'
const localDataDir = await mkdtemp(path.join(tmpdir(), 'dpl304-v2-draft-persistence-'))
process.env.DPL304_LOCAL_DATA_DIR = localDataDir

const { buildDeterministicRemotionTimelineSpec } = await import('../src/pipeline-v2/remotion-timeline-planner.js')
const {
  createV2TimelineDraftRepository,
  V2TimelineRevisionConflictError,
} = await import('../src/pipeline-v2/timeline-draft-repository.js')
type V2StoredPlannerInput = import('../src/pipeline-v2/timeline-draft-repository.js').V2StoredPlannerInput
const { executeV2TimelineDraftRun } = await import('../src/pipeline-v2/timeline-draft-runner.js')

const plannerInput: V2StoredPlannerInput = {
  taskId: `v2_draft_smoke_${Date.now()}`,
  creationMode: 'text_to_video',
  prompt: '清晨云海穿过群山，镜头缓慢推进。',
  plannerMode: 'deterministic',
  canvas: { fps: 30 },
}
const initialSpec = buildDeterministicRemotionTimelineSpec(plannerInput)
const repository = createV2TimelineDraftRepository()
const draft = await repository.createDraft({
  userId: 1,
  plannerInput,
  spec: initialSpec,
  plannerSource: 'deterministic',
  review: { summary_zh: '初始方案' },
  traceDir: 'draft-smoke-preview',
})

const editedSpec = {
  ...initialSpec,
  scenes: initialSpec.scenes.map((scene, index) =>
    index === 0 ? { ...scene, title: '用户保存的草稿镜头' } : scene,
  ),
}
const saved = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: draft.revision,
  spec: editedSpec,
  kind: 'user_edit',
})
assert.equal(saved.revision, 2)
assert.equal(saved.spec.scenes[0]?.title, '用户保存的草稿镜头')

let staleRevisionExecuted = false
await assert.rejects(
  executeV2TimelineDraftRun({
    repository,
    draftId: draft.id,
    revision: draft.revision,
    userId: 1,
    idempotencyKey: `stale-revision-render-${Date.now()}`,
    runTimeline: async () => {
      staleRevisionExecuted = true
      throw new Error('stale revision must not execute')
    },
  }),
  (error: unknown) => error instanceof V2TimelineRevisionConflictError,
)
assert.equal(staleRevisionExecuted, false, 'a stale confirmed revision must not reach rendering')

await assert.rejects(
  () =>
    repository.saveDraft({
      draftId: draft.id,
      userId: 1,
      baseRevision: 1,
      spec: editedSpec,
      kind: 'user_edit',
    }),
  (error: unknown) => error instanceof V2TimelineRevisionConflictError,
)

const source = await repository.getRevision(draft.id, saved.revision, 1)
assert.ok(source)
const pending = await repository.markPendingRevision({
  draftId: draft.id,
  userId: 1,
  baseRevision: saved.revision,
  callId: 'pending_patch_call',
  instruction: 'apply the requested local revision',
})
assert.deepEqual(
  pending?.pendingTimelineRevisions?.map((item) => item.callId),
  ['pending_patch_call'],
)
let blockedRunExecuted = false
await assert.rejects(
  executeV2TimelineDraftRun({
    repository,
    draftId: draft.id,
    revision: saved.revision,
    userId: 1,
    idempotencyKey: `blocked-persistence-render-${Date.now()}`,
    runTimeline: async () => {
      blockedRunExecuted = true
      throw new Error('blocked run must not execute')
    },
  }),
  /pending timeline revision/i,
)
assert.equal(blockedRunExecuted, false, 'a pending draft revision must block the shared RenderRun entry')

const unrelatedSave = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: saved.revision,
  spec: {
    ...editedSpec,
    notes: [...(editedSpec.notes ?? []), 'unrelated successful edit'],
  },
  kind: 'user_edit',
})
assert.deepEqual(
  unrelatedSave.pendingTimelineRevisions.map((item) => item.callId),
  ['pending_patch_call'],
  'an unrelated successful edit must not clear an earlier failed request',
)
const failedRetry = await repository.markPendingRevision({
  draftId: draft.id,
  userId: 1,
  baseRevision: unrelatedSave.revision,
  callId: 'retry_patch_call',
  replacesCallId: 'pending_patch_call',
  instruction: 'retry the same requested local revision',
})
assert.deepEqual(
  failedRetry?.pendingTimelineRevisions.map((item) => item.callId),
  ['retry_patch_call'],
  'a failed retry replaces its pending lineage instead of accumulating duplicate blockers',
)

await assert.rejects(
  repository.saveDraft({
    draftId: draft.id,
    userId: 1,
    baseRevision: unrelatedSave.revision,
    spec: editedSpec,
    kind: 'user_edit',
    resolvesPendingCallIds: ['different_patch_call'],
  }),
  /pending timeline revision/i,
)
const resolvedPending = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: unrelatedSave.revision,
  spec: {
    ...editedSpec,
    notes: [...(editedSpec.notes ?? []), 'resolved pending revision'],
  },
  kind: 'user_edit',
  resolvesPendingCallIds: ['retry_patch_call'],
})
assert.equal(resolvedPending.revision, unrelatedSave.revision + 1)
assert.deepEqual(resolvedPending.pendingTimelineRevisions, [])
const resolvedSource = await repository.getRevision(draft.id, resolvedPending.revision, 1)
assert.ok(resolvedSource)
const blockedDeliverySpec = {
  ...resolvedSource.spec,
  material_jobs: [{
    id: 'missing_user_material', scene_id: resolvedSource.spec.scenes[0]!.id,
    type: 'request_user_material' as const, status: 'planned' as const,
  }],
}
const blockedDelivery = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: resolvedPending.revision,
  spec: blockedDeliverySpec,
  kind: 'user_edit',
})
let blockedDeliveryExecuted = false
await assert.rejects(
  executeV2TimelineDraftRun({
    repository,
    draftId: draft.id,
    revision: blockedDelivery.revision,
    userId: 1,
    idempotencyKey: `blocked-delivery-render-${Date.now()}`,
    runTimeline: async () => {
      blockedDeliveryExecuted = true
      throw new Error('blocked delivery must not execute')
    },
  }),
  /仍需要用户素材/,
)
assert.equal(blockedDeliveryExecuted, false, 'direct HTTP/runner calls must use the same delivery preflight')
const renderableAgain = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: blockedDelivery.revision,
  spec: resolvedSource.spec,
  kind: 'user_edit',
})
const abandoned = await repository.markPendingRevision({
  draftId: draft.id,
  userId: 1,
  baseRevision: renderableAgain.revision,
  callId: 'abandoned_patch_call',
  instruction: 'an edit the user no longer wants',
})
assert.equal(abandoned?.pendingTimelineRevisions.length, 1)
const dismissed = await repository.dismissPendingRevision({
  draftId: draft.id,
  userId: 1,
  baseRevision: renderableAgain.revision,
  callId: 'abandoned_patch_call',
})
assert.equal(dismissed?.revision, renderableAgain.revision, 'dismissal must not create a fake timeline revision')
assert.deepEqual(dismissed?.pendingTimelineRevisions, [])
await assert.rejects(
  repository.dismissPendingRevision({
    draftId: draft.id,
    userId: 1,
    baseRevision: renderableAgain.revision,
    callId: 'unknown_pending_call',
  }),
  /pending timeline revision/i,
)
const run = await repository.createRenderRun({
  id: `v2_draft_smoke_run_${Date.now()}`,
  draftId: draft.id,
  userId: 1,
  sourceRevision: renderableAgain.revision,
  sourceSpec: renderableAgain.spec,
})
await assert.rejects(
  repository.createRenderRun({
    id: `v2_draft_stale_run_${Date.now()}`,
    draftId: draft.id,
    userId: 1,
    sourceRevision: source.revision,
    sourceSpec: source.spec,
  }),
  (error: unknown) => error instanceof V2TimelineRevisionConflictError,
)
const repositorySource = await readFile(
  new URL('../src/pipeline-v2/timeline-draft-repository.ts', import.meta.url),
  'utf8',
)
const createRenderRunSource = repositorySource.match(
  /async createRenderRun\(input\) \{([\s\S]*?)\n    \},\n\n    async completeRenderRun/,
)?.[1] ?? ''
assert.match(
  createRenderRunSource,
  /v2TimelineDraft\.update\([\s\S]*renderRuns:\s*\{\s*create:/,
  'the revision check and RenderRun creation must be one nested database write',
)
assert.doesNotMatch(
  createRenderRunSource,
  /v2TimelineDraft\.updateMany/,
  'a separate revision claim would leave a save interleaving window before Run creation',
)
const resolvedSpec = {
  ...source.spec,
  scenes: source.spec.scenes.map((scene, index) =>
    index === 0 ? { ...scene, title: '仅属于 RenderRun 的 resolved 镜头' } : scene,
  ),
}
await repository.completeRenderRun({
  id: run.id,
  resolvedSpec,
  outputPath: 'draft-smoke.mp4',
  outputUrl: '/v2-renders/draft-smoke.mp4',
  traceDir: 'draft-smoke-run',
  materialResolution: { ok: true },
  evaluation: { ok: true },
})

const reloaded = await repository.getDraft(draft.id, 1)
assert.ok(reloaded)
assert.equal(reloaded.revision, renderableAgain.revision)
assert.equal(reloaded.spec.scenes[0]?.title, '用户保存的草稿镜头')
assert.notEqual(reloaded.spec.scenes[0]?.title, resolvedSpec.scenes[0]?.title)

let receivedOverride: unknown
const executed = await executeV2TimelineDraftRun({
  repository,
  draftId: draft.id,
  revision: renderableAgain.revision,
  userId: 1,
  idempotencyKey: `persistence-render-${Date.now()}`,
  runTimeline: async (input) => {
    receivedOverride = input.timelineSpecOverride
    return {
      ok: true,
      taskId: input.taskId,
      plannerSource: 'override',
      spec: resolvedSource.spec,
      validation: { ok: true, issues: [] },
      review: {},
      materialResolution: { ok: true },
      standardizedAssets: [],
      render: { outputPath: 'shared-run.mp4' },
      outputPath: 'shared-run.mp4',
      traceDir: 'shared-run-trace',
      evaluation: { ok: true, metrics: {}, warnings: [] },
    } as never
  },
})
assert.deepEqual(receivedOverride, resolvedSource.spec, 'RenderRun must consume the saved revision as its exact override')
assert.equal(executed.draftId, draft.id)
assert.equal(executed.draftRevision, renderableAgain.revision)
assert.equal(executed.outputUrl?.includes(executed.renderRunId), true)

const concurrentDraft = await repository.createDraft({
  userId: 1,
  plannerInput: { ...plannerInput, taskId: `${plannerInput.taskId}_concurrent` },
  spec: { ...initialSpec, task_id: `${initialSpec.task_id}_concurrent` },
  plannerSource: 'deterministic',
  review: { summary_zh: 'concurrent pending writes' },
  traceDir: 'draft-smoke-concurrent',
})
await Promise.all([
  repository.markPendingRevision({
    draftId: concurrentDraft.id,
    userId: 1,
    baseRevision: concurrentDraft.revision,
    callId: 'concurrent_patch_a',
    instruction: 'first failed edit',
  }),
  repository.markPendingRevision({
    draftId: concurrentDraft.id,
    userId: 1,
    baseRevision: concurrentDraft.revision,
    callId: 'concurrent_patch_b',
    instruction: 'second failed edit',
  }),
])
const concurrentReloaded = await repository.getDraft(concurrentDraft.id, 1)
assert.deepEqual(
  concurrentReloaded?.pendingTimelineRevisions.map((item) => item.callId).sort(),
  ['concurrent_patch_a', 'concurrent_patch_b'],
  'concurrent failed revisions must merge instead of losing one writer',
)

console.info('[smoke-v2-timeline-draft-persistence] OK')
await rm(localDataDir, { recursive: true, force: true })
