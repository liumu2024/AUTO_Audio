/** v1.2 锚点人工可调字段。 */

export type MarketingRole =
  | 'hook'
  | 'pain_amplify'
  | 'demo'
  | 'product_demo'
  | 'cta'
  | 'social_proof'
  | 'brand_story'
  | 'entertainment'
  | string

export type EmotionVibe =
  | 'urgent'
  | 'warm'
  | 'tech'
  | 'humorous'
  | 'inspiring'
  | 'trustworthy'
  | 'cinematic'
  | 'dreamy'
  | string

export interface AnchorEditorProperties {
  anchor_id: string
  segment_label: string
  marketing_role: MarketingRole
  emotion_vibe: EmotionVibe
  visual_generation_prompt: string
  overlay_rewrite_instruction: string
}

export const NARRATIVE_ROLE_OPTIONS: {
  value: MarketingRole
  label: string
}[] = [
  { value: 'opening', label: '开篇' },
  { value: 'build', label: '铺陈' },
  { value: 'climax', label: '高潮' },
  { value: 'afterglow', label: '余韵' },
  { value: 'cinematic_open', label: '开场氛围' },
  { value: 'texture_cut', label: '质感切点' },
  { value: 'reflection_pause', label: '节奏留白' },
  { value: 'closing_frame', label: '收尾构图' },
  { value: 'entertainment', label: '氛围段落' },
]

/** @deprecated 广告向角色；生成编辑请优先用 NARRATIVE_ROLE_OPTIONS */
export const MARKETING_ROLE_OPTIONS: {
  value: MarketingRole
  label: string
}[] = [
  { value: 'hook', label: '开场吸引' },
  { value: 'pain_amplify', label: '痛点放大' },
  { value: 'demo', label: '产品展示' },
  { value: 'product_demo', label: '产品演示' },
  { value: 'cta', label: '行动召唤' },
  { value: 'social_proof', label: '信任证明' },
  { value: 'brand_story', label: '品牌故事' },
  { value: 'entertainment', label: '氛围段落' },
]

export const EMOTION_VIBE_OPTIONS: {
  value: EmotionVibe
  label: string
}[] = [
  { value: 'cinematic', label: '电影感' },
  { value: 'dreamy', label: '梦幻轻柔' },
  { value: 'warm', label: '温暖安静' },
  { value: 'inspiring', label: '开阔向上' },
  { value: 'tech', label: '冷静克制' },
  { value: 'humorous', label: '轻松' },
  { value: 'trustworthy', label: '沉稳' },
  { value: 'urgent', label: '紧凑' },
]
