/**
 * Migration JSON Protocol v1.2
 * 与 fonted 前端 shared-types 对齐，落库至 ReplicationTask.structureJson (JSONB)
 */

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
