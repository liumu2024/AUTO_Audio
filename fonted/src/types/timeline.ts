export type TrackId = 'video' | 'overlay' | 'audio' | 'effect'

export interface TimelineTrack {
  id: TrackId
  label: string
  sublabel: string
}

export interface TimelineClip {
  id: string
  track_id: TrackId
  start_sec: number
  end_sec: number
  /** 视频素材名 / 花字 OCR / 音效名 */
  label: string
  anchor_id?: string
  content_rewrite_instruction?: string
  visual_generation_prompt?: string
}

export interface TimelineProject {
  duration_sec: number
  tracks: TimelineTrack[]
  clips: TimelineClip[]
}
