import { coerceStringArray, parseJsonIfString } from './json-utils.js'
import type { JsonRecord } from './json-utils.js'
import { isRecord, normalizeId } from './json-utils.js'
import { getRenderPluginManifest } from '../../../../../shared/lib/render-plugin-manifest.js'

export const SLOT_TYPES = ['video', 'image', 'audio', 'text'] as const
export type SlotType = (typeof SLOT_TYPES)[number]

export const SLOT_SOURCES = ['sample_video', 'reference_material'] as const
export type SlotSource = (typeof SLOT_SOURCES)[number]

export const TRANSITION_PRESENTATIONS = [
  'cut',
  'fade',
  'slide',
  'wipe',
  'flip',
  'clock_wipe',
] as const
export type TransitionPresentation = (typeof TRANSITION_PRESENTATIONS)[number]

export const TRANSITION_DIRECTIONS = [
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
] as const
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number]

export const RENDER_EFFECT_PRESETS = [
  'primitive_color_transform',
  'primitive_mask_reveal',
  'primitive_ring_overlay',
  'primitive_orb_motion',
  'primitive_orb_ring_overlay',
  'primitive_directional_wave_reveal',
  'primitive_texture_grade',
  'primitive_bloom_overlay',
  'primitive_vignette_overlay',
  'primitive_grain_overlay',
  'primitive_letterbox_overlay',
  'primitive_chromatic_aberration_overlay',
  'primitive_light_sweep_overlay',
  'primitive_beat_pulse',
  'primitive_beat_flash_overlay',
  'primitive_beat_color_unlock',
  'primitive_color_hint_overlay',
  'primitive_fade_overlay',
  'primitive_transition_accent_overlay',
  'primitive_slice_reveal',
  'primitive_ripple_displacement',
  'primitive_ripple_ring_overlay',
  'primitive_collage_layout',
] as const
export type RenderEffectPreset = (typeof RENDER_EFFECT_PRESETS)[number]

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function coerceSlotType(value: unknown): SlotType | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  const map: Record<string, SlotType> = {
    video: 'video',
    visual: 'video',
    clip: 'video',
    clips: 'video',
    footage: 'video',
    b_roll: 'video',
    video_clip: 'video',
    scene: 'video',
    shot: 'video',
    motion: 'video',
    dynamic_visual: 'video',
    image: 'image',
    img: 'image',
    photo: 'image',
    picture: 'image',
    pic: 'image',
    poster: 'image',
    product_image: 'image',
    still: 'image',
    static_visual: 'image',
    audio: 'audio',
    sound: 'audio',
    music: 'audio',
    bgm: 'audio',
    sfx: 'audio',
    voice: 'audio',
    voiceover: 'audio',
    voice_over: 'audio',
    speech: 'audio',
    narration: 'audio',
    text: 'text',
    copy: 'text',
    caption: 'text',
    subtitle: 'text',
    subtitles: 'text',
    title: 'text',
    headline: 'text',
    overlay: 'text',
    text_overlay: 'text',
    sticker_text: 'text',
    花字: 'text',
    字幕: 'text',
    文案: 'text',
  }
  return map[normalized]
}

export function coerceSlotSource(value: unknown): SlotSource | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (
    [
      'reference_material',
      'reference_materials',
      'reference',
      'references',
      'user_material',
      'user_materials',
      'material',
      'materials',
      'asset',
      'assets',
      'slot_candidate',
    ].includes(normalized)
  ) {
    return 'reference_material'
  }
  if (
    [
      'sample_video',
      'sample',
      'source_video',
      'structure_source',
      'input_video',
    ].includes(normalized)
  ) {
    return 'sample_video'
  }
  return undefined
}

export function coerceTransitionPresentation(
  value: unknown,
): TransitionPresentation | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  const presentationAlias: Record<string, TransitionPresentation> = {
    push_transition: 'slide',
    whip: 'slide',
    whip_pan: 'slide',
    motion_push: 'slide',
    color_wash: 'wipe',
    color_wash_transition: 'wipe',
    light_sweep: 'wipe',
    light_leak_transition: 'wipe',
  }
  if (presentationAlias[normalized]) return presentationAlias[normalized]
  if (
    ['hard_cut', 'straight_cut', 'jump_cut', 'match_cut', 'cut', '硬切', '直切', '卡点切'].includes(
      normalized,
    )
  ) {
    return 'cut'
  }
  if (
    [
      'crossfade',
      'cross_fade',
      'fade_in_out',
      'fade',
      'dissolve',
      '溶转',
      '淡入淡出',
      '叠化',
    ].includes(normalized)
  ) {
    return 'fade'
  }
  if (['slide', 'push', '滑动', '推拉'].includes(normalized)) return 'slide'
  if (['wipe', 'swipe', '擦除', '划像'].includes(normalized)) return 'wipe'
  if (['flip', '翻转'].includes(normalized)) return 'flip'
  if (['clock_wipe', 'clockwipe', 'radial_wipe', '时钟擦除'].includes(normalized)) {
    return 'clock_wipe'
  }
  return undefined
}

export function presentationNeedsTransitionDirection(
  presentation: unknown,
): boolean {
  if (typeof presentation !== 'string') return false
  const normalized = normalizeToken(presentation)
  return ['slide', 'wipe', 'flip', 'clock_wipe', 'clockwipe'].includes(normalized)
}

export function coerceTransitionDirection(
  value: unknown,
  presentation?: unknown,
): TransitionDirection | undefined {
  const needsDirection = presentationNeedsTransitionDirection(presentation)
  if (!needsDirection) return undefined
  if (value == null || value === '') return 'from-right'
  if (typeof value !== 'string') return 'from-right'

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  const mapping: Record<string, TransitionDirection | undefined> = {
    left: 'from-left',
    right: 'from-right',
    top: 'from-top',
    bottom: 'from-bottom',
    'from-left': 'from-left',
    'from-right': 'from-right',
    'from-top': 'from-top',
    'from-bottom': 'from-bottom',
    'slide-left': 'from-left',
    'slide-right': 'from-right',
    'slide-up': 'from-top',
    'slide-down': 'from-bottom',
    horizontal: 'from-right',
    vertical: 'from-bottom',
    in: 'from-right',
    out: 'from-left',
    none: undefined,
    center: undefined,
    左: 'from-left',
    右: 'from-right',
    上: 'from-top',
    下: 'from-bottom',
  }

  if (Object.prototype.hasOwnProperty.call(mapping, normalized)) {
    const mapped = mapping[normalized]
    return mapped ?? 'from-right'
  }
  if (/left|左/.test(normalized)) return 'from-left'
  if (/right|右/.test(normalized)) return 'from-right'
  if (/top|上/.test(normalized)) return 'from-top'
  if (/bottom|下/.test(normalized)) return 'from-bottom'
  return 'from-right'
}

export function coerceTransitionTimingType(
  value: unknown,
): 'linear' | 'spring' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['constant', 'ease', 'easing', 'linear'].includes(normalized)) return 'linear'
  if (['spring', 'bounce', 'elastic', '弹簧'].includes(normalized)) return 'spring'
  return undefined
}

export function coerceTransitionOverlayType(
  value: unknown,
): 'none' | 'light_leak' | 'flash' | 'color_wash' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const overlayAlias: Record<string, 'light_leak' | 'flash' | 'color_wash'> = {
    light_leak_transition: 'light_leak',
    light_sweep: 'light_leak',
    warm_light_sweep: 'light_leak',
    flash_cut: 'flash',
    transition_flash: 'flash',
    color_wash_transition: 'color_wash',
    gradient_wash: 'color_wash',
  }
  if (overlayAlias[normalized]) return overlayAlias[normalized]
  if (['none', 'no_overlay', '无'].includes(normalized)) return 'none'
  if (['light_leak', 'lightleak', '漏光', '光泄漏'].includes(normalized)) {
    return 'light_leak'
  }
  if (['flash', 'white_flash', '闪白'].includes(normalized)) return 'flash'
  if (['color_wash', 'colorwash', '色彩扫过'].includes(normalized)) return 'color_wash'
  return undefined
}

export function coerceSequenceLayout(
  value: unknown,
): 'fill' | 'none' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['none', 'inline'].includes(normalized)) return 'none'
  if (['fill', 'absolute_fill', 'absolute', 'full'].includes(normalized)) return 'fill'
  return undefined
}

export function coerceVisualMotionPreset(
  value: unknown,
): 'static' | 'zoom_in' | 'push_in' | 'pan' | 'shake' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  if (['static', 'still', 'none', '静止'].includes(normalized)) return 'static'
  if (['zoom', 'zoom_in', 'ken_burns', '放大', '推近'].includes(normalized)) return 'zoom_in'
  if (['push', 'push_in', 'dolly_in', '推进'].includes(normalized)) return 'push_in'
  if (['pan', 'truck', '平移', '横移'].includes(normalized)) return 'pan'
  if (['shake', 'handheld', '抖动', '手持'].includes(normalized)) return 'shake'
  return undefined
}

export function coerceRenderEffectPreset(
  value: unknown,
): RenderEffectPreset | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  const aliases: Record<string, RenderEffectPreset> = {
    cinematic_grade_pack: 'primitive_texture_grade',
    cinematic_grade: 'primitive_texture_grade',
    cinematic_texture_grade: 'primitive_texture_grade',
    texture_grade: 'primitive_texture_grade',
    film_grain: 'primitive_texture_grade',
    primitive_texture_grade: 'primitive_texture_grade',
    primitive_color_transform: 'primitive_color_transform',
    grayscale_to_color_transform: 'primitive_color_transform',
    grayscale_to_color: 'primitive_color_transform',
    black_white_to_color: 'primitive_color_transform',
    primitive_mask_reveal: 'primitive_mask_reveal',
    circle_mask_reveal: 'primitive_mask_reveal',
    circular_mask_reveal: 'primitive_mask_reveal',
    primitive_ring_overlay: 'primitive_ring_overlay',
    portal_ring_overlay: 'primitive_ring_overlay',
    primitive_orb_motion: 'primitive_orb_motion',
    orb_motion_driver: 'primitive_orb_motion',
    primitive_orb_ring_overlay: 'primitive_orb_ring_overlay',
    orb_ring_follow_overlay: 'primitive_orb_ring_overlay',
    primitive_directional_wave_reveal: 'primitive_directional_wave_reveal',
    directional_wave_reveal: 'primitive_directional_wave_reveal',
    audio_reactive_cut_driver: 'primitive_beat_pulse',
    audio_reactive: 'primitive_beat_pulse',
    beat_cut_driver: 'primitive_beat_pulse',
    primitive_beat_pulse: 'primitive_beat_pulse',
    primitive_beat_flash_overlay: 'primitive_beat_flash_overlay',
    primitive_beat_color_unlock: 'primitive_beat_color_unlock',
    beat_color_unlock: 'primitive_beat_color_unlock',
    beat_synced_color_unlock: 'primitive_beat_color_unlock',
    color_wake_on_beat: 'primitive_beat_color_unlock',
    color_hint_overlay: 'primitive_color_hint_overlay',
    color_hint_square_overlay: 'primitive_color_hint_overlay',
    color_square_hint: 'primitive_color_hint_overlay',
    primitive_color_hint_overlay: 'primitive_color_hint_overlay',
    fade_to_black: 'primitive_fade_overlay',
    segment_fade_to_black: 'primitive_fade_overlay',
    primitive_fade_overlay: 'primitive_fade_overlay',
    transition_accent: 'primitive_transition_accent_overlay',
    transition_flash: 'primitive_transition_accent_overlay',
    flash_transition: 'primitive_transition_accent_overlay',
    light_leak_transition: 'primitive_transition_accent_overlay',
    color_wash_transition: 'primitive_transition_accent_overlay',
    zoom_blur_transition: 'primitive_transition_accent_overlay',
    primitive_transition_accent_overlay: 'primitive_transition_accent_overlay',
    mask_slice_transition: 'primitive_slice_reveal',
    mask_slice: 'primitive_slice_reveal',
    primitive_slice_reveal: 'primitive_slice_reveal',
    editorial_split_collage: 'primitive_collage_layout',
    editorial_split: 'primitive_collage_layout',
    split_collage_layout: 'primitive_collage_layout',
    primitive_collage_layout: 'primitive_collage_layout',
    color_portal_spotlight: 'primitive_mask_reveal',
    color_portal: 'primitive_mask_reveal',
    portal_spotlight: 'primitive_mask_reveal',
    kinetic_color_ripple: 'primitive_directional_wave_reveal',
    kinetic_ripple: 'primitive_directional_wave_reveal',
    ripple_displacement: 'primitive_ripple_displacement',
    ripple: 'primitive_ripple_displacement',
    primitive_ripple_displacement: 'primitive_ripple_displacement',
    cinematic_light_sweep: 'primitive_light_sweep_overlay',
    light_sweep: 'primitive_light_sweep_overlay',
    primitive_light_sweep_overlay: 'primitive_light_sweep_overlay',
    primitive_bloom_overlay: 'primitive_bloom_overlay',
    primitive_vignette_overlay: 'primitive_vignette_overlay',
    primitive_grain_overlay: 'primitive_grain_overlay',
    primitive_letterbox_overlay: 'primitive_letterbox_overlay',
    primitive_chromatic_aberration_overlay: 'primitive_chromatic_aberration_overlay',
    primitive_ripple_ring_overlay: 'primitive_ripple_ring_overlay',
  }
  return aliases[normalized]
}

export function coerceGlobalEffects(
  value: unknown,
): RenderEffectPreset[] | undefined {
  const parsed = parseJsonIfString(value)
  if (parsed !== value) return coerceGlobalEffects(parsed)
  if (parsed == null) return undefined
  if (Array.isArray(parsed)) {
    const presets = parsed
      .map((item) => coerceRenderEffectPreset(item))
      .filter((item): item is RenderEffectPreset => Boolean(item))
    return presets.length ? presets : undefined
  }
  if (typeof parsed === 'string') {
    const parts = coerceStringArray(parsed)
    if (parts.length > 1) return coerceGlobalEffects(parts)
    const single = coerceRenderEffectPreset(parsed)
    return single ? [single] : undefined
  }
  return undefined
}

export function normalizeSceneEffects(value: unknown): JsonRecord[] | undefined {
  const parsed = parseJsonIfString(value)
  if (parsed == null) return undefined
  if (!Array.isArray(parsed)) return undefined
  const normalized: JsonRecord[] = []
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry)) continue
    const pluginId =
      typeof entry.plugin_id === 'string'
        ? entry.plugin_id
        : typeof entry.effect_id === 'string'
          ? entry.effect_id
          : undefined
    const preset = coerceRenderEffectPreset(entry.preset) ??
      (pluginId ? coerceRenderEffectPreset(getRenderPluginManifest(pluginId)?.fallbackPreset) : undefined)
    if (!preset) continue
    normalized.push({
      ...entry,
      segment_id: normalizeId(entry.segment_id, `seg_${String(index + 1).padStart(3, '0')}`),
      preset,
      ...(pluginId && !entry.plugin_id ? { plugin_id: pluginId } : {}),
    })
  }
  return normalized.length ? normalized : undefined
}

export function normalizeRenderRecipe(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined
  const global_effects = coerceGlobalEffects(value.global_effects)
  const scene_effects = normalizeSceneEffects(value.scene_effects)
  const next: JsonRecord = { ...value }
  if (global_effects?.length) next.global_effects = global_effects
  else delete next.global_effects
  if (scene_effects?.length) next.scene_effects = scene_effects
  else delete next.scene_effects
  return next
}
