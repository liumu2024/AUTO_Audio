/**
 * Migration JSON Protocol v1.2
 * 与 fonted 前端 shared-types 对齐，落库至 ReplicationTask.structureJson (JSONB)
 */

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
}

export interface SemanticAnchor {
  anchor_id: string
  start_sec: number
  end_sec: number
  logic_intent: LogicIntent
  match: AnchorMatch
  replication_instructions: ReplicationInstructions
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
}

/** WebSocket task:progress 推送载荷（与 fonted taskStore 对齐） */
export interface TaskProgressPayload {
  progress: number
  stage: string
  log?: string
}

export const TASK_STATUS = {
  QUEUED: 'QUEUED',
  ANALYZING: 'ANALYZING',
  WAITING_USER_EDIT: 'WAITING_USER_EDIT',
  GENERATING: 'GENERATING',
  CANCELLING: 'CANCELLING',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]
