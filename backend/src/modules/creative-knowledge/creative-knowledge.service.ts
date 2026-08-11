import { createHash, randomUUID } from 'node:crypto'

import type {
  V2SampleEvidenceRange,
  V2SampleUnderstandingResult,
} from '../../../../shared/types/v2-sample-understanding.js'
import { prisma } from '../../shared/prisma.service.js'
import {
  normalizeCreativeText,
  rankCreativeTextRows,
} from '../creative-memory/creative-text-retrieval.js'

export type CreativeKnowledgeStatus = 'active' | 'candidate' | 'revoked'

export interface CreativeKnowledgeSource {
  taskId: string
  sampleName?: string
  methodIds: string[]
  evidenceRanges: V2SampleEvidenceRange[]
}

export interface CreativeKnowledgeRecord {
  id: string
  statement: string
  applicability: string
  status: CreativeKnowledgeStatus
  sources: CreativeKnowledgeSource[]
  createdByUserId?: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export interface CreativeKnowledgeSearchResult {
  items: Array<{
    knowledge: CreativeKnowledgeRecord
    score: number
    matchedTerms: string[]
    rank: number
  }>
  audit: Array<{
    knowledgeId: string
    score: number
    matchedTerms: string[]
    rank?: number
    selected: boolean
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'status_filtered'
  }>
}

type DbKnowledge = {
  id: string
  statement: string
  applicability: string
  status: string
  semanticKey: string
  sourcesJson: unknown
  createdByUserId: number | null
  createdAt: Date
  updatedAt: Date
  revokedAt: Date | null
}

type CreativeKnowledgeDelegate = {
  create(input: { data: Record<string, unknown> }): Promise<DbKnowledge>
  findMany(input: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<DbKnowledge[]>
  findFirst(input: { where: Record<string, unknown> }): Promise<DbKnowledge | null>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  deleteMany(input: { where: Record<string, unknown> }): Promise<{ count: number }>
}

const knowledgeStore = () => (prisma as unknown as { creativeKnowledge: CreativeKnowledgeDelegate }).creativeKnowledge
let knowledgeWriteTail = Promise.resolve()

async function serializeKnowledgeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = knowledgeWriteTail.then(operation)
  knowledgeWriteTail = next.then(() => undefined, () => undefined)
  return next
}

function semanticKey(statement: string): string {
  return createHash('md5').update(normalizeCreativeText(statement)).digest('hex')
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 500) throw new Error(`${label} must contain 1-500 characters.`)
  return normalized
}

function sources(value: unknown): CreativeKnowledgeSource[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CreativeKnowledgeSource => Boolean(
    item && typeof item === 'object' && typeof (item as CreativeKnowledgeSource).taskId === 'string',
  ))
}

function record(row: DbKnowledge): CreativeKnowledgeRecord {
  return {
    id: row.id,
    statement: row.statement,
    applicability: row.applicability,
    status: row.status as CreativeKnowledgeStatus,
    sources: sources(row.sourcesJson),
    ...(row.createdByUserId ? { createdByUserId: row.createdByUserId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
  }
}

function mergeSource(existing: CreativeKnowledgeSource[], source: CreativeKnowledgeSource) {
  const withoutSameTask = existing.filter((item) => item.taskId !== source.taskId)
  return [...withoutSameTask, source].slice(-20)
}

export async function createCreativeKnowledgeCandidate(input: {
  userId: number
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
}): Promise<CreativeKnowledgeRecord> {
  const statement = requiredText(input.statement, 'Creative knowledge statement')
  const applicability = requiredText(input.applicability, 'Creative knowledge applicability')
  const key = semanticKey(statement)
  return serializeKnowledgeWrite(async () => {
    const existing = await knowledgeStore().findFirst({ where: { semanticKey: key } })
    if (existing) {
      await knowledgeStore().updateMany({
        where: { id: existing.id },
        data: { sourcesJson: mergeSource(sources(existing.sourcesJson), input.source) },
      })
      const updated = await knowledgeStore().findFirst({ where: { id: existing.id } })
      if (!updated) throw new Error('Creative knowledge disappeared after source merge.')
      return record(updated)
    }
    try {
      return record(await knowledgeStore().create({
        data: {
          id: `know_${randomUUID()}`,
          statement,
          applicability,
          status: 'candidate',
          semanticKey: key,
          sourcesJson: [input.source],
          createdByUserId: input.userId,
        },
      }))
    } catch (error) {
      const concurrent = await knowledgeStore().findFirst({ where: { semanticKey: key } })
      if (concurrent) {
        await knowledgeStore().updateMany({
          where: { id: concurrent.id },
          data: { sourcesJson: mergeSource(sources(concurrent.sourcesJson), input.source) },
        })
        const merged = await knowledgeStore().findFirst({ where: { id: concurrent.id } })
        if (merged) return record(merged)
      }
      throw error
    }
  })
}

export async function createCreativeKnowledgeCandidatesFromSample(input: {
  userId: number
  understanding: V2SampleUnderstandingResult
}): Promise<CreativeKnowledgeRecord[]> {
  const methods = new Map(input.understanding.method_observations.map((method) => [method.id, method]))
  const created: CreativeKnowledgeRecord[] = []
  for (const item of input.understanding.transferable_knowledge) {
    const methodIds = [...new Set(item.evidence_method_ids)].filter((id) => methods.has(id))
    if (!methodIds.length) continue
    const evidenceRanges = methodIds.flatMap((id) => methods.get(id)?.evidence_ranges ?? [])
    created.push(await createCreativeKnowledgeCandidate({
      userId: input.userId,
      statement: item.statement,
      applicability: item.applicability,
      source: {
        taskId: input.understanding.task_id,
        ...(input.understanding.sample.name ? { sampleName: input.understanding.sample.name } : {}),
        methodIds,
        evidenceRanges,
      },
    }))
  }
  return created
}

export async function listCreativeKnowledge(input: {
  status?: CreativeKnowledgeStatus
  limit?: number
} = {}): Promise<CreativeKnowledgeRecord[]> {
  const rows = await knowledgeStore().findMany({
    where: input.status ? { status: input.status } : {},
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(input.limit ?? 100, 200)),
  })
  return rows.map(record)
}

export async function updateCreativeKnowledge(input: {
  id: string
  statement?: string
  applicability?: string
  status?: CreativeKnowledgeStatus
}): Promise<CreativeKnowledgeRecord> {
  const current = await knowledgeStore().findFirst({ where: { id: input.id } })
  if (!current) throw new Error('Creative knowledge not found.')
  const data: Record<string, unknown> = {}
  if (input.statement !== undefined) {
    const statement = requiredText(input.statement, 'Creative knowledge statement')
    data.statement = statement
    data.semanticKey = semanticKey(statement)
  }
  if (input.applicability !== undefined) {
    data.applicability = requiredText(input.applicability, 'Creative knowledge applicability')
  }
  if (input.status !== undefined) {
    data.status = input.status
    data.revokedAt = input.status === 'revoked' ? new Date() : null
  }
  if (Object.keys(data).length) await knowledgeStore().updateMany({ where: { id: input.id }, data })
  const updated = await knowledgeStore().findFirst({ where: { id: input.id } })
  if (!updated) throw new Error('Creative knowledge disappeared after update.')
  return record(updated)
}

export async function deleteCreativeKnowledge(id: string): Promise<boolean> {
  return (await knowledgeStore().deleteMany({ where: { id } })).count === 1
}

export async function searchCreativeKnowledge(input: {
  query: string
  limit?: number
}): Promise<CreativeKnowledgeSearchResult> {
  const rows = await knowledgeStore().findMany({ where: {}, take: 500 })
  const active = rows.filter((item) => item.status === 'active')
  const ranked = rankCreativeTextRows({
    rows: active,
    id: (row) => row.id,
    text: (row) => `${row.statement} ${row.applicability}`,
    updatedAt: (row) => row.updatedAt,
    query: input.query,
    limit: Math.min(input.limit ?? 8, 8),
  })
  return {
    items: ranked.items.map((item) => ({
      knowledge: record(item.row),
      score: item.score,
      matchedTerms: item.matchedTerms,
      rank: item.rank,
    })),
    audit: [
      ...ranked.audit.map((item) => ({
        knowledgeId: item.row.id,
        score: item.score,
        matchedTerms: item.matchedTerms,
        ...('rank' in item && item.rank ? { rank: item.rank } : {}),
        selected: item.selected,
        reason: item.reason,
      })),
      ...rows.filter((item) => item.status !== 'active').map((item) => ({
        knowledgeId: item.id,
        score: 0,
        matchedTerms: [],
        selected: false,
        reason: 'status_filtered' as const,
      })),
    ],
  }
}
