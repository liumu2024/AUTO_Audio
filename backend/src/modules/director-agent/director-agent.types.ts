import type { DirectorAction } from '../../../../shared/types/director-action.js'
import type { DirectorSessionState } from '../../../../shared/types/director-state.js'
import type {
  DirectorContext,
  DirectorContextSlots,
} from '../../../../shared/types/director-context.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorSurfaceMode } from './surface-router.js'
import type { DirectorWorkspaceState } from './director-workspace-session.js'

export interface DirectorAgentChatRequest {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  /** Stable browser workspace id; the server creates a V2 session when absent. */
  workspaceSessionId?: string
  /** Injected by the controller from the authenticated/request user boundary. */
  userId?: number
}

export type DirectorAgentStreamEvent =
  | {
      type: 'surface'
      mode: DirectorSurfaceMode
      confidence: number
      shouldRunIntentRouter: boolean
      directMessage?: string
    }
  | {
      type: 'thought'
      title: string
      content: string
    }
  | {
      type: 'intent'
      intent: string
      confidence: number
      contentDomain: string
      source?: 'llm' | 'llm_unstructured_safe_reply' | 'context_fallback'
    }
  | {
      type: 'slot_update'
      slots: DirectorContextSlots
      missingSlots: string[]
    }
  | {
      type: 'action_plan'
      action: DirectorAction
    }
  | {
      type: 'state_update'
      state: DirectorSessionState
    }
  | {
      type: 'workspace_session'
      workspaceSessionId: string
      state: DirectorWorkspaceState
      traceDir: string
      modelCalled: boolean
      responseId?: string
      responseContinuityDisabled?: boolean
    }
  | {
      type: 'done'
      action?: DirectorAction
      message?: string
    }
  | {
      type: 'error'
      message: string
    }
