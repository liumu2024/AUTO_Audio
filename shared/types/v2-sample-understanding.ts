export const V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION = 'v2_sample_understanding.v1' as const

export type V2SampleUnderstandingSource = 'llm' | 'heuristic' | 'llm_fallback'

export interface V2SampleUnderstandingSegment {
  id: string
  title_zh: string
  start_sec: number
  end_sec: number
  visual_content_zh: string
  characters_objects_zh: string
  atmosphere_zh: string
  camera_zh: string
  motion_zh: string
  editing_zh: string
  rhythm_zh: string
  transition_after_zh?: string
  text_cues_zh?: string
  reusable_style_zh: string
  material_hint_zh: string
  caution_zh?: string
}

export interface V2SampleUnderstandingResult {
  schema_version: typeof V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION
  task_id: string
  source: V2SampleUnderstandingSource
  sample: {
    name?: string
    duration_sec: number
    width?: number
    height?: number
    fps?: number
  }
  summary_zh: string
  story_zh: string
  atmosphere_zh: string
  editing_zh: string
  rhythm_zh: string
  reusable_style_zh: string
  not_reusable_zh: string
  segments: V2SampleUnderstandingSegment[]
  questions_for_user_zh: string[]
  warnings_zh: string[]
}
