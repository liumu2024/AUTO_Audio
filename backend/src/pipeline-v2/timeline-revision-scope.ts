import type {
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'

export type V2TimelineRevisionScope = 'subtitle' | 'scene' | 'visual_strategy' | 'transition' | 'global'

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

/**
 * Applies the Tool-authorized revision scope before semantic review and
 * persistence. The planner can remain creative inside the scope, while fields
 * outside it keep their persisted V2 values. Unknown scopes are rejected
 * instead of silently passing the candidate through.
 */
export function applyV2TimelineRevisionScope(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  scope: V2TimelineRevisionScope
  sceneId?: string
  transitionIds?: string[]
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
  if (input.scope === 'global') return input.candidateSpec
  throw new Error(`Unsupported revision scope: ${String(input.scope)}`)
}
