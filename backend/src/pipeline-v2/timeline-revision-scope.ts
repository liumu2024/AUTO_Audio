import type {
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
  V2CreativeBrief,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import { retainV2TimelineResourceClosure } from './timeline-resource-closure.js'

export type V2TimelineRevisionScope = 'subtitle' | 'scene' | 'structure' | 'visual_strategy' | 'transition' | 'global'

export const V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION = 'v2_timeline_revision_fragment.v1'
export const V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION = 'v2_timeline_revision_group_fragment.v1'

export type V2TimelineRevisionGroupScope = Extract<
  V2TimelineRevisionScope,
  'scene' | 'visual_strategy' | 'subtitle' | 'transition'
>

export interface V2TimelineRevisionGroupItem {
  ref: string
  callId: string
  scope: V2TimelineRevisionGroupScope
  instruction: string
  sceneId: string
  overlayIds?: string[]
  transitionIds?: string[]
  requiredMaterialIds?: string[]
  useSampleReference?: boolean
}

/** Server-authorized same-scene revision bundle. It is never accepted from a
 * public Tool argument; the server derives it from already validated scopes. */
export interface V2TimelineRevisionGroup {
  sceneId: string
  items: V2TimelineRevisionGroupItem[]
  resolvesPendingCallId?: string
}

export interface V2TimelineRevisionGroupPartition {
  groups: V2TimelineRevisionGroup[]
  invalid: Array<{ callIds: string[]; message: string }>
}

export interface V2TimelineRevisionGroupFragment {
  schema_version: typeof V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION
  image_references?: NonNullable<RemotionTimelineSpecV1['creative_brief']>['image_references']
  scenes?: RemotionTimelineSpecV1['scenes']
  transitions?: RemotionTimelineSpecV1['transitions']
  caption_tracks?: NonNullable<RemotionTimelineSpecV1['caption_tracks']>
  overlays?: RemotionTimelineSpecV1['overlays']
  material_jobs?: RemotionTimelineSpecV1['material_jobs']
}

/**
 * Model-facing revision payload. Arrays contain the complete objects inside
 * the authorized scope, never a second full timeline or model-owned assets.
 * The server merges this fragment back into the persisted base revision.
 */
export interface V2TimelineRevisionFragment {
  schema_version: typeof V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION
  scope: V2TimelineRevisionScope
  creative_brief?: RemotionTimelineSpecV1['creative_brief']
  image_references?: NonNullable<RemotionTimelineSpecV1['creative_brief']>['image_references']
  scenes?: RemotionTimelineSpecV1['scenes']
  transitions?: RemotionTimelineSpecV1['transitions']
  caption_tracks?: NonNullable<RemotionTimelineSpecV1['caption_tracks']>
  overlays?: RemotionTimelineSpecV1['overlays']
  material_jobs?: RemotionTimelineSpecV1['material_jobs']
}

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

function mergeImageReferencesForJobs(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  jobs: RemotionTimelineSpecV1['material_jobs']
}): RemotionTimelineSpecV1['creative_brief'] {
  const referencedImageAssetIds = new Set(input.jobs.flatMap((job) => [
    ...(job.input_asset_id ? [job.input_asset_id] : []),
    ...(job.type === 'reuse_asset' && job.output_asset_id ? [job.output_asset_id] : []),
  ]))
  if (referencedImageAssetIds.size === 0) return input.baseSpec.creative_brief
  const candidateReferences = preserveObservedImageFacts(
    input.baseSpec.creative_brief,
    input.candidateSpec.creative_brief?.image_references ?? [],
  )
    .filter((reference) => referencedImageAssetIds.has(reference.asset_id))
  const candidateReferenceIds = new Set(candidateReferences.map((reference) => reference.asset_id))
  const baseBrief = input.baseSpec.creative_brief
  if (!baseBrief) return input.candidateSpec.creative_brief
  return {
    ...baseBrief,
    image_references: [
      ...baseBrief.image_references.filter((reference) => !candidateReferenceIds.has(reference.asset_id)),
      ...candidateReferences,
    ],
  }
}

function preserveObservedImageFacts(
  baseBrief: V2CreativeBrief | undefined,
  candidateReferences: V2CreativeBrief['image_references'],
) {
  const baseReferences = new Map(
    (baseBrief?.image_references ?? []).map((reference) => [reference.asset_id, reference]),
  )
  return candidateReferences.map((reference) => {
    const existing = baseReferences.get(reference.asset_id)
    return existing
      ? { ...reference, observed_facts: existing.observed_facts }
      : reference
  })
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
    creative_brief: mergeImageReferencesForJobs({
      baseSpec: input.baseSpec,
      candidateSpec: input.candidateSpec,
      jobs: candidateReplacementJobs,
    }),
    assets: [
      ...input.baseSpec.assets,
      ...input.candidateSpec.assets.filter((asset) =>
        !baseAssetIds.has(asset.id) && referencedCandidateAssetIds.has(asset.id)),
    ],
    scenes,
    transitions,
    overlays: mergeScopedArray({
      base: input.baseSpec.overlays.map(shiftProtectedOverlay),
      candidate: candidateReplacementOverlays,
      isInScope: (overlay) => Boolean(
        overlay.scene_id
        && (targetIds.has(overlay.scene_id) || replacementIds.has(overlay.scene_id)),
      ),
      key: (overlay) => overlay.id,
    }),
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
    const requestedOverlayIds = new Set(input.overlayIds ?? [])
    if (input.sceneId || requestedOverlayIds.size > 0) {
      const invalid = [...requestedOverlayIds].filter((id) => !input.baseSpec.overlays.some((overlay) =>
        overlay.id === id
        && overlay.type === 'caption'
        && (!input.sceneId || overlay.scene_id === input.sceneId)))
      if (invalid.length > 0) throw new Error(`Subtitle revision contains invalid overlayIds: ${invalid.join(', ')}`)
      const inTarget = (overlay: RemotionTimelineSpecV1['overlays'][number]) =>
        overlay.type === 'caption'
        && (!input.sceneId || overlay.scene_id === input.sceneId)
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
    const baseTargetJobIds = new Set(input.baseSpec.material_jobs
      .filter((job) => job.scene_id === sceneId)
      .map((job) => job.id))
    const candidateJobById = new Map(input.candidateSpec.material_jobs
      .filter((job) => baseTargetJobIds.has(job.id) && job.scene_id === sceneId)
      .map((job) => [job.id, job]))
    const targetCandidateJobs = [...candidateJobById.values()]
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
              applied_preferences: input.candidateSpec.creative_brief.applied_preferences,
              image_references: candidateImageReferences,
            }
          : undefined,
      material_jobs: input.baseSpec.material_jobs.map((job) => {
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
    const assetIds = new Set(input.candidateSpec.assets.map((asset) => asset.id))
    const plannedAssetIds = new Set(input.candidateSpec.material_jobs
      .filter((job) => job.scene_id === sceneId
        && job.type === 'generate_video'
        && job.status === 'planned'
        && (!job.input_asset_id || assetIds.has(job.input_asset_id)))
      .flatMap((job) => job.output_asset_id ? [job.output_asset_id] : []))
    const assetBackedTypes = new Set(['user_video', 'ai_video', 'image_motion'])
    const effectiveCandidateScene = baseScene && candidateScene
      && assetBackedTypes.has(candidateScene.type)
      && (!candidateScene.asset_id
        || (!assetIds.has(candidateScene.asset_id) && !plannedAssetIds.has(candidateScene.asset_id)))
      ? { ...candidateScene, type: baseScene.type, asset_id: baseScene.asset_id }
      : candidateScene
    const strategyChanged = Boolean(
      baseScene && effectiveCandidateScene && visualStrategyChanged(baseScene, effectiveCandidateScene),
    )
    const baseTargetJobIds = new Set(input.baseSpec.material_jobs
      .filter((job) => job.scene_id === sceneId)
      .map((job) => job.id))
    const targetCandidateJobs = input.candidateSpec.material_jobs.filter((job) =>
      job.scene_id === sceneId
      && (
        baseTargetJobIds.has(job.id)
        || Boolean(job.type === 'generate_video'
          ? job.output_asset_id && (job.status === 'fulfilled'
            ? assetIds.has(job.output_asset_id)
            : job.status === 'planned' && (!job.input_asset_id || assetIds.has(job.input_asset_id)))
          : job.output_asset_id && assetIds.has(job.output_asset_id))
      ))
    return {
      ...input.baseSpec,
      scenes: input.baseSpec.scenes.map((scene) =>
        scene.id === sceneId && effectiveCandidateScene
          ? applyVisualStrategyScene(scene, effectiveCandidateScene)
          : scene),
      creative_brief: mergeImageReferencesForJobs({
        baseSpec: input.baseSpec,
        candidateSpec: input.candidateSpec,
        jobs: targetCandidateJobs,
      }),
      material_jobs: mergeScopedArray({
        base: input.baseSpec.material_jobs,
        candidate: targetCandidateJobs,
        isInScope: (job) => job.scene_id === sceneId,
        key: (job) => job.id,
      }).map((job) => {
        if (job.scene_id !== sceneId || job.type !== 'generate_video') return job
        const baseJob = input.baseSpec.material_jobs.find((item) => item.id === job.id)
        if (!baseJob) return job
        const candidatePrompt = job.prompt?.trim()
        const promptChanged = candidatePrompt && candidatePrompt !== baseJob.prompt?.trim()
        const strategyPrompt = effectiveCandidateScene ? visualStrategyPrompt(effectiveCandidateScene) : ''
        const basePrompt = baseJob.prompt?.trim()
        if (!strategyChanged && JSON.stringify(baseJob) === JSON.stringify(job)) return job
        return {
          ...job,
          status: 'planned',
          prompt: promptChanged || !strategyPrompt
            ? candidatePrompt
            : basePrompt?.split('\n').includes(strategyPrompt)
              ? basePrompt
              : [basePrompt, strategyPrompt].filter(Boolean).join('\n'),
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

export function enforceV2TimelineRevisionScope(input: {
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

function candidateAssets(
  baseSpec: RemotionTimelineSpecV1,
  availableAssets: RemotionTimelineSpecV1['assets'] = [],
) {
  return [...new Map(
    [...baseSpec.assets, ...availableAssets].map((asset) => [asset.id, asset]),
  ).values()]
}

function candidateBriefWithReferences(
  baseSpec: RemotionTimelineSpecV1,
  imageReferences: V2TimelineRevisionFragment['image_references'],
) {
  if (!imageReferences) return baseSpec.creative_brief
  if (!baseSpec.creative_brief) {
    if (imageReferences.length === 0) return undefined
    throw new Error('Image-conditioned revision requires an existing creative brief.')
  }
  const authoritativeReferences = preserveObservedImageFacts(baseSpec.creative_brief, imageReferences)
  const replacementIds = new Set(authoritativeReferences.map((reference) => reference.asset_id))
  return {
    ...baseSpec.creative_brief,
    image_references: [
      ...baseSpec.creative_brief.image_references.filter((reference) => !replacementIds.has(reference.asset_id)),
      ...authoritativeReferences,
    ],
  }
}

function assertFragmentFields(input: {
  fragment: V2TimelineRevisionFragment
  scope: V2TimelineRevisionScope
  globalMode?: 'brief_update' | 'full_replan'
}) {
  const scopeFields: Record<Exclude<V2TimelineRevisionScope, 'global'>, string[]> = {
    subtitle: ['overlays', 'caption_tracks'],
    scene: ['scenes', 'material_jobs', 'image_references'],
    visual_strategy: ['scenes', 'material_jobs', 'image_references'],
    transition: ['transitions'],
    structure: ['scenes', 'transitions', 'overlays', 'caption_tracks', 'material_jobs', 'image_references'],
  }
  if (input.scope === 'global' && input.globalMode !== 'brief_update') {
    throw new Error('A full replan must return a complete timeline, not a revision fragment.')
  }
  const allowed = new Set([
    'schema_version',
    'scope',
    ...(input.scope === 'global' ? ['creative_brief'] : scopeFields[input.scope]),
  ])
  const unexpected = Object.keys(input.fragment).filter((key) => !allowed.has(key))
  if (unexpected.length) {
    throw new Error(`Revision fragment contains fields outside its authorized scope: ${unexpected.join(', ')}`)
  }
  if (input.fragment.creative_brief?.planning_gaps?.length) {
    throw new Error('planning_gaps are server-maintained and cannot be returned by the planner model.')
  }
}

function fragmentCandidateSpec(input: {
  baseSpec: RemotionTimelineSpecV1
  fragment: V2TimelineRevisionFragment
  scope: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
  availableAssets?: RemotionTimelineSpecV1['assets']
}): RemotionTimelineSpecV1 {
  if (input.fragment.schema_version !== V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION) {
    throw new Error('Revision fragment schema_version is invalid.')
  }
  if (input.fragment.scope !== input.scope) {
    throw new Error('Revision fragment scope does not match the server-authorized scope.')
  }
  assertFragmentFields(input)
  const assets = candidateAssets(input.baseSpec, input.availableAssets)
  if (input.scope === 'subtitle') {
    if (!Array.isArray(input.fragment.overlays) || !Array.isArray(input.fragment.caption_tracks)) {
      throw new Error('Subtitle revision fragment requires overlays and caption_tracks.')
    }
    return {
      ...input.baseSpec,
      assets,
      overlays: input.fragment.overlays,
      caption_tracks: input.fragment.caption_tracks,
    }
  }
  if (input.scope === 'scene' || input.scope === 'visual_strategy') {
    if (!input.sceneId || !Array.isArray(input.fragment.scenes) || input.fragment.scenes.length !== 1) {
      throw new Error(`${input.scope} revision fragment requires exactly one target scene.`)
    }
    if (input.fragment.scenes[0]?.id !== input.sceneId) {
      throw new Error(`${input.scope} revision fragment returned the wrong target scene.`)
    }
    if (!Array.isArray(input.fragment.material_jobs) || !Array.isArray(input.fragment.image_references)) {
      throw new Error(`${input.scope} revision fragment requires material_jobs and image_references.`)
    }
    return {
      ...input.baseSpec,
      assets,
      creative_brief: candidateBriefWithReferences(input.baseSpec, input.fragment.image_references),
      scenes: input.fragment.scenes,
      material_jobs: input.fragment.material_jobs,
    }
  }
  if (input.scope === 'transition') {
    if (!Array.isArray(input.fragment.transitions)) {
      throw new Error('Transition revision fragment requires transitions.')
    }
    return { ...input.baseSpec, assets, transitions: input.fragment.transitions }
  }
  if (input.scope === 'structure') {
    if (
      !Array.isArray(input.fragment.scenes)
      || !Array.isArray(input.fragment.transitions)
      || !Array.isArray(input.fragment.overlays)
      || !Array.isArray(input.fragment.caption_tracks)
      || !Array.isArray(input.fragment.material_jobs)
      || !Array.isArray(input.fragment.image_references)
    ) throw new Error('Structure revision fragment is incomplete.')
    const requested = [...new Set(input.sceneIds ?? [])]
    const indices = requested.map((id) => input.baseSpec.scenes.findIndex((scene) => scene.id === id))
    if (requested.length === 0 || indices.some((index) => index < 0)) {
      throw new Error('Structure revision fragment requires known sceneIds.')
    }
    const sorted = [...indices].sort((a, b) => a - b)
    if (sorted.some((index, offset) => index !== sorted[0]! + offset)) {
      throw new Error('Structure revision sceneIds must form one contiguous range.')
    }
    return {
      ...input.baseSpec,
      assets,
      creative_brief: candidateBriefWithReferences(input.baseSpec, input.fragment.image_references),
      scenes: [
        ...input.baseSpec.scenes.slice(0, sorted[0]),
        ...input.fragment.scenes,
        ...input.baseSpec.scenes.slice(sorted.at(-1)! + 1),
      ],
      transitions: input.fragment.transitions,
      overlays: input.fragment.overlays,
      caption_tracks: input.fragment.caption_tracks,
      material_jobs: input.fragment.material_jobs,
    }
  }
  if (input.scope === 'global' && input.globalMode === 'brief_update') {
    if (!input.fragment.creative_brief) {
      throw new Error('Global brief revision fragment requires creative_brief.')
    }
    return { ...input.baseSpec, assets, creative_brief: input.fragment.creative_brief }
  }
  throw new Error('A full replan must return a complete timeline, not a revision fragment.')
}

export function applyV2TimelineRevisionFragment(input: {
  baseSpec: RemotionTimelineSpecV1
  fragment: V2TimelineRevisionFragment
  scope: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  overlayIds?: string[]
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
  durationMode?: 'preserve_range' | 'resize_timeline'
  availableAssets?: RemotionTimelineSpecV1['assets']
}): RemotionTimelineSpecV1 {
  return enforceV2TimelineRevisionScope({
    ...input,
    candidateSpec: fragmentCandidateSpec(input),
  })
}

function mergeExistingById<T extends { id: string }>(base: T[], candidate: T[]): T[] {
  const candidateById = new Map(candidate.map((item) => [item.id, item]))
  return base.map((item) => candidateById.get(item.id) ?? item)
}

const CAPTION_TRACK_OVERRIDE_FIELDS = [
  'x_pct',
  'y_pct',
  'width_pct',
  'max_lines',
  'z_index',
  'enter_animation',
  'exit_animation',
] as const

function removeRedundantCaptionTrackOverrides(input: {
  baseOverlays: RemotionTimelineSpecV1['overlays']
  candidateOverlays: RemotionTimelineSpecV1['overlays']
  captionTracks: NonNullable<RemotionTimelineSpecV1['caption_tracks']>
}) {
  const baseById = new Map(input.baseOverlays.map((overlay) => [overlay.id, overlay]))
  const trackById = new Map(input.captionTracks.map((track) => [track.id, track]))
  return input.candidateOverlays.map((overlay) => {
    const base = baseById.get(overlay.id)
    const track = overlay.type === 'caption' && overlay.track_id
      ? trackById.get(overlay.track_id)
      : undefined
    if (!base || !track) return overlay
    const result = { ...overlay }
    for (const field of CAPTION_TRACK_OVERRIDE_FIELDS) {
      if (base[field] === undefined && track[field] !== undefined && result[field] === track[field]) {
        delete result[field]
      }
    }
    return result
  })
}

function groupScopeOrder(scope: V2TimelineRevisionGroupScope) {
  return ['scene', 'visual_strategy', 'subtitle', 'transition'].indexOf(scope)
}

export function enforceV2TimelineRevisionGroup(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  group: V2TimelineRevisionGroup
}): RemotionTimelineSpecV1 {
  return [...input.group.items]
    .sort((left, right) => groupScopeOrder(left.scope) - groupScopeOrder(right.scope))
    .reduce((spec, item) => enforceV2TimelineRevisionScope({
      baseSpec: spec,
      candidateSpec: input.candidateSpec,
      scope: item.scope,
      sceneId: item.sceneId,
      overlayIds: item.overlayIds,
      transitionIds: item.transitionIds,
    }), input.baseSpec)
}

export function applyV2TimelineRevisionGroupFragment(input: {
  baseSpec: RemotionTimelineSpecV1
  fragment: V2TimelineRevisionGroupFragment
  group: V2TimelineRevisionGroup
  availableAssets?: RemotionTimelineSpecV1['assets']
}): RemotionTimelineSpecV1 {
  if (input.fragment.schema_version !== V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION) {
    throw new Error('Revision group fragment schema_version is invalid.')
  }
  const allowed = new Set(['schema_version'])
  const scopes = new Set(input.group.items.map((item) => item.scope))
  if (scopes.has('scene') || scopes.has('visual_strategy')) {
    for (const field of ['scenes', 'material_jobs', 'image_references']) allowed.add(field)
  }
  if (scopes.has('subtitle')) {
    allowed.add('overlays')
    allowed.add('caption_tracks')
  }
  if (scopes.has('transition')) allowed.add('transitions')
  const unexpected = Object.keys(input.fragment).filter((field) => !allowed.has(field))
  if (unexpected.length) {
    throw new Error(`Revision group fragment contains unauthorized fields: ${unexpected.join(', ')}`)
  }
  if ((scopes.has('scene') || scopes.has('visual_strategy')) && (
    input.fragment.scenes?.length !== 1
    || input.fragment.scenes[0]?.id !== input.group.sceneId
    || !Array.isArray(input.fragment.material_jobs)
    || !Array.isArray(input.fragment.image_references)
  )) throw new Error('Revision group fragment requires one target scene, material_jobs, and image_references.')
  if (scopes.has('subtitle') && (
    !Array.isArray(input.fragment.overlays) || !Array.isArray(input.fragment.caption_tracks)
  )) throw new Error('Revision group fragment requires overlays and caption_tracks.')
  if (scopes.has('transition') && !Array.isArray(input.fragment.transitions)) {
    throw new Error('Revision group fragment requires transitions.')
  }

  const targetOverlayIds = new Set(input.group.items.flatMap((item) => item.overlayIds ?? []))
  const addsSceneCaption = input.group.items.some((item) =>
    item.scope === 'subtitle' && !item.overlayIds?.length)
  const targetTransitionIds = new Set(input.group.items.flatMap((item) => item.transitionIds ?? []))
  const targetJobIds = new Set(input.baseSpec.material_jobs
    .filter((job) => job.scene_id === input.group.sceneId)
    .map((job) => job.id))
  const baseTargetJobById = new Map(input.baseSpec.material_jobs
    .filter((job) => job.scene_id === input.group.sceneId)
    .map((job) => [job.id, job]))
  const assets = candidateAssets(input.baseSpec, input.availableAssets)
  const assetIds = new Set(assets.map((asset) => asset.id))
  const targetCandidateJobs = input.fragment.material_jobs?.filter((job) =>
    job.scene_id === input.group.sceneId
    && (
      targetJobIds.has(job.id)
      || Boolean(scopes.has('visual_strategy') && (
        job.type === 'generate_video'
          ? job.output_asset_id && (job.status === 'fulfilled'
            ? assetIds.has(job.output_asset_id)
            : job.status === 'planned' && (!job.input_asset_id || assetIds.has(job.input_asset_id)))
          : job.output_asset_id && assetIds.has(job.output_asset_id)
      ))
    )).map((job) => {
      const stableOutputAssetId = baseTargetJobById.get(job.id)?.output_asset_id
      return !job.output_asset_id && stableOutputAssetId
        ? { ...job, output_asset_id: stableOutputAssetId }
        : job
    }) ?? []
  const isTargetOverlay = (item: RemotionTimelineSpecV1['overlays'][number]) =>
    targetOverlayIds.has(item.id)
    || Boolean(addsSceneCaption && item.type === 'caption' && item.scene_id === input.group.sceneId)
  const targetCandidateOverlays = input.fragment.overlays?.filter(isTargetOverlay) ?? []
  const targetTrackIds = new Set([
    ...input.baseSpec.overlays.filter((overlay) => targetOverlayIds.has(overlay.id)),
    ...targetCandidateOverlays,
  ].flatMap((overlay) => overlay.track_id ? [overlay.track_id] : []))
  const protectedTrackIds = new Set(input.baseSpec.overlays
    .filter((overlay) => overlay.type === 'caption' && !isTargetOverlay(overlay) && overlay.track_id)
    .map((overlay) => overlay.track_id as string))
  const captionTracks = input.fragment.caption_tracks
    ? mergeScopedArray({
        base: input.baseSpec.caption_tracks ?? [],
        candidate: input.fragment.caption_tracks,
        isInScope: (track) => targetTrackIds.has(track.id) && !protectedTrackIds.has(track.id),
        key: (track) => track.id,
      })
    : input.baseSpec.caption_tracks ?? []
  const overlays = input.fragment.overlays
    ? removeRedundantCaptionTrackOverrides({
        baseOverlays: input.baseSpec.overlays,
        candidateOverlays: mergeScopedArray({
          base: input.baseSpec.overlays,
          candidate: targetCandidateOverlays,
          isInScope: isTargetOverlay,
          key: (overlay) => overlay.id,
        }),
        captionTracks,
      })
    : input.baseSpec.overlays
  const candidate: RemotionTimelineSpecV1 = {
    ...input.baseSpec,
    assets,
    creative_brief: candidateBriefWithReferences(input.baseSpec, input.fragment.image_references),
    scenes: input.fragment.scenes
      ? mergeExistingById(input.baseSpec.scenes, input.fragment.scenes)
      : input.baseSpec.scenes,
    transitions: input.fragment.transitions
      ? mergeExistingById(
          input.baseSpec.transitions,
          input.fragment.transitions.filter((item) => targetTransitionIds.has(item.id)),
        )
      : input.baseSpec.transitions,
    caption_tracks: captionTracks,
    overlays,
    material_jobs: input.fragment.material_jobs
      ? scopes.has('visual_strategy')
        ? mergeScopedArray({
            base: input.baseSpec.material_jobs,
            candidate: targetCandidateJobs,
            isInScope: (job) => job.scene_id === input.group.sceneId,
            key: (job) => job.id,
          })
        : mergeExistingById(input.baseSpec.material_jobs, targetCandidateJobs)
      : input.baseSpec.material_jobs,
  }
  return enforceV2TimelineRevisionGroup({
    baseSpec: input.baseSpec,
    candidateSpec: candidate,
    group: input.group,
  })
}

export function resolveV2TimelineRevisionGroup(input: {
  baseSpec: RemotionTimelineSpecV1
  items: Array<{
    ref: string
    callId: string
    scope: unknown
    instruction?: unknown
    sceneId?: unknown
    overlayIds?: unknown
    transitionIds?: unknown
    requiredMaterialIds?: unknown
    useSampleReference?: unknown
    resolvesPendingCallId?: unknown
  }>
}): V2TimelineRevisionGroup | undefined {
  if (input.items.length < 2) return undefined
  const pendingCallIds = new Set(input.items.flatMap((item) =>
    typeof item.resolvesPendingCallId === 'string' && item.resolvesPendingCallId
      ? [item.resolvesPendingCallId]
      : []))
  if (pendingCallIds.size > 1) return undefined
  const allowed = new Set<V2TimelineRevisionGroupScope>(['scene', 'visual_strategy', 'subtitle', 'transition'])
  if (input.items.some((item) => typeof item.scope !== 'string' || !allowed.has(item.scope as V2TimelineRevisionGroupScope))) {
    return undefined
  }
  const explicitSceneIds = input.items.flatMap((item) =>
    typeof item.sceneId === 'string' && item.sceneId ? [item.sceneId] : [])
  const overlayIds = input.items.flatMap((item) => Array.isArray(item.overlayIds)
    ? item.overlayIds.filter((id): id is string => typeof id === 'string')
    : [])
  const overlaySceneIds = overlayIds.flatMap((id) => {
    const overlay = input.baseSpec.overlays.find((item) => item.id === id && item.type === 'caption')
    return overlay?.scene_id ? [overlay.scene_id] : []
  })
  if (overlaySceneIds.length !== overlayIds.length) {
    if (new Set(explicitSceneIds).size === 1) {
      throw new Error('Same-scene revision group references an invalid caption overlay.')
    }
    return undefined
  }
  const sceneIds = new Set([...explicitSceneIds, ...overlaySceneIds])
  if (sceneIds.size !== 1) return undefined
  const sceneId = [...sceneIds][0]!
  if (!input.baseSpec.scenes.some((scene) => scene.id === sceneId)) {
    throw new Error('Same-scene revision group references an invalid scene.')
  }

  const items: V2TimelineRevisionGroupItem[] = []
  for (const item of input.items) {
    const scope = item.scope as V2TimelineRevisionGroupScope
    const memberOverlayIds = Array.isArray(item.overlayIds)
      ? item.overlayIds.filter((id): id is string => typeof id === 'string')
      : undefined
    const memberTransitionIds = Array.isArray(item.transitionIds)
      ? item.transitionIds.filter((id): id is string => typeof id === 'string')
      : undefined
    const memberRequiredMaterialIds = Array.isArray(item.requiredMaterialIds)
      ? item.requiredMaterialIds.filter((id): id is string => typeof id === 'string')
      : undefined
    if (scope === 'subtitle') {
      const existingSceneCaptions = input.baseSpec.overlays.filter((overlay) =>
        overlay.type === 'caption' && overlay.scene_id === sceneId)
      if (memberOverlayIds?.length) {
        if (memberOverlayIds.some((id) => !existingSceneCaptions.some((overlay) => overlay.id === id))) {
          throw new Error('Same-scene revision group caption target is invalid.')
        }
      } else if (existingSceneCaptions.length > 0) {
        throw new Error('Same-scene revision group must identify existing caption overlays explicitly.')
      }
    }
    if (scope === 'transition' && (!memberTransitionIds?.length || memberTransitionIds.some((id) =>
      !input.baseSpec.transitions.some((transition) => transition.id === id
        && (transition.from_scene_id === sceneId || transition.to_scene_id === sceneId))))) {
      throw new Error('Same-scene revision group transition target is invalid.')
    }
    items.push({
      ref: item.ref,
      callId: item.callId,
      scope,
      instruction: typeof item.instruction === 'string' ? item.instruction : '',
      sceneId,
      ...(memberOverlayIds?.length ? { overlayIds: memberOverlayIds } : {}),
      ...(memberTransitionIds?.length ? { transitionIds: memberTransitionIds } : {}),
      ...(memberRequiredMaterialIds?.length ? { requiredMaterialIds: memberRequiredMaterialIds } : {}),
      ...(item.useSampleReference === true ? { useSampleReference: true } : {}),
    })
  }
  return {
    sceneId,
    items,
    ...([...pendingCallIds][0] ? { resolvesPendingCallId: [...pendingCallIds][0] } : {}),
  }
}

/**
 * Partitions already validated patch requests into independent same-scene
 * groups. Requests that do not form a group remain on the ordinary single
 * revision path; an invalid candidate only rejects its own scene group.
 */
export function partitionV2TimelineRevisionGroups(input: {
  baseSpec: RemotionTimelineSpecV1
  items: Array<{
    ref: string
    callId: string
    scope: unknown
    instruction?: unknown
    sceneId?: unknown
    overlayIds?: unknown
    transitionIds?: unknown
    requiredMaterialIds?: unknown
    useSampleReference?: unknown
    resolvesPendingCallId?: unknown
  }>
}): V2TimelineRevisionGroupPartition {
  const allowed = new Set<V2TimelineRevisionGroupScope>(['scene', 'visual_strategy', 'subtitle', 'transition'])
  const buckets = new Map<string, typeof input.items>()
  const transitionItems: typeof input.items = []
  const add = (sceneId: string, item: typeof input.items[number]) => {
    const existing = buckets.get(sceneId) ?? []
    existing.push(item)
    buckets.set(sceneId, existing)
  }

  for (const item of input.items) {
    if (typeof item.scope !== 'string'
      || !allowed.has(item.scope as V2TimelineRevisionGroupScope)) continue
    const explicitSceneId = typeof item.sceneId === 'string' && item.sceneId ? item.sceneId : undefined
    if (item.scope === 'transition' && !explicitSceneId) {
      transitionItems.push(item)
      continue
    }
    if (explicitSceneId) {
      add(explicitSceneId, item)
      continue
    }
    if (item.scope !== 'subtitle' || !Array.isArray(item.overlayIds) || item.overlayIds.length === 0) continue
    const sceneIds = new Set(item.overlayIds.flatMap((id) => {
      if (typeof id !== 'string') return []
      const overlay = input.baseSpec.overlays.find((candidate) => candidate.id === id && candidate.type === 'caption')
      return overlay?.scene_id ? [overlay.scene_id] : []
    }))
    if (sceneIds.size === 1 && item.overlayIds.every((id) => typeof id === 'string'
      && input.baseSpec.overlays.some((overlay) => overlay.id === id && overlay.type === 'caption'))) {
      add([...sceneIds][0]!, item)
    }
  }

  for (const item of transitionItems) {
    if (!Array.isArray(item.transitionIds) || item.transitionIds.length === 0) continue
    const targetTransitions = item.transitionIds.flatMap((id) => typeof id === 'string'
      ? input.baseSpec.transitions.filter((transition) => transition.id === id)
      : [])
    if (targetTransitions.length !== item.transitionIds.length) continue
    const matchingSceneIds = [...buckets.keys()].filter((sceneId) => targetTransitions.every((transition) =>
      transition.from_scene_id === sceneId || transition.to_scene_id === sceneId))
    if (matchingSceneIds.length === 1) add(matchingSceneIds[0]!, item)
  }

  const groups: V2TimelineRevisionGroup[] = []
  const invalid: V2TimelineRevisionGroupPartition['invalid'] = []
  for (const items of buckets.values()) {
    if (items.length < 2) continue
    try {
      const group = resolveV2TimelineRevisionGroup({ baseSpec: input.baseSpec, items })
      if (group) {
        groups.push(group)
      } else {
        invalid.push({
          callIds: items.map((item) => item.callId),
          message: 'Same-scene revision requests could not form one compatible revision group.',
        })
      }
    } catch (error) {
      invalid.push({
        callIds: items.map((item) => item.callId),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { groups, invalid }
}
