import type { ReplicationTaskDto } from '@/lib/api'

/** Poll interval while waiting for analyzer.worker */
export const ANALYSIS_POLL_MS = 2000

/** 30 minutes — seed TSX authoring can exceed the old 6-minute cap */
export const ANALYSIS_MAX_POLLS = 900

export function isAnalysisStructureReady(task: ReplicationTaskDto): boolean {
  return Boolean(
    task.structureJson &&
      (task.taskStatus === 'WAITING_USER_EDIT' || task.taskStatus === 'ANALYZING'),
  )
}
