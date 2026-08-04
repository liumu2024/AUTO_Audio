import type { DirectorContext } from './director-context.js'

export type DirectorWorkspaceTurnRole = 'user' | 'assistant' | 'system'

export interface DirectorWorkspaceTurn {
  role: DirectorWorkspaceTurnRole
  content: string
  at: string
  intent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
  outcome?: string
}

export interface ConfirmedRequirement {
  id: string
  statement: string
  status: 'active' | 'superseded' | 'revoked'
  sourceTurnId: string
  supersededBy?: string
}

export interface DirectorWorkspaceState {
  context: DirectorContext
  confirmedRequirements: ConfirmedRequirement[]
  draftId?: string
  baseRevision?: number
  selectedItemId?: string
  latestExecution?: { action: string; outcome: string; traceDir?: string }
  pendingQuestion?: string
  recentFailure?: { reason: string; recovery?: string }
  rollingSummary: string
  turns: DirectorWorkspaceTurn[]
  responseId?: string
  responseContinuityDisabled?: boolean
  /** Bounded idempotency ledger for server-authorized V2 tool calls. */
  recentToolCallIds?: string[]
}
