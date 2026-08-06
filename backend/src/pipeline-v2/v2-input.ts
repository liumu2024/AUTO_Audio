import type { V2SampleUnderstandingResult } from '../../../shared/types/v2-sample-understanding.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2TimelineRevisionContext } from './timeline-revision-context.js'
import type { V2TimelineRevisionScope } from './timeline-revision-scope.js'

export interface V2PlannerMaterialInput {
  id: string
  name?: string
  type: 'video' | 'image' | 'audio'
  src: string
  publicUrl?: string
  tags?: string[]
}

/** Stable planning facts. Unlike a conversation recap, these fields are safe to
 * persist in a trace and cannot rewrite the user's current creative request. */
export interface V2PlanningContext {
  kind: 'initial' | 'revision'
  activeRequirements: string[]
  /** Relevant active long-term knowledge recalled for this turn; it is not persisted as V2 state. */
  recalledCreativeMemories?: string[]
  draftId?: string
  baseRevision?: number
  selectedClipId?: string
  authorizationEvidence?: string
}

export interface V2AgentSkillInstruction {
  id: string
  version: string
  source: 'v2_official' | 'official_remotion'
  hash: string
  content: string
}

export interface V2AgentSkillContext {
  primary: V2AgentSkillInstruction & { purpose: string }
  references: V2AgentSkillInstruction[]
}

export interface V2AgentToolContext {
  callId: string
  toolId: string
  arguments: Record<string, unknown>
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
  planningContext?: V2PlanningContext
  /** Server-built from a persisted V2 draft; clients never provide this. */
  revisionContext?: V2TimelineRevisionContext
  /** Server-only full base spec used for preservation/audit; never sent to the model. */
  revisionBaseSpec?: RemotionTimelineSpecV1
  /** Tool-authorized field scope applied before review and persistence. */
  revisionScope?: V2TimelineRevisionScope
  /** Tool-authorized target scene for the scene revision scope. */
  revisionSceneId?: string
  /** Server-resolved instructions and normalized arguments for this Agent stage. */
  agentSkillContext?: V2AgentSkillContext
  agentToolContext?: V2AgentToolContext
  /** System-confirmed effect->component mappings for this request. */
  componentHints?: Array<{ component_id: string; purpose?: 'scene' | 'transition'; matched_text: string }>
  /** All promoted (sedimented) render components available for reference. */
  availableComponents?: Array<{ id: string; purpose?: 'scene' | 'transition'; description: string }>
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
