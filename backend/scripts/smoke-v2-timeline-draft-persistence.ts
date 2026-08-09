import assert from 'node:assert/strict'

import { buildDeterministicRemotionTimelineSpec } from '../src/pipeline-v2/remotion-timeline-planner.js'
import {
  createV2TimelineDraftRepository,
  V2TimelineRevisionConflictError,
  type V2StoredPlannerInput,
} from '../src/pipeline-v2/timeline-draft-repository.js'
import { executeV2TimelineDraftRun } from '../src/pipeline-v2/timeline-draft-runner.js'

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
const run = await repository.createRenderRun({
  id: `v2_draft_smoke_run_${Date.now()}`,
  draftId: draft.id,
  sourceRevision: source.revision,
  sourceSpec: source.spec,
})
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
assert.equal(reloaded.revision, 2)
assert.equal(reloaded.spec.scenes[0]?.title, '用户保存的草稿镜头')
assert.notEqual(reloaded.spec.scenes[0]?.title, resolvedSpec.scenes[0]?.title)

let receivedOverride: unknown
const executed = await executeV2TimelineDraftRun({
  repository,
  draftId: draft.id,
  revision: saved.revision,
  userId: 1,
  runTimeline: async (input) => {
    receivedOverride = input.timelineSpecOverride
    return {
      ok: true,
      taskId: input.taskId,
      plannerSource: 'override',
      spec: source.spec,
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
assert.deepEqual(receivedOverride, source.spec, 'RenderRun must consume the saved revision as its exact override')
assert.equal(executed.draftId, draft.id)
assert.equal(executed.draftRevision, saved.revision)
assert.equal(executed.outputUrl?.includes(executed.renderRunId), true)

console.info('[smoke-v2-timeline-draft-persistence] OK')
