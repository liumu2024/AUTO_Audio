import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-scifi-scoped-edit-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = dataDir
process.env.RENDER_COMPONENTS_DIR = path.join(dataDir, 'render-components')

try {
  // A five-scene sci-fi base timeline with two material jobs and captions.
  const base = {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: 'sci_fi_base',
    canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 20 },
    assets: [
      { id: 'asset_generated', type: 'video', src: 'https://example.com/generated.mp4', source: 'generated_asset' },
      { id: 'mat_station', type: 'video', src: 'https://example.com/station.mp4', source: 'user_asset' },
    ],
    scenes: [1, 2, 3, 4, 5].map((index) => ({
      id: `scene_${index}`,
      type: index === 2 ? 'ai_video' : index === 4 ? 'user_video' : 'remotion_card',
      start_sec: (index - 1) * 4,
      duration_sec: 4,
      ...(index === 2 ? { asset_id: 'asset_generated' } : index === 4 ? { asset_id: 'mat_station' } : {}),
      creative_intent: `scene ${index} narrative`,
    })),
    transitions: [1, 2, 3, 4].map((index) => ({
      id: `transition_${index}`,
      from_scene_id: `scene_${index}`,
      to_scene_id: `scene_${index + 1}`,
      type: 'fade',
      duration_sec: 0.35,
    })),
    overlays: [
      { id: 'cap_1', type: 'caption', scene_id: 'scene_1', text: '曙光号进入静默区', start_sec: 0, end_sec: 4 },
      { id: 'cap_2', type: 'caption', scene_id: 'scene_2', text: '注意：气闸舱气压异常', start_sec: 4, end_sec: 8 },
      { id: 'cap_3', type: 'caption', scene_id: 'scene_4', text: '引力波读数正在衰减', start_sec: 12, end_sec: 16 },
    ].map((overlay) => ({ ...overlay, x_pct: 50, y_pct: 86 })),
    caption_tracks: [
      { scene_id: 'scene_1', lines: ['曙光号进入静默区'] },
      { scene_id: 'scene_2', lines: ['注意：气闸舱气压异常'] },
      { scene_id: 'scene_4', lines: ['引力波读数正在衰减'] },
    ].map((track, index) => ({ ...track, id: `track_${index + 1}`, x_pct: 50, y_pct: 86 })),
    material_jobs: [
      { id: 'job_1', scene_id: 'scene_2', type: 'generate_video', status: 'planned', prompt: 'space station airlock', output_asset_id: 'asset_generated' },
      { id: 'job_2', scene_id: 'scene_4', type: 'reuse_asset', status: 'fulfilled', output_asset_id: 'mat_station' },
    ],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
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
  const { normalizeV2TimelineSelection } = await import(
    '../src/pipeline-v2/timeline-selection.js'
  )
  const { applyV2TimelineHardRequirements } = await import(
    '../src/pipeline-v2/hard-requirements.js'
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

  // A scene-targeted subtitle revision must preserve every non-target object,
  // regardless of whether the target is the first, middle, or final scene.
  for (const targetIndex of [0, 2, 4]) {
    const sceneIds = base.scenes.map(() => `scene_${randomUUID()}`)
    const sceneIdByOldId = new Map(base.scenes.map((scene, index) => [scene.id, sceneIds[index]!]))
    const isolatedBase = {
      ...structuredClone(base),
      task_id: `subtitle_scope_${randomUUID()}`,
      scenes: base.scenes.map((scene, index) => ({ ...scene, id: sceneIds[index]! })),
      transitions: base.transitions.map((transition) => ({
        ...transition,
        id: `transition_${randomUUID()}`,
        from_scene_id: sceneIdByOldId.get(transition.from_scene_id)!,
        to_scene_id: sceneIdByOldId.get(transition.to_scene_id)!,
      })),
      overlays: base.overlays.map((overlay) => ({
        ...overlay,
        id: `caption_${randomUUID()}`,
        scene_id: sceneIdByOldId.get(overlay.scene_id!)!,
      })),
      caption_tracks: base.caption_tracks.map((track) => ({
        ...track,
        id: `track_${randomUUID()}`,
        scene_id: sceneIdByOldId.get(track.scene_id)!,
      })),
      material_jobs: base.material_jobs.map((job) => ({
        ...job,
        id: `job_${randomUUID()}`,
        scene_id: sceneIdByOldId.get(job.scene_id)!,
      })),
    }
    const targetSceneId = sceneIds[targetIndex]!
    const requestedText = `target_${randomUUID()}`
    const isolatedCandidate = structuredClone(isolatedBase)
    isolatedCandidate.scenes = isolatedCandidate.scenes.map((scene) => ({
      ...scene,
      creative_intent: `unrelated_${scene.id}`,
    }))
    isolatedCandidate.overlays = isolatedCandidate.overlays.map((overlay) => ({
      ...overlay,
      text: overlay.scene_id === targetSceneId ? requestedText : `unrelated_${overlay.id}`,
    }))
    if (!isolatedCandidate.overlays.some((overlay) => overlay.scene_id === targetSceneId)) {
      const targetScene = isolatedCandidate.scenes[targetIndex]!
      isolatedCandidate.overlays.push({
        id: `caption_${randomUUID()}`,
        type: 'caption',
        scene_id: targetSceneId,
        text: requestedText,
        start_sec: targetScene.start_sec,
        end_sec: targetScene.end_sec,
      })
    }

    const isolated = applyV2TimelineRevisionScope({
      baseSpec: isolatedBase,
      candidateSpec: isolatedCandidate,
      scope: 'subtitle',
      sceneId: targetSceneId,
    })
    assert.deepEqual(isolated.scenes, isolatedBase.scenes)
    assert.deepEqual(isolated.transitions, isolatedBase.transitions)
    assert.deepEqual(isolated.material_jobs, isolatedBase.material_jobs)
    assert.deepEqual(
      isolated.overlays.filter((overlay) => overlay.scene_id !== targetSceneId),
      isolatedBase.overlays.filter((overlay) => overlay.scene_id !== targetSceneId),
      `subtitle target at index ${targetIndex} must not move or rewrite another scene's text`,
    )
    assert.equal(
      isolated.overlays.find((overlay) => overlay.scene_id === targetSceneId)?.text,
      requestedText,
    )

    const checked = applyV2TimelineHardRequirements({
      spec: isolated,
      requirements: {
        schema_version: 'v2_timeline_hard_requirements.v1',
        required_captions: [requestedText],
        use_all_visual_materials: false,
      },
      synthesizeMissing: false,
    })
    assert.deepEqual(checked, isolated, 'revision hard requirements must validate without rebuilding overlays')
  }

  const sharedTrackBase = structuredClone(base)
  sharedTrackBase.caption_tracks = [{
    id: `shared_track_${randomUUID()}`,
    font_size: 42,
  }]
  sharedTrackBase.overlays = sharedTrackBase.overlays.map((overlay, index) =>
    index < 2 ? { ...overlay, track_id: sharedTrackBase.caption_tracks[0]!.id } : overlay)
  const sharedTrackCandidate = structuredClone(sharedTrackBase)
  sharedTrackCandidate.caption_tracks[0] = {
    ...sharedTrackCandidate.caption_tracks[0]!,
    font_size: 12,
  }
  sharedTrackCandidate.overlays[0] = {
    ...sharedTrackCandidate.overlays[0]!,
    text: `target_${randomUUID()}`,
  }
  const sharedTrackScoped = applyV2TimelineRevisionScope({
    baseSpec: sharedTrackBase,
    candidateSpec: sharedTrackCandidate,
    scope: 'subtitle',
    sceneId: sharedTrackBase.overlays[0]!.scene_id,
  })
  assert.deepEqual(
    sharedTrackScoped.caption_tracks,
    sharedTrackBase.caption_tracks,
    'a target subtitle must not mutate a style track shared by another scene',
  )

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
  assert.equal(sceneScoped.transitions.find((transition) => transition.id === 'transition_2')?.type, 'fade')
  assert.equal(sceneScoped.transitions.find((transition) => transition.id === 'transition_1')?.type, 'fade')
  assert.equal(sceneScoped.overlays.find((overlay) => overlay.id === 'cap_2')?.text, base.overlays.find((overlay) => overlay.id === 'cap_2')?.text)
  const baseJob1 = base.material_jobs.find((job) => job.id === 'job_1')
  const scopedJob1 = sceneScoped.material_jobs.find((job) => job.id === 'job_1')
  assert.notEqual(scopedJob1?.prompt, baseJob1?.prompt,
    'scene creative-intent change must re-derive the generation prompt')
  assert.equal(scopedJob1?.status, 'planned', 'scene content changes must invalidate a previously generated shot')
  assert.match(String(scopedJob1?.prompt), /画面应连贯呈现主体、环境、光线、动作和镜头运动/,
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

  // 4d. A structural revision may replace one contiguous scene range while
  // preserving every scene and object outside that range.
  const replacementSceneIds = [`scene_${randomUUID()}`, `scene_${randomUUID()}`]
  const structureCandidate = structuredClone(base)
  const usedStructureAssetId = `asset_${randomUUID()}`
  const unrelatedStructureAssetId = `asset_${randomUUID()}`
  structureCandidate.assets.push(
    { id: usedStructureAssetId, type: 'image', src: 'https://example.invalid/used.png' },
    { id: unrelatedStructureAssetId, type: 'image', src: 'https://example.invalid/unrelated.png' },
  )
  structureCandidate.scenes = [
    { ...base.scenes[0]!, creative_intent: 'UNRELATED prefix rewrite' },
    base.scenes[1]!,
    { ...base.scenes[2]!, id: replacementSceneIds[0], start_sec: 8, duration_sec: 2, asset_id: usedStructureAssetId, creative_intent: 'split first half' },
    { ...base.scenes[2]!, id: replacementSceneIds[1], start_sec: 10, duration_sec: 2, creative_intent: 'split second half' },
    base.scenes[3]!,
    { ...base.scenes[4]!, creative_intent: 'UNRELATED suffix rewrite' },
  ]
  structureCandidate.transitions = [
    base.transitions[0]!,
    { id: `transition_${randomUUID()}`, from_scene_id: 'scene_2', to_scene_id: replacementSceneIds[0], type: 'cut', duration_sec: 0 },
    { id: `transition_${randomUUID()}`, from_scene_id: replacementSceneIds[0], to_scene_id: replacementSceneIds[1], type: 'cut', duration_sec: 0 },
    { id: `transition_${randomUUID()}`, from_scene_id: replacementSceneIds[1], to_scene_id: 'scene_4', type: 'fade', duration_sec: 0.35 },
    base.transitions[3]!,
  ]
  structureCandidate.overlays = [
    { ...base.overlays[0]!, text: 'UNRELATED caption rewrite' },
    ...base.overlays.slice(1),
    { id: `caption_${randomUUID()}`, type: 'caption', scene_id: replacementSceneIds[0], text: 'split caption', start_sec: 8, end_sec: 10, x_pct: 50, y_pct: 86 },
  ]
  structureCandidate.material_jobs = [
    ...base.material_jobs,
    { id: `job_${randomUUID()}`, scene_id: replacementSceneIds[1], type: 'generate_video', status: 'planned', prompt: 'split second half' },
  ]
  const structureScoped = applyV2TimelineRevisionScope({
    baseSpec: base,
    candidateSpec: structureCandidate,
    scope: 'structure',
    sceneIds: ['scene_3'],
  })
  assert.deepEqual(
    structureScoped.scenes.map((scene) => scene.id),
    ['scene_1', 'scene_2', ...replacementSceneIds, 'scene_4', 'scene_5'],
  )
  assert.deepEqual(structureScoped.scenes[0], base.scenes[0])
  assert.deepEqual(structureScoped.scenes.at(-1), base.scenes.at(-1))
  assert.equal(structureScoped.overlays.find((overlay) => overlay.id === 'cap_1')?.text, base.overlays[0]?.text)
  assert.ok(structureScoped.overlays.some((overlay) => overlay.scene_id === replacementSceneIds[0]))
  assert.deepEqual(
    structureScoped.material_jobs.filter((job) => job.scene_id === 'scene_2' || job.scene_id === 'scene_4'),
    base.material_jobs,
  )
  assert.ok(structureScoped.material_jobs.some((job) => job.scene_id === replacementSceneIds[1]))
  assert.ok(structureScoped.assets.some((asset) => asset.id === usedStructureAssetId))
  assert.equal(structureScoped.assets.some((asset) => asset.id === unrelatedStructureAssetId), false)
  assert.deepEqual(structureScoped.transitions[0], base.transitions[0])
  assert.deepEqual(structureScoped.transitions.at(-1), base.transitions.at(-1))
  assert.equal(
    normalizeV2TimelineSelection({
      selectedItemId: 'v2-scene-scene_3',
      nextSpec: structureScoped,
    }),
    null,
    'A split with multiple replacements must clear selection instead of guessing by position.',
  )
  const singleReplacement = {
    ...structureScoped,
    scenes: structureScoped.scenes.filter((scene) => scene.id !== replacementSceneIds[1]),
  }
  assert.equal(
    normalizeV2TimelineSelection({
      selectedItemId: 'v2-scene-scene_3',
      nextSpec: singleReplacement,
    }),
    null,
    'A removed selection must stay cleared until an explicit replacement receipt exists.',
  )
  assert.equal(
    normalizeV2TimelineSelection({
      selectedItemId: 'v2-scene-scene_2',
      nextSpec: structureScoped,
    }),
    'v2-scene-scene_2',
  )

  const briefOnlyAssetId = `mat_${randomUUID()}`
  const briefCandidate = structuredClone(base)
  briefCandidate.assets.push({
    id: briefOnlyAssetId,
    type: 'image',
    src: 'https://example.invalid/brief-reference.png',
    source: 'user_asset',
  })
  briefCandidate.creative_brief = {
    direction: 'Use the supplied image as a global character reference.',
    sample_methods: [],
    image_references: [{
      asset_id: briefOnlyAssetId,
      observed_facts: ['distinctive reference subject'],
      intended_use: 'Keep the subject identity consistent across generated scenes.',
    }],
  }
  const briefScoped = applyV2TimelineRevisionScope({
    baseSpec: base,
    candidateSpec: briefCandidate,
    scope: 'global',
    globalMode: 'brief_update',
  })
  assert.ok(
    briefScoped.assets.some((asset) => asset.id === briefOnlyAssetId),
    'A creative-brief image reference must keep its authoritative asset in the resource closure.',
  )
  assert.equal(evaluateV2TimelineRevisionCommit({
    baseSpec: base,
    candidateSpec: briefScoped,
    scope: 'global',
  }).ok, true, 'a brief_update must count as a real revision without rewriting direct timeline fields')

  assert.equal(evaluateV2TimelineRevisionCommit({
    baseSpec: base,
    candidateSpec: structureScoped,
    scope: 'structure',
    sceneIds: ['scene_3'],
  }).ok, true)
  assert.throws(
    () => applyV2TimelineRevisionScope({ baseSpec: base, candidateSpec: structureCandidate, scope: 'structure', sceneIds: ['scene_2', 'scene_4'] }),
    /contiguous/,
  )

  // Candidate timestamps can be based on illegal edits to protected scenes.
  // When the replacement scenes are normalized back to the persisted range,
  // their bound overlays must keep the same scene-relative timing.
  const timingBase = {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: 'structure_timing_base',
    canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 6 },
    assets: [],
    scenes: [
      { id: 'anchor_before', type: 'remotion_card', start_sec: 0, duration_sec: 2 },
      { id: 'replace_me', type: 'remotion_card', start_sec: 2, duration_sec: 2 },
      { id: 'anchor_after', type: 'remotion_card', start_sec: 4, duration_sec: 2 },
    ],
    transitions: [],
    overlays: [
      { id: 'old_caption', type: 'caption', scene_id: 'replace_me', text: 'old', start_sec: 2.2, end_sec: 3.8, x_pct: 10, y_pct: 80 },
    ],
    material_jobs: [],
    render_policy: { renderer: 'remotion_timeline' },
  } satisfies RemotionTimelineSpecV1
  const timingCandidate = structuredClone(timingBase)
  timingCandidate.scenes = [
    { ...timingBase.scenes[0]!, duration_sec: 3 },
    { id: 'replacement_a', type: 'remotion_card', start_sec: 3, duration_sec: 1 },
    { id: 'replacement_b', type: 'remotion_card', start_sec: 4, duration_sec: 1 },
    { ...timingBase.scenes[2]!, start_sec: 5, duration_sec: 1 },
  ]
  timingCandidate.overlays = [
    { id: 'new_caption', type: 'caption', scene_id: 'replacement_a', text: 'new', start_sec: 3.1, end_sec: 3.9, x_pct: 10, y_pct: 80 },
  ]
  const timingScoped = applyV2TimelineRevisionScope({
    baseSpec: timingBase,
    candidateSpec: timingCandidate,
    scope: 'structure',
    sceneIds: ['replace_me'],
  })
  const normalizedOverlay = timingScoped.overlays.find((overlay) => overlay.id === 'new_caption')
  assert.equal(normalizedOverlay?.start_sec, 2.1)
  assert.equal(normalizedOverlay?.end_sec, 2.9)
  assert.equal(validateRemotionTimelineSpec(timingScoped).ok, true)

  const resizedCandidate = structuredClone(timingBase)
  resizedCandidate.canvas.duration_sec = 7
  resizedCandidate.scenes = [
    timingBase.scenes[0]!,
    { ...timingBase.scenes[1]!, duration_sec: 3 },
    { ...timingBase.scenes[2]!, start_sec: 5 },
  ]
  resizedCandidate.overlays = [
    { ...timingBase.overlays[0]!, end_sec: 4.8 },
  ]
  const resized = applyV2TimelineRevisionScope({
    baseSpec: timingBase,
    candidateSpec: resizedCandidate,
    scope: 'structure',
    sceneIds: ['replace_me'],
    durationMode: 'resize_timeline',
  })
  assert.equal(resized.canvas.duration_sec, 7)
  assert.equal(resized.scenes.find((scene) => scene.id === 'anchor_after')?.start_sec, 5)
  assert.equal(validateRemotionTimelineSpec(resized).ok, true)

  const captionTargetBase = structuredClone(timingBase)
  captionTargetBase.overlays.push({
    id: 'protected_caption', type: 'caption', scene_id: 'replace_me', text: 'protected',
    start_sec: 2.3, end_sec: 3.7, x_pct: 50, y_pct: 70,
  })
  const captionTargetCandidate = structuredClone(captionTargetBase)
  captionTargetCandidate.overlays = captionTargetCandidate.overlays.map((overlay) =>
    overlay.id === 'old_caption'
      ? { ...overlay, start_sec: 2.5, end_sec: 3.5 }
      : { ...overlay, text: 'must not survive' })
  const captionTargetScoped = applyV2TimelineRevisionScope({
    baseSpec: captionTargetBase,
    candidateSpec: captionTargetCandidate,
    scope: 'subtitle',
    sceneId: 'replace_me',
    overlayIds: ['old_caption'],
  })
  assert.equal(captionTargetScoped.overlays.find((overlay) => overlay.id === 'old_caption')?.start_sec, 2.5)
  assert.deepEqual(
    captionTargetScoped.overlays.find((overlay) => overlay.id === 'protected_caption'),
    captionTargetBase.overlays.find((overlay) => overlay.id === 'protected_caption'),
  )

  // 4e. visual_strategy scope: only the target scene's visual fields and its
  // material jobs may change; captions, audio, transitions and other scenes
  // stay untouched.
  const vsCandidate = structuredClone(base)
  const visualAssetId = `mat_${randomUUID()}`
  const orphanVisualAssetId = `mat_${randomUUID()}`
  vsCandidate.assets.push(
    { id: visualAssetId, type: 'image', src: 'https://example.invalid/visual.png', source: 'user_asset' },
    { id: orphanVisualAssetId, type: 'image', src: 'https://example.invalid/orphan.png', source: 'user_asset' },
  )
  vsCandidate.scenes = vsCandidate.scenes.map((scene) => scene.id === 'scene_2'
    ? { ...scene, type: 'image_motion', asset_id: visualAssetId, motion: 'slow_zoom_in', creative_intent: 'SHOULD NOT SURVIVE' }
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
  assert.ok(vsScoped.assets.some((asset) => asset.id === visualAssetId))
  assert.equal(vsScoped.assets.some((asset) => asset.id === orphanVisualAssetId), false)
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
  const baseVisualJob = base.material_jobs.find((job) => job.scene_id === 'scene_2' && job.type === 'generate_video')
  assert.ok(baseVisualJob)
  const visualOnlyCandidate = structuredClone(base)
  visualOnlyCandidate.scenes = visualOnlyCandidate.scenes.map((scene) => scene.id === 'scene_2'
    ? { ...scene, motion: 'slow_zoom_in', background: '#112244' }
    : scene)
  const visualOnlyScoped = applyV2TimelineRevisionScope({
    baseSpec: base,
    candidateSpec: visualOnlyCandidate,
    scope: 'visual_strategy',
    sceneId: 'scene_2',
  })
  const resolvedVisualJob = visualOnlyScoped.material_jobs.find((job) => job.id === baseVisualJob.id)
  assert.equal(resolvedVisualJob?.status, 'planned')
  assert.notEqual(
    resolvedVisualJob?.prompt,
    baseVisualJob.prompt,
    'a visual strategy change must alter the AI generation request even when the model omitted the job prompt',
  )
  assert.match(resolvedVisualJob?.prompt ?? '', /slow_zoom_in/)
  assert.equal(
    evaluateV2TimelineRevisionCommit({ baseSpec: base, candidateSpec: base, scope: 'visual_strategy', sceneId: 'scene_2' }).ok,
    false,
    'zero visual-strategy diff must be rejected',
  )

  // 4e. transition scope may update multiple explicit transition objects in
  // one revision while preserving every scene and non-target transition.
  const transitionBase = structuredClone(base)
  transitionBase.transitions = transitionBase.transitions.map((transition) => ({
    ...transition,
    id: `transition_${randomUUID()}`,
  }))
  const targetTransitionIds = [transitionBase.transitions[0]!.id, transitionBase.transitions[2]!.id]
  const unrelatedTransitionId = transitionBase.transitions[1]!.id
  const firstTargetBase = transitionBase.transitions[0]!
  const transitionCandidate = structuredClone(transitionBase)
  transitionCandidate.transitions = transitionCandidate.transitions.map((transition) =>
    transition.id === targetTransitionIds[0]
      ? {
          ...transition,
          from_scene_id: transitionBase.scenes.at(-2)!.id,
          to_scene_id: transitionBase.scenes.at(-1)!.id,
          type: 'wipe',
        }
      : transition.id === targetTransitionIds[1]
        ? { ...transition, type: 'light_flash' }
        : transition.id === unrelatedTransitionId
          ? { ...transition, type: 'slide' }
          : transition)
  const transitionScoped = applyV2TimelineRevisionScope({
    baseSpec: transitionBase,
    candidateSpec: transitionCandidate,
    scope: 'transition',
    transitionIds: targetTransitionIds,
  })
  assert.equal(transitionScoped.transitions.find((item) => item.id === targetTransitionIds[0])?.type, 'wipe')
  assert.equal(transitionScoped.transitions.find((item) => item.id === targetTransitionIds[1])?.type, 'light_flash')
  assert.equal(
    transitionScoped.transitions.find((item) => item.id === targetTransitionIds[0])?.from_scene_id,
    firstTargetBase.from_scene_id,
    'transition scope must preserve the server-owned source scene',
  )
  assert.equal(
    transitionScoped.transitions.find((item) => item.id === targetTransitionIds[0])?.to_scene_id,
    firstTargetBase.to_scene_id,
    'transition scope must preserve the server-owned destination scene',
  )
  assert.equal(transitionScoped.transitions.find((item) => item.id === unrelatedTransitionId)?.type, 'fade')
  assert.deepEqual(transitionScoped.scenes, transitionBase.scenes)
  assert.deepEqual(transitionScoped.overlays, transitionBase.overlays)
  assert.deepEqual(transitionScoped.material_jobs, transitionBase.material_jobs)
  assert.equal(
    evaluateV2TimelineRevisionCommit({
      baseSpec: transitionBase,
      candidateSpec: transitionScoped,
      scope: 'transition',
      transitionIds: targetTransitionIds,
    }).ok,
    true,
  )

  // 4f. The shared preset contract accepts blur without a natural-language
  // capability gate in the dispatcher.
  const blurTransitionSpec = {
    schema_version: 'remotion_timeline_spec.v1' as const,
    task_id: `blur_${randomUUID()}`,
    canvas: { width: 360, height: 640, fps: 12, duration_sec: 2 },
    assets: [],
    scenes: [
      { id: 'scene_blur_a', type: 'remotion_card', start_sec: 0, duration_sec: 1, title: 'a' },
      { id: 'scene_blur_b', type: 'remotion_card', start_sec: 1, duration_sec: 1, title: 'b' },
    ],
    transitions: [{
      id: 'transition_blur',
      from_scene_id: 'scene_blur_a',
      to_scene_id: 'scene_blur_b',
      type: 'blur' as const,
      duration_sec: 0.5,
    }],
    overlays: [],
    material_jobs: [],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
  }
  assert.equal(validateRemotionTimelineSpec(blurTransitionSpec).ok, true)

  const receiptComponentId = `cmp_receipt_${randomUUID().slice(0, 8)}`
  const { registerRenderComponent } = await import('../src/modules/render-components/component-registry.js')
  await registerRenderComponent({
    id: receiptComponentId,
    purpose: 'scene',
    displayName: '回执归因组件',
    effectSummary: 'render receipt attribution fixture',
    effectBrief: 'render receipt attribution fixture',
    acceptanceCriteria: ['fixture renders'],
    source: "export default function ReceiptFixture() { return <div style={{background: '#111', height: '100%', width: '100%'}} /> }",
  })
  const renderFailureSpec = {
    ...blurTransitionSpec,
    scenes: blurTransitionSpec.scenes.map((scene, index) => index === 0
      ? { ...scene, custom_render: { component_id: receiptComponentId, params: {} } }
      : scene),
  }
  assert.equal(validateRemotionTimelineSpec(renderFailureSpec).ok, true)

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
  const { dispatchV2AgentTool } = await import('../src/pipeline-v2/agent-tools/dispatcher.js')
  const staleTransition = await dispatchV2AgentTool({
    stage: {
      primarySkill: { id: 'v2-timeline-authoring' },
      references: [],
      toolRequest: {
        ref: 'stale_transition',
        callId: `stale_transition_${randomUUID()}`,
        toolId: 'timeline.patch',
        skillId: 'v2-timeline-authoring',
        arguments: { scope: 'transition', transitionIds: [`missing_${randomUUID()}`] },
        requestedMode: 'preview',
        dependsOn: [],
      },
    } as never,
    prompt: '修改一个不存在的转场',
    userId: 7,
    context: {
      materials: [], userIntent: {},
      slots: { aspectRatio: '16:9', durationSec: 20, styleIntensity: 'medium' },
    },
    runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false },
    workspace: {
      version: 1, context: { materials: [], userIntent: {}, slots: { aspectRatio: '16:9', durationSec: 20, styleIntensity: 'medium' } },
      draftId: created.id, baseRevision: created.revision, confirmedRequirements: [], recentTurns: [], rollingSummary: '', recentToolCallIds: [],
    } as never,
  })
  assert.equal(staleTransition.ok, false)
  assert.equal(staleTransition.gate, 'dispatcher_target')

  const renderFailureDraftInput = {
    userId: 7,
    plannerInput: { taskId: 'render_failure', prompt: 'render failure', creationMode: 'text_to_video', plannerMode: 'deterministic', allowPlannerFallback: true } as never,
    spec: renderFailureSpec,
    plannerSource: 'deterministic',
    review: {},
  }
  await assert.rejects(
    drafts.createDraft(renderFailureDraftInput),
    /not authorized/,
    'a persisted draft cannot self-authorize a newly referenced draft component',
  )
  const initialRenderFailureDraft = await drafts.createDraft({
    ...renderFailureDraftInput,
    authorizedDraftComponentIds: [receiptComponentId],
  })
  const unrelatedComponentId = `cmp_unrelated_${randomUUID().slice(0, 8)}`
  await registerRenderComponent({
    id: unrelatedComponentId,
    purpose: 'scene',
    displayName: '无关测试组件',
    effectSummary: 'unrelated fixture',
    effectBrief: 'unrelated fixture',
    acceptanceCriteria: ['fixture renders'],
    source: "export default function UnrelatedFixture() { return <div style={{height: '100%', width: '100%'}} /> }",
  })
  await assert.rejects(
    drafts.saveDraft({
      draftId: initialRenderFailureDraft.id,
      userId: 7,
      baseRevision: initialRenderFailureDraft.revision,
      spec: {
        ...renderFailureSpec,
        scenes: renderFailureSpec.scenes.map((scene, index) => index === 0
          ? { ...scene, custom_render: { component_id: unrelatedComponentId, params: {} } }
          : scene),
      },
      kind: 'user_edit',
    }),
    /not authorized/,
    'a revision cannot self-authorize an unrelated draft component',
  )
  const renderFailureDraft = await drafts.saveDraft({
    draftId: initialRenderFailureDraft.id,
    userId: 7,
    baseRevision: initialRenderFailureDraft.revision,
    spec: { ...renderFailureSpec, notes: ['existing draft component remains bound'] },
    kind: 'user_edit',
  })
  assert.equal(renderFailureDraft.revision, 2, 'a revision may retain a draft component already bound by its base')
  const previousBrowserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE
  process.env.REMOTION_BROWSER_EXECUTABLE = path.join(dataDir, 'missing-browser.exe')
  try {
    const failedRender = await dispatchV2AgentTool({
      stage: {
        primarySkill: { id: 'v2-render-delivery' },
        references: [],
        toolRequest: {
          ref: 'render_failure', callId: `render_failure_${randomUUID()}`, toolId: 'timeline.render',
          skillId: 'v2-render-delivery', arguments: {}, requestedMode: 'execute', dependsOn: [],
        },
      } as never,
      prompt: '渲染当前草稿',
      userId: 7,
      context: {
        materials: [], userIntent: {},
        slots: { aspectRatio: '9:16', durationSec: 2, styleIntensity: 'medium' },
      },
      runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false },
      workspace: {
        version: 1,
        context: { materials: [], userIntent: {}, slots: { aspectRatio: '9:16', durationSec: 2, styleIntensity: 'medium' } },
        draftId: renderFailureDraft.id, baseRevision: renderFailureDraft.revision,
        confirmedRequirements: [], recentTurns: [], rollingSummary: '', recentToolCallIds: [],
      } as never,
      authorization: { granted: true, evidence: 'test' },
    })
    assert.equal(failedRender.ok, false)
    assert.equal(failedRender.gate, 'render_failed')
    assert.equal(failedRender.output?.phase, 'remotion_render')
    assert.deepEqual(
      failedRender.output?.componentIds,
      [],
      'browser failures must not implicate referenced custom components without direct error evidence',
    )
  } finally {
    if (previousBrowserExecutable === undefined) delete process.env.REMOTION_BROWSER_EXECUTABLE
    else process.env.REMOTION_BROWSER_EXECUTABLE = previousBrowserExecutable
  }
  const revision1 = await drafts.getRevision(created.id, 1, 7)
  assert.ok(revision1, 'revision 1 must exist')
  const { creative_brief: createdBrief, ...createdWithoutBrief } = created.spec
  assert.equal(createdBrief?.direction, 'sci-fi')
  assert.deepEqual(createdWithoutBrief, base)
  assert.deepEqual(revision1.spec, created.spec)

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
  const { creative_brief: savedBrief, ...savedWithoutBrief } = saved.spec
  assert.equal(savedBrief?.direction, 'sci-fi')
  assert.deepEqual(savedWithoutBrief, scoped)
  assert.deepEqual(
    (await drafts.getRevision(created.id, 1, 7))?.spec,
    created.spec,
    'revision 1 must remain immutable',
  )
  assert.deepEqual((await drafts.getRevision(created.id, 2, 7))?.spec, saved.spec)

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
