import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-scifi-scoped-edit-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = dataDir

try {
  // 0. Dataset shape gate: the sci-fi suite must contain at least 50 turns.
  const suite = JSON.parse(await readFile(
    new URL('../evals/v2-agent/sci-fi-timeline-editing.v1.json', import.meta.url),
    'utf8',
  )) as { cases: Array<{ id: string; category: string; turns: Array<{ prompt: string; expected: { tools?: string[]; kind?: string } }> }> }
  const turnCount = suite.cases.reduce((sum, item) => sum + item.turns.length, 0)
  assert.ok(turnCount >= 50, `sci-fi suite must have >= 50 turns, got ${turnCount}`)
  assert.ok(new Set(suite.cases.map((item) => item.category)).size >= 4)
  assert.ok(suite.cases.every((item) => item.turns.every((turn) => Array.isArray(turn.expected.tools) && turn.expected.kind)))

  // 1. A five-scene sci-fi base timeline with two material jobs and captions.
  const base = {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: 'sci_fi_base',
    canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 20 },
    assets: [],
    scenes: [1, 2, 3, 4, 5].map((index) => ({
      id: `scene_${index}`,
      type: index === 2 ? 'ai_video' : index === 4 ? 'user_video' : 'remotion_card',
      start_sec: (index - 1) * 4,
      end_sec: index * 4,
      creative_intent: `scene ${index} narrative`,
    })),
    transitions: [1, 2, 3, 4].map((index) => ({
      id: `transition_${index}`,
      from_scene_id: `scene_${index}`,
      to_scene_id: `scene_${index + 1}`,
      type: 'fade',
    })),
    overlays: [
      { id: 'cap_1', type: 'caption', scene_id: 'scene_1', text: '曙光号进入静默区', start_sec: 0, end_sec: 4 },
      { id: 'cap_2', type: 'caption', scene_id: 'scene_2', text: '注意：气闸舱气压异常', start_sec: 4, end_sec: 8 },
      { id: 'cap_3', type: 'caption', scene_id: 'scene_4', text: '引力波读数正在衰减', start_sec: 12, end_sec: 16 },
    ],
    caption_tracks: [
      { scene_id: 'scene_1', lines: ['曙光号进入静默区'] },
      { scene_id: 'scene_2', lines: ['注意：气闸舱气压异常'] },
      { scene_id: 'scene_4', lines: ['引力波读数正在衰减'] },
    ],
    material_jobs: [
      { id: 'job_1', scene_id: 'scene_2', type: 'generate_video', status: 'planned', prompt: 'space station airlock' },
      { id: 'job_2', scene_id: 'scene_4', type: 'use_user_material', status: 'planned', material_id: 'mat_station' },
    ],
    audio: [],
    render_policy: { type: 'remotion_timeline', allow_custom_component: false },
    notes: ['sci-fi draft'],
  }

  // 2. A candidate that illegally touches scene_2's visuals AND legitimately
  // edits scene_2's caption. The subtitle scope must drop the visual change.
  const candidate = structuredClone(base)
  candidate.scenes = candidate.scenes.map((scene, index) => index === 1
    ? { ...scene, creative_intent: 'UNRELATED visual rewrite' }
    : scene)
  candidate.overlays = candidate.overlays.map((overlay) => overlay.id === 'cap_2'
    ? { ...overlay, text: '注意：气压异常' }
    : overlay)
  candidate.caption_tracks = candidate.caption_tracks.map((track) => track.scene_id === 'scene_2'
    ? { ...track, lines: ['注意：气压异常'] }
    : track)

  const { applyV2TimelineRevisionScope } = await import(
    '../src/pipeline-v2/timeline-revision-scope.js'
  )
  const scoped = applyV2TimelineRevisionScope({ baseSpec: base, candidateSpec: candidate, scope: 'subtitle' })

  // 3. Partial-modification guarantee: only caption facts changed.
  assert.deepEqual(scoped.scenes, base.scenes, 'scene visuals must stay untouched')
  assert.deepEqual(scoped.transitions, base.transitions, 'transitions must stay untouched')
  assert.deepEqual(scoped.material_jobs, base.material_jobs, 'material jobs must stay untouched')
  assert.deepEqual(
    scoped.overlays.filter((overlay) => overlay.type !== 'caption'),
    base.overlays.filter((overlay) => overlay.type !== 'caption'),
  )
  assert.deepEqual(
    scoped.overlays.filter((overlay) => overlay.type === 'caption'),
    candidate.overlays.filter((overlay) => overlay.type === 'caption'),
    'caption overlays must come from the candidate',
  )
  assert.equal(scoped.caption_tracks.find((track) => track.scene_id === 'scene_2')?.lines[0], '注意：气压异常')

  // 4. No-diff gate: an unchanged candidate is rejected; a real caption change passes.
  const { evaluateV2TimelineRevisionCommit } = await import(
    '../src/pipeline-v2/timeline-revision-outcome-review.js'
  )
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: base, scope: 'subtitle' }).ok,
    false,
    'zero-diff revision must be rejected',
  )
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: scoped, scope: 'subtitle' }).ok,
    true,
    'scoped caption change must pass the commit gate',
  )

  // 4b. scene scope: only the target scene, its captions and adjacent
  // transitions may change; unrelated scenes are preserved.
  const sceneCandidate = structuredClone(base)
  sceneCandidate.scenes = sceneCandidate.scenes.map((scene) => scene.id === 'scene_2'
    ? { ...scene, creative_intent: 'airlock emergency visual rewrite' }
    : scene.id === 'scene_4'
      ? { ...scene, creative_intent: 'UNRELATED scene 4 rewrite' }
      : scene)
  sceneCandidate.overlays = sceneCandidate.overlays.map((overlay) => overlay.id === 'cap_2'
    ? { ...overlay, text: '注意：气压异常' }
    : overlay)
  sceneCandidate.transitions = sceneCandidate.transitions.map((transition) => transition.id === 'transition_2'
    ? { ...transition, type: 'wipe' }
    : transition)
  const sceneScoped = applyV2TimelineRevisionScope({
    baseSpec: base,
    candidateSpec: sceneCandidate,
    scope: 'scene',
    sceneId: 'scene_2',
  })
  assert.equal(
    sceneScoped.scenes.find((scene) => scene.id === 'scene_2')?.creative_intent,
    'airlock emergency visual rewrite',
  )
  assert.deepEqual(
    sceneScoped.scenes.find((scene) => scene.id === 'scene_4'),
    base.scenes.find((scene) => scene.id === 'scene_4'),
    'scene scope must ignore unrelated scene changes',
  )
  assert.equal(sceneScoped.transitions.find((transition) => transition.id === 'transition_2')?.type, 'wipe')
  assert.equal(sceneScoped.transitions.find((transition) => transition.id === 'transition_1')?.type, 'fade')
  assert.equal(sceneScoped.overlays.find((overlay) => overlay.id === 'cap_2')?.text, '注意：气压异常')
  const baseJob1 = base.material_jobs.find((job) => job.id === 'job_1')
  const scopedJob1 = sceneScoped.material_jobs.find((job) => job.id === 'job_1')
  assert.notEqual(scopedJob1?.prompt, baseJob1?.prompt,
    'scene creative-intent change must re-derive the generation prompt')
  assert.match(String(scopedJob1?.prompt), /生成写实、连贯的视频画面/,
    'derived prompt keeps the generation instruction')
  assert.equal(
    sceneScoped.material_jobs.find((job) => job.id === 'job_2'),
    base.material_jobs.find((job) => job.id === 'job_2'),
    'scene scope must leave unrelated jobs untouched',
  )
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: sceneScoped, scope: 'scene', sceneId: 'scene_2' }).ok,
    true,
    'scoped scene change must pass the commit gate',
  )

  // 4c. global scope allows a full rewrite; unknown scopes and missing
  // sceneId must fail loudly instead of silently passing through.
  assert.equal(evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: sceneCandidate, scope: 'global' }).ok, true)
  assert.throws(
    () => applyV2TimelineRevisionScope({ baseSpec: base, candidateSpec: sceneCandidate, scope: 'bogus' as never }),
    /Unsupported revision scope/,
  )
  assert.throws(
    () => evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: sceneCandidate, scope: 'bogus' as never }),
    /Unsupported revision scope/,
  )
  assert.throws(
    () => applyV2TimelineRevisionScope({ baseSpec: base, candidateSpec: sceneCandidate, scope: 'scene' }),
    /requires a sceneId/,
  )

  // 4d. visual_strategy scope: only the target scene's visual fields and its
  // material jobs may change; captions, audio, transitions and other scenes
  // stay untouched.
  const vsCandidate = structuredClone(base)
  vsCandidate.scenes = vsCandidate.scenes.map((scene) => scene.id === 'scene_2'
    ? { ...scene, type: 'image_motion', motion: 'slow_zoom_in', creative_intent: 'SHOULD NOT SURVIVE' }
    : scene)
  vsCandidate.overlays = vsCandidate.overlays.map((overlay) => overlay.id === 'cap_2'
    ? { ...overlay, text: 'SHOULD NOT SURVIVE' }
    : overlay)
  vsCandidate.material_jobs = vsCandidate.material_jobs.map((job) => job.scene_id === 'scene_2'
    ? { ...job, type: 'reuse_asset', status: 'planned', material_id: 'mat_station' }
    : job)
  const vsScoped = applyV2TimelineRevisionScope({
    baseSpec: base,
    candidateSpec: vsCandidate,
    scope: 'visual_strategy',
    sceneId: 'scene_2',
  })
  assert.equal(vsScoped.scenes.find((scene) => scene.id === 'scene_2')?.type, 'image_motion')
  assert.equal(vsScoped.scenes.find((scene) => scene.id === 'scene_2')?.motion, 'slow_zoom_in')
  assert.equal(
    vsScoped.scenes.find((scene) => scene.id === 'scene_2')?.creative_intent,
    base.scenes.find((scene) => scene.id === 'scene_2')?.creative_intent,
    'creative_intent must stay from base under visual_strategy scope',
  )
  assert.equal(
    vsScoped.overlays.find((overlay) => overlay.id === 'cap_2')?.text,
    base.overlays.find((overlay) => overlay.id === 'cap_2')?.text,
    'captions must stay from base under visual_strategy scope',
  )
  assert.deepEqual(vsScoped.transitions, base.transitions)
  assert.equal(vsScoped.material_jobs.find((job) => job.scene_id === 'scene_2')?.type, 'reuse_asset')
  assert.deepEqual(
    vsScoped.material_jobs.filter((job) => job.scene_id !== 'scene_2'),
    base.material_jobs.filter((job) => job.scene_id !== 'scene_2'),
  )
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: vsScoped, scope: 'visual_strategy', sceneId: 'scene_2' }).ok,
    true,
    'scoped visual strategy change must pass the commit gate',
  )
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: base, scope: 'visual_strategy', sceneId: 'scene_2' }).ok,
    false,
    'zero visual-strategy diff must be rejected',
  )

  // 5. Revision immutability and render-run binding through the draft repository.
  const { createV2TimelineDraftRepository } = await import(
    '../src/pipeline-v2/timeline-draft-repository.js'
  )
  const drafts = createV2TimelineDraftRepository()
  const created = await drafts.createDraft({
    userId: 7,
    plannerInput: { taskId: 'sci_fi', prompt: 'sci-fi', creationMode: 'text_to_video', plannerMode: 'deterministic', allowPlannerFallback: true } as never,
    spec: base,
    plannerSource: 'deterministic',
    review: {},
    traceDir: 'tmp/v2-traces/tasks/sci_fi',
  })
  const revision1 = await drafts.getRevision(created.id, 1, 7)
  assert.ok(revision1, 'revision 1 must exist')
  assert.deepEqual(revision1.spec, base)

  const saved = await drafts.saveDraft({
    draftId: created.id,
    userId: 7,
    baseRevision: 1,
    spec: scoped,
    kind: 'user_edit',
    plannerSource: 'deterministic',
    review: {},
  })
  assert.equal(saved.revision, 2, 'saving a scoped edit must advance to revision 2')
  assert.deepEqual((await drafts.getRevision(created.id, 1, 7))?.spec, base, 'revision 1 must remain immutable')
  assert.deepEqual((await drafts.getRevision(created.id, 2, 7))?.spec, scoped)

  await drafts.createRenderRun({ id: 'run_1', draftId: created.id, sourceRevision: 1, sourceSpec: base })
  await drafts.completeRenderRun({
    id: 'run_1',
    resolvedSpec: base,
    outputPath: 'v2-renders/run_1.mp4',
    outputUrl: '/v2-renders/run_1.mp4',
    traceDir: 'tmp/v2-traces/tasks/sci_fi/render_1',
    materialResolution: {},
    evaluation: {},
  })
  await drafts.createRenderRun({ id: 'run_2', draftId: created.id, sourceRevision: 2, sourceSpec: scoped })
  await drafts.completeRenderRun({
    id: 'run_2',
    resolvedSpec: scoped,
    outputPath: 'v2-renders/run_2.mp4',
    outputUrl: '/v2-renders/run_2.mp4',
    traceDir: 'tmp/v2-traces/tasks/sci_fi/render_2',
    materialResolution: {},
    evaluation: {},
  })

  const history = await drafts.getDraftHistory(created.id, 7)
  assert.ok(history, 'draft history must exist')
  assert.equal(history.latestRevision.revision, 2)
  assert.equal(history.latestRun?.sourceRevision, 2, 'latest render must be bound to revision 2')
  assert.equal(history.latestRun?.outputUrl, '/v2-renders/run_2.mp4')

  // 6. Second render is scoped: untouched segment material jobs are preserved
  // in the run source, and the first run artifact is never overwritten.
  const { prisma } = await import('../src/shared/prisma.service.js')
  const run1 = await prisma.v2TimelineRenderRun.findFirst({ where: { id: 'run_1' } })
  const run2 = await prisma.v2TimelineRenderRun.findFirst({ where: { id: 'run_2' } })
  assert.ok(run1 && run2, 'both render runs must coexist')
  assert.equal(run1.outputUrl, '/v2-renders/run_1.mp4')
  assert.equal(run2.sourceRevision, 2, 'run_2 must be bound to revision 2')
  assert.equal(run2.outputUrl, '/v2-renders/run_2.mp4')
  assert.deepEqual(run1.sourceSpecJson, base, 'run_1 keeps the revision-1 source')
  assert.deepEqual(run2.sourceSpecJson, scoped, 'run_2 uses the scoped revision-2 source')
  assert.deepEqual(
    run2.sourceSpecJson.material_jobs,
    base.material_jobs,
    'untouched segments keep their material jobs in the second render',
  )

  console.log('V2 sci-fi scoped-edit smoke passed (partial modification, revision binding, re-render isolation).')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
