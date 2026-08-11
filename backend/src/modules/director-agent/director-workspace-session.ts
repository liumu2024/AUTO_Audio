import { randomUUID } from 'node:crypto'

import type { DirectorContext } from '../../../../shared/types/director-context.js'
import type {
  ConfirmedRequirement,
  DirectorWorkspaceState,
  DirectorWorkspaceTurn,
  DirectorWorkspaceTurnRole,
} from '../../../../shared/types/director-workspace-session.js'
import { V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION } from '../../../../shared/types/v2-sample-understanding.js'

export type { DirectorWorkspaceState, DirectorWorkspaceTurn, DirectorWorkspaceTurnRole }

export type RequirementOperation =
  | { operation: 'add'; statement: string }
  | { operation: 'replace'; targetRequirementId: string; statement: string }
  | { operation: 'revoke'; targetRequirementId: string }

export type RequirementChange =
  | { type: 'none' }
  | { type: 'apply'; operations: RequirementOperation[] }

export interface RequirementChanges {
  added: ConfirmedRequirement[]
  replaced: Array<{ previous: ConfirmedRequirement; current: ConfirmedRequirement }>
  revoked: ConfirmedRequirement[]
  unchanged: ConfirmedRequirement[]
  rejected: string[]
}

export type RequirementChangeResult =
  | { ok: true; state: DirectorWorkspaceState; changes: RequirementChanges }
  | { ok: false; state: DirectorWorkspaceState; changes: RequirementChanges; error: string }

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
  recentToolCallIds?: string[]
  recentVisualMaterialIds?: string[]
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function emptyRequirementChanges(): RequirementChanges {
  return { added: [], replaced: [], revoked: [], unchanged: [], rejected: [] }
}

function requirementId() {
  return `req_${randomUUID()}`
}

function normalizedStatement(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizedContext(input: DirectorContext): {
  context: DirectorContext
  legacyConstraints: string[]
} {
  const context = clone(input)
  const legacyIntent = context.userIntent as Record<string, unknown>
  const legacyConstraints = Array.isArray(legacyIntent.constraints)
    ? legacyIntent.constraints
      .filter((item): item is string => typeof item === 'string')
      .map(normalizedStatement)
      .filter(Boolean)
    : []
  delete legacyIntent.constraints
  delete legacyIntent.requestedStyle
  delete legacyIntent.rawText
  delete (context.slots as unknown as Record<string, unknown>).subtitlePolicy
  const sampleUnderstanding = context.sampleVideo?.sampleUnderstanding as unknown as Record<string, unknown> | undefined
  if (context.sampleVideo && sampleUnderstanding?.schema_version !== V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION) {
    delete context.sampleVideo.sampleUnderstanding
    delete context.sampleVideo.reference
    delete (context.sampleVideo as unknown as Record<string, unknown>).styleRecipe
  }
  return { context, legacyConstraints }
}

function importedRequirements(statements: string[]): ConfirmedRequirement[] {
  return Array.from(new Set(statements)).map((statement) => ({
    id: requirementId(),
    statement,
    status: 'active',
    sourceTurnId: 'initial_context',
  }))
}

/** Hydrate old JSON sessions once and remove fields superseded by the requirement ledger. */
export function hydrateDirectorWorkspaceState(state: DirectorWorkspaceState): DirectorWorkspaceState {
  const { context, legacyConstraints } = normalizedContext(state.context)
  const existing = Array.isArray(state.confirmedRequirements)
    ? clone(state.confirmedRequirements)
    : []
  const activeStatements = new Set(
    existing.filter((item) => item.status === 'active').map((item) => normalizedStatement(item.statement)),
  )
  const imported = importedRequirements(legacyConstraints.filter((item) => !activeStatements.has(item)))
  return {
    ...clone(state),
    stateRevision: Number.isInteger(state.stateRevision) && state.stateRevision >= 0
      ? state.stateRevision
      : 0,
    context,
    confirmedRequirements: [...existing, ...imported],
  }
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
  const { context, legacyConstraints } = normalizedContext(input.context)
  const currentTimeline = context.currentTimeline
  return {
    stateRevision: 0,
    context,
    confirmedRequirements: importedRequirements(legacyConstraints),
    draftId: input.draftId ?? currentTimeline?.draftId,
    baseRevision: input.baseRevision ?? currentTimeline?.currentRevision,
    selectedItemId:
      currentTimeline?.selectedClipId ?? currentTimeline?.selectedSceneId,
    rollingSummary: '',
    turns: [],
  }
}

export function applyDirectorRequirementChange(
  state: DirectorWorkspaceState,
  change: RequirementChange,
  sourceTurnId: string,
): RequirementChangeResult {
  const changes = emptyRequirementChanges()
  if (change.type === 'none') return { ok: true, state, changes }
  if (change.operations.length < 1 || change.operations.length > 20) {
    const error = 'Requirement operation count must be between 1 and 20.'
    changes.rejected.push(error)
    return { ok: false, state, changes, error }
  }

  const activeById = new Map(
    state.confirmedRequirements.filter((item) => item.status === 'active').map((item) => [item.id, item]),
  )
  const targeted = new Set<string>()
  for (const operation of change.operations) {
    if ('statement' in operation) {
      const statement = normalizedStatement(operation.statement)
      if (!statement || statement.length > 500) {
        const error = 'Requirement statement must contain 1 to 500 characters.'
        changes.rejected.push(error)
        return { ok: false, state, changes, error }
      }
    }
    if (operation.operation === 'add') continue
    if (targeted.has(operation.targetRequirementId)) {
      const error = `Requirement ${operation.targetRequirementId} is targeted more than once.`
      changes.rejected.push(error)
      return { ok: false, state, changes, error }
    }
    targeted.add(operation.targetRequirementId)
    if (!activeById.has(operation.targetRequirementId)) {
      const error = `Requirement ${operation.targetRequirementId} is not active.`
      changes.rejected.push(error)
      return { ok: false, state, changes, error }
    }
  }

  const next = hydrateDirectorWorkspaceState(state)
  const active = () => next.confirmedRequirements.filter((item) => item.status === 'active')
  for (const operation of change.operations) {
    if (operation.operation === 'add') {
      const statement = normalizedStatement(operation.statement)
      const duplicate = active().find((item) => normalizedStatement(item.statement) === statement)
      if (duplicate) {
        changes.unchanged.push(clone(duplicate))
        continue
      }
      const added: ConfirmedRequirement = {
        id: requirementId(), statement, status: 'active', sourceTurnId,
      }
      next.confirmedRequirements.push(added)
      changes.added.push(clone(added))
      continue
    }

    const index = next.confirmedRequirements.findIndex((item) => item.id === operation.targetRequirementId)
    const previous = clone(next.confirmedRequirements[index]!)
    if (operation.operation === 'revoke') {
      next.confirmedRequirements[index] = { ...next.confirmedRequirements[index]!, status: 'revoked' }
      changes.revoked.push(clone(next.confirmedRequirements[index]!))
      continue
    }

    const statement = normalizedStatement(operation.statement)
    const current = {
      id: requirementId(), statement, status: 'active' as const, sourceTurnId,
    }
    next.confirmedRequirements[index] = {
      ...next.confirmedRequirements[index]!, status: 'superseded', supersededBy: current.id,
    }
    next.confirmedRequirements.push(current)
    changes.replaced.push({ previous, current: clone(current) })
  }
  return { ok: true, state: next, changes }
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
    'recentToolCallIds',
    'recentVisualMaterialIds',
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
  const confirmedRequirements = state.confirmedRequirements.filter((item) => item.status === 'active')
  const recentRequirementChanges = state.confirmedRequirements
    .filter((item) => item.status !== 'active')
    .slice(-20)
  return {
    durableFacts: {
      draftId: state.draftId,
      baseRevision: state.baseRevision,
      selectedItemId: state.selectedItemId,
      slots: state.context.slots,
      effectiveCreativeConfig: state.context.effectiveCreativeConfig,
      userIntent: state.context.userIntent,
      confirmedRequirements,
      recentRequirementChanges,
      currentTimeline: state.context.currentTimeline,
      timelineFacts: state.context.timelineFacts,
      materialRoles: state.context.materials.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        tags: item.tags ?? [],
      })),
      recentVisualMaterialIds: state.recentVisualMaterialIds ?? [],
      latestExecution: state.latestExecution,
      pendingQuestion: state.pendingQuestion,
      recentFailure: state.recentFailure,
    },
    rollingSummary: state.rollingSummary,
    recentTurns: state.turns,
  }
}
