import type {
  DirectorContextSlots,
  DirectorIntentResult,
  DirectorUserIntent,
} from './director-context.js'

/** 对话层可输出的导演动作（不直接绑定具体任务实现） */
export type DirectorActionType =
  | 'ANALYZE_SAMPLE'
  | 'ANALYZE_MATERIALS'
  | 'GENERATE_RENDER_PLAN'
  | 'REVISE_RENDER_PLAN'
  | 'RENDER_VIDEO'
  | 'ASK_USER'
  | 'REQUEST_PLUGIN'

export type DirectorToolName =
  | 'sample_understanding.analyze'
  | 'material.analyze_basic'
  | 'render_plan.build'
  | 'render_plan.revise'
  | 'render_plan.validate'
  | 'effect_composition.apply'
  | 'video.render'
  | 'user.ask'

export interface DirectorPlanStep {
  id: string
  tool: DirectorToolName
  reason: string
  required: boolean
  retryLimit: number
}

export interface DirectorExecutionPlan {
  version: 'director_plan_v1'
  sourceAction: DirectorActionType
  steps: DirectorPlanStep[]
}

export type DirectorFailureCode =
  | 'ARK_FILE_QUOTA_EXCEEDED'
  | 'API_KEY_INVALID'
  | 'MISSING_SAMPLE'
  | 'MISSING_MATERIAL'
  | 'MISSING_RENDER_PLAN'
  | 'PLAN_NOT_SYNCED'
  | 'PLAN_SCHEMA_INVALID'
  | 'UNSUPPORTED_COMPONENT'
  | 'RESOURCE_NOT_FOUND'
  | 'RENDER_FAILED'
  | 'UNKNOWN'

export interface DirectorToolError {
  code: DirectorFailureCode
  message: string
  recoverable: boolean
  stepId?: string
  tool?: DirectorToolName
}

export interface DirectorToolResult<T = unknown> {
  ok: boolean
  data?: T
  warnings: string[]
  errors: DirectorToolError[]
}

export type DirectorPlanStepStatus =
  | 'planned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface DirectorPlanStepRun extends DirectorPlanStep {
  status: DirectorPlanStepStatus
  startedAt?: string
  completedAt?: string
  warnings?: string[]
  error?: DirectorToolError
}

export interface DirectorActionPayload {
  missingSlots?: string[]
  pluginId?: string
  requiresConfirmation?: boolean
  executionPlan?: DirectorExecutionPlan
}

export interface DirectorAction {
  type: DirectorActionType
  message: string
  intent: DirectorUserIntent
  slots: DirectorContextSlots
  result: DirectorIntentResult
  payload?: DirectorActionPayload
}

export type DirectorActionPhase =
  | 'idle'
  | 'message'
  | 'running'
  | 'completed'
  | 'failed'

export interface DirectorActionOutcome {
  phase: DirectorActionPhase
  action: DirectorActionType
  message: string
  /** 仅 ASK_USER / REQUEST_PLUGIN / REVISE_RENDER_PLAN 等无需后端任务时 */
  userFacingOnly?: boolean
  toolResult?: DirectorToolResult
  error?: string
}
