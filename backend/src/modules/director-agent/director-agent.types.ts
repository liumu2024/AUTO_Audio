import type { DirectorAction } from '../../../../shared/types/director-action.js'
import type { DirectorSessionState } from '../../../../shared/types/director-state.js'
import type {
  DirectorContext,
  DirectorContextSlots,
} from '../../../../shared/types/director-context.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorSurfaceMode } from './surface-router.js'

export interface DirectorAgentChatRequest {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
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
      source?: 'llm' | 'rule_fallback'
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
      type: 'done'
      action?: DirectorAction
      message?: string
    }
  | {
      type: 'error'
      message: string
    }
