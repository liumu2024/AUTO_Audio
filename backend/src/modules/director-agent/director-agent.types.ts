import type { DirectorSessionState } from '../../../../shared/types/director-state.js'
import type {
  DirectorContext,
  DirectorContextSlots,
  DirectorEffectiveCreativeConfig,
} from '../../../../shared/types/director-context.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorSurfaceMode } from './surface-router.js'
import type { DirectorWorkspaceState } from './director-workspace-session.js'

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
  | { type: 'constraint_resolution'; config: DirectorEffectiveCreativeConfig }
  | {
      type: 'skill_selected'
      skillId: string
      purpose: string
    }
  | {
      type: 'skill_loaded'
      skillId: string
      version: string
      source: 'v2_official' | 'official_remotion'
      hash: string
      dependency: boolean
    }
  | {
      type: 'tool_proposed'
      callId: string
      toolId: string
      requestedMode: 'preview' | 'execute'
      effectiveMode: 'preview' | 'execute'
      modeNormalized: boolean
    }
  | {
      type: 'tool_started'
      callId: string
      toolId: string
    }
  | {
      type: 'tool_progress'
      callId: string
      toolId: string
      phase: string
      progress: number
      message: string
      elapsedMs?: number
      jobId?: string
      sceneId?: string
    }
  | {
      type: 'tool_result'
      actionRef: string
      status: 'succeeded' | 'failed' | 'skipped'
      callId: string
      toolId: string
      ok: boolean
      summary: string
      result?: Record<string, unknown>
      draft?: { draftId: string; revision: number; spec: import('../../../../shared/types/remotion-timeline-spec.v1.js').RemotionTimelineSpecV1; traceDir?: string }
    }
  | { type: 'assistant_reply'; message: string }
  | { type: 'workspace_snapshot'; workspaceSessionId: string; state: DirectorWorkspaceState }
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
      message?: string
    }
  | {
      type: 'error'
      message: string
    }
