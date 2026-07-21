export type AnalyzedAssetType = 'video' | 'image' | 'audio'

export type AssetVisualTag =
  | 'face'
  | 'product'
  | 'close_up'
  | 'wide_shot'
  | 'empty_scene'
  | 'screen_recording'
  | 'food'
  | 'lifestyle'
  | string

export type AssetEmotionTag =
  | 'excited'
  | 'calm'
  | 'surprised'
  | 'urgent'
  | 'happy'
  | 'trustworthy'
  | string

export interface AssetSegmentV1 {
  id: string
  asset_id: string
  start_sec: number
  end_sec: number
  tags: AssetVisualTag[]
  emotion_tags?: AssetEmotionTag[]
  shot_type?: 'close_up' | 'medium' | 'wide' | 'macro' | 'screen' | string
  motion?: 'static' | 'push_in' | 'pan' | 'shake' | 'handheld' | string
  transcript?: string
  ocr_text?: string
  score: number
}

export interface AssetAnalysisV1 {
  version: '1.0'
  asset_id: string
  type: AnalyzedAssetType
  name: string
  url: string
  duration_sec?: number
  tags: AssetVisualTag[]
  segments: AssetSegmentV1[]
}
