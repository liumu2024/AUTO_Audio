// 定义后端生成的 Remotion 渲染参数契约，包括素材、场景、视觉层、贴层、音频轨和特效预设。
import type { RenderPlanComponentResolution } from '../../shared/types/render-plan.v1'
import type { SceneEffectBindingContext } from '../../shared/lib/effect-layer-binding-resolver'
export type { SceneEffectBindingContext } from '../../shared/lib/effect-layer-binding-resolver'
export type VisualMode =
  | 'material_clip'
  | 'ai_generated'
  | 'image_motion'
  | 'solid_bg'

export type RenderAssetType = 'video' | 'image' | 'audio' | 'generated_video'

export type TransitionPresentation =
  | 'cut'
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'flip'
  | 'clock_wipe'

export type TransitionTimingType = 'linear' | 'spring'

export type TransitionDirection =
  | 'from-left'
  | 'from-right'
  | 'from-top'
  | 'from-bottom'

export type TransitionOverlayType =
  | 'none'
  | 'light_leak'
  | 'flash'
  | 'color_wash'

export interface SequenceSpec {
  from_sec: number
  duration_sec: number
  layout: 'fill' | 'none'
  premount_sec: number
}

export interface RenderTransition {
  id: string
  from_anchor_id: string
  to_anchor_id: string
  at_sec: number
  presentation: TransitionPresentation
  duration_sec: number
  timing: {
    type: TransitionTimingType
    easing?: string
    damping?: number
    stiffness?: number
  }
  direction?: TransitionDirection
  overlay?: {
    type: TransitionOverlayType
    duration_sec?: number
    offset_sec?: number
    intensity?: number
  }
  reason?: string
}

export interface RenderAsset {
  id: string
  type: RenderAssetType
  name: string
  url: string
  duration_sec?: number
  source: 'user_material' | 'generated' | 'system'
}

export interface VisualLayer {
  mode: VisualMode
  asset_id?: string
  material_source?: 'user_material' | 'generated' | 'sample_reference'
  trim?: {
    start_sec: number
    end_sec: number
  }
  fit: 'cover' | 'contain'
  crop?: {
    x: number
    y: number
    scale: number
  }
  motion?: {
    preset: 'static' | 'zoom_in' | 'push_in' | 'pan' | 'shake'
    intensity: number
    easing?: string
    driver?: 'useCurrentFrame'
  }
  visual_prompt: string
}

export interface OverlayLayer {
  id: string
  type:
    | 'subtitle'
    | 'big_caption'
    | 'sticker'
    | 'alert_box'
    | 'price_tag'
    | 'cta'
  start_sec: number
  end_sec: number
  text: string
  layout: {
    position: 'top' | 'center' | 'bottom' | 'left' | 'right'
    align: 'left' | 'center' | 'right'
    max_width_pct: number
  }
  style: {
    font_size: number
    font_weight: 'regular' | 'bold' | 'black'
    font_family?: string
    letter_spacing_px?: number
    text_transform?: 'none' | 'uppercase'
    color: string
    background?: string
    border_radius_px?: number
    backdrop_blur_px?: number
    stroke?: string
    shadow?: boolean
    opacity?: number
    color_label?: {
      square_color: string
      square_size_px: number
      gap_px: number
    }
  }
  animation: {
    in: 'none' | 'pop' | 'fade_in' | 'slide_up' | 'bounce'
    out: 'none' | 'fade_out' | 'slide_down'
    emphasis?: 'shake' | 'flash' | 'scale_pulse'
  }
}

export interface AudioLayer {
  id: string
  type: 'bgm' | 'sfx' | 'voiceover'
  start_sec: number
  end_sec?: number
  asset_id?: string
  emotion_vibe?: string
  sfx_type?: 'whoosh' | 'ding' | 'pop' | 'hit' | 'transition' | 'none'
  voiceover_text?: string
  volume: number
  ducking?: boolean
}

export interface EffectKeyframeNumber {
  time: number
  value: number
}

export interface EffectKeyframePosition {
  time: number
  x_pct: number
  y_pct: number
}

export interface ColorPortalSpotlightEffects {
  preset: 'color_portal_spotlight'
  base_filter?: string
  portal: {
    shape: 'circle'
    radius_pct_keyframes: EffectKeyframeNumber[]
    position_keyframes: EffectKeyframePosition[]
    beat_reactive_scale?: boolean
  }
  ring?: {
    enabled: boolean
    stroke_px: number
    colors: string[]
    glow: {
      outer_blur_px: number
      outer_spread_px: number
      inner_blur_px: number
    }
    blend_mode?: string
    chromatic_aberration?: {
      enabled: boolean
      offset_px: number
    }
  }
}

export interface PrimitiveColorTransformEffects {
  preset: 'primitive_color_transform'
  transform: 'grayscale_to_color_base' | 'grade_filter'
  base_filter?: string
}

export interface PrimitiveMaskRevealEffects {
  preset: 'primitive_mask_reveal'
  mask: {
    shape: 'circle' | 'rectangle'
    radius_pct_keyframes: EffectKeyframeNumber[]
    position_keyframes: EffectKeyframePosition[]
    beat_reactive_scale?: boolean
  }
  reveal_asset_id?: string
  next_asset_id?: string
  lens_style?: 'none' | 'crystal'
  old_filter?: string
  new_filter?: string
  magnification?: number
  distortion_px?: number
  wave_strength_px?: number
  wave_speed?: number
  water_jitter_px?: number
  water_micro_jitter_px?: number
  water_band_opacity?: number
  water_caustic_opacity?: number
  rim_width_px?: number
  glow_px?: number
  chromatic_px?: number
}

export interface PrimitiveRingOverlayEffects {
  preset: 'primitive_ring_overlay'
  ring: NonNullable<ColorPortalSpotlightEffects['ring']>
  mask?: PrimitiveMaskRevealEffects['mask']
}

export interface PrimitiveOrbMotionEffects {
  preset: 'primitive_orb_motion'
  orb: KineticColorRippleEffects['orb']
}

export interface PrimitiveOrbRingOverlayEffects {
  preset: 'primitive_orb_ring_overlay'
  orb: KineticColorRippleEffects['orb']
  ring: NonNullable<KineticColorRippleEffects['ring']>
}

export interface PrimitiveDirectionalWaveRevealEffects {
  preset: 'primitive_directional_wave_reveal'
  color_layer?: KineticColorRippleEffects['color_layer']
  reveal_events: KineticColorRippleEffects['reveal_events']
}

export interface PrimitiveTextureGradeEffects {
  preset: 'primitive_texture_grade'
  base_filter?: string
  color_grade?: CinematicGradePackEffects['color_grade']
}

export interface PrimitiveBloomOverlayEffects {
  preset: 'primitive_bloom_overlay'
  bloom: NonNullable<CinematicGradePackEffects['bloom']>
}

export interface PrimitiveVignetteOverlayEffects {
  preset: 'primitive_vignette_overlay'
  vignette: NonNullable<CinematicGradePackEffects['vignette']>
}

export interface PrimitiveGrainOverlayEffects {
  preset: 'primitive_grain_overlay'
  grain: NonNullable<CinematicGradePackEffects['grain']>
}

export interface PrimitiveLetterboxOverlayEffects {
  preset: 'primitive_letterbox_overlay'
  letterbox: NonNullable<CinematicGradePackEffects['letterbox']>
}

export interface PrimitiveChromaticAberrationOverlayEffects {
  preset: 'primitive_chromatic_aberration_overlay'
  chromatic_aberration: NonNullable<CinematicGradePackEffects['chromatic_aberration']>
}

export interface PrimitiveLightSweepOverlayEffects {
  preset: 'primitive_light_sweep_overlay'
  sweep: CinematicLightSweepEffects['sweep']
}

export interface PrimitiveBeatPulseEffects {
  preset: 'primitive_beat_pulse'
  base_filter?: string
  beat_times: number[]
  strong_beats?: number[]
  energy_peaks?: AudioReactiveCutDriverEffects['energy_peaks']
  pulse?: AudioReactiveCutDriverEffects['pulse']
  shake?: AudioReactiveCutDriverEffects['shake']
}

export interface PrimitiveBeatFlashOverlayEffects {
  preset: 'primitive_beat_flash_overlay'
  strong_beats?: number[]
  energy_peaks?: AudioReactiveCutDriverEffects['energy_peaks']
  flash: NonNullable<AudioReactiveCutDriverEffects['flash']>
}

export interface PrimitiveBeatColorUnlockEffects {
  preset: 'primitive_beat_color_unlock'
  base_filter?: string
  color_filter?: string
  reveal_mode: 'radial' | 'directional_wipe' | 'soft_wave'
  trigger_times: number[]
  duration_sec: number
  origin?: {
    x_pct: number
    y_pct: number
  }
  direction?: 'left_to_right' | 'right_to_left' | 'top_to_bottom' | 'bottom_to_top' | 'center_out'
  feather_pct?: number
  hold_after?: boolean
}

export interface PrimitiveColorHintOverlayEffects {
  preset: 'primitive_color_hint_overlay'
  cues: Array<{
    id: string
    label: string
    color: string
    start_sec: number
    end_sec: number
    x_pct: number
    y_pct: number
  }>
  square_size_pct: number
  gap_px?: number
  font_size_px?: number
  text_color?: string
  fade_sec?: number
}

export interface PrimitiveFadeOverlayEffects {
  preset: 'primitive_fade_overlay'
  color: string
  start_sec: number
  duration_sec: number
  direction: 'in' | 'out'
  hold?: boolean
}

export interface PrimitiveTransitionAccentOverlayEffects {
  preset: 'primitive_transition_accent_overlay'
  style: 'flash' | 'light_leak' | 'color_wash' | 'zoom_blur'
  start_sec: number
  duration_sec: number
  color?: string
  secondary_color?: string
  intensity: number
  direction?: 'left_to_right' | 'right_to_left' | 'top_to_bottom' | 'bottom_to_top' | 'center'
}

export interface PrimitiveSliceRevealEffects {
  preset: 'primitive_slice_reveal'
  start_sec: number
  duration_sec: number
  slice_count: number
  direction: MaskSliceTransitionEffects['direction']
  mode: MaskSliceTransitionEffects['mode']
  stagger_sec?: number
  slide_distance_pct?: number
  overlay_asset_id?: string
  slice_style?: MaskSliceTransitionEffects['slice_style']
}

export interface PrimitiveRippleDisplacementEffects {
  preset: 'primitive_ripple_displacement'
  ripple: RippleDisplacementEffects['ripple']
}

export interface PrimitiveRippleRingOverlayEffects {
  preset: 'primitive_ripple_ring_overlay'
  ripple: RippleDisplacementEffects['ripple']
  lighting?: RippleDisplacementEffects['lighting']
}

export interface PrimitiveCollageLayoutEffects {
  preset: 'primitive_collage_layout'
  base_filter?: string
  color_grade?: EditorialSplitCollageEffects['color_grade']
  panels: EditorialSplitCollageEffects['panels']
  panel_style?: EditorialSplitCollageEffects['panel_style']
  layout_mode?: 'split' | 'radial_triangle_prism'
  background_filter?: string
  panel_filter?: string
  seam_px?: number
  seam_opacity?: number
  chromatic_px?: number
  entrance_duration_sec?: number
  stagger_sec?: number
  side_edge_y_pct?: number
  base_scale?: number
  seams_enabled?: boolean
}

export interface CinematicLightSweepEffects {
  preset: 'cinematic_light_sweep'
  base_filter?: string
  color_grade?: {
    saturate?: number
    contrast?: number
    brightness?: number
    hue_rotate_deg?: number
  }
  vignette?: {
    enabled: boolean
    opacity: number
    radius_pct: number
  }
  sweep: {
    angle_deg: number
    width_pct: number
    opacity_keyframes: EffectKeyframeNumber[]
    position_keyframes: EffectKeyframePosition[]
    colors: string[]
    blur_px?: number
    blend_mode?: string
  }
  grain?: {
    enabled: boolean
    opacity: number
    size_px: number
  }
  letterbox?: {
    enabled: boolean
    height_pct: number
  }
}

export interface RippleDisplacementEffects {
  preset: 'ripple_displacement'
  base_filter?: string
  ripple: {
    origin: {
      x_pct: number
      y_pct: number
    }
    start_sec: number
    duration_sec: number
    radius_pct_keyframes: EffectKeyframeNumber[]
    amplitude_px: number
    frequency: number
    decay: number
    width_pct: number
  }
  lighting?: {
    highlight_color?: string
    shadow_color?: string
    glow_color?: string
    ring_opacity?: number
  }
}

export interface KineticColorRippleEffects {
  preset: 'kinetic_color_ripple'
  base_filter?: string
  color_layer?: {
    saturate?: number
    contrast?: number
    brightness?: number
    accumulate?: boolean
  }
  orb: {
    radius_pct: number
    colors: string[]
    glow_px: number
    trail_enabled?: boolean
    trail_decay?: number
    path_keyframes: Array<{
      time: number
      x_pct: number
      y_pct: number
      easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot'
      hold?: boolean
    }>
  }
  ring?: {
    enabled: boolean
    follow_target: 'orb'
    lag_frames: number
    radius_multiplier: number
    stroke_px: number
    colors: string[]
    glow_px: number
    chromatic_aberration_px?: number
  }
  reveal_events: Array<{
    id: string
    mode?: 'energy' | 'ripple' | 'portal_burst'
    trigger_time: number
    origin: {
      x_pct: number
      y_pct: number
    }
    direction_from_motion?: boolean
    direction?: {
      x: number
      y: number
    }
    duration_sec: number
    wave_count: number
    wave_spacing_pct: number
    wave_width_pct: number
    propagation_speed_pct_per_sec: number
    color_unlock: number
    hold_after?: boolean
    jitter_px?: number
  }>
}

export interface EditorialSplitCollageEffects {
  preset: 'editorial_split_collage'
  base_filter?: string
  color_grade?: {
    saturate?: number
    contrast?: number
    brightness?: number
  }
  vignette?: {
    enabled: boolean
    opacity: number
    radius_pct: number
  }
  letterbox?: {
    enabled: boolean
    height_pct: number
  }
  grain?: {
    enabled: boolean
    opacity: number
    size_px: number
  }
  panels: Array<{
    id: string
    asset_id: string
    start_sec: number
    end_sec: number
    x_pct: number
    y_pct: number
    width_pct: number
    height_pct: number
    fit: 'cover' | 'contain'
    border_radius_px?: number
    opacity?: number
    entrance?: 'fade' | 'slide_left' | 'slide_right' | 'slide_up' | 'zoom'
    scale_from?: number
    scale_to?: number
  }>
  panel_style?: {
    shadow?: boolean
    border_px?: number
    border_color?: string
    chromatic_aberration_px?: number
  }
}

export interface CinematicGradePackEffects {
  preset: 'cinematic_grade_pack'
  base_filter?: string
  color_grade?: {
    saturate?: number
    contrast?: number
    brightness?: number
    hue_rotate_deg?: number
    sepia?: number
  }
  vignette?: {
    enabled: boolean
    opacity: number
    radius_pct: number
  }
  letterbox?: {
    enabled: boolean
    height_pct: number
  }
  grain?: {
    enabled: boolean
    opacity: number
    size_px: number
  }
  bloom?: {
    enabled: boolean
    opacity: number
    blur_px: number
  }
  chromatic_aberration?: {
    enabled: boolean
    offset_px: number
    opacity: number
  }
}

export interface AudioReactiveCutDriverEffects {
  preset: 'audio_reactive_cut_driver'
  base_filter?: string
  beat_times: number[]
  strong_beats?: number[]
  energy_peaks?: Array<{
    time: number
    intensity: number
    duration_sec?: number
  }>
  pulse?: {
    scale: number
    duration_sec: number
  }
  flash?: {
    enabled: boolean
    color: string
    opacity: number
    duration_sec: number
  }
  shake?: {
    enabled: boolean
    amplitude_px: number
    duration_sec: number
  }
}

export interface MaskSliceTransitionEffects {
  preset: 'mask_slice_transition'
  base_filter?: string
  start_sec: number
  duration_sec: number
  slice_count: number
  direction: 'horizontal' | 'vertical'
  mode: 'reveal' | 'cover' | 'shuffle'
  stagger_sec?: number
  slide_distance_pct?: number
  overlay_asset_id?: string
  slice_style?: {
    gap_px?: number
    shadow?: boolean
    chromatic_aberration_px?: number
  }
}

export interface GeneratedComponentEffects {
  preset: 'generated_component'
  component_id: string
  props: Record<string, unknown>
  fallback_preset?: SceneEffects['preset']
}

export type SceneEffects =
  | ColorPortalSpotlightEffects
  | PrimitiveColorTransformEffects
  | PrimitiveMaskRevealEffects
  | PrimitiveRingOverlayEffects
  | PrimitiveOrbMotionEffects
  | PrimitiveOrbRingOverlayEffects
  | PrimitiveDirectionalWaveRevealEffects
  | PrimitiveTextureGradeEffects
  | PrimitiveBloomOverlayEffects
  | PrimitiveVignetteOverlayEffects
  | PrimitiveGrainOverlayEffects
  | PrimitiveLetterboxOverlayEffects
  | PrimitiveChromaticAberrationOverlayEffects
  | PrimitiveLightSweepOverlayEffects
  | PrimitiveBeatPulseEffects
  | PrimitiveBeatFlashOverlayEffects
  | PrimitiveBeatColorUnlockEffects
  | PrimitiveColorHintOverlayEffects
  | PrimitiveFadeOverlayEffects
  | PrimitiveTransitionAccentOverlayEffects
  | PrimitiveSliceRevealEffects
  | PrimitiveRippleDisplacementEffects
  | PrimitiveRippleRingOverlayEffects
  | PrimitiveCollageLayoutEffects
  | CinematicLightSweepEffects
  | RippleDisplacementEffects
  | KineticColorRippleEffects
  | EditorialSplitCollageEffects
  | CinematicGradePackEffects
  | AudioReactiveCutDriverEffects
  | MaskSliceTransitionEffects
  | GeneratedComponentEffects

export type RenderEffectLayerKind =
  | 'motion_driver'
  | 'mask_reveal'
  | 'distortion'
  | 'color_transform'
  | 'texture_grade'
  | 'color_grade'
  | 'layout'
  | 'overlay'
  | 'audio_driver'
  | 'composite'

export interface RenderEffectLayer {
  id: string
  layerKind: RenderEffectLayerKind
  plugin_id: string
  preset: SceneEffects['preset']
  effects: SceneEffects
  source: 'scene_recipe' | 'global_effect' | 'audio_driver' | 'component_resolution' | 'composition_plan'
  is_primary: boolean
  reason?: string
  resolution?: 'compiled' | 'fallback' | 'missing'
  /** @deprecated use layerKind */
  kind?: RenderEffectLayerKind
}

export interface RemotionSceneProps {
  id: string
  sourceAnchorId: string
  fromFrame: number
  durationInFrames: number
  sequence?: SequenceSpec
  role: string
  visual: VisualLayer
  effects?: SceneEffects
  effectLayers?: RenderEffectLayer[]
  resolvedEffectLayers?: RenderEffectLayer[]
  effectBinding?: SceneEffectBindingContext
  overlays: OverlayLayer[]
  audio: AudioLayer[]
}

export interface RemotionRenderProps {
  taskId: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  strategy: 'montage' | 'motion_graphics' | 'hybrid'
  assets: RenderAsset[]
  scenes: RemotionSceneProps[]
  transitions?: RenderTransition[]
  componentResolution?: RenderPlanComponentResolution
}
