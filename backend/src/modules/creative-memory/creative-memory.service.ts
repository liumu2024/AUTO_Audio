import { createHash, randomUUID } from 'node:crypto'

import { prisma } from '../../shared/prisma.service.js'
import {
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

function memoryScopeKey(scopeType: CreativeMemoryScope, draftId?: string): string {
  return scopeType === 'draft' ? `draft:${draftId}` : 'user'
}

function memorySemanticKey(statement: string): string {
  return createHash('md5').update(normalizedText(statement)).digest('hex')
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
      if (input.preserveExistingStatus) return record(current)
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
    data.revokedAt = input.status === 'revoked'
      ? new Date()
      : input.status === 'active'
        ? null
        : current.revokedAt
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

export async function replaceActiveCreativeMemory(input: {
  userId: number
  previousId: string
  nextId: string
  previousStatus: CreativeMemoryStatus
  nextStatus: CreativeMemoryStatus
}): Promise<CreativeMemoryRecord> {
  if (input.previousId === input.nextId) throw new Error('Creative memory replacement requires two records.')

  const apply = async (store: CreativeMemoryDelegate) => {
    const activated = await store.updateMany({
      where: { id: input.nextId, userId: input.userId, status: input.nextStatus },
      data: { status: 'active', revokedAt: null },
    })
    if (activated.count !== 1) throw new Error('Replacement preference changed before activation.')
    const revoked = await store.updateMany({
      where: { id: input.previousId, userId: input.userId, status: input.previousStatus },
      data: { status: 'revoked', revokedAt: new Date() },
    })
    if (revoked.count !== 1) throw new Error('Previous preference changed before replacement.')
  }

  if (process.env.DPL304_LOCAL_MODE === 'true') {
    const store = memories()
    const nextBefore = await store.findFirst({
      where: { id: input.nextId, userId: input.userId, status: input.nextStatus },
    })
    if (!nextBefore) throw new Error('Replacement preference changed before activation.')
    const activated = await store.updateMany({
      where: { id: input.nextId, userId: input.userId, status: input.nextStatus },
      data: { status: 'active', revokedAt: null },
    })
    if (activated.count !== 1) throw new Error('Replacement preference changed before activation.')
    try {
      const revoked = await store.updateMany({
        where: { id: input.previousId, userId: input.userId, status: input.previousStatus },
        data: { status: 'revoked', revokedAt: new Date() },
      })
      if (revoked.count !== 1) throw new Error('Previous preference changed before replacement.')
    } catch (error) {
      await store.updateMany({
        where: { id: input.nextId, userId: input.userId, status: 'active' },
        data: {
          status: input.nextStatus,
          revokedAt: nextBefore.revokedAt,
        },
      })
      throw error
    }
  } else {
    await prisma.$transaction(async (transaction) => {
      await apply((transaction as unknown as { creativeMemory: CreativeMemoryDelegate }).creativeMemory)
    })
  }

  const updated = await memories().findFirst({ where: { id: input.nextId, userId: input.userId } })
  if (!updated) throw new Error('Replacement preference disappeared after activation.')
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
