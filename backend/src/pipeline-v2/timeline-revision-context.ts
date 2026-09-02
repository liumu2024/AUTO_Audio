import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2TimelineRevisionGroup, V2TimelineRevisionScope } from './timeline-revision-scope.js'

export interface V2TimelineRevisionContext {
  draft_id: string
  base_revision: number
  constraints?: {
    target_range_start_sec: number
    target_range_duration_sec: number
  }
  timeline: {
    creative_brief?: RemotionTimelineSpecV1['creative_brief']
    canvas: RemotionTimelineSpecV1['canvas']
    assets: Array<Pick<RemotionTimelineSpecV1['assets'][number], 'id' | 'type' | 'source' | 'label'>>
    scenes: RemotionTimelineSpecV1['scenes']
    transitions: RemotionTimelineSpecV1['transitions']
    caption_tracks?: RemotionTimelineSpecV1['caption_tracks']
    overlays: RemotionTimelineSpecV1['overlays']
    material_jobs: RemotionTimelineSpecV1['material_jobs']
    audio?: RemotionTimelineSpecV1['audio']
  }
}

export interface V2TimelineRevisionAudit {
  base_revision: number
  scene_changes: { added: string[]; removed: string[]; changed: string[] }
  overlay_changes: { added: string[]; removed: string[]; changed: string[] }
  transition_changes: { added: string[]; removed: string[]; changed: string[] }
  preserved_scene_notes: string[]
  warnings: string[]
}

/**
 * The persisted revision is the only authoritative source for a revision.
 * This compact projection intentionally excludes trace/chat history while
 * retaining every stable timeline reference the planner needs to preserve or
 * deliberately change the current plan.
 */
export function buildV2TimelineRevisionContext(input: {
  draftId: string
  baseRevision: number
  spec: RemotionTimelineSpecV1
  scope?: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  overlayIds?: string[]
  transitionIds?: string[]
  globalMode?: 'brief_update' | 'full_replan'
}): V2TimelineRevisionContext {
  const { spec } = input
  const full = !input.scope || (input.scope === 'global' && input.globalMode === 'full_replan')
  const requestedSceneIds = new Set<string>()
  const requestedTransitionIds = new Set(input.transitionIds ?? [])
  const requestedOverlayIds = new Set(input.overlayIds ?? [])

  if (input.scope === 'subtitle') {
    if (input.sceneId) requestedSceneIds.add(input.sceneId)
  } else if (input.scope === 'scene' || input.scope === 'visual_strategy') {
    if (input.sceneId) requestedSceneIds.add(input.sceneId)
  } else if (input.scope === 'transition') {
    for (const transition of spec.transitions) {
      if (!requestedTransitionIds.has(transition.id)) continue
      requestedSceneIds.add(transition.from_scene_id)
      requestedSceneIds.add(transition.to_scene_id)
    }
  } else if (input.scope === 'structure') {
    const targetIndices = (input.sceneIds ?? [])
      .map((id) => spec.scenes.findIndex((scene) => scene.id === id))
      .filter((index) => index >= 0)
    for (const id of input.sceneIds ?? []) requestedSceneIds.add(id)
    if (targetIndices.length) {
      const first = Math.min(...targetIndices)
      const last = Math.max(...targetIndices)
      if (first > 0) requestedSceneIds.add(spec.scenes[first - 1]!.id)
      if (last < spec.scenes.length - 1) requestedSceneIds.add(spec.scenes[last + 1]!.id)
    }
  } else if (input.scope === 'global') {
    for (const scene of spec.scenes) requestedSceneIds.add(scene.id)
  }

  let overlays = full ? spec.overlays : []
  if (input.scope === 'subtitle') {
    overlays = spec.overlays.filter((overlay) =>
      overlay.type === 'caption'
      && (!input.sceneId || overlay.scene_id === input.sceneId)
      && (requestedOverlayIds.size === 0 || requestedOverlayIds.has(overlay.id)))
    for (const overlay of overlays) if (overlay.scene_id) requestedSceneIds.add(overlay.scene_id)
  } else if (input.scope === 'structure') {
    const structuralTargets = new Set(input.sceneIds ?? [])
    overlays = spec.overlays.filter((overlay) => overlay.scene_id && structuralTargets.has(overlay.scene_id))
  }
  const selectedTrackIds = new Set(overlays.flatMap((overlay) => overlay.track_id ? [overlay.track_id] : []))
  const scenes = full ? spec.scenes : spec.scenes.filter((scene) => requestedSceneIds.has(scene.id))
  const structuralTargets = new Set(input.sceneIds ?? [])
  const materialJobs = full
    ? spec.material_jobs
    : (input.scope === 'scene' || input.scope === 'visual_strategy') && input.sceneId
      ? spec.material_jobs.filter((job) => job.scene_id === input.sceneId)
      : input.scope === 'structure'
        ? spec.material_jobs.filter((job) => structuralTargets.has(job.scene_id))
        : []
  const transitions = full
    ? spec.transitions
    : input.scope === 'transition'
      ? spec.transitions.filter((transition) => requestedTransitionIds.has(transition.id))
      : input.scope === 'structure'
        ? spec.transitions.filter((transition) =>
            requestedSceneIds.has(transition.from_scene_id) && requestedSceneIds.has(transition.to_scene_id))
        : (input.scope === 'scene' || input.scope === 'visual_strategy') && input.sceneId
          ? spec.transitions.filter((transition) =>
              transition.from_scene_id === input.sceneId || transition.to_scene_id === input.sceneId)
          : []
  const referencedAssetIds = new Set<string>()
  for (const scene of scenes) if (scene.asset_id) referencedAssetIds.add(scene.asset_id)
  for (const overlay of overlays) if (overlay.asset_id) referencedAssetIds.add(overlay.asset_id)
  for (const job of materialJobs) {
    if (job.input_asset_id) referencedAssetIds.add(job.input_asset_id)
    if (job.output_asset_id) referencedAssetIds.add(job.output_asset_id)
    if (job.fallback_asset_id) referencedAssetIds.add(job.fallback_asset_id)
  }
  const includeBrief = full || input.scope === 'scene' || input.scope === 'visual_strategy'
    || input.scope === 'structure' || input.scope === 'global'
  const structuralTargetScenes = input.scope === 'structure'
    ? spec.scenes.filter((scene) => structuralTargets.has(scene.id))
    : []
  const structureConstraints = structuralTargetScenes.length > 0
    ? {
        target_range_start_sec: Math.min(...structuralTargetScenes.map((scene) => scene.start_sec)),
        target_range_duration_sec: Number(structuralTargetScenes
          .reduce((sum, scene) => sum + scene.duration_sec, 0)
          .toFixed(3)),
      }
    : undefined
  return {
    draft_id: input.draftId,
    base_revision: input.baseRevision,
    ...(structureConstraints ? { constraints: structureConstraints } : {}),
    timeline: {
      creative_brief: includeBrief ? spec.creative_brief : undefined,
      canvas: spec.canvas,
      assets: spec.assets.filter((asset) => full || referencedAssetIds.has(asset.id)).map((asset) => ({
        id: asset.id,
        type: asset.type,
        source: asset.source,
        label: asset.label,
      })),
      scenes: scenes.map((scene) => ({ ...scene })),
      transitions: transitions.map((transition) => ({ ...transition })),
      caption_tracks: spec.caption_tracks?.filter((track) => full || selectedTrackIds.has(track.id)).map((track) => ({ ...track })),
      overlays: overlays.map((overlay) => ({ ...overlay })),
      material_jobs: materialJobs.map((job) => ({ ...job })),
      // Persisted drafts can predate the array contract. Do not let malformed
      // optional audio metadata crash a revision; validation still reports it
      // before the timeline is accepted for a new plan or render.
      audio: full && Array.isArray(spec.audio) ? spec.audio.map((clip) => ({ ...clip })) : undefined,
    },
  }
}

export function buildV2TimelineRevisionGroupContext(input: {
  draftId: string
  baseRevision: number
  spec: RemotionTimelineSpecV1
  group: V2TimelineRevisionGroup
}): V2TimelineRevisionContext {
  const contexts = input.group.items.map((item) => buildV2TimelineRevisionContext({
    draftId: input.draftId,
    baseRevision: input.baseRevision,
    spec: input.spec,
    scope: item.scope,
    sceneId: item.sceneId,
    overlayIds: item.overlayIds,
    transitionIds: item.transitionIds,
  }))
  const byId = <T extends { id: string }>(values: T[][]) =>
    [...new Map(values.flat().map((item) => [item.id, item])).values()]
  return {
    draft_id: input.draftId,
    base_revision: input.baseRevision,
    timeline: {
      creative_brief: contexts.find((context) => context.timeline.creative_brief)?.timeline.creative_brief,
      canvas: input.spec.canvas,
      assets: byId(contexts.map((context) => context.timeline.assets)),
      scenes: byId(contexts.map((context) => context.timeline.scenes)),
      transitions: byId(contexts.map((context) => context.timeline.transitions)),
      caption_tracks: byId(contexts.map((context) => context.timeline.caption_tracks ?? [])),
      overlays: byId(contexts.map((context) => context.timeline.overlays)),
      material_jobs: byId(contexts.map((context) => context.timeline.material_jobs)),
    },
  }
}

function changes<T extends { id: string }>(
  base: T[],
  next: T[],
): { added: string[]; removed: string[]; changed: string[] } {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))
  return {
    added: next.filter((item) => !baseById.has(item.id)).map((item) => item.id),
    removed: base.filter((item) => !nextById.has(item.id)).map((item) => item.id),
    changed: next
      .filter((item) => {
        const previous = baseById.get(item.id)
        return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item)
      })
      .map((item) => item.id),
  }
}

/** Preserve explicit editor notes when the planner retains the same scene but
 * omits the note. A model may redesign creative content, but it must not lose
 * a user's local instruction through an accidental serialization omission. */
export function applyV2TimelineRevisionPreservation(input: {
  baseSpec: RemotionTimelineSpecV1
  nextSpec: RemotionTimelineSpecV1
  baseRevision: number
}): { spec: RemotionTimelineSpecV1; audit: V2TimelineRevisionAudit } {
  const baseScenes = new Map(input.baseSpec.scenes.map((scene) => [scene.id, scene]))
  const preservedSceneNotes: string[] = []
  const scenes = input.nextSpec.scenes.map((scene) => {
    const previous = baseScenes.get(scene.id)
    if (previous?.note?.trim() && !scene.note?.trim()) {
      preservedSceneNotes.push(scene.id)
      return { ...scene, note: previous.note }
    }
    return scene
  })
  const spec = preservedSceneNotes.length ? { ...input.nextSpec, scenes } : input.nextSpec
  const removedNotedScenes = input.baseSpec.scenes
    .filter((scene) => scene.note?.trim() && !spec.scenes.some((next) => next.id === scene.id))
    .map((scene) => scene.id)
  const audit: V2TimelineRevisionAudit = {
    base_revision: input.baseRevision,
    scene_changes: changes(input.baseSpec.scenes, spec.scenes),
    overlay_changes: changes(input.baseSpec.overlays, spec.overlays),
    transition_changes: changes(input.baseSpec.transitions, spec.transitions),
    preserved_scene_notes: preservedSceneNotes,
    warnings: removedNotedScenes.length
      ? [`${removedNotedScenes.length} 个带有用户备注的镜头被移除：${removedNotedScenes.join(', ')}`]
      : [],
  }
  return { spec, audit }
}
