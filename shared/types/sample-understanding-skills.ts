/** Skill 层与预处理中间产物 — Sample Understanding Layer */

export interface PreprocessorMetadata {
  video_duration: number
  fps: number
  frame_count: number
  width?: number
  height?: number
}

export interface PreprocessorOutput {
  frames_dir: string
  audio_path: string
  metadata: PreprocessorMetadata
  /** 关键帧时间戳（秒），含 1fps 均匀采样 + 场景切换点 */
  keyframe_times_sec: number[]
}

export interface AsrSegment {
  start: number
  end: number
  text: string
}

export interface AsrSkillOutput {
  speech: AsrSegment[]
}

export interface OcrCaption {
  start: number
  end?: number
  text: string
}

export interface OcrSkillOutput {
  captions: OcrCaption[]
}

export type ShotType =
  | 'close_up'
  | 'medium'
  | 'wide'
  | 'top_view'
  | 'macro'
  | string

export interface VisionFrameAnalysis {
  time: number
  objects: string[]
  scene: string
  shot_type: ShotType
}

export interface VisionSkillOutput {
  frames: VisionFrameAnalysis[]
}

export type MotionType =
  | 'push_in'
  | 'pull_out'
  | 'pan_left'
  | 'pan_right'
  | 'shake'
  | 'static'
  | string

export interface MotionEvent {
  time: number
  type: MotionType
}

export interface MotionSkillOutput {
  motions: MotionEvent[]
}

export interface RhythmSkillOutput {
  beats: number[]
}

export type EmotionType =
  | 'excited'
  | 'calm'
  | 'surprised'
  | 'urgent'
  | 'happy'
  | string

export interface EmotionSample {
  time: number
  type: EmotionType
  score: number
}

export interface EmotionSkillOutput {
  emotion: EmotionSample[]
}

/** Feature Aggregator 输出 — Planner LLM 的统一输入 */
export interface MultimodalFeatureBundle {
  speech: AsrSegment[]
  captions: OcrCaption[]
  frames: VisionFrameAnalysis[]
  motions: MotionEvent[]
  beats: number[]
  emotion: EmotionSample[]
  metadata?: PreprocessorMetadata
}

export interface AudioVisualUnderstandingHints {
  metadata: PreprocessorMetadata
  audio_features: {
    beats: number[]
    strong_beats: number[]
    energy_peaks: Array<{
      time: number
      intensity: number
      duration_sec: number
    }>
    waveform: Array<{
      time: number
      value: number
    }>
    sections: Array<{
      start: number
      end: number
      type: 'intro' | 'groove' | 'accent' | 'outro' | string
    }>
  }
  visual_keyframes: Array<{
    time: number
    reason: 'uniform' | 'beat' | 'strong_beat' | 'energy_peak' | 'section_boundary' | string
  }>
}

export type SkillName =
  | 'asr'
  | 'ocr'
  | 'vision'
  | 'motion'
  | 'rhythm'
  | 'emotion'

export interface SkillPipelineResult {
  preprocessor: PreprocessorOutput
  asr?: AsrSkillOutput
  ocr?: OcrSkillOutput
  vision?: VisionSkillOutput
  motion?: MotionSkillOutput
  rhythm?: RhythmSkillOutput
  emotion?: EmotionSkillOutput
  features: MultimodalFeatureBundle
}
