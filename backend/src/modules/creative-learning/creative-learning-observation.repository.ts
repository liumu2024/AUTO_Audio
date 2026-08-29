import { createHash, randomUUID } from 'node:crypto'

import { prisma } from '../../shared/prisma.service.js'
import type { CreativeMemoryScope } from '../creative-memory/creative-memory.service.js'
import { normalizeCreativeText } from '../creative-memory/creative-text-retrieval.js'

export type CreativeMemoryObservationKind = 'explicit_preference' | 'behavioral_signal' | 'revocation'
export type CreativePreferencePolarity = 'prefer' | 'avoid'
export type CreativeKnowledgeObservationSourceType = 'sample' | 'catalog' | 'manual'

export interface CreativeMemoryObservationRecord {
  id: string
  userId: number
  memoryId: string
  scopeType: CreativeMemoryScope
  draftId?: string
  sourceWorkspaceSessionId: string
  sourceTurnId: string
  sourceFingerprint: string
  kind: CreativeMemoryObservationKind
  statement: string
  polarity: CreativePreferencePolarity
  sourceExcerpt: string
  confidence?: number
  createdAt: string
}

export interface CreativeKnowledgeObservationRecord {
  id: string
  knowledgeId: string
  createdByUserId?: number
  sourceType: CreativeKnowledgeObservationSourceType
  sourceId: string
  sourceContentHash?: string
  sourceFingerprint: string
  statement: string
  applicability: string
  evidence: unknown
  confidence?: number
  createdAt: string
}

type DbMemoryObservation = {
  id: string
  userId: number
  memoryId: string
  scopeType: string
  draftId: string | null
  sourceWorkspaceSessionId: string
  sourceTurnId: string
  sourceFingerprint: string
  observationKey: string
  kind: string
  statement: string
  polarity: string
  sourceExcerpt: string
  confidence: number | null
  createdAt: Date
}

type DbKnowledgeObservation = {
  id: string
  knowledgeId: string
  createdByUserId: number | null
  sourceType: string
  sourceId: string
  sourceContentHash: string | null
  sourceFingerprint: string
  observationKey: string
  statement: string
  applicability: string
  evidenceJson: unknown
  confidence: number | null
  createdAt: Date
}

type ObservationDelegate<T> = {
  create(input: { data: Record<string, unknown> }): Promise<T>
  findFirst(input: { where: Record<string, unknown> }): Promise<T | null>
  findMany(input: {
    where: Record<string, unknown>
    orderBy?: Record<string, 'asc' | 'desc'>
  }): Promise<T[]>
}

const memoryObservations = () => (prisma as unknown as {
  creativeMemoryObservation: ObservationDelegate<DbMemoryObservation>
}).creativeMemoryObservation

const knowledgeObservations = () => (prisma as unknown as {
  creativeKnowledgeObservation: ObservationDelegate<DbKnowledgeObservation>
}).creativeKnowledgeObservation

function hash(parts: Array<string | number | undefined>): string {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u001f')).digest('hex')
}

function requiredText(value: string, label: string, maxLength = 1_000): string {
  const text = value.trim()
  if (!text || text.length > maxLength) throw new Error(`${label} must contain 1-${maxLength} characters.`)
  return text
}

function confidence(value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Creative learning confidence must be between 0 and 1.')
  }
  return value
}

function memoryRecord(row: DbMemoryObservation): CreativeMemoryObservationRecord {
  return {
    id: row.id,
    userId: row.userId,
    memoryId: row.memoryId,
    scopeType: row.scopeType as CreativeMemoryScope,
    ...(row.draftId ? { draftId: row.draftId } : {}),
    sourceWorkspaceSessionId: row.sourceWorkspaceSessionId,
    sourceTurnId: row.sourceTurnId,
    sourceFingerprint: row.sourceFingerprint,
    kind: row.kind as CreativeMemoryObservationKind,
    statement: row.statement,
    polarity: row.polarity as CreativePreferencePolarity,
    sourceExcerpt: row.sourceExcerpt,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    createdAt: row.createdAt.toISOString(),
  }
}

function knowledgeRecord(row: DbKnowledgeObservation): CreativeKnowledgeObservationRecord {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    ...(row.createdByUserId === null ? {} : { createdByUserId: row.createdByUserId }),
    sourceType: row.sourceType as CreativeKnowledgeObservationSourceType,
    sourceId: row.sourceId,
    ...(row.sourceContentHash ? { sourceContentHash: row.sourceContentHash } : {}),
    sourceFingerprint: row.sourceFingerprint,
    statement: row.statement,
    applicability: row.applicability,
    evidence: row.evidenceJson,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    createdAt: row.createdAt.toISOString(),
  }
}

export async function recordCreativeMemoryObservation(input: {
  userId: number
  memoryId: string
  scopeType: CreativeMemoryScope
  draftId?: string
  sourceWorkspaceSessionId: string
  sourceTurnId: string
  kind: CreativeMemoryObservationKind
  statement: string
  polarity: CreativePreferencePolarity
  sourceExcerpt: string
  confidence?: number
}): Promise<{ observation: CreativeMemoryObservationRecord; created: boolean }> {
  const statement = requiredText(input.statement, 'Creative memory observation statement', 500)
  const sourceExcerpt = requiredText(input.sourceExcerpt, 'Creative memory observation excerpt')
  const workspaceSessionId = requiredText(input.sourceWorkspaceSessionId, 'Creative memory workspace session ID', 200)
  const turnId = requiredText(input.sourceTurnId, 'Creative memory source turn ID', 200)
  const sourceFingerprint = hash([input.userId, workspaceSessionId, turnId])
  const observationKey = hash([
    input.scopeType,
    input.draftId,
    input.kind,
    input.polarity,
    normalizeCreativeText(statement),
  ])
  const where = { userId: input.userId, sourceFingerprint, observationKey }
  const existing = await memoryObservations().findFirst({ where })
  if (existing) return { observation: memoryRecord(existing), created: false }
  try {
    return {
      observation: memoryRecord(await memoryObservations().create({
        data: {
          id: `memobs_${randomUUID()}`,
          userId: input.userId,
          memoryId: input.memoryId,
          scopeType: input.scopeType,
          draftId: input.draftId ?? null,
          sourceWorkspaceSessionId: workspaceSessionId,
          sourceTurnId: turnId,
          sourceFingerprint,
          observationKey,
          kind: input.kind,
          statement,
          polarity: input.polarity,
          sourceExcerpt,
          confidence: confidence(input.confidence),
        },
      })),
      created: true,
    }
  } catch (error) {
    const concurrent = await memoryObservations().findFirst({ where })
    if (concurrent) return { observation: memoryRecord(concurrent), created: false }
    throw error
  }
}

export async function listCreativeMemoryObservations(input: {
  userId?: number
  memoryId?: string
}): Promise<CreativeMemoryObservationRecord[]> {
  const rows = await memoryObservations().findMany({
    where: {
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.memoryId ? { memoryId: input.memoryId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(memoryRecord)
}

export async function recordCreativeKnowledgeObservation(input: {
  userId?: number
  knowledgeId: string
  sourceType: CreativeKnowledgeObservationSourceType
  sourceId: string
  sourceContentHash?: string
  statement: string
  applicability: string
  evidence: unknown
  confidence?: number
}): Promise<{ observation: CreativeKnowledgeObservationRecord; created: boolean }> {
  const statement = requiredText(input.statement, 'Creative knowledge observation statement', 500)
  const applicability = requiredText(input.applicability, 'Creative knowledge observation applicability', 500)
  const sourceId = requiredText(input.sourceId, 'Creative knowledge source ID', 500)
  const sourceContentHash = input.sourceContentHash?.trim() || undefined
  if (input.sourceType === 'sample' && !sourceContentHash) {
    throw new Error('Sample knowledge observation requires a stable source content hash.')
  }
  const sourceFingerprint = hash([input.sourceType, sourceContentHash ?? sourceId])
  const observationKey = hash([normalizeCreativeText(statement), normalizeCreativeText(applicability)])
  const where = { sourceFingerprint, observationKey }
  const existing = await knowledgeObservations().findFirst({ where })
  if (existing) return { observation: knowledgeRecord(existing), created: false }
  try {
    return {
      observation: knowledgeRecord(await knowledgeObservations().create({
        data: {
          id: `knowobs_${randomUUID()}`,
          knowledgeId: input.knowledgeId,
          createdByUserId: input.userId ?? null,
          sourceType: input.sourceType,
          sourceId,
          sourceContentHash: sourceContentHash ?? null,
          sourceFingerprint,
          observationKey,
          statement,
          applicability,
          evidenceJson: input.evidence,
          confidence: confidence(input.confidence),
        },
      })),
      created: true,
    }
  } catch (error) {
    const concurrent = await knowledgeObservations().findFirst({ where })
    if (concurrent) return { observation: knowledgeRecord(concurrent), created: false }
    throw error
  }
}

export async function listCreativeKnowledgeObservations(input: {
  knowledgeId?: string
}): Promise<CreativeKnowledgeObservationRecord[]> {
  const rows = await knowledgeObservations().findMany({
    where: input.knowledgeId ? { knowledgeId: input.knowledgeId } : {},
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(knowledgeRecord)
}
