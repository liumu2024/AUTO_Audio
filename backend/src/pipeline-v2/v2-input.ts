import type { V2SampleUnderstandingResult } from '../../../shared/types/v2-sample-understanding.js'

export interface V2PlannerMaterialInput {
  id: string
  name?: string
  type: 'video' | 'image' | 'audio'
  src: string
  publicUrl?: string
  tags?: string[]
}

export interface V2PlannerInput {
  taskId: string
  prompt: string
  creationMode?: 'sample_replicate' | 'material_brief' | 'text_to_video'
  mainVideoPath?: string
  inputImageUrl?: string
  referenceVideoPath?: string
  sampleUnderstanding?: V2SampleUnderstandingResult
  conversationSummary?: string
  materials?: V2PlannerMaterialInput[]
  durationSec?: number
  plannerMode?: 'deterministic' | 'llm'
  allowPlannerFallback?: boolean
  canvas?: {
    width?: number
    height?: number
    fps?: number
  }
}
