import type { V2SampleUnderstandingResult } from '../../../shared/types/v2-sample-understanding.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { RenderComponentSummary } from '../modules/render-components/component-registry.js'
import type { V2TimelineRevisionContext } from './timeline-revision-context.js'
import type { V2TimelineRevisionGroup, V2TimelineRevisionScope } from './timeline-revision-scope.js'

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
  /** Relevant reviewed creation methods; separate from user preferences and never persisted as V2 state. */
  recalledCreativeKnowledge?: string[]
  draftId?: string
  baseRevision?: number
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
  /** Original turn text used only to preserve the user's output language during scoped revisions. */
  originalUserPrompt?: string
  creationMode?: 'sample_replicate' | 'material_brief' | 'text_to_video'
  mainVideoPath?: string
  inputImageUrl?: string
  referenceVideoPath?: string
  sampleUnderstanding?: V2SampleUnderstandingResult
  /** Director-authorized use of the currently selected sample in this operation. */
  useSampleReference?: boolean
  conversationSummary?: string
  planningContext?: V2PlanningContext
  /** Server-built from a persisted V2 draft; clients never provide this. */
  revisionContext?: V2TimelineRevisionContext
  /** Server-only full base spec used for preservation/audit; never sent to the model. */
  revisionBaseSpec?: RemotionTimelineSpecV1
  /** Tool-authorized field scope applied before review and persistence. */
  revisionScope?: V2TimelineRevisionScope
  /** Server-derived union of compatible same-scene scopes; never accepted from Tool arguments. */
  revisionGroup?: V2TimelineRevisionGroup
  /** Structure edits preserve their range unless the Tool explicitly authorizes timeline resizing. */
  revisionDurationMode?: 'preserve_range' | 'resize_timeline'
  /** Distinguishes a creative-direction update from an explicit whole-plan replacement. */
  revisionGlobalMode?: 'brief_update' | 'full_replan'
  /** Tool-authorized target scene for the scene revision scope. */
  revisionSceneId?: string
  /** Optional server-validated caption targets for a narrow subtitle edit. */
  revisionOverlayIds?: string[]
  /** Tool-authorized contiguous scene range for structural revisions. */
  revisionSceneIds?: string[]
  /** Tool-authorized target transitions for the transition revision scope. */
  revisionTransitionIds?: string[]
  /** Server-resolved instructions and normalized arguments for this Agent stage. */
  agentSkillContext?: V2AgentSkillContext
  agentToolContext?: V2AgentToolContext
  /** Server-confirmed render components available for reference. */
  availableComponents?: RenderComponentSummary[]
  materials?: V2PlannerMaterialInput[]
  /** Server-validated material IDs that this operation must actually use.
   * Other materials remain optional candidates. */
  requiredMaterialIds?: string[]
  durationSec?: number
  canvas?: {
    width?: number
    height?: number
    fps?: number
  }
}
