import { readFile, writeFile } from 'node:fs/promises'

import {
  createCreativeMemory,
  searchCreativeMemories,
  updateCreativeMemory,
  type CreativeMemoryScope,
  type CreativeMemoryStatus,
} from '../modules/creative-memory/creative-memory.service.js'
import { prisma } from '../shared/prisma.service.js'

interface RetrievalSuite {
  version: string
  drafts: string[]
  memories: Array<{
    key: string
    scopeType: CreativeMemoryScope
    draftId?: string
    statement: string
    status: CreativeMemoryStatus
  }>
  queries: Array<{
    id: string
    draftId?: string
    query: string
    activeRelevant?: Record<string, number>
    candidateRelevant?: string[]
    forbiddenKeys?: string[]
  }>
}

function divide(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null
}

function dcg(grades: number[]) {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
}

export async function evaluateCreativeMemoryRetrieval(input: {
  suiteFile: string
  outputFile?: string
  userId?: number
}) {
  const suite = JSON.parse(await readFile(input.suiteFile, 'utf8')) as RetrievalSuite
  const userId = input.userId ?? 901
  await prisma.creativeMemory.deleteMany({ where: { userId } })
  for (const draftId of suite.drafts) {
    const current = await prisma.v2TimelineDraft.findFirst({ where: { id: draftId, userId } })
    if (!current) {
      await prisma.v2TimelineDraft.create({
        data: {
          id: draftId,
          userId,
          creationMode: 'text_to_video',
          plannerInputJson: {},
          specJson: {},
        },
      })
    }
  }
  const idToKey = new Map<string, string>()
  for (const item of suite.memories) {
    const memory = await createCreativeMemory({
      userId,
      scopeType: item.scopeType,
      draftId: item.draftId,
      statement: item.statement,
      status: item.status === 'candidate' ? 'candidate' : 'active',
      origin: item.status === 'candidate' ? 'inferred' : 'explicit',
      sourceWorkspaceSessionId: 'memory_retrieval_evaluation',
      sourceTurnIds: [`fixture_${item.key}`],
    })
    if (item.status === 'revoked') {
      await updateCreativeMemory({ userId, id: memory.id, status: 'revoked' })
    }
    idToKey.set(memory.id, item.key)
  }

  let activeRelevant = 0
  let activeRetrieved = 0
  let ndcgTotal = 0
  let ndcgQueries = 0
  let candidateRelevantReturned = 0
  let candidateReturned = 0
  let candidateQueries = 0
  let crossScopeRetrievalCount = 0
  let forbiddenRetrievalCount = 0
  let unrelatedRetrievalCount = 0
  const queryResults = []
  for (const query of suite.queries) {
    const result = await searchCreativeMemories({
      userId,
      draftId: query.draftId,
      query: query.query,
      activeLimit: 8,
      candidateLimit: 3,
    })
    const activeKeys = result.active.map((item) => idToKey.get(item.memory.id)).filter(Boolean) as string[]
    const candidateKeys = result.candidate.map((item) => idToKey.get(item.memory.id)).filter(Boolean) as string[]
    const relevance = query.activeRelevant ?? {}
    const relevantKeys = Object.keys(relevance)
    const queryActiveRetrieved = activeKeys.filter((key) => key in relevance).length
    activeRelevant += relevantKeys.length
    activeRetrieved += queryActiveRetrieved
    let queryNdcg: number | null = null
    if (relevantKeys.length) {
      const actualDcg = dcg(activeKeys.map((key) => relevance[key] ?? 0))
      const idealDcg = dcg(Object.values(relevance).sort((a, b) => b - a).slice(0, 8))
      queryNdcg = idealDcg ? actualDcg / idealDcg : 0
      ndcgTotal += queryNdcg
      ndcgQueries += 1
    }
    let queryCandidateRelevant = 0
    let queryCandidateReturned = 0
    if (query.candidateRelevant !== undefined) {
      const relevantCandidates = new Set(query.candidateRelevant)
      queryCandidateRelevant = candidateKeys.filter((key) => relevantCandidates.has(key)).length
      queryCandidateReturned = Math.max(1, candidateKeys.length)
      candidateRelevantReturned += queryCandidateRelevant
      candidateReturned += queryCandidateReturned
      candidateQueries += 1
    }
    const returned = [...result.active, ...result.candidate]
    crossScopeRetrievalCount += returned.filter((item) => (
      item.memory.scopeType === 'draft' && item.memory.draftId !== query.draftId
    )).length
    const forbidden = new Set(query.forbiddenKeys ?? [])
    forbiddenRetrievalCount += [...activeKeys, ...candidateKeys].filter((key) => forbidden.has(key)).length
    const annotatedRelevant = new Set([
      ...Object.keys(query.activeRelevant ?? {}),
      ...(query.candidateRelevant ?? []),
    ])
    unrelatedRetrievalCount += [...activeKeys, ...candidateKeys].filter(
      (key) => !annotatedRelevant.has(key),
    ).length
    queryResults.push({
      id: query.id,
      query: query.query,
      activeKeys,
      candidateKeys,
      activeRelevant: relevantKeys.length,
      activeRetrieved: queryActiveRetrieved,
      ndcg: queryNdcg,
      candidateRelevantReturned: queryCandidateRelevant,
      candidateReturned: queryCandidateReturned,
      audit: result.audit,
    })
  }

  const report = {
    version: suite.version,
    queries: suite.queries.length,
    activeRelevant,
    activeRetrieved,
    ndcgTotal,
    ndcgQueries,
    candidateRelevantReturned,
    candidateReturned,
    activeMemoryRecallAt8: divide(activeRetrieved, activeRelevant),
    activeMemoryNdcgAt8: divide(ndcgTotal, ndcgQueries),
    candidatePrecisionAt3: divide(candidateRelevantReturned, candidateReturned),
    candidateQueries,
    crossScopeRetrievalCount,
    forbiddenRetrievalCount,
    unrelatedRetrievalCount,
    queryResults,
  }
  if (input.outputFile) {
    await writeFile(input.outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}
