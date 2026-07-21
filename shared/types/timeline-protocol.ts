/** 时间线协议 — 由 structure v1.2 + materials 推导或独立 Mock */

import type { TimelineTransition } from './migration-protocol.v1.2.js'

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
  label: string
  anchor_id?: string
  material_id?: string
  content_rewrite_instruction?: string
  visual_generation_prompt?: string
}

export interface TimelineProject {
  duration_sec: number
  tracks: TimelineTrack[]
  clips: TimelineClip[]
  transitions?: TimelineTransition[]
}
