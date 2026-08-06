import { randomUUID } from 'node:crypto'

import { prisma } from '../../shared/prisma.service.js'

export type CreativeMemoryScope = 'user' | 'draft'
export type CreativeMemoryStatus = 'active' | 'candidate' | 'revoked'
export type CreativeMemoryOrigin = 'explicit' | 'inferred'

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
  status: 'succeeded' | 'failed'
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
  findMany(input: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<DbMemory[]>
  findFirst(input: { where: Record<string, unknown> }): Promise<DbMemory | null>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>
}

const memories = () => (prisma as unknown as { creativeMemory: CreativeMemoryDelegate }).creativeMemory

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function tokens(value: string): string[] {
  const normalized = normalizedText(value)
  const ascii = normalized.match(/[a-z0-9]+/g) ?? []
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? []
  const han = hanRuns.flatMap((run) => {
    const chars = [...run]
    if (chars.length < 2) return chars
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
  })
  return [...ascii, ...han]
}

export function longestSharedHanPhrase(left: string, right: string) {
  const runs = normalizedText(left).match(/[\p{Script=Han}]+/gu) ?? []
  let best = ''
  for (const run of runs) {
    const chars = [...run]
    for (let length = Math.min(chars.length, 12); length >= 4; length -= 1) {
      if (length <= [...best].length) break
      for (let index = 0; index + length <= chars.length; index += 1) {
        const phrase = chars.slice(index, index + length).join('')
        if (normalizedText(right).includes(phrase)) {
          best = phrase
          break
        }
      }
    }
  }
  return best
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
  duplicateOfRequirement?: boolean
}): Promise<'active' | 'candidate'> {
  if (input.requestedStatus === 'candidate') return 'candidate'
  if (input.origin === 'inferred') return 'candidate'
  if (input.duplicateOfRequirement) return 'candidate'
  const rows = await memories().findMany({ where: { userId: input.userId }, take: 500 })
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
}): Promise<CreativeMemoryRecord> {
  const statement = assertStatement(input.statement)
  await assertScope(input.userId, input.scopeType, input.draftId)
  const existing = (await memories().findMany({ where: { userId: input.userId }, take: 500 }))
    .find((item) => item.scopeType === input.scopeType
      && item.draftId === (input.draftId ?? null)
      && item.status !== 'revoked'
      && normalizedText(item.statement) === normalizedText(statement))
  if (existing) {
    if (existing.status === 'candidate' && input.status === 'active') {
      await memories().updateMany({
        where: { id: existing.id, userId: input.userId },
        data: { status: 'active', revokedAt: null },
      })
      return record({ ...existing, status: 'active', revokedAt: null })
    }
    return record(existing)
  }

  return record(await memories().create({
    data: {
      id: `mem_${randomUUID()}`,
      userId: input.userId,
      scopeType: input.scopeType,
      draftId: input.draftId ?? null,
      statement,
      status: input.status,
      origin: input.origin,
      sourceWorkspaceSessionId: input.sourceWorkspaceSessionId?.trim() || null,
      sourceTurnIdsJson: (input.sourceTurnIds ?? []).slice(0, 20),
      sourceExcerpt: input.sourceExcerpt?.trim().slice(0, 1_000) || null,
    },
  }))
}

export async function listCreativeMemories(input: {
  userId: number
  draftId?: string
  scopeType?: CreativeMemoryScope
  status?: CreativeMemoryStatus
  limit?: number
}): Promise<CreativeMemoryRecord[]> {
  // ponytail: bounded in-process filtering is sufficient for the current small corpus;
  // move scope/status filtering into indexed queries if a user can exceed 500 memories.
  const rows = await memories().findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  return rows
    .filter((item) => !input.scopeType || item.scopeType === input.scopeType)
    .filter((item) => !input.status || item.status === input.status)
    .filter((item) => item.scopeType === 'user' || item.draftId === input.draftId)
    .slice(0, Math.max(1, Math.min(input.limit ?? 100, 200)))
    .map(record)
}

export async function updateCreativeMemory(input: {
  userId: number
  id: string
  statement?: string
  status?: CreativeMemoryStatus
}): Promise<CreativeMemoryRecord> {
  const current = await memories().findFirst({ where: { id: input.id, userId: input.userId } })
  if (!current) throw new Error('Creative memory not found.')
  const data: Record<string, unknown> = {}
  if (input.statement !== undefined) data.statement = assertStatement(input.statement)
  if (input.status !== undefined) {
    data.status = input.status
    data.revokedAt = input.status === 'revoked' ? new Date() : null
  }
  if (!Object.keys(data).length) return record(current)
  const changed = await memories().updateMany({ where: { id: input.id, userId: input.userId }, data })
  if (changed.count !== 1) throw new Error('Creative memory update failed.')
  const updated = await memories().findFirst({ where: { id: input.id, userId: input.userId } })
  if (!updated) throw new Error('Creative memory disappeared after update.')
  return record(updated)
}

export async function deleteCreativeMemory(input: { userId: number; id: string }): Promise<boolean> {
  return (await memories().deleteMany({ where: { id: input.id, userId: input.userId } })).count === 1
}

function rank(rows: DbMemory[], query: string, limit: number) {
  const minimumScore = 1.5
  const queryTokens = [...new Set(tokens(query))]
  if (!queryTokens.length) return {
    items: [] as RankedCreativeMemory[],
    audit: rows.map((row) => ({
      memoryId: row.id,
      status: row.status as 'active' | 'candidate',
      score: 0,
      matchedTerms: [] as string[],
      selected: false,
      reason: 'below_threshold' as const,
    })),
  }
  const documents = rows.map((row) => ({ row, terms: tokens(row.statement) }))
  const averageLength = documents.reduce((sum, item) => sum + item.terms.length, 0) / Math.max(1, documents.length)
  const queryText = normalizedText(query)
  const scored = documents.map(({ row, terms }) => {
    const frequencies = new Map<string, number>()
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    let score = 0
    const matchedTerms: string[] = []
    for (const term of queryTokens) {
      const frequency = frequencies.get(term) ?? 0
      if (!frequency) continue
      matchedTerms.push(term)
      const documentFrequency = documents.filter((item) => item.terms.includes(term)).length
      const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5))
      const denominator = frequency + 1.2 * (0.25 + 0.75 * terms.length / Math.max(1, averageLength))
      score += idf * (frequency * 2.2) / denominator
    }
    const statementText = normalizedText(row.statement)
    if (statementText.includes(queryText) || queryText.includes(statementText)) score += 3
    const sharedPhrase = longestSharedHanPhrase(row.statement, query)
    if (sharedPhrase) {
      score += Math.min(3, [...sharedPhrase].length * 0.5)
      matchedTerms.push(sharedPhrase)
    }
    return { row, score, matchedTerms }
  })
  scored.sort((left, right) =>
    right.score - left.score
    || right.row.updatedAt.getTime() - left.row.updatedAt.getTime()
    || left.row.id.localeCompare(right.row.id),
  )
  const eligible = scored.filter((item) => item.score >= minimumScore)
  const items = eligible.slice(0, limit).map((item, index) => ({
    memory: record(item.row),
    score: Number(item.score.toFixed(6)),
    matchedTerms: item.matchedTerms,
    rank: index + 1,
  }))
  const selectedIds = new Set(items.map((item) => item.memory.id))
  return {
    items,
    audit: scored.map((item) => {
      const eligibleRank = item.score >= minimumScore ? eligible.indexOf(item) + 1 : undefined
      const selected = selectedIds.has(item.row.id)
      return {
        memoryId: item.row.id,
        status: item.row.status as 'active' | 'candidate',
        score: Number(item.score.toFixed(6)),
        matchedTerms: item.matchedTerms,
        ...(eligibleRank ? { rank: eligibleRank } : {}),
        selected,
        reason: selected
          ? 'selected' as const
          : item.score < minimumScore
            ? 'below_threshold' as const
            : 'top_k_cutoff' as const,
      }
    }),
  }
}

export async function searchCreativeMemories(input: {
  userId: number
  draftId?: string
  query: string
  activeLimit?: number
  candidateLimit?: number
}): Promise<CreativeMemorySearchResult> {
  const rows = await memories().findMany({ where: { userId: input.userId }, take: 500 })
  const scopeFiltered = rows.filter(
    (item) => item.scopeType === 'draft' && item.draftId !== input.draftId,
  )
  const statusFiltered = rows.filter(
    (item) => item.status !== 'active' && item.status !== 'candidate',
  )
  const scoped = rows
    .filter((item) => item.scopeType === 'user' || item.draftId === input.draftId)
    .filter((item) => item.status === 'active' || item.status === 'candidate')
  const active = rank(
    scoped.filter((item) => item.status === 'active'),
    input.query,
    Math.min(input.activeLimit ?? 8, 8),
  )
  const candidate = rank(
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
  currentDraftId?: string
  recalledMemoryIds?: Set<string>
  actions: CreativeMemoryAction[]
  requirementStatements?: string[]
}): Promise<CreativeMemoryActionReceipt[]> {
  const receipts: CreativeMemoryActionReceipt[] = []
  for (const action of input.actions) {
    try {
      if (!action.sourceTurnIds.includes(input.currentTurnId)) {
        throw new Error('Creative memory action must cite the current source turn.')
      }
      if (action.operation === 'add') {
        const scopeType = action.scopeType ?? 'user'
        const statement = assertStatement(action.statement)
        const origin = action.origin ?? 'inferred'
        const duplicateOfRequirement = (input.requirementStatements ?? []).some((requirement) =>
          Boolean(longestSharedHanPhrase(statement, requirement)))
        const status = await effectiveCreativeMemoryStatus({
          userId: input.userId,
          scopeType,
          draftId: scopeType === 'draft' ? input.currentDraftId : undefined,
          statement,
          origin,
          requestedStatus: action.status ?? 'candidate',
          currentWorkspaceSessionId: input.workspaceSessionId,
          duplicateOfRequirement,
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
        receipts.push({
          ref: action.ref,
          operation: action.operation,
          status: 'succeeded',
          memoryId: memory.id,
          reason: duplicateOfRequirement ? 'duplicate_of_requirement' : undefined,
          effectiveStatus: status,
        })
        continue
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
        await updateCreativeMemory({ userId: input.userId, id: target.id, status: 'revoked' })
        receipts.push({ ref: action.ref, operation: action.operation, status: 'succeeded', memoryId: target.id })
        continue
      }
      const replacement = await createCreativeMemory({
        userId: input.userId,
        scopeType: target.scopeType as CreativeMemoryScope,
        draftId: target.draftId ?? undefined,
        statement: assertStatement(action.statement),
        status: action.status ?? (target.status as 'active' | 'candidate'),
        origin: action.origin ?? (target.origin as CreativeMemoryOrigin),
        sourceWorkspaceSessionId: input.workspaceSessionId,
        sourceTurnIds: action.sourceTurnIds,
        sourceExcerpt: action.sourceExcerpt,
      })
      if (replacement.id !== target.id) {
        try {
          await updateCreativeMemory({ userId: input.userId, id: target.id, status: 'revoked' })
        } catch (error) {
          await deleteCreativeMemory({ userId: input.userId, id: replacement.id })
          throw error
        }
      }
      receipts.push({ ref: action.ref, operation: action.operation, status: 'succeeded', memoryId: replacement.id })
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
