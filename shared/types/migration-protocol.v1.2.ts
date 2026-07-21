/** Migration JSON Protocol v1.2 — 视频理解输出（语义结构） */

import type { ContentDomain, VisualPhenomenonMechanism } from './director-grounding.v1.js'

export type { ContentDomain, VisualPhenomenonMechanism }

export type MarketingRole =
  | 'hook'
  | 'pain_amplify'
  | 'product_demo'
  | 'demo'
  | 'cta'
  | 'social_proof'
  | 'brand_story'
  | string

export type EmotionVibe =
  | 'urgent'
  | 'warm'
  | 'tech'
  | 'humorous'
  | 'inspiring'
  | 'trustworthy'
  | string

export type MatchStatus = 'matched' | 'gap' | 'pending'

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

export type SequenceLayout = 'fill' | 'none'

export type VisualMotionPreset =
  | 'static'
  | 'zoom_in'
  | 'push_in'
  | 'pan'
  | 'shake'

export interface LogicIntent {
  /** 营销向角色（产品广告链路）；非广告样例可与 creative_role 相同 */
  marketing_role: MarketingRole
  /** 可执行叙事/剪辑角色（opening/build/climax 等） */
  creative_role?: string
  emotion_vibe?: EmotionVibe
  evidence_refs?: string[]
  confidence?: number
}

export interface AnchorMatch {
  status: MatchStatus
  asset_name: string | null
  asset_id?: string
}

export interface ReplicationInstructions {
  visual_generation_prompt: string
  overlay_rewrite_instruction: string
  visual_motion?: VisualMotion
}

export interface SequenceSpec {
  from_sec: number
  duration_sec: number
  layout: SequenceLayout
  premount_sec: number
}

export interface VisualMotion {
  preset: VisualMotionPreset
  intensity: number
  easing?: string
  driver: 'useCurrentFrame'
}

export interface SemanticAnchor {
  anchor_id: string
  start_sec: number
  end_sec: number
  sequence?: SequenceSpec
  logic_intent: LogicIntent
  match: AnchorMatch
  replication_instructions: ReplicationInstructions
}

export interface TransitionTiming {
  type: TransitionTimingType
  easing?: string
  damping?: number
  stiffness?: number
}

export interface TransitionOverlay {
  type: TransitionOverlayType
  duration_sec?: number
  offset_sec?: number
  intensity?: number
}

export interface TimelineTransition {
  id: string
  from_anchor_id: string
  to_anchor_id: string
  at_sec: number
  presentation: TransitionPresentation
  duration_sec: number
  timing: TransitionTiming
  direction?: TransitionDirection
  overlay?: TransitionOverlay
  reason?: string
}

export interface RenderSceneEffectRecipe {
  segment_id: string
  preset?: string
  effect_id?: string
  plugin_id?: string
  layer?: VisualPhenomenonMechanism
  phenomenon?: string
  evidence_refs?: string[]
  confidence?: number
  params?: Record<string, unknown>
}

export interface RenderAudioDriverRecipe {
  beat_times: number[]
  strong_beats?: number[]
  energy_peaks?: Array<{
    time: number
    intensity: number
    duration_sec?: number
  }>
  waveform?: Array<{
    time: number
    value: number
  }>
}

export interface RenderRecipeExtension {
  style_family?: string
  global_effects?: string[]
  scene_effects?: RenderSceneEffectRecipe[]
  audio_driver?: RenderAudioDriverRecipe
}

export interface MigrationProtocolV12 {
  version: '1.2'
  metadata: {
    video_id: string
    duration_sec: number
    content_domain?: ContentDomain
  }
  source_video: {
    url: string
    duration: number
  }
  generated_video: {
    url: string
    duration: number
  }
  semantic_anchors: SemanticAnchor[]
  transitions?: TimelineTransition[]
  render_recipe?: RenderRecipeExtension
  /** Optional audit artifact from Director Grounding Layer for UI/debug/repair. */
  director_grounding?: unknown
}
