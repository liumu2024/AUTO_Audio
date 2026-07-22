export interface V2PlannerInput {
  taskId: string
  prompt: string
  mainVideoPath?: string
  inputImageUrl?: string
  referenceVideoPath?: string
  durationSec?: number
  plannerMode?: 'deterministic' | 'llm'
  allowPlannerFallback?: boolean
  canvas?: {
    width?: number
    height?: number
    fps?: number
  }
}
