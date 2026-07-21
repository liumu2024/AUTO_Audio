import {
  CONTENT_DOMAINS,
  VISUAL_PHENOMENON_MECHANISMS,
  type ContentDomain,
  type VisualPhenomenonMechanism,
} from '../../../../../shared/types/director-grounding.v1.js'
import { getRenderPluginManifest } from '../../../../../shared/lib/render-plugin-manifest.js'
import {
  coerceGlobalEffects,
  coerceRenderEffectPreset,
  coerceSlotType,
  coerceVisualMotionPreset,
} from '../normalizer/enum-coercion.js'
import { isRecord, normalizeId } from '../normalizer/json-utils.js'

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function coerceContentDomain(value: unknown): ContentDomain {
  if (typeof value !== 'string') return 'unknown'
  const normalized = normalizeToken(value)
  return (CONTENT_DOMAINS as readonly string[]).includes(normalized)
    ? (normalized as ContentDomain)
    : 'unknown'
}

function coerceMechanism(value: unknown): VisualPhenomenonMechanism | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  const aliases: Record<string, VisualPhenomenonMechanism> = {
    motion_blur: 'distortion',
    blur_motion: 'distortion',
    motion_trace_blur: 'distortion',
    beat_pulse: 'audio_driver',
    beat_flash: 'audio_driver',
    audio_beat: 'audio_driver',
    circular_mask_expand: 'mask_reveal',
    circle_mask_expand: 'mask_reveal',
    radial_mask_expand: 'mask_reveal',
    circle_reveal: 'mask_reveal',
  }
  if (aliases[normalized]) return aliases[normalized]
  return (VISUAL_PHENOMENON_MECHANISMS as readonly string[]).includes(normalized)
    ? (normalized as VisualPhenomenonMechanism)
    : undefined
}

function resolveSceneEffectPreset(entry: Record<string, unknown>): string | undefined {
  const preset = coerceRenderEffectPreset(entry.preset)
  if (preset) return preset
  const pluginId =
    typeof entry.plugin_id === 'string'
      ? entry.plugin_id
      : typeof entry.effect_id === 'string'
        ? entry.effect_id
        : undefined
  const manifest = getRenderPluginManifest(pluginId)
  return manifest?.fallbackPreset
}

function normalizeSceneEffects(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const next: Record<string, unknown> = { ...entry }
    next.segment_id = normalizeId(
      entry.segment_id,
      `seg_${String(index + 1).padStart(3, '0')}`,
    )
    const pluginId =
      typeof entry.plugin_id === 'string'
        ? entry.plugin_id
        : typeof entry.effect_id === 'string'
          ? entry.effect_id
          : undefined
    if (pluginId && !next.plugin_id) next.plugin_id = pluginId
    const preset = resolveSceneEffectPreset(next)
    if (preset) next.preset = preset
    if (typeof entry.layer === 'string') {
      const layer = coerceMechanism(entry.layer)
      if (layer) next.layer = layer
    }
    return next
  })
}

function normalizeTemporalEvents(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const next: Record<string, unknown> = { ...entry }
    next.id = normalizeId(entry.id, `seg_${String(index + 1).padStart(3, '0')}`)
    if (!next.creative_role && typeof entry.marketing_role === 'string') {
      next.creative_role = entry.marketing_role
    }
    const rawMotion = isRecord(entry.visual_motion) ? entry.visual_motion : {}
    const preset =
      coerceVisualMotionPreset(rawMotion.preset) ??
      coerceVisualMotionPreset(entry.motion) ??
      'static'
    const rawIntensity = rawMotion.intensity
    const intensity =
      typeof rawIntensity === 'number' && Number.isFinite(rawIntensity)
        ? Math.min(1, Math.max(0, rawIntensity))
        : preset === 'static'
          ? 0
          : 0.35
    next.visual_motion = {
      ...rawMotion,
      preset,
      intensity,
      ...(typeof rawMotion.easing === 'string' ? { easing: rawMotion.easing } : {}),
      driver: 'useCurrentFrame',
    }
    if (Array.isArray(entry.accepted_material_types)) {
      const accepted = entry.accepted_material_types
        .map((item) => coerceSlotType(item))
        .filter((item): item is NonNullable<ReturnType<typeof coerceSlotType>> => Boolean(item))
      next.accepted_material_types = accepted.length ? [...new Set(accepted)] : ['video', 'image']
    }
    return next
  })
}

function normalizeVisualPhenomena(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const next: Record<string, unknown> = { ...entry }
    next.id = normalizeId(entry.id, `phen_${String(index + 1).padStart(3, '0')}`)
    const mechanism = coerceMechanism(entry.mechanism) ?? coerceMechanism(entry.type)
    if (mechanism) next.mechanism = mechanism
    else delete next.mechanism
    return next
  })
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeShotEvents(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const next: Record<string, unknown> = { ...entry }
    next.id = normalizeId(entry.id, `shot_${String(index + 1).padStart(3, '0')}`)
    next.visual_change_intensity = clampUnit(entry.visual_change_intensity, 0.5)
    return next
  })
}

function normalizeTransitionObservations(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const next: Record<string, unknown> = { ...entry }
    next.id = normalizeId(entry.id, `obs_tr_${String(index + 1).padStart(3, '0')}`)
    if (typeof next.type !== 'string' || !next.type.trim()) {
      next.type = 'cut'
    }
    return next
  })
}

function normalizeCapabilityLayers(value: unknown): unknown {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    if (!isRecord(entry)) return entry
    const layers = Array.isArray(entry.layers) ? entry.layers : []
    return {
      ...entry,
      segment_id: normalizeId(entry.segment_id, `seg_${String(index + 1).padStart(3, '0')}`),
      layers: layers.map((layer) => {
        if (!isRecord(layer)) return layer
        const mechanism = coerceMechanism(layer.layer)
        const preset = coerceRenderEffectPreset(layer.preset)
        return {
          ...layer,
          ...(mechanism ? { layer: mechanism } : {}),
          ...(preset ? { preset } : {}),
        }
      }),
    }
  })
}

function normalizeMatchedPlugins(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry)) return entry
    const preset = coerceRenderEffectPreset(entry.preset)
    return preset ? { ...entry, preset } : entry
  })
}

function coerceEffectIntentSyncDriver(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  if (['audio_beat', 'audio', 'beat', 'music', 'rhythm'].includes(normalized)) return 'audio_beat'
  if (['motion_subject', 'subject_motion', 'motion', 'visual_motion'].includes(normalized)) {
    return 'motion_subject'
  }
  if (['manual', 'none', 'off', 'disabled', 'static', 'usecurrentframe'].includes(normalized)) {
    return 'manual'
  }
  return undefined
}

function normalizeEffectIntents(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry)) return entry
    if (!isRecord(entry.sync)) return entry

    const sync: Record<string, unknown> = { ...entry.sync }
    const driver = coerceEffectIntentSyncDriver(sync.driver)
    if (driver) sync.driver = driver
    else delete sync.driver

    return {
      ...entry,
      sync,
    }
  })
}

function normalizeCritique(value: unknown): unknown {
  if (!isRecord(value)) {
    return {
      likely_failure_points: [],
      repair_notes: [],
      final_decision: 'usable',
    }
  }
  return {
    ...value,
    likely_failure_points: Array.isArray(value.likely_failure_points)
      ? value.likely_failure_points
      : [],
    repair_notes: Array.isArray(value.repair_notes) ? value.repair_notes : [],
    final_decision:
      typeof value.final_decision === 'string' && value.final_decision.trim()
        ? value.final_decision
        : 'usable',
  }
}

function normalizeRenderRecipe(value: unknown): unknown {
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = { ...value }
  const global_effects = coerceGlobalEffects(value.global_effects)
  if (global_effects?.length) next.global_effects = global_effects
  else delete next.global_effects
  if (Array.isArray(value.scene_effects)) {
    next.scene_effects = normalizeSceneEffects(value.scene_effects)
  }
  if (isRecord(value.audio_driver)) {
    const { preset: _legacyPreset, ...audioDriver } = value.audio_driver
    next.audio_driver = audioDriver
  }
  return next
}

/** 归一化 LLM 原始 JSON，兼容旧字段（marketing_role、缺 preset 等）后再 Zod 校验 */
export function normalizeDirectorGroundingCandidate(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate
  const next: Record<string, unknown> = { ...candidate }
  next.content_domain = coerceContentDomain(candidate.content_domain)

  if (Array.isArray(candidate.temporal_events)) {
    next.temporal_events = normalizeTemporalEvents(candidate.temporal_events)
  }
  if (Array.isArray(candidate.visual_phenomena)) {
    next.visual_phenomena = normalizeVisualPhenomena(candidate.visual_phenomena)
  }
  if (Array.isArray(candidate.shot_events)) {
    next.shot_events = normalizeShotEvents(candidate.shot_events)
  }
  if (Array.isArray(candidate.transition_observations)) {
    next.transition_observations = normalizeTransitionObservations(
      candidate.transition_observations,
    )
  }
  if (isRecord(candidate.render_recipe)) {
    next.render_recipe = normalizeRenderRecipe(candidate.render_recipe)
  }
  if (isRecord(candidate.remotion_capability_plan)) {
    next.remotion_capability_plan = {
      ...candidate.remotion_capability_plan,
      matched_plugins: normalizeMatchedPlugins(
        candidate.remotion_capability_plan.matched_plugins ?? [],
      ),
      capability_layers: normalizeCapabilityLayers(
        candidate.remotion_capability_plan.capability_layers ?? [],
      ),
    }
  }
  if (Array.isArray(candidate.effect_intents)) {
    next.effect_intents = normalizeEffectIntents(candidate.effect_intents)
  }
  next.critique = normalizeCritique(candidate.critique)
  return next
}
