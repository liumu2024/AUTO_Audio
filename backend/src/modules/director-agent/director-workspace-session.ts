import type { DirectorContext } from '../../../../shared/types/director-context.js'
import type {
  DirectorWorkspaceState,
  DirectorWorkspaceTurn,
  DirectorWorkspaceTurnRole,
} from '../../../../shared/types/director-workspace-session.js'

export type { DirectorWorkspaceState, DirectorWorkspaceTurn, DirectorWorkspaceTurnRole }

export interface DirectorWorkspacePatch {
  context?: unknown
  draftId?: string | null
  baseRevision?: number | null
  selectedItemId?: string | null
  latestExecution?: DirectorWorkspaceState['latestExecution'] | null
  pendingQuestion?: string | null
  recentFailure?: DirectorWorkspaceState['recentFailure'] | null
  responseId?: string | null
  responseContinuityDisabled?: boolean
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Presence-aware JSON merge patch. Undefined means no opinion; null means the
 * user/model explicitly cleared the value. Arrays are replaced only when the
 * patch contains one. This is the single V2 session state merge seam.
 */
function mergePresent(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return clone(base)
  if (patch === null) return undefined
  if (Array.isArray(patch)) return clone(patch)
  if (!isRecord(patch)) return clone(patch)

  const source = isRecord(base) ? base : {}
  const result: Record<string, unknown> = { ...clone(source) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const merged = mergePresent(source[key], value)
    if (merged === undefined) delete result[key]
    else result[key] = merged
  }
  return result
}

export function createDirectorWorkspaceState(input: {
  context: DirectorContext
  draftId?: string
  baseRevision?: number
}): DirectorWorkspaceState {
  return {
    context: clone(input.context),
    draftId: input.draftId,
    baseRevision: input.baseRevision,
    rollingSummary: '',
    turns: [],
  }
}

export function applyDirectorWorkspacePatch(
  state: DirectorWorkspaceState,
  patch: DirectorWorkspacePatch,
): DirectorWorkspaceState {
  const next = clone(state)
  if (patch.context !== undefined) {
    next.context = mergePresent(state.context, patch.context) as DirectorContext
  }
  for (const key of [
    'draftId',
    'baseRevision',
    'selectedItemId',
    'latestExecution',
    'pendingQuestion',
    'recentFailure',
    'responseId',
  ] as const) {
    if (patch[key] === undefined) continue
    const value = patch[key]
    if (value === null) delete next[key]
    else Object.assign(next, { [key]: clone(value) })
  }
  if (patch.responseContinuityDisabled !== undefined) {
    next.responseContinuityDisabled = patch.responseContinuityDisabled
  }
  return next
}

export function appendDirectorWorkspaceTurn(
  state: DirectorWorkspaceState,
  turn: DirectorWorkspaceTurn,
): DirectorWorkspaceState {
  return { ...state, turns: [...state.turns, clone(turn)] }
}

/** Keep four verbatim turns and make older content a bounded, auditable summary. */
export function compactDirectorWorkspaceTurns(
  state: DirectorWorkspaceState,
  maxRecentTurns = 4,
  maxSummaryChars = 4_000,
): DirectorWorkspaceState {
  if (state.turns.length <= maxRecentTurns) return state
  const removed = state.turns.slice(0, -maxRecentTurns)
  const summaryLines = removed.map((turn) => {
    const content = turn.content.replace(/\s+/g, ' ').trim().slice(0, 600)
    return `${turn.role}: ${content}${turn.intent ? ` [${turn.intent}]` : ''}${turn.outcome ? ` => ${turn.outcome}` : ''}`
  })
  const rollingSummary = [state.rollingSummary, ...summaryLines]
    .filter(Boolean)
    .join('\n')
    .slice(-maxSummaryChars)
  return { ...state, rollingSummary, turns: state.turns.slice(-maxRecentTurns) }
}

export function compactDirectorWorkspaceContext(state: DirectorWorkspaceState) {
  return {
    durableFacts: {
      draftId: state.draftId,
      baseRevision: state.baseRevision,
      selectedItemId: state.selectedItemId,
      slots: state.context.slots,
      userIntent: state.context.userIntent,
      currentTimeline: state.context.currentTimeline,
      materialRoles: state.context.materials.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        tags: item.tags ?? [],
      })),
      latestExecution: state.latestExecution,
      pendingQuestion: state.pendingQuestion,
      recentFailure: state.recentFailure,
    },
    rollingSummary: state.rollingSummary,
    recentTurns: state.turns,
  }
}
