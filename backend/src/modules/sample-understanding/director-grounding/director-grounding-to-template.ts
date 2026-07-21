import type { UserMaterialDto } from '../../../../../shared/types/pipeline.js'
import type { AudioVisualUnderstandingHints } from '../../../../../shared/types/sample-understanding-skills.js'
import { coerceGlobalEffects } from '../normalizer/enum-coercion.js'
import { getRenderPluginManifest } from '../../../../../shared/lib/render-plugin-manifest.js'
import type { SampleUnderstandingResult } from '../sample-understanding.schema.js'
import {
  RENDER_EFFECT_PRESETS,
  type RenderEffectPreset,
} from '../normalizer/enum-coercion.js'
import type { DirectorGroundingResult } from './director-grounding.schema.js'

function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(Math.min(Math.max(value, 0), duration).toFixed(3))
}

function materialTypeToTemplateType(type: UserMaterialDto['material_type']) {
  if (type === 'VIDEO') return 'video' as const
  if (type === 'AUDIO') return 'audio' as const
  return 'image' as const
}

function defaultSlotType(accepted: Array<'video' | 'image' | 'audio' | 'text'>) {
  if (accepted.includes('video')) return 'video' as const
  if (accepted.includes('image')) return 'image' as const
  if (accepted.includes('audio')) return 'audio' as const
  return 'text' as const
}

function normalizeEvents(
  grounding: DirectorGroundingResult,
): DirectorGroundingResult['temporal_events'] {
  const duration = grounding.audio_visual_evidence.duration_sec
  const sortedEvents = grounding.temporal_events
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)

  let cursor = 0
  const events = sortedEvents
    .map((event, index) => {
      const rawStart = clampTime(event.start_sec, duration)
      const start = clampTime(Math.max(rawStart, cursor), duration)
      const nextRawStart =
        index < sortedEvents.length - 1
          ? clampTime(sortedEvents[index + 1].start_sec, duration)
          : duration
      const rawEnd = clampTime(Math.max(event.end_sec, start + 0.1), duration)
      const endLimit = nextRawStart > start ? nextRawStart : duration
      const end = clampTime(Math.min(Math.max(rawEnd, start + 0.1), endLimit), duration)
      cursor = end
      return {
        ...event,
        id: event.id || `seg_${String(index + 1).padStart(3, '0')}`,
        start_sec: start,
        end_sec: end > start ? end : clampTime(start + 0.1, duration),
      }
    })
    .filter((event) => event.end_sec > event.start_sec && event.start_sec < duration)

  if (events.length) return events

  return [
    {
      id: 'seg_001',
      start_sec: 0,
      end_sec: duration,
      creative_role: 'style_replication',
      description: grounding.style_summary.editing_pattern,
      visual_prompt: grounding.style_summary.visual_style || grounding.style_summary.editing_pattern,
      overlay_text: '',
      emotion_vibe: 'cinematic',
      camera: '',
      motion: '',
      visual_motion: {
        preset: 'push_in',
        intensity: 0.35,
        driver: 'useCurrentFrame',
      },
      slot_tags: ['style_reference'],
      accepted_material_types: ['video', 'image'],
    },
  ]
}

function selectDefaultMaterialId(
  accepted: Array<'video' | 'image' | 'audio' | 'text'>,
  materials: UserMaterialDto[],
  index: number,
): string | undefined {
  const acceptedSet = new Set(accepted.map((type) => type.toUpperCase()))
  const candidates = materials.filter((material) =>
    acceptedSet.has(material.material_type),
  )
  return candidates[index % candidates.length]?.id
}

function resolveSceneEffectPreset(
  effect: DirectorGroundingResult['render_recipe']['scene_effects'][number],
): RenderEffectPreset | undefined {
  if (isRuntimeRenderEffectPreset(effect.preset)) return effect.preset
  const pluginId = effect.plugin_id ?? effect.effect_id
  const fallbackPreset = getRenderPluginManifest(pluginId)?.fallbackPreset
  return isRuntimeRenderEffectPreset(fallbackPreset) ? fallbackPreset : undefined
}

function isRuntimeRenderEffectPreset(
  value: string | undefined,
): value is RenderEffectPreset {
  return Boolean(value && RENDER_EFFECT_PRESETS.includes(value as RenderEffectPreset))
}

function buildRenderRecipe(
  grounding: DirectorGroundingResult,
  hints: AudioVisualUnderstandingHints | undefined,
): SampleUnderstandingResult['template']['render_recipe'] {
  const audio = hints?.audio_features
  const audioDriver =
    grounding.render_recipe.audio_driver ??
    (audio
      ? {
          beat_times: audio.beats,
          strong_beats: audio.strong_beats,
          energy_peaks: audio.energy_peaks,
          waveform: audio.waveform,
        }
      : undefined)

  return {
    style_family:
      grounding.render_recipe.style_family ?? grounding.style_summary.style_family,
    global_effects:
      coerceGlobalEffects(grounding.render_recipe.global_effects) ??
      grounding.render_recipe.global_effects,
    scene_effects: grounding.render_recipe.scene_effects
      .map((effect) => {
        const preset = resolveSceneEffectPreset(effect)
        if (!preset) return null
        return {
          segment_id: effect.segment_id,
          preset,
          effect_id: effect.effect_id ?? effect.plugin_id,
          plugin_id: effect.plugin_id ?? effect.effect_id,
          layer: effect.layer,
          phenomenon: effect.phenomenon,
          evidence_refs: effect.evidence_refs,
          confidence: effect.confidence,
          params: effect.params,
        }
      })
      .filter((effect): effect is NonNullable<typeof effect> => Boolean(effect)),
    ...(audioDriver ? { audio_driver: audioDriver } : {}),
  }
}

export function directorGroundingToSampleUnderstanding(input: {
  grounding: DirectorGroundingResult
  taskId: string
  videoUrl: string
  materials?: UserMaterialDto[]
  sampleHints?: AudioVisualUnderstandingHints
}): SampleUnderstandingResult {
  const materials = input.materials ?? []
  const duration = input.grounding.audio_visual_evidence.duration_sec
  const events = normalizeEvents(input.grounding)
  const slots = events.map((event, index) => {
    const accepted = event.accepted_material_types.length
      ? event.accepted_material_types
      : (['video', 'image'] as Array<'video' | 'image'>)
    return {
      id: `slot_${String(index + 1).padStart(3, '0')}`,
      type: defaultSlotType(accepted),
      required: true,
      tags: event.slot_tags.length ? event.slot_tags : [event.creative_role],
      description: event.description,
      source: 'reference_material' as const,
      accepted_material_types: accepted,
      default_material_id: selectDefaultMaterialId(accepted, materials, index),
    }
  })

  const sampleUnderstanding = {
    hook_formula: input.grounding.visual_phenomena[0]?.type ?? 'style_opening',
    narrative_arc: input.grounding.style_summary.editing_pattern,
    conversion_logic: input.grounding.style_summary.audio_sync_logic,
    audience_trigger: input.grounding.style_summary.visual_style,
    reusable_pattern: input.grounding.style_summary.style_family,
  }

  const template: SampleUnderstandingResult['template'] = {
    schema_version: '1.0',
    id: `tpl_${input.taskId}`,
    title: input.grounding.style_summary.style_family,
    duration,
    style: input.grounding.style_summary.editing_pattern,
    content_domain: input.grounding.content_domain,
    sample_video: {
      id: input.grounding.source.sample_video.id,
      name: input.grounding.source.sample_video.name,
      url: input.videoUrl,
      duration,
    },
    reference_materials: materials
      .filter((material) => material.material_type !== 'AUDIO')
      .map((material) => ({
        id: material.id,
        name: material.label || material.id,
        type: materialTypeToTemplateType(material.material_type),
        url: material.oss_url,
        tags: material.ai_tags ?? [],
        used_by_slots: slots
          .filter((slot) => slot.default_material_id === material.id)
          .map((slot) => slot.id),
      })),
    creative_intent: input.grounding.intent,
    sample_understanding: sampleUnderstanding,
    structure: events.map((event, index) => ({
      id: event.id,
      name: event.creative_role,
      creative_role: event.creative_role,
      start: event.start_sec,
      end: event.end_sec,
      sequence: {
        from_sec: event.start_sec,
        duration_sec: Number((event.end_sec - event.start_sec).toFixed(3)),
        layout: 'fill',
        premount_sec: 0.35,
      },
      purpose: event.description,
      emotion: event.emotion_vibe,
      subtitle: event.overlay_text,
      camera: event.camera,
      motion: event.motion,
      visual_motion: event.visual_motion,
      slot: slots[index].id,
      intent_summary: event.visual_prompt,
      evidence_refs: event.evidence_refs,
      confidence: event.confidence,
    })),
    slots,
    transitions: events.slice(0, -1).map((event, index) => {
      const next = events[index + 1]
      return {
        id: `tr_${String(index + 1).padStart(3, '0')}`,
        from_segment_id: event.id,
        to_segment_id: next.id,
        at_sec: event.end_sec,
        presentation: 'cut',
        duration_sec: 0,
        timing: { type: 'linear' },
        overlay: { type: 'none' },
        reason: input.grounding.style_summary.audio_sync_logic,
      }
    }),
    style_features: {
      visual_style: input.grounding.style_summary.visual_style,
      pace: input.grounding.style_summary.pace,
      transition: input.grounding.style_summary.editing_pattern,
      bgm: input.grounding.style_summary.audio_sync_logic,
      remotion_plugins: input.grounding.remotion_capability_plan.matched_plugins
        .map((plugin) => plugin.preset)
        .join(', '),
      missing_capabilities: input.grounding.remotion_capability_plan.missing_capabilities
        .map((capability) => capability.id)
        .join(', '),
      plugin_authoring_skill: input.grounding.remotion_capability_plan
        .plugin_authoring_skill.enabled
        ? input.grounding.remotion_capability_plan.plugin_authoring_skill.candidate_plugin_ids.join(', ')
        : 'disabled',
    },
    viral_points: [
      ...input.grounding.visual_phenomena.map((phenomenon) => ({
        time: phenomenon.start_sec,
        type: phenomenon.type,
        reason: phenomenon.description,
        mechanism: phenomenon.mechanism,
        evidence_refs: phenomenon.evidence_refs,
        confidence: phenomenon.confidence,
      })),
      ...(input.sampleHints?.audio_features.energy_peaks ?? []).map((peak) => ({
        time: peak.time,
        type: 'beat_sync',
        reason: `Audio energy peak ${peak.intensity}`,
        mechanism: 'audio_driver' as const,
      })),
    ].slice(0, 12),
    render_recipe: buildRenderRecipe(input.grounding, input.sampleHints),
    capability_layers: input.grounding.remotion_capability_plan.capability_layers,
    source_video_id: input.grounding.source.sample_video.id,
  }

  return {
    schema_version: 'sample_understanding.v1',
    task_id: input.taskId,
    director_grounding: input.grounding,
    source: {
      sample_video: {
        id: input.grounding.source.sample_video.id,
        name: input.grounding.source.sample_video.name,
        url: input.videoUrl,
        role: 'structure_source',
      },
      reference_materials: materials.map((material) => ({
        id: material.id,
        name: material.label || material.id,
        type: materialTypeToTemplateType(material.material_type),
        role: 'slot_candidate',
        tags: material.ai_tags ?? [],
      })),
    },
    intent: input.grounding.intent,
    sample_analysis: sampleUnderstanding,
    template,
  }
}
