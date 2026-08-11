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
    `镜头作用：${scene.visual_role ?? 'feature'}`,
    '生成写实、连贯的视频画面，明确主体、环境、光线、动作和镜头运动',
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

function applyStructureScope(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  sceneIds?: string[]
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
  if (Math.abs(replacedDuration - replacementDuration) > 0.001) {
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
  const scenes = [...before, ...normalizedReplacement, ...after]
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

  return {
    ...input.baseSpec,
    assets: [
      ...input.baseSpec.assets,
      ...input.candidateSpec.assets.filter((asset) =>
        !baseAssetIds.has(asset.id) && referencedCandidateAssetIds.has(asset.id)),
    ],
    scenes,
    transitions,
    overlays: [
      ...input.baseSpec.overlays.filter((overlay) => !overlay.scene_id || !targetIds.has(overlay.scene_id)),
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
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
}): RemotionTimelineSpecV1 {
  if (input.scope === 'subtitle') {
    if (input.sceneId) {
      const targetTrackIds = new Set([
        ...input.baseSpec.overlays,
        ...input.candidateSpec.overlays,
      ].filter((overlay) =>
        overlay.type === 'caption' && overlay.scene_id === input.sceneId && overlay.track_id)
        .map((overlay) => overlay.track_id as string))
      const protectedTrackIds = new Set(input.baseSpec.overlays
        .filter((overlay) =>
          overlay.type === 'caption' && overlay.scene_id !== input.sceneId && overlay.track_id)
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
          isInScope: (overlay) => overlay.type === 'caption' && overlay.scene_id === input.sceneId,
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
    const creativeIntentChanged =
      JSON.stringify(baseScene?.creative_intent) !== JSON.stringify(candidateScene?.creative_intent)
    const sceneCaptionTrackIds = new Set(
      input.candidateSpec.overlays
        .filter((overlay) => overlay.type === 'caption' && overlay.scene_id === sceneId && overlay.track_id)
        .map((overlay) => overlay.track_id as string),
    )
    return {
      ...input.baseSpec,
      scenes: input.baseSpec.scenes.map((scene) =>
        scene.id === sceneId && candidateScene ? candidateScene : scene),
      caption_tracks: mergeScopedArray({
        base: input.baseSpec.caption_tracks ?? [],
        candidate: input.candidateSpec.caption_tracks ?? [],
        isInScope: (track) => sceneCaptionTrackIds.has(track.id),
        key: (track) => track.id,
      }),
      overlays: mergeScopedArray({
        base: input.baseSpec.overlays,
        candidate: input.candidateSpec.overlays,
        isInScope: (overlay) => overlay.type === 'caption' && overlay.scene_id === sceneId,
        key: (overlay) => overlay.id,
      }),
      transitions: mergeScopedArray({
        base: input.baseSpec.transitions,
        candidate: input.candidateSpec.transitions,
        isInScope: (transition) =>
          transition.from_scene_id === sceneId || transition.to_scene_id === sceneId,
        key: (transition) => `${transition.from_scene_id}:${transition.to_scene_id}`,
      }),
      material_jobs: input.baseSpec.material_jobs.map((job) =>
        job.scene_id === sceneId && job.type === 'generate_video' && creativeIntentChanged && candidateScene
          ? { ...job, prompt: deriveSceneGenerationPrompt(candidateScene) }
          : job),
    }
  }
  if (input.scope === 'structure') return applyStructureScope(input)
  if (input.scope === 'visual_strategy') {
    const sceneId = input.sceneId
    if (!sceneId) throw new Error('Visual strategy revision scope requires a sceneId.')
    const candidateScene = input.candidateSpec.scenes.find((scene) => scene.id === sceneId)
    return {
      ...input.baseSpec,
      scenes: input.baseSpec.scenes.map((scene) =>
        scene.id === sceneId && candidateScene ? applyVisualStrategyScene(scene, candidateScene) : scene),
      material_jobs: mergeScopedArray({
        base: input.baseSpec.material_jobs,
        candidate: input.candidateSpec.material_jobs,
        isInScope: (job) => job.scene_id === sceneId,
        key: (job) => job.id,
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
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
}): RemotionTimelineSpecV1 {
  return retainV2TimelineResourceClosure({
    baseSpec: input.baseSpec,
    candidateSpec: input.candidateSpec,
    mergedSpec: applyV2TimelineRevisionScopeUnchecked(input),
  })
}
