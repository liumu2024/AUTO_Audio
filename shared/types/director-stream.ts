import type {
  DirectorContextSlots,
  DirectorEffectiveCreativeConfig,
} from './director-context.js'
import type { DirectorSessionState } from './director-state.js'
import type { DirectorWorkspaceState } from './director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from './remotion-timeline-spec.v1.js'

export type DirectorSurfaceMode =
  | 'smalltalk'
  | 'help'
  | 'capability_intro'
  | 'creative_guide'
  | 'task'
  | 'edit'
  | 'repair'
  | 'unknown'

export type DirectorAgentStreamEvent =
  | {
      type: 'turn_receipt'
      turnRequestId: string
      status: 'running' | 'replayed' | 'failed'
    }
  | {
      type: 'surface'
      mode: DirectorSurfaceMode
      confidence: number
      shouldRunIntentRouter: boolean
      directMessage?: string
    }
  | { type: 'thought'; title: string; content: string }
  | {
      type: 'intent'
      intent: string
      confidence: number
      contentDomain: string
      source?: 'llm' | 'llm_unstructured_safe_reply' | 'context_fallback'
    }
  | { type: 'slot_update'; slots: DirectorContextSlots; missingSlots: string[] }
  | { type: 'constraint_resolution'; config: DirectorEffectiveCreativeConfig }
  | { type: 'skill_selected'; skillId: string; purpose: string }
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
  | { type: 'tool_started'; callId: string; toolId: string }
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
      draft?: {
        draftId: string
        revision: number
        spec: RemotionTimelineSpecV1
        traceDir?: string
      }
    }
  | { type: 'assistant_reply'; message: string }
  | { type: 'state_update'; state: DirectorSessionState }
  | {
      type: 'workspace_session'
      workspaceSessionId: string
      turnRequestId: string
      stateRevision: number
      state: DirectorWorkspaceState
      traceDir: string
      modelCalled: boolean
      responseId?: string
      responseContinuityDisabled?: boolean
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
