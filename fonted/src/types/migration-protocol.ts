/** Migration JSON Protocol v1.2 — Truth Source */

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

export interface LogicIntent {
  marketing_role: MarketingRole
  emotion_vibe?: EmotionVibe
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
  layout: 'fill' | 'none'
  premount_sec: number
}

export interface VisualMotion {
  preset: 'static' | 'zoom_in' | 'push_in' | 'pan' | 'shake'
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

export interface TimelineTransition {
  id: string
  from_anchor_id: string
  to_anchor_id: string
  at_sec: number
  presentation: 'cut' | 'fade' | 'slide' | 'wipe' | 'flip' | 'clock_wipe'
  duration_sec: number
  timing: {
    type: 'linear' | 'spring'
    easing?: string
    damping?: number
    stiffness?: number
  }
  direction?: 'from-left' | 'from-right' | 'from-top' | 'from-bottom'
  overlay?: {
    type: 'none' | 'light_leak' | 'flash' | 'color_wash'
    duration_sec?: number
    offset_sec?: number
    intensity?: number
  }
  reason?: string
}

export interface DirectorTemporalEvent {
  id: string
  start_sec: number
  end_sec: number
  creative_role: string
  description: string
  visual_prompt: string
  overlay_text?: string
  emotion_vibe?: string
  camera?: string
  motion?: string
  visual_motion?: VisualMotion
  slot_tags?: string[]
  accepted_material_types?: Array<'video' | 'image' | 'audio' | 'text'>
}

export interface DirectorVisualPhenomenon {
  id: string
  start_sec: number
  end_sec: number
  type: string
  description: string
  evidence?: string
  confidence?: number
}

export interface DirectorGroundingResult {
  schema_version?: 'director_grounding.v1' | string
  audio_visual_evidence?: {
    duration_sec?: number
    fps?: number
    key_observations?: string[]
    beat_summary?: string
  }
  visual_phenomena?: DirectorVisualPhenomenon[]
  temporal_events?: DirectorTemporalEvent[]
  style_summary?: {
    style_family?: string
    editing_pattern?: string
    audio_sync_logic?: string
    visual_style?: string
    pace?: string
  }
  remotion_capability_plan?: {
    matched_plugins?: Array<{
      preset: string
      reason: string
      segment_ids?: string[]
    }>
    missing_capabilities?: Array<{
      id: string
      description: string
      suggested_contract?: Record<string, unknown>
    }>
  }
  render_recipe?: RenderRecipeExtension
  critique?: {
    likely_failure_points?: string[]
    repair_notes?: string[]
    final_decision?: string
  }
}

export interface RenderRecipeExtension {
  style_family?: string
  global_effects?: string[]
  scene_effects?: Array<{
    segment_id: string
    preset: string
    params?: Record<string, unknown>
  }>
  audio_driver?: {
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
}

export interface MigrationProtocolV12 {
  version: '1.2'
  metadata: {
    video_id: string
    duration_sec: number
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
  director_grounding?: DirectorGroundingResult | unknown
}

export const MARKETING_ROLE_LABELS: Record<string, string> = {
  hook: 'Hook',
  pain_amplify: '痛点放大',
  product_demo: '产品演示',
  demo: '产品演示',
  cta: 'CTA',
  social_proof: '社会证明',
  brand_story: '品牌故事',
}

export const ANCHOR_COLORS: Record<string, string> = {
  hook: '#ef4444',
  pain_amplify: '#f97316',
  product_demo: '#3b82f6',
  demo: '#3b82f6',
  cta: '#a855f7',
  social_proof: '#22c55e',
  brand_story: '#a855f7',
}

export function getAnchorId(anchor: SemanticAnchor): string {
  return anchor.anchor_id
}

export function getAnchorStart(anchor: SemanticAnchor): number {
  return anchor.start_sec
}

export function getAnchorEnd(anchor: SemanticAnchor): number {
  return anchor.end_sec
}

export function getAnchorLabel(anchor: SemanticAnchor): string {
  return (
    MARKETING_ROLE_LABELS[anchor.logic_intent.marketing_role] ??
    anchor.anchor_id
  )
}

export function getAnchorColor(anchor: SemanticAnchor): string {
  return ANCHOR_COLORS[anchor.logic_intent.marketing_role] ?? '#71717a'
}

export function findActiveAnchor(
  anchors: SemanticAnchor[],
  time: number,
): SemanticAnchor | undefined {
  return anchors.find((a) => time >= a.start_sec && time < a.end_sec)
}
