import type { DirectorContext } from '../../../../shared/types/director-context.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'

export interface DirectorAgentChatRequest {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  /** Materials explicitly attached to this turn; omitted for contextual follow-ups. */
  currentTurnMaterialIds?: string[]
  /** True only after the user changed the current material selection in this browser session. */
  contextMaterialsAuthoritative?: boolean
  /** True only after the user selected or cleared the current sample in this browser session. */
  contextSampleAuthoritative?: boolean
  /** Stable for one user submission and reused only for transport retries. */
  turnRequestId?: string
  /** Last server workspace revision observed by this browser. */
  workspaceStateRevision?: number
  /** Explicit decision for the exact server-validated revision proposal. */
  timelineRevisionDecision?: {
    confirmationId: string
    action: 'confirm' | 'reject'
  }
  /** Stable browser workspace id; the server creates a V2 session when absent. */
  workspaceSessionId?: string
  /** Injected by the controller from the authenticated/request user boundary. */
  userId?: number
}
