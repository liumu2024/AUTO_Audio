import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'dpl304-v2-history-'))

const { buildDeterministicRemotionTimelineSpec } = await import(
  '../src/pipeline-v2/remotion-timeline-planner.js'
)
const { createV2TimelineDraftRepository } = await import(
  '../src/pipeline-v2/timeline-draft-repository.js'
)
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
} = await import('../src/pipeline-v2/timeline-draft-controller.js')

function request(input: {
  userId?: string
  draftId?: string
  limit?: string
}) {
  return {
    headers: { 'x-user-id': input.userId ?? '1' },
    params: input.draftId ? { draftId: input.draftId } : {},
    query: input.limit ? { limit: input.limit } : {},
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
assert.equal(draft.spec.transitions[0]?.custom_render?.display_name, '历史圆形渐变')
const saved = await repository.saveDraft({
  draftId: draft.id,
  userId: 1,
  baseRevision: draft.revision,
  kind: 'user_edit',
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
const source = await repository.getRevision(saved.id, saved.revision, 1)
assert.ok(source)
const run = await repository.createRenderRun({
  id: `v2_history_run_${Date.now()}`,
  draftId: draft.id,
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

const listResponse = response()
await getV2TimelineDrafts(request({ limit: '10' }), listResponse.res)
const list = listResponse.result()
assert.equal(list.statusCode, 200)
const listed = list.body as { drafts: Array<Record<string, unknown>> }
assert.equal(listed.drafts.length, 1)
assert.equal(listed.drafts[0]?.draftId, draft.id)
assert.equal(listed.drafts[0]?.revision, 2)
assert.equal((listed.drafts[0]?.latestRun as { id?: string })?.id, run.id)

const getResponse = response()
await getV2TimelineDraft(request({ draftId: draft.id }), getResponse.res)
const loaded = getResponse.result()
assert.equal(loaded.statusCode, 200)
const loadedDraft = (loaded.body as { draft: Record<string, unknown> }).draft
assert.ok(loadedDraft.spec)
assert.equal((loadedDraft.latestRevision as { revision?: number })?.revision, 2)

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
