import type {
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import { retainV2TimelineResourceClosure } from './timeline-resource-closure.js'

export type V2TimelineRevisionScope = 'subtitle' | 'scene' | 'structure' | 'visual_strategy' | 'transition' | 'global'

/** Scene fields the visual_strategy scope may override. */
export const VISUAL_STRATEGY_SCENE_FIELDS = ['type', 'fit', 'motion', 'background', 'asset_id'] as const

/**
 * Merges an array so the result keeps the base order as the global skeleton:
 * out-of-scope items stay exactly as in base; in-scope items take candidate
 * content (matched by key), in-scope deletions in candidate are honored, and
 * newly introduced in-scope items are appended. Array order is a global
 * structure that a scoped revision may update content for but never reorder.
 */
function mergeScopedArray<T>(input: {
  base: T[]
  candidate: T[]
  isInScope: (item: T) => boolean
  key: (item: T) => string
}): T[] {
  const { base, candidate, isInScope, key } = input
  const candidateInScope = candidate.filter(isInScope)
  const candidateByKey = new Map(candidateInScope.map((item) => [key(item), item]))
  const baseInScopeKeys = new Set(base.filter(isInScope).map(key))
  const merged: T[] = []
  for (const item of base) {
    if (!isInScope(item)) {
      merged.push(item)
      continue
    }
    const replacement = candidateByKey.get(key(item))
    if (replacement !== undefined) merged.push(replacement)
  }
  for (const item of candidateInScope) {
    if (!baseInScopeKeys.has(key(item))) merged.push(item)
  }
  return merged
}

/**
 * Derives the video-generation prompt for one scene from its own creative
 * intent. Used when a scene revision changes the intent, so the edit actually
 * reaches the generation model instead of leaving the old job prompt in place.
 */
function deriveSceneGenerationPrompt(scene: RemotionTimelineScene): string {
  const subject = scene.creative_intent?.description ?? scene.creative_intent?.title ?? scene.title ?? ''
  return [
    subject,
    '画面应连贯呈现主体、环境、光线、动作和镜头运动',
  ].filter(Boolean).join('；')
}

function applyVisualStrategyScene(
  base: RemotionTimelineScene,
  candidate: RemotionTimelineScene,
): RemotionTimelineScene {
  const merged = { ...base }
  for (const field of VISUAL_STRATEGY_SCENE_FIELDS) {
    if (field in candidate) {
      ;(merged as unknown as Record<string, unknown>)[field] =
        (candidate as unknown as Record<string, unknown>)[field]
    }
  }
  return merged
}

function visualStrategyChanged(
  base: RemotionTimelineScene,
  candidate: RemotionTimelineScene,
): boolean {
  const project = (scene: RemotionTimelineScene) => Object.fromEntries(
    VISUAL_STRATEGY_SCENE_FIELDS.map((field) => [field, scene[field]]),
  )
  return JSON.stringify(project(base)) !== JSON.stringify(project(candidate))
}

function visualStrategyPrompt(scene: RemotionTimelineScene): string {
  return [
    `presentation_type=${scene.type}`,
    scene.fit ? `fit=${scene.fit}` : '',
    scene.motion ? `motion=${scene.motion}` : '',
    scene.background ? `background=${scene.background}` : '',
    scene.asset_id ? `asset=${scene.asset_id}` : '',
  ].filter(Boolean).join('; ')
}

function applyStructureScope(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  sceneIds?: string[]
  durationMode?: 'preserve_range' | 'resize_timeline'
}): RemotionTimelineSpecV1 {
  const requested = [...new Set(input.sceneIds ?? [])]
  if (requested.length === 0) throw new Error('Structure revision scope requires sceneIds.')
  const baseIndices = requested.map((id) => input.baseSpec.scenes.findIndex((scene) => scene.id === id))
  if (baseIndices.some((index) => index < 0)) throw new Error('Structure revision scope contains an unknown sceneId.')
  const sorted = [...baseIndices].sort((a, b) => a - b)
  if (sorted.some((index, offset) => index !== sorted[0]! + offset)) {
    throw new Error('Structure revision sceneIds must form one contiguous range.')
  }

  const startIndex = sorted[0]!
  const endIndex = sorted.at(-1)!
  const before = input.baseSpec.scenes.slice(0, startIndex)
  const after = input.baseSpec.scenes.slice(endIndex + 1)
  const previousAnchorId = before.at(-1)?.id
  const nextAnchorId = after[0]?.id
  const candidateStart = previousAnchorId
    ? input.candidateSpec.scenes.findIndex((scene) => scene.id === previousAnchorId) + 1
    : 0
  const candidateEnd = nextAnchorId
    ? input.candidateSpec.scenes.findIndex((scene) => scene.id === nextAnchorId)
    : input.candidateSpec.scenes.length
  if ((previousAnchorId && candidateStart === 0) || (nextAnchorId && candidateEnd < 0) || candidateEnd < candidateStart) {
    throw new Error('Structure revision candidate must preserve the surrounding scene anchors.')
  }
  const protectedIds = new Set([...before, ...after].map((scene) => scene.id))
  const replacement = input.candidateSpec.scenes.slice(candidateStart, candidateEnd)
  if (replacement.some((scene) => protectedIds.has(scene.id))) {
    throw new Error('Structure revision candidate reordered a protected scene.')
  }
  const replacedDuration = input.baseSpec.scenes.slice(startIndex, endIndex + 1)
    .reduce((sum, scene) => sum + scene.duration_sec, 0)
  const replacementDuration = replacement.reduce((sum, scene) => sum + scene.duration_sec, 0)
  const durationDelta = replacementDuration - replacedDuration
  if (input.durationMode !== 'resize_timeline' && Math.abs(durationDelta) > 0.001) {
    throw new Error('Structure revision must preserve the target range duration.')
  }
  let cursor = input.baseSpec.scenes[startIndex]!.start_sec
  const normalizedReplacement = replacement.map((scene) => {
    const start = cursor
    cursor += scene.duration_sec
    return { ...scene, start_sec: start }
  })
  const replacementTimeShiftBySceneId = new Map(normalizedReplacement.map((scene, index) => [
    scene.id,
    scene.start_sec - replacement[index]!.start_sec,
  ]))
  const targetIds = new Set(requested)
  const replacementIds = new Set(normalizedReplacement.map((scene) => scene.id))
  const candidateTrackIds = new Set(input.candidateSpec.overlays
    .filter((overlay) => overlay.scene_id && replacementIds.has(overlay.scene_id) && overlay.track_id)
    .map((overlay) => overlay.track_id as string))
  const baseTrackIds = new Set(input.baseSpec.overlays
    .filter((overlay) => overlay.scene_id && targetIds.has(overlay.scene_id) && overlay.track_id)
    .map((overlay) => overlay.track_id as string))
  const protectedTrackIds = new Set(input.baseSpec.overlays
    .filter((overlay) => overlay.scene_id && !targetIds.has(overlay.scene_id) && overlay.track_id)
    .map((overlay) => overlay.track_id as string))
  const shiftedAfter = Math.abs(durationDelta) <= 0.001
    ? after
    : after.map((scene) => ({ ...scene, start_sec: scene.start_sec + durationDelta }))
  const scenes = [...before, ...normalizedReplacement, ...shiftedAfter]
  const candidateTransitions = input.candidateSpec.transitions.filter((transition) =>
    replacementIds.has(transition.from_scene_id)
      || replacementIds.has(transition.to_scene_id)
      || (replacementIds.size === 0
        && transition.from_scene_id === previousAnchorId
        && transition.to_scene_id === nextAnchorId))
  const transitionByPair = new Map([
    ...input.baseSpec.transitions
      .filter((transition) => !targetIds.has(transition.from_scene_id) && !targetIds.has(transition.to_scene_id))
      .map((transition) => [`${transition.from_scene_id}:${transition.to_scene_id}`, transition] as const),
    ...candidateTransitions.map((transition) => [`${transition.from_scene_id}:${transition.to_scene_id}`, transition] as const),
  ])
  const transitions = scenes.slice(0, -1).flatMap((scene, index) => {
    const transition = transitionByPair.get(`${scene.id}:${scenes[index + 1]!.id}`)
    return transition ? [transition] : []
  })
  const baseAssetIds = new Set(input.baseSpec.assets.map((asset) => asset.id))
  const candidateReplacementOverlays = input.candidateSpec.overlays
    .filter((overlay) => overlay.scene_id && replacementIds.has(overlay.scene_id))
    .map((overlay) => {
      const shift = replacementTimeShiftBySceneId.get(overlay.scene_id as string) ?? 0
      return shift === 0 ? overlay : {
        ...overlay,
        start_sec: overlay.start_sec + shift,
        end_sec: overlay.end_sec + shift,
      }
    })
  const candidateReplacementJobs = input.candidateSpec.material_jobs
    .filter((job) => replacementIds.has(job.scene_id))
  const referencedCandidateAssetIds = new Set<string>()
  for (const scene of normalizedReplacement) if (scene.asset_id) referencedCandidateAssetIds.add(scene.asset_id)
  for (const overlay of candidateReplacementOverlays) if (overlay.asset_id) referencedCandidateAssetIds.add(overlay.asset_id)
  for (const job of candidateReplacementJobs) {
    if (job.input_asset_id) referencedCandidateAssetIds.add(job.input_asset_id)
    if (job.output_asset_id) referencedCandidateAssetIds.add(job.output_asset_id)
    if (job.fallback_asset_id) referencedCandidateAssetIds.add(job.fallback_asset_id)
  }

  const shiftedAfterIds = new Set(after.map((scene) => scene.id))
  const replacedEnd = input.baseSpec.scenes[endIndex]!.start_sec
    + input.baseSpec.scenes[endIndex]!.duration_sec
  const shiftProtectedOverlay = (overlay: RemotionTimelineSpecV1['overlays'][number]) => {
    const followsRange = overlay.scene_id
      ? shiftedAfterIds.has(overlay.scene_id)
      : overlay.start_sec >= replacedEnd - 0.001
    if (!followsRange || Math.abs(durationDelta) <= 0.001) return overlay
    return { ...overlay, start_sec: overlay.start_sec + durationDelta, end_sec: overlay.end_sec + durationDelta }
  }
  const shiftAudio = (clip: NonNullable<RemotionTimelineSpecV1['audio']>[number]) => {
    if (Math.abs(durationDelta) <= 0.001 || clip.end_sec <= replacedEnd + 0.001) return clip
    if (clip.start_sec >= replacedEnd - 0.001) {
      return { ...clip, start_sec: clip.start_sec + durationDelta, end_sec: clip.end_sec + durationDelta }
    }
    return { ...clip, end_sec: clip.end_sec + durationDelta }
  }

  return {
    ...input.baseSpec,
    canvas: input.durationMode === 'resize_timeline'
      ? { ...input.baseSpec.canvas, duration_sec: input.baseSpec.canvas.duration_sec + durationDelta }
      : input.baseSpec.canvas,
    assets: [
      ...input.baseSpec.assets,
      ...input.candidateSpec.assets.filter((asset) =>
        !baseAssetIds.has(asset.id) && referencedCandidateAssetIds.has(asset.id)),
    ],
    scenes,
    transitions,
    overlays: [
      ...input.baseSpec.overlays
        .filter((overlay) => !overlay.scene_id || !targetIds.has(overlay.scene_id))
        .map(shiftProtectedOverlay),
      ...candidateReplacementOverlays,
    ],
    caption_tracks: [
      ...(input.baseSpec.caption_tracks ?? []).filter((track) =>
        !baseTrackIds.has(track.id) || protectedTrackIds.has(track.id)),
      ...(input.candidateSpec.caption_tracks ?? []).filter((track) =>
        candidateTrackIds.has(track.id) && !protectedTrackIds.has(track.id)),
    ],
    material_jobs: [
      ...input.baseSpec.material_jobs.filter((job) => !targetIds.has(job.scene_id)),
      ...candidateReplacementJobs,
    ],
    audio: input.baseSpec.audio?.map(shiftAudio),
  }
}

/**
 * Applies the Tool-authorized revision scope before semantic review and
 * persistence. The planner can remain creative inside the scope, while fields
 * outside it keep their persisted V2 values. Unknown scopes are rejected
 * instead of silently passing the candidate through.
 */
function applyV2TimelineRevisionScopeUnchecked(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  scope: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  overlayIds?: string[]
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
  durationMode?: 'preserve_range' | 'resize_timeline'
}): RemotionTimelineSpecV1 {
  if (input.scope === 'subtitle') {
    if (input.sceneId) {
      const requestedOverlayIds = new Set(input.overlayIds ?? [])
      if (requestedOverlayIds.size > 0) {
        const invalid = [...requestedOverlayIds].filter((id) => !input.baseSpec.overlays.some((overlay) =>
          overlay.id === id && overlay.type === 'caption' && overlay.scene_id === input.sceneId))
        if (invalid.length > 0) throw new Error(`Subtitle revision contains invalid overlayIds: ${invalid.join(', ')}`)
      }
      const inTarget = (overlay: RemotionTimelineSpecV1['overlays'][number]) =>
        overlay.type === 'caption'
        && overlay.scene_id === input.sceneId
        && (requestedOverlayIds.size === 0 || requestedOverlayIds.has(overlay.id))
      const targetTrackIds = new Set([
        ...input.baseSpec.overlays,
        ...input.candidateSpec.overlays,
      ].filter((overlay) => inTarget(overlay) && overlay.track_id)
        .map((overlay) => overlay.track_id as string))
      const protectedTrackIds = new Set(input.baseSpec.overlays
        .filter((overlay) =>
          overlay.type === 'caption' && !inTarget(overlay) && overlay.track_id)
        .map((overlay) => overlay.track_id as string))
      return {
        ...input.baseSpec,
        caption_tracks: mergeScopedArray({
          base: input.baseSpec.caption_tracks ?? [],
          candidate: input.candidateSpec.caption_tracks ?? [],
          isInScope: (track) => targetTrackIds.has(track.id) && !protectedTrackIds.has(track.id),
          key: (track) => track.id,
        }),
        overlays: mergeScopedArray({
          base: input.baseSpec.overlays,
          candidate: input.candidateSpec.overlays,
          isInScope: inTarget,
          key: (overlay) => overlay.id,
        }),
      }
    }
    return {
      ...input.baseSpec,
      caption_tracks: input.candidateSpec.caption_tracks ?? input.baseSpec.caption_tracks,
      overlays: [
        ...input.baseSpec.overlays.filter((overlay) => overlay.type !== 'caption'),
        ...input.candidateSpec.overlays.filter((overlay) => overlay.type === 'caption'),
      ],
    }
  }
  if (input.scope === 'scene') {
    const sceneId = input.sceneId
    if (!sceneId) throw new Error('Scene revision scope requires a sceneId.')
    const candidateScene = input.candidateSpec.scenes.find((scene) => scene.id === sceneId)
    const baseScene = input.baseSpec.scenes.find((scene) => scene.id === sceneId)
    const sceneNarrativeChanged = candidateScene != null && baseScene != null && JSON.stringify({
      creative_intent: baseScene.creative_intent,
      title: baseScene.title,
      subtitle: baseScene.subtitle,
      body: baseScene.body,
    }) !== JSON.stringify({
      creative_intent: candidateScene.creative_intent,
      title: candidateScene.title,
      subtitle: candidateScene.subtitle,
      body: candidateScene.body,
    })
    const candidateJobById = new Map(input.candidateSpec.material_jobs.map((job) => [job.id, job]))
    const targetCandidateJobs = input.candidateSpec.material_jobs.filter((job) => job.scene_id === sceneId)
    const conditionedAssetIds = new Set(targetCandidateJobs.flatMap((job) =>
      job.input_asset_id ? [job.input_asset_id] : []))
    const candidateImageReferences = input.candidateSpec.creative_brief?.image_references.filter((reference) =>
      conditionedAssetIds.has(reference.asset_id)) ?? []
    const baseImageReferences = input.baseSpec.creative_brief?.image_references ?? []
    const targetReferenceIds = new Set(candidateImageReferences.map((reference) => reference.asset_id))
    return {
      ...input.baseSpec,
      scenes: input.baseSpec.scenes.map((scene) =>
        scene.id === sceneId && candidateScene
          ? {
              ...scene,
              creative_intent: candidateScene.creative_intent,
              title: candidateScene.title,
              subtitle: candidateScene.subtitle,
              body: candidateScene.body,
            }
          : scene),
      creative_brief: input.baseSpec.creative_brief
        ? {
            ...input.baseSpec.creative_brief,
            image_references: [
              ...baseImageReferences.filter((reference) => !targetReferenceIds.has(reference.asset_id)),
              ...candidateImageReferences,
            ],
          }
        : input.candidateSpec.creative_brief
          ? {
              direction: input.candidateSpec.creative_brief.direction,
              sample_methods: input.candidateSpec.creative_brief.sample_methods,
              image_references: candidateImageReferences,
            }
          : undefined,
      material_jobs: mergeScopedArray({
        base: input.baseSpec.material_jobs,
        candidate: input.candidateSpec.material_jobs,
        isInScope: (job) => job.scene_id === sceneId,
        key: (job) => job.id,
      }).map((job) => {
        if (job.scene_id !== sceneId || job.type !== 'generate_video' || !sceneNarrativeChanged || !candidateScene) {
          return job
        }
        const candidatePrompt = candidateJobById.get(job.id)?.prompt?.trim()
        return {
          ...job,
          status: 'planned',
          prompt: candidatePrompt && candidatePrompt !== input.baseSpec.material_jobs.find((baseJob) => baseJob.id === job.id)?.prompt
            ? candidatePrompt
            : deriveSceneGenerationPrompt(candidateScene),
        }
      }),
    }
  }
  if (input.scope === 'structure') return applyStructureScope(input)
  if (input.scope === 'visual_strategy') {
    const sceneId = input.sceneId
    if (!sceneId) throw new Error('Visual strategy revision scope requires a sceneId.')
    const candidateScene = input.candidateSpec.scenes.find((scene) => scene.id === sceneId)
    const baseScene = input.baseSpec.scenes.find((scene) => scene.id === sceneId)
    const strategyChanged = Boolean(baseScene && candidateScene && visualStrategyChanged(baseScene, candidateScene))
    return {
      ...input.baseSpec,
      scenes: input.baseSpec.scenes.map((scene) =>
        scene.id === sceneId && candidateScene ? applyVisualStrategyScene(scene, candidateScene) : scene),
      material_jobs: mergeScopedArray({
        base: input.baseSpec.material_jobs,
        candidate: input.candidateSpec.material_jobs,
        isInScope: (job) => job.scene_id === sceneId,
        key: (job) => job.id,
      }).map((job) => {
        if (job.scene_id !== sceneId || job.type !== 'generate_video') return job
        const baseJob = input.baseSpec.material_jobs.find((item) => item.id === job.id)
        if (!baseJob) return job
        const candidatePrompt = job.prompt?.trim()
        const promptChanged = candidatePrompt && candidatePrompt !== baseJob.prompt?.trim()
        if (!strategyChanged && JSON.stringify(baseJob) === JSON.stringify(job)) return job
        return {
          ...job,
          status: 'planned',
          prompt: promptChanged || !candidateScene
            ? candidatePrompt
            : [baseJob.prompt?.trim(), visualStrategyPrompt(candidateScene)].filter(Boolean).join('\n'),
        }
      }),
    }
  }
  if (input.scope === 'transition') {
    const transitionIds = new Set(input.transitionIds)
    if (transitionIds.size === 0) throw new Error('Transition revision scope requires transitionIds.')
    const candidateById = new Map(input.candidateSpec.transitions.map((transition) => [transition.id, transition]))
    return {
      ...input.baseSpec,
      transitions: input.baseSpec.transitions.map((transition) => {
        const candidate = transitionIds.has(transition.id) ? candidateById.get(transition.id) : undefined
        return candidate
          ? {
              ...candidate,
              id: transition.id,
              from_scene_id: transition.from_scene_id,
              to_scene_id: transition.to_scene_id,
            }
          : transition
      }),
    }
  }
  if (input.scope === 'global') {
    if (input.globalMode === 'brief_update') {
      return {
        ...input.baseSpec,
        creative_brief: input.candidateSpec.creative_brief
          ? {
              ...input.candidateSpec.creative_brief,
              planning_gaps: input.baseSpec.creative_brief?.planning_gaps,
            }
          : input.baseSpec.creative_brief,
      }
    }
    if (input.globalMode === 'full_replan') return input.candidateSpec
    throw new Error('Global revision scope requires brief_update or full_replan mode.')
  }
  throw new Error(`Unsupported revision scope: ${String(input.scope)}`)
}

export function applyV2TimelineRevisionScope(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  scope: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  overlayIds?: string[]
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
  durationMode?: 'preserve_range' | 'resize_timeline'
}): RemotionTimelineSpecV1 {
  return retainV2TimelineResourceClosure({
    baseSpec: input.baseSpec,
    candidateSpec: input.candidateSpec,
    mergedSpec: applyV2TimelineRevisionScopeUnchecked(input),
  })
}
