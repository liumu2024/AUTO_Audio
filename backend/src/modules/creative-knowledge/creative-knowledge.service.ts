import { createHash, randomUUID } from 'node:crypto'

import type {
  V2SampleEvidenceRange,
} from '../../../../shared/types/v2-sample-understanding.js'
import { prisma } from '../../shared/prisma.service.js'
import {
  normalizeCreativeText,
  rankConfiguredCreativeTextRows,
} from '../creative-memory/creative-text-retrieval.js'

export type CreativeKnowledgeStatus = 'active' | 'candidate' | 'revoked'

export interface CreativeKnowledgeSampleSource {
  type: 'sample'
  seedId?: string
  taskId: string
  contentHash?: string
  sampleName?: string
  methodIds: string[]
  evidenceRanges: V2SampleEvidenceRange[]
}

export interface CreativeKnowledgeCatalogSource {
  type: 'catalog'
  seedId?: string
  sourceId: string
  sourceTitle: string
  catalogVersion?: string
}

export interface CreativeKnowledgeManualSource {
  type: 'manual'
  sourceId: string
  sourceTitle: string
}

export interface CreativeKnowledgeManualRevisionSource {
  type: 'manual_revision'
  seedId?: string
  editorUserId: number
  editedAt: string
}

export interface CreativeKnowledgeReviewSource {
  type: 'review'
  reviewerId: string
  reviewedAt: string
}

export interface CreativeKnowledgeEvidenceSource {
  type: 'evidence'
  policyVersion: 'creative_learning_evidence.v1'
  observationCount: number
  activatedAt: string
}

export type CreativeKnowledgeSource = CreativeKnowledgeSampleSource
  | CreativeKnowledgeCatalogSource
  | CreativeKnowledgeManualSource
  | CreativeKnowledgeManualRevisionSource
  | CreativeKnowledgeReviewSource
  | CreativeKnowledgeEvidenceSource

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
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'status_filtered' | 'review_filtered'
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
  findMany(input: {
    where: Record<string, unknown>
    orderBy?: Record<string, 'asc' | 'desc'>
    skip?: number
    take?: number
  }): Promise<DbKnowledge[]>
  findFirst(input: { where: Record<string, unknown> }): Promise<DbKnowledge | null>
  count(input: { where: Record<string, unknown> }): Promise<number>
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
  return value.flatMap((item): CreativeKnowledgeSource[] => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if ((value.type === 'catalog' || value.type === 'curated')
      && typeof value.sourceId === 'string'
      && typeof value.sourceTitle === 'string') {
      return [{
        type: 'catalog',
        ...(typeof value.seedId === 'string' ? { seedId: value.seedId } : {}),
        sourceId: value.sourceId,
        sourceTitle: value.sourceTitle,
        ...(typeof value.catalogVersion === 'string' ? { catalogVersion: value.catalogVersion } : {}),
      }]
    }
    if (value.type === 'manual'
      && typeof value.sourceId === 'string'
      && typeof value.sourceTitle === 'string') {
      return [{ type: 'manual', sourceId: value.sourceId, sourceTitle: value.sourceTitle }]
    }
    if (value.type === 'manual_revision'
      && Number.isInteger(value.editorUserId)
      && typeof value.editedAt === 'string') {
      return [{
        type: 'manual_revision',
        ...(typeof value.seedId === 'string' ? { seedId: value.seedId } : {}),
        editorUserId: Number(value.editorUserId),
        editedAt: value.editedAt,
      }]
    }
    if (value.type === 'review'
      && typeof value.reviewerId === 'string'
      && typeof value.reviewedAt === 'string') {
      return [{ type: 'review', reviewerId: value.reviewerId, reviewedAt: value.reviewedAt }]
    }
    if (value.type === 'evidence'
      && value.policyVersion === 'creative_learning_evidence.v1'
      && Number.isInteger(value.observationCount)
      && typeof value.activatedAt === 'string') {
      return [{
        type: 'evidence',
        policyVersion: 'creative_learning_evidence.v1',
        observationCount: Number(value.observationCount),
        activatedAt: value.activatedAt,
      }]
    }
    if (typeof value.taskId !== 'string') return []
    return [{
      type: 'sample',
      ...(typeof value.seedId === 'string' ? { seedId: value.seedId } : {}),
      taskId: value.taskId,
      ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
      ...(typeof value.sampleName === 'string' ? { sampleName: value.sampleName } : {}),
      methodIds: Array.isArray(value.methodIds)
        ? value.methodIds.filter((id): id is string => typeof id === 'string')
        : [],
      evidenceRanges: Array.isArray(value.evidenceRanges)
        ? value.evidenceRanges.filter((range): range is V2SampleEvidenceRange => Boolean(
          range && typeof range === 'object'
          && Number.isFinite((range as V2SampleEvidenceRange).start_sec)
          && Number.isFinite((range as V2SampleEvidenceRange).end_sec),
        ))
        : [],
    }]
  })
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
  const sourceKey = knowledgeSourceKey(source)
  const withoutSameTask = existing.filter((item) => (
    knowledgeSourceKey(item)
  ) !== sourceKey)
  return [...withoutSameTask, source]
}

function knowledgeSourceKey(source: CreativeKnowledgeSource): string {
  if ((source.type === 'sample' || source.type === 'catalog') && source.seedId) return `seed:${source.seedId}`
  if (source.type === 'sample') return `sample:${source.contentHash ?? source.taskId}`
  if (source.type === 'catalog' || source.type === 'manual') return `${source.type}:${source.sourceId}`
  if (source.type === 'manual_revision') return 'manual_revision:current'
  if (source.type === 'review') return 'review:current'
  return 'evidence:current'
}

export interface CreativeKnowledgeCandidateUpsert {
  knowledge: CreativeKnowledgeRecord
  created: boolean
  sourceMerged: boolean
}

export class CreativeKnowledgeAlreadyExistsError extends Error {
  constructor(readonly existing: CreativeKnowledgeRecord) {
    super('Creative knowledge with the same semantic identity already exists.')
    this.name = 'CreativeKnowledgeAlreadyExistsError'
  }
}

async function upsertCreativeKnowledgeCandidate(input: {
  userId: number
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
  mergeExistingSource: boolean
  replaceOwnedUnreviewedSource?: boolean
}): Promise<CreativeKnowledgeCandidateUpsert> {
  const statement = requiredText(input.statement, 'Creative knowledge statement')
  const applicability = requiredText(input.applicability, 'Creative knowledge applicability')
  const key = semanticKey(statement)
  return serializeKnowledgeWrite(async () => {
    const reuse = async (existing: DbKnowledge): Promise<CreativeKnowledgeCandidateUpsert> => {
      const existingSources = sources(existing.sourcesJson)
      const replaceableSeedSource = existingSources.length > 0 && existingSources.every((source) => (
        source.type === 'catalog'
        || (source.type === 'sample' && (source.taskId.startsWith('curated_review_sample_')
          || source.taskId.startsWith('seed_sample_')))
      ))
      if (input.replaceOwnedUnreviewedSource
        && existing.createdByUserId === input.userId
        && replaceableSeedSource
        && !existingSources.some((source) => source.type === 'review')) {
        await knowledgeStore().updateMany({
          where: { id: existing.id, createdByUserId: input.userId },
          data: { applicability, sourcesJson: [input.source] },
        })
        const replaced = await knowledgeStore().findFirst({ where: { id: existing.id } })
        if (!replaced) throw new Error('Creative knowledge disappeared after seed source replacement.')
        return { knowledge: record(replaced), created: false, sourceMerged: true }
      }
      if (!input.mergeExistingSource) {
        return { knowledge: record(existing), created: false, sourceMerged: false }
      }
      await knowledgeStore().updateMany({
        where: { id: existing.id },
        data: { sourcesJson: mergeSource(sources(existing.sourcesJson), input.source) },
      })
      const updated = await knowledgeStore().findFirst({ where: { id: existing.id } })
      if (!updated) throw new Error('Creative knowledge disappeared after source merge.')
      return { knowledge: record(updated), created: false, sourceMerged: true }
    }
    const existing = await knowledgeStore().findFirst({ where: { semanticKey: key } })
    if (existing) return reuse(existing)
    try {
      return {
        knowledge: record(await knowledgeStore().create({
          data: {
            id: `know_${randomUUID()}`,
            statement,
            applicability,
            status: 'candidate',
            semanticKey: key,
            sourcesJson: [input.source],
            createdByUserId: input.userId,
          },
        })),
        created: true,
        sourceMerged: true,
      }
    } catch (error) {
      const concurrent = await knowledgeStore().findFirst({ where: { semanticKey: key } })
      if (concurrent) return reuse(concurrent)
      throw error
    }
  })
}

export async function createCreativeKnowledgeCandidate(input: {
  userId: number
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
}): Promise<CreativeKnowledgeRecord> {
  return (await upsertCreativeKnowledgeCandidate({ ...input, mergeExistingSource: true })).knowledge
}

export async function mergeCreativeKnowledgeSource(input: {
  id: string
  source: CreativeKnowledgeSource
}): Promise<CreativeKnowledgeRecord> {
  return serializeKnowledgeWrite(async () => {
    const current = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!current) throw new Error('Creative knowledge not found during source merge.')
    await knowledgeStore().updateMany({
      where: { id: input.id },
      data: { sourcesJson: mergeSource(sources(current.sourcesJson), input.source) },
    })
    const updated = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!updated) throw new Error('Creative knowledge disappeared after source merge.')
    return record(updated)
  })
}

export async function activateCreativeKnowledgeFromEvidence(input: {
  id: string
  observationCount: number
}): Promise<CreativeKnowledgeRecord> {
  if (!Number.isInteger(input.observationCount) || input.observationCount < 2) {
    throw new Error('Creative knowledge requires at least two independent observations for activation.')
  }
  return serializeKnowledgeWrite(async () => {
    const current = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!current) throw new Error('Creative knowledge not found during evidence activation.')
    if (current.status === 'revoked') return record(current)
    await knowledgeStore().updateMany({
      where: { id: input.id },
      data: {
        status: 'active',
        revokedAt: null,
        sourcesJson: mergeSource(sources(current.sourcesJson), {
          type: 'evidence',
          policyVersion: 'creative_learning_evidence.v1',
          observationCount: input.observationCount,
          activatedAt: new Date().toISOString(),
        }),
      },
    })
    const updated = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!updated) throw new Error('Creative knowledge disappeared after evidence activation.')
    return record(updated)
  })
}

export async function createManualCreativeKnowledgeCandidate(input: {
  userId: number
  statement: string
  applicability: string
  sourceId: string
  sourceTitle: string
}): Promise<CreativeKnowledgeRecord> {
  const sourceId = requiredText(input.sourceId, 'Creative knowledge source ID')
  const sourceTitle = requiredText(input.sourceTitle, 'Creative knowledge source title')
  const outcome = await upsertCreativeKnowledgeCandidate({
    userId: input.userId,
    statement: input.statement,
    applicability: input.applicability,
    mergeExistingSource: false,
    source: {
      type: 'manual',
      sourceId,
      sourceTitle,
    },
  })
  if (!outcome.created) throw new CreativeKnowledgeAlreadyExistsError(outcome.knowledge)
  return outcome.knowledge
}

export async function createIsolatedSeedCreativeKnowledgeCandidate(input: {
  userId: number
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
}): Promise<CreativeKnowledgeCandidateUpsert> {
  return upsertCreativeKnowledgeCandidate({
    ...input,
    mergeExistingSource: false,
    replaceOwnedUnreviewedSource: true,
  })
}

export async function synchronizeIsolatedSeedCreativeKnowledgeCandidate(input: {
  id: string
  userId: number
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
}): Promise<CreativeKnowledgeRecord> {
  return serializeKnowledgeWrite(async () => {
    const current = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!current) throw new Error('Creative knowledge not found during seed synchronization.')
    const currentSources = sources(current.sourcesJson)
    const targetSeedId = (input.source.type === 'sample' || input.source.type === 'catalog')
      ? input.source.seedId
      : undefined
    if (!targetSeedId) throw new Error('Seed knowledge synchronization requires a stable seed ID.')
    const protectedRecord = current.createdByUserId !== input.userId
      || current.status === 'revoked'
      || currentSources.some((source) => source.type === 'review'
        || source.type === 'manual' || source.type === 'manual_revision')
      || currentSources.some((source) => (
        (source.type !== 'sample' && source.type !== 'catalog') || source.seedId !== targetSeedId
      ))
    if (protectedRecord) return record(current)
    const statement = requiredText(input.statement, 'Creative knowledge statement')
    const applicability = requiredText(input.applicability, 'Creative knowledge applicability')
    const key = semanticKey(statement)
    const collision = await knowledgeStore().findFirst({ where: { semanticKey: key } })
    if (collision && collision.id !== current.id) {
      await knowledgeStore().deleteMany({ where: { id: current.id, createdByUserId: input.userId } })
      return record(collision)
    }
    const updated = await knowledgeStore().updateMany({
      where: { id: current.id, createdByUserId: input.userId },
      data: {
        statement,
        applicability,
        semanticKey: key,
        status: 'candidate',
        revokedAt: null,
        sourcesJson: [input.source],
      },
    })
    if (updated.count !== 1) throw new Error('Creative knowledge changed during seed synchronization.')
    const refreshed = await knowledgeStore().findFirst({ where: { id: current.id } })
    if (!refreshed) throw new Error('Creative knowledge disappeared after seed synchronization.')
    return record(refreshed)
  })
}

export interface CreativeKnowledgePage {
  items: CreativeKnowledgeRecord[]
  total: number
  offset: number
  limit: number
}

export async function listCreativeKnowledgePage(input: {
  status?: CreativeKnowledgeStatus
  createdByUserId?: number
  offset?: number
  limit?: number
} = {}): Promise<CreativeKnowledgePage> {
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
  }
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200))
  const [rows, total] = await Promise.all([
    knowledgeStore().findMany({ where, orderBy: { updatedAt: 'desc' }, skip: offset, take: limit }),
    knowledgeStore().count({ where }),
  ])
  return { items: rows.map(record), total, offset, limit }
}

export async function getCreativeKnowledgeById(id: string): Promise<CreativeKnowledgeRecord | undefined> {
  const row = await knowledgeStore().findFirst({ where: { id } })
  return row ? record(row) : undefined
}

export async function listCreativeKnowledge(input: {
  status?: CreativeKnowledgeStatus
  limit?: number
} = {}): Promise<CreativeKnowledgeRecord[]> {
  return (await listCreativeKnowledgePage({
    status: input.status,
    limit: input.limit ?? 100,
  })).items
}

export async function updateCreativeKnowledge(input: {
  id: string
  statement?: string
  applicability?: string
  status?: CreativeKnowledgeStatus
  editedByUserId?: number
  reviewedBy?: string
}): Promise<CreativeKnowledgeRecord> {
  return serializeKnowledgeWrite(async () => {
    const current = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!current) throw new Error('Creative knowledge not found.')
    const statement = input.statement === undefined
      ? current.statement
      : requiredText(input.statement, 'Creative knowledge statement')
    const applicability = input.applicability === undefined
      ? current.applicability
      : requiredText(input.applicability, 'Creative knowledge applicability')
    const contentChanged = statement !== current.statement || applicability !== current.applicability
    if (contentChanged && input.status === 'active') {
      throw new Error('Edited creative knowledge must be reviewed before activation.')
    }
    if (contentChanged && (!Number.isInteger(input.editedByUserId) || Number(input.editedByUserId) <= 0)) {
      throw new Error('Creative knowledge edits require an editor identity.')
    }
    const data: Record<string, unknown> = {}
    if (statement !== current.statement) {
      data.statement = statement
      data.semanticKey = semanticKey(statement)
    }
    if (applicability !== current.applicability) data.applicability = applicability
    if (contentChanged) {
      const seedId = sources(current.sourcesJson).flatMap((source) => (
        (source.type === 'sample' || source.type === 'catalog') && source.seedId ? [source.seedId] : []
      ))[0]
      data.status = 'candidate'
      data.revokedAt = null
      data.sourcesJson = [{
        type: 'manual_revision',
        ...(seedId ? { seedId } : {}),
        editorUserId: Number(input.editedByUserId),
        editedAt: new Date().toISOString(),
      } satisfies CreativeKnowledgeManualRevisionSource]
    } else if (input.status !== undefined) {
      if (input.status === 'active') {
        const reviewerId = requiredText(input.reviewedBy ?? '', 'Creative knowledge reviewer')
        data.sourcesJson = mergeSource(sources(current.sourcesJson), {
          type: 'review',
          reviewerId,
          reviewedAt: new Date().toISOString(),
        })
      } else if (input.status === 'candidate') {
        data.sourcesJson = sources(current.sourcesJson).filter((source) => source.type !== 'review')
      }
      data.status = input.status
      data.revokedAt = input.status === 'revoked' ? new Date() : null
    }
    if (Object.keys(data).length) await knowledgeStore().updateMany({ where: { id: input.id }, data })
    const updated = await knowledgeStore().findFirst({ where: { id: input.id } })
    if (!updated) throw new Error('Creative knowledge disappeared after update.')
    return record(updated)
  })
}

export async function deleteCreativeKnowledge(id: string): Promise<boolean> {
  return (await knowledgeStore().deleteMany({ where: { id } })).count === 1
}

export async function searchCreativeKnowledge(input: {
  query: string
  limit?: number
  statuses?: CreativeKnowledgeStatus[]
  createdByUserId?: number
  requireReviewed?: boolean
}): Promise<CreativeKnowledgeSearchResult> {
  const allowedStatuses = new Set(input.statuses ?? ['active'])
  const singleStatus = allowedStatuses.size === 1 ? [...allowedStatuses][0] : undefined
  const rows = await knowledgeStore().findMany({
    where: {
      ...(singleStatus ? { status: singleStatus } : {}),
      ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
    },
  })
  const requireReviewed = input.requireReviewed ?? true
  const statusEligible = rows.filter((item) => allowedStatuses.has(item.status as CreativeKnowledgeStatus)
    && (!input.createdByUserId || item.createdByUserId === input.createdByUserId))
  const eligible = statusEligible.filter((item) => item.status !== 'active'
    || !requireReviewed
    || sources(item.sourcesJson).some((source) => source.type === 'review' || source.type === 'evidence'))
  const eligibleIds = new Set(eligible.map((item) => item.id))
  const reviewFilteredIds = new Set(statusEligible
    .filter((item) => !eligibleIds.has(item.id))
    .map((item) => item.id))
  const ranked = await rankConfiguredCreativeTextRows({
    entityType: 'knowledge',
    rows: eligible,
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
      ...rows.filter((item) => !eligibleIds.has(item.id)).map((item) => ({
        knowledgeId: item.id,
        score: 0,
        matchedTerms: [],
        selected: false,
        reason: reviewFilteredIds.has(item.id) ? 'review_filtered' as const : 'status_filtered' as const,
      })),
    ],
  }
}
