import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

export interface V2TimelineRevisionContext {
  draft_id: string
  base_revision: number
  timeline: {
    creative_brief?: RemotionTimelineSpecV1['creative_brief']
    canvas: RemotionTimelineSpecV1['canvas']
    assets: Array<Pick<RemotionTimelineSpecV1['assets'][number], 'id' | 'type' | 'source' | 'label'>>
    scenes: Array<Pick<
      RemotionTimelineSpecV1['scenes'][number],
      'id' | 'type' | 'start_sec' | 'duration_sec' | 'asset_id' | 'motion' | 'visual_role' |
      'creative_intent' | 'title' | 'subtitle' | 'body' | 'note'
    >>
    transitions: RemotionTimelineSpecV1['transitions']
    caption_tracks?: RemotionTimelineSpecV1['caption_tracks']
    overlays: RemotionTimelineSpecV1['overlays']
    material_jobs: Array<Pick<
      RemotionTimelineSpecV1['material_jobs'][number],
      'id' | 'scene_id' | 'type' | 'status' | 'input_asset_id' | 'output_asset_id' | 'fallback_asset_id'
      | 'prompt' | 'fallback_kind'
    >>
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
}): V2TimelineRevisionContext {
  const { spec } = input
  return {
    draft_id: input.draftId,
    base_revision: input.baseRevision,
    timeline: {
      creative_brief: spec.creative_brief,
      canvas: spec.canvas,
      assets: spec.assets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        source: asset.source,
        label: asset.label,
      })),
      scenes: spec.scenes.map((scene) => ({
        id: scene.id,
        type: scene.type,
        start_sec: scene.start_sec,
        duration_sec: scene.duration_sec,
        asset_id: scene.asset_id,
        motion: scene.motion,
        visual_role: scene.visual_role,
        creative_intent: scene.creative_intent,
        title: scene.title,
        subtitle: scene.subtitle,
        body: scene.body,
        note: scene.note,
      })),
      transitions: spec.transitions.map((transition) => ({ ...transition })),
      caption_tracks: spec.caption_tracks?.map((track) => ({ ...track })),
      overlays: spec.overlays.map((overlay) => ({ ...overlay })),
      material_jobs: spec.material_jobs.map((job) => ({
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        status: job.status,
        input_asset_id: job.input_asset_id,
        output_asset_id: job.output_asset_id,
        fallback_asset_id: job.fallback_asset_id,
        prompt: job.prompt,
        fallback_kind: job.fallback_kind,
      })),
      // Persisted drafts can predate the array contract. Do not let malformed
      // optional audio metadata crash a revision; validation still reports it
      // before the timeline is accepted for a new plan or render.
      audio: Array.isArray(spec.audio) ? spec.audio.map((clip) => ({ ...clip })) : undefined,
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
