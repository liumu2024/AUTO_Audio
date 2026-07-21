/** Director Grounding Layer — 内容域与视觉机制枚举（样例理解 → Remotion） */

export type ContentDomain =
  | 'landscape_montage'
  | 'product_ad'
  | 'music_visual'
  | 'motion_graphics'
  | 'talking_head'
  | 'unknown'

export const CONTENT_DOMAINS = [
  'landscape_montage',
  'product_ad',
  'music_visual',
  'motion_graphics',
  'talking_head',
  'unknown',
] as const satisfies readonly ContentDomain[]

/** 视觉现象的可复刻机制（对齐 render plugin layer_kind / visual_grammar） */
export type VisualPhenomenonMechanism =
  | 'motion_driver'
  | 'mask_reveal'
  | 'distortion'
  | 'color_transform'
  | 'texture_grade'
  | 'color_grade'
  | 'layout'
  | 'overlay'
  | 'audio_driver'

export const VISUAL_PHENOMENON_MECHANISMS = [
  'motion_driver',
  'mask_reveal',
  'distortion',
  'color_transform',
  'texture_grade',
  'color_grade',
  'layout',
  'overlay',
  'audio_driver',
] as const satisfies readonly VisualPhenomenonMechanism[]

/** 风光/旅拍等非广告样例常用 narrative creative_role */
export type LandscapeCreativeRole =
  | 'opening'
  | 'build'
  | 'climax'
  | 'afterglow'
  | 'cinematic_open'
  | 'beat_cut'
  | 'color_peak'
  | 'reflection_pause'
  | 'closing_frame'

export interface CapabilityLayerEntry {
  plugin_id: string
  layer: VisualPhenomenonMechanism
  preset?: string
  reason?: string
  confidence?: number
}

export interface CapabilityLayerPlan {
  segment_id: string
  layers: CapabilityLayerEntry[]
}

export function isMarketingContentDomain(domain: ContentDomain | undefined): boolean {
  return domain === 'product_ad'
}
