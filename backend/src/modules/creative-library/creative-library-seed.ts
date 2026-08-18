import { readFileSync } from 'node:fs'

import {
  createIsolatedSeedCreativeKnowledgeCandidate,
  deleteCreativeKnowledge,
  listCreativeKnowledgePage,
  synchronizeIsolatedSeedCreativeKnowledgeCandidate,
  updateCreativeKnowledge,
  type CreativeKnowledgeSource,
} from '../creative-knowledge/creative-knowledge.service.js'
import {
  createCreativeMemory,
  deleteCreativeMemory,
  listCreativeMemoriesPage,
  synchronizeSyntheticCreativeMemory,
} from '../creative-memory/creative-memory.service.js'
import { normalizeCreativeText } from '../creative-memory/creative-text-retrieval.js'

export const CREATIVE_LIBRARY_SEED_LOCAL_USER_ID = 901 as const

interface SeedPreference {
  id: string
  statement: string
}

interface SeedKnowledge {
  id: string
  statement: string
  applicability: string
  source: CreativeKnowledgeSource
}

export interface CreativeLibrarySeedData {
  version: string
  purpose: 'isolated_evaluation_bootstrap'
  preferenceProfile: {
    key: string
    label: string
    entries: SeedPreference[]
  }
  knowledgeCandidates: SeedKnowledge[]
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Creative library seed ${field} is required.`)
  return value.trim()
}

function parseSource(value: unknown): CreativeKnowledgeSource {
  if (!value || typeof value !== 'object') throw new Error('Creative library seed knowledge source is invalid.')
  const source = value as Record<string, unknown>
  if (source.type === 'sample') {
    if (!Array.isArray(source.methodIds) || !Array.isArray(source.evidenceRanges)) {
      throw new Error('Sample knowledge seed must retain methods and evidence ranges.')
    }
    return {
      type: 'sample',
      taskId: requiredString(source.taskId, 'sample taskId'),
      ...(typeof source.sampleName === 'string' ? { sampleName: source.sampleName } : {}),
      methodIds: source.methodIds.map((id) => requiredString(id, 'sample methodId')),
      evidenceRanges: source.evidenceRanges.map((range) => {
        if (!range || typeof range !== 'object') throw new Error('Sample evidence range is invalid.')
        const candidate = range as Record<string, unknown>
        if (!Number.isFinite(candidate.start_sec) || !Number.isFinite(candidate.end_sec)) {
          throw new Error('Sample evidence range must contain finite bounds.')
        }
        return { start_sec: Number(candidate.start_sec), end_sec: Number(candidate.end_sec) }
      }),
    }
  }
  if (source.type !== 'catalog') throw new Error('Knowledge seed source must be sample or catalog.')
  return {
    type: 'catalog',
    sourceId: requiredString(source.sourceId, 'catalog sourceId'),
    sourceTitle: requiredString(source.sourceTitle, 'catalog sourceTitle'),
    catalogVersion: requiredString(source.catalogVersion, 'catalog version'),
  }
}

function loadSeedData(): CreativeLibrarySeedData {
  const file = new URL('../../../prisma/data/creative-library.seed.v1.json', import.meta.url)
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  if (raw.purpose !== 'isolated_evaluation_bootstrap') {
    throw new Error('Creative library seed must remain isolated evaluation bootstrap data.')
  }
  const profile = raw.preferenceProfile as Record<string, unknown> | undefined
  if (!profile || !Array.isArray(profile.entries) || !Array.isArray(raw.knowledgeCandidates)) {
    throw new Error('Creative library seed collections are invalid.')
  }
  const data: CreativeLibrarySeedData = {
    version: requiredString(raw.version, 'version'),
    purpose: 'isolated_evaluation_bootstrap',
    preferenceProfile: {
      key: requiredString(profile.key, 'profile key'),
      label: requiredString(profile.label, 'profile label'),
      entries: profile.entries.map((entry) => {
        if (!entry || typeof entry !== 'object') throw new Error('Creative preference seed is invalid.')
        const item = entry as Record<string, unknown>
        return { id: requiredString(item.id, 'preference id'), statement: requiredString(item.statement, 'preference statement') }
      }),
    },
    knowledgeCandidates: raw.knowledgeCandidates.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Creative knowledge seed is invalid.')
      const item = entry as Record<string, unknown>
      const id = requiredString(item.id, 'knowledge id')
      const source = parseSource(item.source)
      return {
        id,
        statement: requiredString(item.statement, 'knowledge statement'),
        applicability: requiredString(item.applicability, 'knowledge applicability'),
        source: { ...source, seedId: id },
      }
    }),
  }
  if (data.preferenceProfile.entries.length < 80 || data.knowledgeCandidates.length < 80) {
    throw new Error('Creative library seed must contain at least 80 preferences and 80 knowledge candidates.')
  }
  const preferenceIds = new Set(data.preferenceProfile.entries.map((entry) => entry.id))
  const preferenceStatements = new Set(data.preferenceProfile.entries.map((entry) => entry.statement))
  const knowledgeIds = new Set(data.knowledgeCandidates.map((entry) => entry.id))
  const knowledgeStatements = new Set(data.knowledgeCandidates.map((entry) => entry.statement))
  if (preferenceIds.size !== data.preferenceProfile.entries.length
    || preferenceStatements.size !== data.preferenceProfile.entries.length
    || knowledgeIds.size !== data.knowledgeCandidates.length
    || knowledgeStatements.size !== data.knowledgeCandidates.length) {
    throw new Error('Creative library seed IDs and statements must be unique.')
  }
  return data
}

export const CREATIVE_LIBRARY_SEED_DATA = loadSeedData()
export const CREATIVE_LIBRARY_SEED_VERSION = CREATIVE_LIBRARY_SEED_DATA.version
export const CREATIVE_LIBRARY_SEED_PREFERENCES = CREATIVE_LIBRARY_SEED_DATA.preferenceProfile.entries
export const CREATIVE_LIBRARY_SEED_KNOWLEDGE = CREATIVE_LIBRARY_SEED_DATA.knowledgeCandidates

async function allSeedProfileMemories(userId: number) {
  const records = []
  for (let offset = 0; ; offset += 200) {
    const page = await listCreativeMemoriesPage({ userId, scopeType: 'user', offset, limit: 200 })
    records.push(...page.items)
    if (offset + page.items.length >= page.total) break
  }
  return records
}

async function allSeedCreatorKnowledge(userId: number) {
  const records = []
  for (let offset = 0; ; offset += 200) {
    const page = await listCreativeKnowledgePage({ createdByUserId: userId, offset, limit: 200 })
    records.push(...page.items)
    if (offset + page.items.length >= page.total) break
  }
  return records
}

function seedKnowledgeId(source: CreativeKnowledgeSource): string | undefined {
  return source.type === 'sample' || source.type === 'catalog' || source.type === 'manual_revision'
    ? source.seedId
    : undefined
}

function isSeedKnowledgeSource(source: CreativeKnowledgeSource): boolean {
  return source.type === 'catalog'
    || ((source.type === 'sample') && (source.seedId !== undefined
      || source.taskId.startsWith('curated_review_sample_')
      || source.taskId.startsWith('seed_sample_')))
}

function isUnreviewedSeedKnowledge(record: Awaited<ReturnType<typeof allSeedCreatorKnowledge>>[number]) {
  return record.status !== 'revoked'
    && record.sources.length > 0
    && record.sources.every(isSeedKnowledgeSource)
    && !record.sources.some((source) => source.type === 'review'
      || source.type === 'manual' || source.type === 'manual_revision')
}

async function removeDeprecatedSeedPreferences(
  userId: number,
  records: Awaited<ReturnType<typeof allSeedProfileMemories>>,
  validIds: Set<string>,
) {
  for (const record of records) {
    const seedOwned = record.sourceWorkspaceSessionId === 'curated_creative_library.v1'
      || record.sourceWorkspaceSessionId?.startsWith('creative_library_seed.')
    const sourceId = record.sourceTurnIds[0]
    if (seedOwned && record.origin === 'synthetic' && record.status === 'active'
      && (!sourceId || !validIds.has(sourceId))) {
      await deleteCreativeMemory({ userId, id: record.id })
    }
  }
}

export async function seedCreativeLibraryFixtures(
  userId: number,
  data: CreativeLibrarySeedData = CREATIVE_LIBRARY_SEED_DATA,
): Promise<{
  memories: number
  knowledge: number
}> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('A valid seed user ID is required.')
  const preferenceIds = new Set(data.preferenceProfile.entries.map((entry) => entry.id))
  let memoryRecords = await allSeedProfileMemories(userId)
  await removeDeprecatedSeedPreferences(userId, memoryRecords, preferenceIds)
  memoryRecords = await allSeedProfileMemories(userId)

  for (const entry of data.preferenceProfile.entries) {
    const existing = memoryRecords.find((record) => record.sourceTurnIds[0] === entry.id)
    if (existing) {
      await synchronizeSyntheticCreativeMemory({
        userId,
        id: existing.id,
        statement: entry.statement,
        sourceWorkspaceSessionId: data.version,
        sourceTurnId: entry.id,
        sourceExcerpt: `合成评测画像：${entry.statement}`,
      })
      continue
    }
    if (memoryRecords.some((record) => normalizeCreativeText(record.statement) === normalizeCreativeText(entry.statement))) {
      continue
    }
    const created = await createCreativeMemory({
      userId,
      scopeType: 'user',
      statement: entry.statement,
      status: 'active',
      origin: 'synthetic',
      sourceWorkspaceSessionId: data.version,
      sourceTurnIds: [entry.id],
      sourceExcerpt: `合成评测画像：${entry.statement}`,
      preserveExistingStatus: true,
    })
    memoryRecords.push(created)
  }

  let knowledgeRecords = await allSeedCreatorKnowledge(userId)
  for (const entry of data.knowledgeCandidates) {
    const source = { ...entry.source, seedId: entry.id } as CreativeKnowledgeSource
    const existing = knowledgeRecords.find((record) => record.sources.some((item) => seedKnowledgeId(item) === entry.id))
    const outcome = existing
      ? { knowledge: await synchronizeIsolatedSeedCreativeKnowledgeCandidate({
        id: existing.id,
        userId,
        statement: entry.statement,
        applicability: entry.applicability,
        source,
      }) }
      : await createIsolatedSeedCreativeKnowledgeCandidate({
        userId,
        statement: entry.statement,
        applicability: entry.applicability,
        source,
      })
    const record = outcome.knowledge
    const seedOwnedAndUnreviewed = record.createdByUserId === userId
      && record.sources.some(isSeedKnowledgeSource)
      && !record.sources.some((source) => source.type === 'review')
    if (record.status === 'active' && seedOwnedAndUnreviewed) {
      await updateCreativeKnowledge({ id: record.id, status: 'candidate' })
    }
  }
  knowledgeRecords = await allSeedCreatorKnowledge(userId)
  const validKnowledgeIds = new Set(data.knowledgeCandidates.map((entry) => entry.id))
  const validKnowledgeStatements = new Set(data.knowledgeCandidates.map((entry) => normalizeCreativeText(entry.statement)))
  for (const record of knowledgeRecords) {
    if (!isUnreviewedSeedKnowledge(record)) continue
    const stableIds = record.sources.map(seedKnowledgeId).filter((id): id is string => Boolean(id))
    const removedStableRecord = stableIds.length > 0 && stableIds.every((id) => !validKnowledgeIds.has(id))
    const removedLegacyRecord = stableIds.length === 0
      && !validKnowledgeStatements.has(normalizeCreativeText(record.statement))
    if (removedStableRecord || removedLegacyRecord) await deleteCreativeKnowledge(record.id)
  }

  return {
    memories: data.preferenceProfile.entries.length,
    knowledge: data.knowledgeCandidates.length,
  }
}
