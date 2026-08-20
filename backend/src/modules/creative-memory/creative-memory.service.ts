import { createHash, randomUUID } from 'node:crypto'

import { prisma } from '../../shared/prisma.service.js'
import {
  createV2IdempotencyRepository,
  executeV2JsonIdempotentOperation,
  v2IdempotencyRequestHash,
} from '../../pipeline-v2/idempotency-repository.js'
import {
  longestSharedCreativeHanPhrase,
  normalizeCreativeText,
  rankConfiguredCreativeTextRows,
} from './creative-text-retrieval.js'

export type CreativeMemoryScope = 'user' | 'draft'
export type CreativeMemoryStatus = 'active' | 'candidate' | 'revoked'
export type CreativeMemoryOrigin = 'explicit' | 'inferred' | 'synthetic'

export interface CreativeMemoryRecord {
  id: string
  userId: number
  scopeType: CreativeMemoryScope
  draftId?: string
  statement: string
  status: CreativeMemoryStatus
  origin: CreativeMemoryOrigin
  sourceWorkspaceSessionId?: string
  sourceTurnIds: string[]
  sourceExcerpt?: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export interface CreativeMemoryAction {
  ref: string
  operation: 'add' | 'replace' | 'revoke'
  targetMemoryId?: string
  scopeType?: CreativeMemoryScope
  draftId?: string
  statement?: string
  status?: 'active' | 'candidate'
  origin?: CreativeMemoryOrigin
  sourceTurnIds: string[]
  sourceExcerpt?: string
}

export interface CreativeMemoryActionReceipt {
  ref: string
  operation: CreativeMemoryAction['operation']
  status: 'succeeded' | 'failed' | 'skipped'
  memoryId?: string
  reason?: string
  effectiveStatus?: 'active' | 'candidate'
}

export interface RankedCreativeMemory {
  memory: CreativeMemoryRecord
  score: number
  matchedTerms: string[]
  rank: number
}

export interface CreativeMemorySearchResult {
  active: RankedCreativeMemory[]
  candidate: RankedCreativeMemory[]
  audit: Array<{
    memoryId: string
    status: CreativeMemoryStatus
    score: number
    matchedTerms: string[]
    rank?: number
    selected: boolean
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'scope_filtered' | 'status_filtered'
  }>
}

type DbMemory = {
  id: string
  userId: number
  scopeType: string
  draftId: string | null
  scopeKey: string
  semanticKey: string
  statement: string
  status: string
  origin: string
  sourceWorkspaceSessionId: string | null
  sourceTurnIdsJson: unknown
  sourceExcerpt: string | null
  createdAt: Date
  updatedAt: Date
  revokedAt: Date | null
}

type CreativeMemoryDelegate = {
  create(input: { data: Record<string, unknown> }): Promise<DbMemory>
  findMany(input: {
    where: Record<string, unknown>
    orderBy?: Record<string, 'asc' | 'desc'>
    skip?: number
    take?: number
  }): Promise<DbMemory[]>
  findFirst(input: { where: Record<string, unknown> }): Promise<DbMemory | null>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>
}

const memories = () => (prisma as unknown as { creativeMemory: CreativeMemoryDelegate }).creativeMemory

function normalizedText(value: string): string {
  return normalizeCreativeText(value)
}

function duplicatesRequirement(statement: string, requirement: string): boolean {
  const normalizedStatement = normalizedText(statement)
  const normalizedRequirement = normalizedText(requirement)
  if (!normalizedStatement || !normalizedRequirement) return false
  if (normalizedStatement === normalizedRequirement) return true
  const shorter = normalizedStatement.length <= normalizedRequirement.length
    ? normalizedStatement
    : normalizedRequirement
  const longer = shorter === normalizedStatement ? normalizedRequirement : normalizedStatement
  return longer.includes(shorter) && shorter.length / longer.length >= 0.75
}

function memoryScopeKey(scopeType: CreativeMemoryScope, draftId?: string): string {
  return scopeType === 'draft' ? `draft:${draftId}` : 'user'
}

function memorySemanticKey(statement: string): string {
  return createHash('md5').update(normalizedText(statement)).digest('hex')
}

export function longestSharedHanPhrase(left: string, right: string) {
  return longestSharedCreativeHanPhrase(left, right)
}

function record(row: DbMemory): CreativeMemoryRecord {
  return {
    id: row.id,
    userId: row.userId,
    scopeType: row.scopeType as CreativeMemoryScope,
    ...(row.draftId ? { draftId: row.draftId } : {}),
    statement: row.statement,
    status: row.status as CreativeMemoryStatus,
    origin: row.origin as CreativeMemoryOrigin,
    ...(row.sourceWorkspaceSessionId
      ? { sourceWorkspaceSessionId: row.sourceWorkspaceSessionId }
      : {}),
    sourceTurnIds: Array.isArray(row.sourceTurnIdsJson)
      ? row.sourceTurnIdsJson.filter((item): item is string => typeof item === 'string')
      : [],
    ...(row.sourceExcerpt ? { sourceExcerpt: row.sourceExcerpt } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
  }
}

function assertStatement(value: string | undefined): string {
  const statement = value?.trim()
  if (!statement || statement.length > 500) {
    throw new Error('Creative memory statement must contain 1-500 characters.')
  }
  return statement
}

/**
 * Server-side status guard: inferred knowledge never silently controls
 * creation, a previously negated preference needs re-confirmation, and a
 * user preference repeated across projects (near-duplicate from another
 * session) is behavior evidence and becomes an active control automatically.
 * ponytail: negation detection is exact normalized-match only; semantic
 * negation and real embedding similarity stay deferred until the corpus
 * needs them.
 */
async function effectiveCreativeMemoryStatus(input: {
  userId: number
  scopeType: CreativeMemoryScope
  draftId?: string
  statement: string
  origin: CreativeMemoryOrigin
  requestedStatus: 'active' | 'candidate'
  currentWorkspaceSessionId: string
}): Promise<'active' | 'candidate'> {
  if (input.requestedStatus === 'candidate') return 'candidate'
  if (input.origin === 'inferred') return 'candidate'
  const rows = await memories().findMany({ where: { userId: input.userId } })
  const normalized = normalizedText(input.statement)
  const sameScope = (item: DbMemory) =>
    item.scopeType === input.scopeType
    && item.draftId === (input.draftId ?? null)
  if (rows.some((item) =>
    item.status === 'revoked' && sameScope(item) && normalizedText(item.statement) === normalized,
  )) {
    return 'candidate'
  }
  if (input.scopeType === 'user' && rows.some((item) =>
    item.status !== 'revoked'
    && item.scopeType === 'user'
    && item.sourceWorkspaceSessionId
    && item.sourceWorkspaceSessionId !== input.currentWorkspaceSessionId
    && (normalizedText(item.statement) === normalized
      || longestSharedHanPhrase(item.statement, input.statement)),
  )) {
    return 'active'
  }
  return 'active'
}

async function assertScope(userId: number, scopeType: CreativeMemoryScope, draftId?: string) {
  if (scopeType === 'user') {
    if (draftId) throw new Error('User-scoped creative memory cannot bind a draft.')
    return
  }
  if (!draftId) throw new Error('Draft-scoped creative memory requires draftId.')
  const draft = await prisma.v2TimelineDraft.findFirst({ where: { id: draftId, userId } })
  if (!draft) throw new Error('Creative memory draft does not exist or belongs to another user.')
}

export async function createCreativeMemory(input: {
  userId: number
  scopeType: CreativeMemoryScope
  draftId?: string
  statement: string
  status: 'active' | 'candidate'
  origin: CreativeMemoryOrigin
  sourceWorkspaceSessionId?: string
  sourceTurnIds?: string[]
  sourceExcerpt?: string
  preserveExistingStatus?: boolean
}): Promise<CreativeMemoryRecord> {
  const statement = assertStatement(input.statement)
  await assertScope(input.userId, input.scopeType, input.draftId)
  const scopeKey = memoryScopeKey(input.scopeType, input.draftId)
  const semanticKey = memorySemanticKey(statement)
  const reuseExisting = async (existing: DbMemory) => {
    let current = existing
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (input.preserveExistingStatus) {
        await memories().updateMany({
          where: { id: current.id, userId: input.userId },
          data: {
            statement,
            origin: input.origin,
            sourceWorkspaceSessionId: input.sourceWorkspaceSessionId?.trim() || null,
            sourceTurnIdsJson: (input.sourceTurnIds ?? []).slice(0, 20),
            sourceExcerpt: input.sourceExcerpt?.trim().slice(0, 1_000) || null,
          },
        })
        const refreshed = await memories().findFirst({ where: { id: current.id, userId: input.userId } })
        if (!refreshed) throw new Error('Creative memory disappeared after metadata refresh.')
        return record(refreshed)
      }
      const needsPromotion = current.status === 'revoked'
        || (current.status === 'candidate' && input.status === 'active')
      if (!needsPromotion) return record(current)
      const update = await memories().updateMany({
        where: { id: current.id, userId: input.userId, status: current.status },
        data: {
          statement,
          status: input.status,
          origin: input.origin,
          sourceWorkspaceSessionId: input.sourceWorkspaceSessionId?.trim() || null,
          sourceTurnIdsJson: (input.sourceTurnIds ?? []).slice(0, 20),
          sourceExcerpt: input.sourceExcerpt?.trim().slice(0, 1_000) || null,
          revokedAt: null,
        },
      })
      const updated = await memories().findFirst({ where: { id: current.id, userId: input.userId } })
      if (!updated) throw new Error('Creative memory disappeared after reuse.')
      if (update.count === 1 && updated.status === input.status) return record(updated)
      current = updated
    }
    throw new Error('Creative memory changed concurrently while being reused.')
  }
  const existing = await memories().findFirst({ where: { userId: input.userId, scopeKey, semanticKey } })
  if (existing) return reuseExisting(existing)

  try {
    return record(await memories().create({
      data: {
        id: `mem_${randomUUID()}`,
        userId: input.userId,
        scopeType: input.scopeType,
        draftId: input.draftId ?? null,
        scopeKey,
        semanticKey,
        statement,
        status: input.status,
        origin: input.origin,
        sourceWorkspaceSessionId: input.sourceWorkspaceSessionId?.trim() || null,
        sourceTurnIdsJson: (input.sourceTurnIds ?? []).slice(0, 20),
        sourceExcerpt: input.sourceExcerpt?.trim().slice(0, 1_000) || null,
      },
    }))
  } catch (error) {
    const concurrent = await memories().findFirst({ where: { userId: input.userId, scopeKey, semanticKey } })
    if (concurrent) return reuseExisting(concurrent)
    throw error
  }
}

export async function synchronizeSyntheticCreativeMemory(input: {
  userId: number
  id: string
  statement: string
  sourceWorkspaceSessionId: string
  sourceTurnId: string
  sourceExcerpt: string
}): Promise<CreativeMemoryRecord> {
  const current = await memories().findFirst({ where: { id: input.id, userId: input.userId } })
  if (!current) throw new Error('Creative memory not found during seed synchronization.')
  if (current.origin !== 'synthetic' || current.status !== 'active') return record(current)
  const statement = assertStatement(input.statement)
  const semanticKey = memorySemanticKey(statement)
  const collision = await memories().findFirst({
    where: { userId: input.userId, scopeKey: current.scopeKey, semanticKey },
  })
  if (collision && collision.id !== current.id) {
    await memories().deleteMany({ where: { id: current.id, userId: input.userId, origin: 'synthetic' } })
    return record(collision)
  }
  const updated = await memories().updateMany({
    where: { id: current.id, userId: input.userId, origin: 'synthetic', status: 'active' },
    data: {
      statement,
      semanticKey,
      sourceWorkspaceSessionId: input.sourceWorkspaceSessionId,
      sourceTurnIdsJson: [input.sourceTurnId],
      sourceExcerpt: input.sourceExcerpt,
    },
  })
  if (updated.count !== 1) throw new Error('Creative memory changed during seed synchronization.')
  const refreshed = await memories().findFirst({ where: { id: current.id, userId: input.userId } })
  if (!refreshed) throw new Error('Creative memory disappeared after seed synchronization.')
  return record(refreshed)
}

export interface CreativeMemoryPage {
  items: CreativeMemoryRecord[]
  total: number
  offset: number
  limit: number
}

export async function listCreativeMemoriesPage(input: {
  userId: number
  draftId?: string
  scopeType?: CreativeMemoryScope
  status?: CreativeMemoryStatus
  offset?: number
  limit?: number
}): Promise<CreativeMemoryPage> {
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200))
  const rows = await memories().findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: 'desc' },
  })
  const filtered = rows
    .filter((item) => !input.scopeType || item.scopeType === input.scopeType)
    .filter((item) => !input.status || item.status === input.status)
    .filter((item) => item.scopeType === 'user' || item.draftId === input.draftId)
  return {
    items: filtered.slice(offset, offset + limit).map(record),
    total: filtered.length,
    offset,
    limit,
  }
}

export async function listCreativeMemories(input: {
  userId: number
  draftId?: string
  scopeType?: CreativeMemoryScope
  status?: CreativeMemoryStatus
  limit?: number
}): Promise<CreativeMemoryRecord[]> {
  return (await listCreativeMemoriesPage({ ...input, limit: input.limit ?? 100 })).items
}

export async function updateCreativeMemory(input: {
  userId: number
  id: string
  statement?: string
  status?: CreativeMemoryStatus
  expectedStatus?: CreativeMemoryStatus
}): Promise<CreativeMemoryRecord> {
  const current = await memories().findFirst({ where: { id: input.id, userId: input.userId } })
  if (!current) throw new Error('Creative memory not found.')
  const data: Record<string, unknown> = {}
  if (input.statement !== undefined) {
    const statement = assertStatement(input.statement)
    data.statement = statement
    data.semanticKey = memorySemanticKey(statement)
    data.origin = 'explicit'
    data.sourceExcerpt = statement
  }
  if (input.status !== undefined) {
    data.status = input.status
    data.revokedAt = input.status === 'revoked' ? new Date() : null
  }
  if (!Object.keys(data).length) return record(current)
  const changed = await memories().updateMany({
    where: {
      id: input.id,
      userId: input.userId,
      ...(input.expectedStatus ? { status: input.expectedStatus } : {}),
    },
    data,
  })
  if (changed.count !== 1) {
    if (input.expectedStatus) throw new Error('Creative memory changed concurrently; retry with the current record.')
    throw new Error('Creative memory update failed.')
  }
  const updated = await memories().findFirst({ where: { id: input.id, userId: input.userId } })
  if (!updated) throw new Error('Creative memory disappeared after update.')
  return record(updated)
}

export async function deleteCreativeMemory(input: { userId: number; id: string }): Promise<boolean> {
  return (await memories().deleteMany({ where: { id: input.id, userId: input.userId } })).count === 1
}

async function rank(rows: DbMemory[], query: string, limit: number) {
  const ranked = await rankConfiguredCreativeTextRows({
    entityType: 'memory',
    rows,
    id: (row) => row.id,
    text: (row) => row.statement,
    updatedAt: (row) => row.updatedAt,
    query,
    limit,
  })
  return {
    items: ranked.items.map((item) => ({
      memory: record(item.row),
      score: item.score,
      matchedTerms: item.matchedTerms,
      rank: item.rank,
    })),
    audit: ranked.audit.map((item) => ({
      memoryId: item.row.id,
      status: item.row.status as 'active' | 'candidate',
      score: item.score,
      matchedTerms: item.matchedTerms,
      ...('rank' in item && item.rank ? { rank: item.rank } : {}),
      selected: item.selected,
      reason: item.reason,
    })),
  }
}

export async function searchCreativeMemories(input: {
  userId: number
  draftId?: string
  query: string
  activeLimit?: number
  candidateLimit?: number
}): Promise<CreativeMemorySearchResult> {
  const rows = await memories().findMany({ where: { userId: input.userId } })
  const scopeFiltered = rows.filter(
    (item) => item.scopeType === 'draft' && item.draftId !== input.draftId,
  )
  const statusFiltered = rows.filter(
    (item) => item.status !== 'active' && item.status !== 'candidate',
  )
  const scoped = rows
    .filter((item) => item.scopeType === 'user' || item.draftId === input.draftId)
    .filter((item) => item.status === 'active' || item.status === 'candidate')
  const active = await rank(
    scoped.filter((item) => item.status === 'active'),
    input.query,
    Math.min(input.activeLimit ?? 8, 8),
  )
  const candidate = await rank(
    scoped.filter((item) => item.status === 'candidate'),
    input.query,
    Math.min(input.candidateLimit ?? 3, 3),
  )
  return {
    active: active.items,
    candidate: candidate.items,
    audit: [
      ...active.audit,
      ...candidate.audit,
      ...scopeFiltered.map((item) => ({
        memoryId: item.id,
        status: item.status as CreativeMemoryStatus,
        score: 0,
        matchedTerms: [],
        selected: false,
        reason: 'scope_filtered' as const,
      })),
      ...statusFiltered
        .filter((item) => !scopeFiltered.some((candidate) => candidate.id === item.id))
        .map((item) => ({
          memoryId: item.id,
          status: item.status as CreativeMemoryStatus,
          score: 0,
          matchedTerms: [],
          selected: false,
          reason: 'status_filtered' as const,
        })),
    ],
  }
}

export async function applyCreativeMemoryActions(input: {
  userId: number
  workspaceSessionId: string
  currentTurnId: string
  currentUserText?: string
  currentDraftId?: string
  recalledMemoryIds?: Set<string>
  actions: CreativeMemoryAction[]
  requirementStatements?: string[]
}): Promise<CreativeMemoryActionReceipt[]> {
  const receipts: CreativeMemoryActionReceipt[] = []
  const idempotency = createV2IdempotencyRepository()
  for (const action of input.actions) {
    try {
      const outcome = await executeV2JsonIdempotentOperation<CreativeMemoryActionReceipt>({
        repository: idempotency,
        reservation: {
          userId: input.userId,
          draftId: input.currentDraftId,
          operation: `memory.${action.operation}`,
          idempotencyKey: `${input.currentTurnId}:${action.ref}`,
          resourceKey: action.targetMemoryId ?? action.scopeType ?? 'user',
          requestHash: v2IdempotencyRequestHash({
            workspaceSessionId: input.workspaceSessionId,
            currentDraftId: input.currentDraftId,
            currentUserText: input.currentUserText ? normalizedText(input.currentUserText) : undefined,
            requirementStatements: (input.requirementStatements ?? []).map(normalizedText),
            action: {
              ...action,
              statement: action.statement ? normalizedText(action.statement) : undefined,
            },
          }),
        },
        execute: () => applyCreativeMemoryAction(input, action),
        failureFromResult: (receipt) => receipt.status === 'failed'
          ? { code: 'memory_action_failed', message: receipt.reason ?? 'Creative memory action failed.' }
          : undefined,
      })
      if (outcome.kind === 'running') {
        receipts.push(await waitForCreativeMemoryAction(idempotency, {
          userId: input.userId,
          operation: `memory.${action.operation}`,
          idempotencyKey: `${input.currentTurnId}:${action.ref}`,
        }))
      } else if (outcome.value) {
        receipts.push(outcome.value)
      }
    } catch (error) {
      receipts.push({
        ref: action.ref,
        operation: action.operation,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return receipts
}

async function waitForCreativeMemoryAction(
  repository: ReturnType<typeof createV2IdempotencyRepository>,
  key: { userId: number; operation: string; idempotencyKey: string },
): Promise<CreativeMemoryActionReceipt> {
  while (true) {
    const receipt = await repository.get(key)
    if (!receipt || receipt.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 25))
      continue
    }
    const value = receipt.resultJson && typeof receipt.resultJson === 'object'
      ? (receipt.resultJson as { value?: CreativeMemoryActionReceipt }).value
      : undefined
    if (value) return value
    throw new Error(receipt.failure?.message ?? 'Creative memory action finished without a stored receipt.')
  }
}

async function applyCreativeMemoryAction(
  input: Parameters<typeof applyCreativeMemoryActions>[0],
  action: CreativeMemoryAction,
): Promise<CreativeMemoryActionReceipt> {
  try {
    if (!action.sourceTurnIds.includes(input.currentTurnId)) {
      throw new Error('Creative memory action must cite the current source turn.')
    }
    if (action.operation === 'add') {
      const scopeType = action.scopeType ?? 'user'
      const statement = assertStatement(action.statement)
      const origin = action.origin ?? 'inferred'
      const explicitlyTransferablePreference = scopeType === 'user'
        && origin === 'explicit'
        && Boolean(action.sourceExcerpt
          && input.currentUserText
          && normalizedText(input.currentUserText).includes(normalizedText(action.sourceExcerpt))
          && (
            normalizedText(action.sourceExcerpt).includes(normalizedText(statement))
            || normalizedText(statement).includes(normalizedText(action.sourceExcerpt))
          )
          && (
          /(?:我|本人).{0,12}(?:喜欢|偏好|倾向|钟爱)|(?:一直|向来|长期|平时|通常|以后).{0,12}(?:喜欢|偏好|采用|保持)/u.test(action.sourceExcerpt)
          || /\b(?:i (?:always )?(?:like|prefer)|my (?:usual|long[- ]term) preference)\b/iu.test(action.sourceExcerpt)
          ))
      const duplicateOfRequirement = (input.requirementStatements ?? [])
        .some((requirement) => duplicatesRequirement(statement, requirement))
      if (duplicateOfRequirement && !explicitlyTransferablePreference) {
        return {
          ref: action.ref,
          operation: action.operation,
          status: 'skipped',
          reason: 'duplicate_of_requirement',
        }
      }
      const status = await effectiveCreativeMemoryStatus({
        userId: input.userId,
        scopeType,
        draftId: scopeType === 'draft' ? input.currentDraftId : undefined,
        statement,
        origin,
        requestedStatus: action.status ?? 'candidate',
        currentWorkspaceSessionId: input.workspaceSessionId,
      })
      const memory = await createCreativeMemory({
        userId: input.userId,
        scopeType,
        draftId: scopeType === 'draft' ? input.currentDraftId : undefined,
        statement,
        status,
        origin,
        sourceWorkspaceSessionId: input.workspaceSessionId,
        sourceTurnIds: action.sourceTurnIds,
        sourceExcerpt: action.sourceExcerpt,
      })
      return {
        ref: action.ref,
        operation: action.operation,
        status: 'succeeded',
        memoryId: memory.id,
        effectiveStatus: status,
      }
    }
    if (!action.targetMemoryId) throw new Error('Creative memory targetMemoryId is required.')
    const target = await memories().findFirst({ where: { id: action.targetMemoryId, userId: input.userId } })
    if (!target || target.status === 'revoked') throw new Error('Creative memory target is missing or inactive.')
    if (input.recalledMemoryIds && !input.recalledMemoryIds.has(target.id)) {
      throw new Error('Creative memory target was not recalled in this turn.')
    }
    if (target.scopeType === 'draft' && target.draftId !== input.currentDraftId) {
      throw new Error('Creative memory target belongs to another draft.')
    }
    if (action.operation === 'revoke') {
      await updateCreativeMemory({
        userId: input.userId,
        id: target.id,
        status: 'revoked',
        expectedStatus: target.status as CreativeMemoryStatus,
      })
      return { ref: action.ref, operation: action.operation, status: 'succeeded', memoryId: target.id }
    }
    const statement = assertStatement(action.statement)
    const changed = await memories().updateMany({
      where: { id: target.id, userId: input.userId, status: target.status },
      data: {
        statement,
        semanticKey: memorySemanticKey(statement),
        status: action.status ?? target.status,
        origin: action.origin ?? target.origin,
        sourceWorkspaceSessionId: input.workspaceSessionId,
        sourceTurnIdsJson: action.sourceTurnIds.slice(0, 20),
        sourceExcerpt: action.sourceExcerpt?.trim().slice(0, 1_000) || null,
        revokedAt: null,
      },
    })
    if (changed.count !== 1) throw new Error('Creative memory changed concurrently; retry with the current record.')
    return { ref: action.ref, operation: action.operation, status: 'succeeded', memoryId: target.id }
  } catch (error) {
    return {
      ref: action.ref,
      operation: action.operation,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
