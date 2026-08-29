import { z } from 'zod'

import { extractStructuredJsonCandidate } from '../agent-tools/structured-json-tool.js'
import {
  callResponsesApi,
} from '../director-agent/llm-intent-router.js'
import {
  createCreativeKnowledgeCandidate,
  getCreativeKnowledgeById,
  listCreativeKnowledge,
  mergeCreativeKnowledgeSource,
  activateCreativeKnowledgeFromEvidence,
  searchCreativeKnowledge,
  type CreativeKnowledgeRecord,
  type CreativeKnowledgeSampleSource,
} from '../creative-knowledge/creative-knowledge.service.js'
import {
  createCreativeMemory,
  listCreativeMemories,
  replaceActiveCreativeMemory,
  searchCreativeMemories,
  updateCreativeMemory,
  type CreativeMemoryRecord,
  type CreativeMemoryScope,
} from '../creative-memory/creative-memory.service.js'
import { normalizeCreativeText } from '../creative-memory/creative-text-retrieval.js'
import {
  listCreativeKnowledgeObservations,
  listCreativeMemoryObservations,
  recordCreativeKnowledgeObservation,
  recordCreativeMemoryObservation,
  type CreativeMemoryObservationKind,
  type CreativePreferencePolarity,
} from './creative-learning-observation.repository.js'

const MemoryObservationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['explicit_preference', 'behavioral_signal']),
    scopeType: z.enum(['user', 'draft']),
    statement: z.string().trim().min(1).max(500),
    polarity: z.enum(['prefer', 'avoid']),
    sourceExcerpt: z.string().trim().min(1).max(1_000),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    kind: z.literal('revocation'),
    scopeType: z.enum(['user', 'draft']),
    targetMemoryId: z.string().trim().min(1),
    statement: z.string().trim().min(1).max(500),
    polarity: z.enum(['prefer', 'avoid']),
    sourceExcerpt: z.string().trim().min(1).max(1_000),
    confidence: z.number().min(0).max(1),
  }).strict(),
])
const MemoryDecisionSchema = z.object({ observations: z.array(MemoryObservationSchema).max(10) }).strict()
const MemoryRelationSchema = z.object({
  relation: z.enum(['equivalent', 'contradictory', 'unrelated']),
  targetId: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1),
}).strict()
const KnowledgeRelationSchema = z.object({
  relation: z.enum(['equivalent', 'unrelated']),
  targetId: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1),
}).strict()

export type CreativeMemoryLearningObservation = z.infer<typeof MemoryObservationSchema>
export type CreativeMemoryLearningDecision = z.infer<typeof MemoryDecisionSchema>
export type CreativeMemoryRelation = z.infer<typeof MemoryRelationSchema>
export type CreativeKnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>

export interface CreativeLearningDependencies {
  observeUserTurn?: (input: {
    userText: string
    requirementStatements: string[]
    recalledMemories: Array<Pick<CreativeMemoryRecord, 'id' | 'statement' | 'scopeType' | 'status'>>
  }) => Promise<CreativeMemoryLearningDecision>
  judgeMemoryRelation?: (
    observation: CreativeMemoryLearningObservation,
    candidates: Array<Pick<CreativeMemoryRecord, 'id' | 'statement' | 'scopeType' | 'status'>>,
  ) => Promise<CreativeMemoryRelation>
  judgeKnowledgeRelation?: (
    observation: { statement: string; applicability: string },
    candidates: Array<Pick<CreativeKnowledgeRecord, 'id' | 'statement' | 'applicability' | 'status'>>,
  ) => Promise<CreativeKnowledgeRelation>
}

export interface CreativePreferenceLearningReceipt {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped'
  changes: Array<{
    memoryId: string
    relation: 'created' | 'equivalent' | 'contradictory' | 'revoked'
    observationCreated: boolean
    effectiveStatus: 'active' | 'candidate' | 'revoked'
  }>
  errors: string[]
}

export interface CreativeKnowledgeLearningReceipt {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped'
  changes: Array<{
    knowledgeId: string
    relation: 'created' | 'equivalent'
    observationCreated: boolean
    effectiveStatus: 'active' | 'candidate' | 'revoked'
  }>
  errors: string[]
}

const RELATION_CONFIDENCE_THRESHOLD = 0.9
const MIN_OBSERVATION_CONFIDENCE = 0.6
const DIRECT_ACTIVATION_CONFIDENCE = 0.9
const MIN_INDEPENDENT_PREFERENCE_WORKSPACES = 2
const MIN_INDEPENDENT_KNOWLEDGE_SOURCES = 2

function parseStructured<T>(schema: z.ZodType<T>, raw: unknown): T {
  const extracted = extractStructuredJsonCandidate(raw, (candidate) => schema.safeParse(candidate).success)
  return schema.parse(extracted.candidate)
}

async function defaultObserveUserTurn(input: Parameters<NonNullable<CreativeLearningDependencies['observeUserTurn']>>[0]) {
  const response = await callResponsesApi({
    promptText: [
      '你负责从用户本轮原话中识别可长期复用的创作偏好证据，不负责回复用户、修改项目要求或创建视频方案。',
      '只提取用户明确表达的长期偏好，或可作为候选观察的弱偏好信号。单次项目对象、故事内容、镜头操作、交付参数和当前实现要求不是长期偏好。',
      'statement 使用简洁、原子化、可跨任务复用的规范表达；一句话包含多个独立偏好时拆开。不要把人物、地点、题材内容或本次任务目标混入 statement，除非它明确限定偏好的适用题材。',
      'sourceExcerpt 必须逐字截取自本轮 userText，且单独阅读时必须支持 statement 的对象、方向和适用条件；statement 可以进行语义归纳。',
      '用户明确说明长期、以后、一贯偏好时使用 explicit_preference；仅表达本次感觉、可能倾向或尚不确定时使用 behavioral_signal；明确撤销已有偏好时使用 revocation，并且只能引用 recalledMemories 中的 targetMemoryId。',
      '当前项目要求与偏好同时出现时，只提取其中可跨任务复用的偏好部分。没有可靠偏好证据时返回空 observations。',
      `userText=${JSON.stringify(input.userText)}`,
      `currentRequirements=${JSON.stringify(input.requirementStatements)}`,
      `recalledMemories=${JSON.stringify(input.recalledMemories)}`,
      '只输出符合 JSON Schema 的结果。',
    ].join('\n'),
    maxOutputTokens: 1_200,
    structuredOutput: {
      name: 'creative_memory_observations',
      schema: z.toJSONSchema(MemoryDecisionSchema, { target: 'draft-7' }) as Record<string, unknown>,
    },
  })
  return parseStructured(MemoryDecisionSchema, response.raw)
}

async function defaultJudgeMemoryRelation(
  observation: CreativeMemoryLearningObservation,
  candidates: Array<Pick<CreativeMemoryRecord, 'id' | 'statement' | 'scopeType' | 'status'>>,
) {
  const response = await callResponsesApi({
    promptText: [
      '判断一条新的用户创作偏好与候选偏好的语义关系。只判断偏好对象、属性、方向和适用条件，不按表面共享词语合并。',
      'equivalent 表示可以作为同一偏好累计证据；contradictory 表示相同对象与条件下方向相反；其他情况使用 unrelated。',
      'targetId 只能来自 candidates；unrelated 不填写 targetId。低置信度时选择 unrelated。',
      `observation=${JSON.stringify(observation)}`,
      `candidates=${JSON.stringify(candidates)}`,
      '只输出符合 JSON Schema 的结果。',
    ].join('\n'),
    maxOutputTokens: 300,
    structuredOutput: {
      name: 'creative_memory_relation',
      schema: z.toJSONSchema(MemoryRelationSchema, { target: 'draft-7' }) as Record<string, unknown>,
    },
  })
  return parseStructured(MemoryRelationSchema, response.raw)
}

async function defaultJudgeKnowledgeRelation(
  observation: { statement: string; applicability: string },
  candidates: Array<Pick<CreativeKnowledgeRecord, 'id' | 'statement' | 'applicability' | 'status'>>,
) {
  const response = await callResponsesApi({
    promptText: [
      '判断新提取的创作方法与候选知识是否表达同一种可迁移方法。只有方法、目的和适用条件基本一致时才是 equivalent；共享题材词但方法不同必须是 unrelated。',
      'targetId 只能来自 candidates；unrelated 不填写 targetId。低置信度时选择 unrelated。',
      `observation=${JSON.stringify(observation)}`,
      `candidates=${JSON.stringify(candidates)}`,
      '只输出符合 JSON Schema 的结果。',
    ].join('\n'),
    maxOutputTokens: 300,
    structuredOutput: {
      name: 'creative_knowledge_relation',
      schema: z.toJSONSchema(KnowledgeRelationSchema, { target: 'draft-7' }) as Record<string, unknown>,
    },
  })
  return parseStructured(KnowledgeRelationSchema, response.raw)
}

function receiptStatus(changes: unknown[], errors: string[]) {
  if (!changes.length && !errors.length) return 'skipped' as const
  if (!changes.length) return 'failed' as const
  return errors.length ? 'partial' as const : 'succeeded' as const
}

function sourceExcerptFromUserText(userText: string, excerpt: string): string {
  const sourceExcerpt = excerpt.trim()
  if (!sourceExcerpt || !userText.includes(sourceExcerpt)) {
    throw new Error('Creative learning source excerpt must be copied from the current user text.')
  }
  return sourceExcerpt
}

function eligibleMemoryCandidates(
  rows: CreativeMemoryRecord[],
  scopeType: CreativeMemoryScope,
  draftId?: string,
) {
  return rows.filter((item) => item.scopeType === scopeType
    && (scopeType === 'user' || item.draftId === draftId)
    && item.status !== 'revoked')
}

export async function learnCreativePreferencesFromUserTurn(input: {
  userId: number
  workspaceSessionId: string
  turnId: string
  userText: string
  currentDraftId?: string
  requirementStatements: string[]
  recalledMemories?: CreativeMemoryRecord[]
}, dependencies: CreativeLearningDependencies = {}): Promise<CreativePreferenceLearningReceipt> {
  const changes: CreativePreferenceLearningReceipt['changes'] = []
  const errors: string[] = []
  let recalled = input.recalledMemories
  try {
    if (!recalled) {
      const retrieval = await searchCreativeMemories({
        userId: input.userId,
        draftId: input.currentDraftId,
        query: input.userText,
      })
      recalled = [...retrieval.active, ...retrieval.candidate].map((item) => item.memory)
    }
    const decision = MemoryDecisionSchema.parse(await (dependencies.observeUserTurn ?? defaultObserveUserTurn)({
      userText: input.userText,
      requirementStatements: input.requirementStatements,
      recalledMemories: recalled.map(({ id, statement, scopeType, status }) => ({ id, statement, scopeType, status })),
    }))
    for (const observation of decision.observations) {
      try {
        const sourceExcerpt = sourceExcerptFromUserText(input.userText, observation.sourceExcerpt)
        if (observation.confidence < MIN_OBSERVATION_CONFIDENCE) {
          throw new Error('Creative preference observation confidence is too low to persist.')
        }
        if (observation.scopeType === 'draft' && !input.currentDraftId) {
          throw new Error('Draft-scoped preference observation requires a current draft.')
        }
        const allMemories = await listCreativeMemories({
          userId: input.userId,
          draftId: input.currentDraftId,
          limit: 200,
        })
        const scopeCandidates = eligibleMemoryCandidates(
          allMemories,
          observation.scopeType,
          input.currentDraftId,
        )
        if (observation.kind === 'revocation') {
          if (observation.confidence < DIRECT_ACTIVATION_CONFIDENCE) {
            throw new Error('Creative memory revocation confidence is too low.')
          }
          const target = scopeCandidates.find((item) => item.id === observation.targetMemoryId
            && recalled?.some((candidate) => candidate.id === item.id))
          if (!target) throw new Error('Creative memory revocation target was not recalled in this turn.')
          const recorded = await recordCreativeMemoryObservation({
            userId: input.userId,
            memoryId: target.id,
            scopeType: target.scopeType,
            draftId: target.draftId,
            sourceWorkspaceSessionId: input.workspaceSessionId,
            sourceTurnId: input.turnId,
            kind: observation.kind,
            statement: observation.statement,
            polarity: observation.polarity,
            sourceExcerpt,
            confidence: observation.confidence,
          })
          const revoked = await updateCreativeMemory({ userId: input.userId, id: target.id, status: 'revoked' })
          changes.push({
            memoryId: revoked.id,
            relation: 'revoked',
            observationCreated: recorded.created,
            effectiveStatus: revoked.status,
          })
          continue
        }

        const exact = scopeCandidates.find((item) =>
          normalizeCreativeText(item.statement) === normalizeCreativeText(observation.statement))
        if (exact) {
          const priorEvidence = await listCreativeMemoryObservations({ memoryId: exact.id })
          const priorPolarity = [...priorEvidence].reverse()
            .find((item) => item.kind !== 'revocation')?.polarity
          if (priorPolarity && priorPolarity !== observation.polarity) {
            throw new Error('Creative preference polarity conflicts with the identical stored statement.')
          }
        }
        const related = exact ? undefined : await searchCreativeMemories({
          userId: input.userId,
          draftId: input.currentDraftId,
          query: observation.statement,
        })
        const candidates = exact ? [exact] : eligibleMemoryCandidates(
          [...(related?.active ?? []), ...(related?.candidate ?? [])].map((item) => item.memory),
          observation.scopeType,
          input.currentDraftId,
        )
        const judged = exact
          ? { relation: 'equivalent' as const, targetId: exact.id, confidence: 1 }
          : candidates.length
            ? MemoryRelationSchema.parse(await (dependencies.judgeMemoryRelation ?? defaultJudgeMemoryRelation)(
                observation,
                candidates.map(({ id, statement, scopeType, status }) => ({ id, statement, scopeType, status })),
              ))
            : { relation: 'unrelated' as const, confidence: 1 }
        const trustedTarget = judged.confidence >= RELATION_CONFIDENCE_THRESHOLD && judged.targetId
          ? candidates.find((item) => item.id === judged.targetId)
          : undefined
        const relation = trustedTarget && judged.relation !== 'unrelated' ? judged.relation : 'unrelated'
        const memory = relation === 'equivalent' && trustedTarget
          ? trustedTarget
          : await createCreativeMemory({
              userId: input.userId,
              scopeType: observation.scopeType,
              draftId: observation.scopeType === 'draft' ? input.currentDraftId : undefined,
              statement: observation.statement,
              status: 'candidate',
              origin: observation.kind === 'explicit_preference' ? 'explicit' : 'inferred',
              sourceWorkspaceSessionId: input.workspaceSessionId,
              sourceTurnIds: [input.turnId],
              sourceExcerpt,
              preserveExistingStatus: true,
            })
        const recorded = await recordCreativeMemoryObservation({
          userId: input.userId,
          memoryId: memory.id,
          scopeType: observation.scopeType,
          draftId: observation.scopeType === 'draft' ? input.currentDraftId : undefined,
          sourceWorkspaceSessionId: input.workspaceSessionId,
          sourceTurnId: input.turnId,
          kind: observation.kind,
          statement: observation.statement,
          polarity: observation.polarity,
          sourceExcerpt,
          confidence: observation.confidence,
        })
        const evidence = await listCreativeMemoryObservations({ memoryId: memory.id })
        const revokedAt = memory.revokedAt ? Date.parse(memory.revokedAt) : undefined
        const currentEvidence = revokedAt === undefined
          ? evidence
          : evidence.filter((item) => Date.parse(item.createdAt) > revokedAt)
        const independentWorkspaces = new Set(currentEvidence
          .filter((item) => item.kind !== 'revocation')
          .map((item) => item.sourceWorkspaceSessionId)).size
        const shouldPromote = (observation.kind === 'explicit_preference'
            && observation.confidence >= DIRECT_ACTIVATION_CONFIDENCE)
          || independentWorkspaces >= MIN_INDEPENDENT_PREFERENCE_WORKSPACES
        let contradictedActive = relation === 'contradictory' && trustedTarget?.status === 'active'
          ? trustedTarget
          : undefined
        if (shouldPromote && !contradictedActive && trustedTarget?.status === 'candidate') {
          const promotionRetrieval = related ?? await searchCreativeMemories({
            userId: input.userId,
            draftId: input.currentDraftId,
            query: observation.statement,
          })
          const activeCandidates = eligibleMemoryCandidates(
            promotionRetrieval.active.map((item) => item.memory),
            observation.scopeType,
            input.currentDraftId,
          ).filter((item) => item.id !== memory.id)
          if (activeCandidates.length) {
            const conflict = MemoryRelationSchema.parse(
              await (dependencies.judgeMemoryRelation ?? defaultJudgeMemoryRelation)(
                observation,
                activeCandidates.map(({ id, statement, scopeType, status }) => ({ id, statement, scopeType, status })),
              ),
            )
            contradictedActive = conflict.relation === 'contradictory'
              && conflict.confidence >= RELATION_CONFIDENCE_THRESHOLD
              ? activeCandidates.find((item) => item.id === conflict.targetId)
              : undefined
          }
        }
        let effective = memory
        if (shouldPromote && contradictedActive && memory.status !== 'active') {
          effective = await replaceActiveCreativeMemory({
            userId: input.userId,
            previousId: contradictedActive.id,
            nextId: memory.id,
            previousStatus: contradictedActive.status,
            nextStatus: memory.status,
          })
        } else if (shouldPromote && memory.status !== 'active') {
          effective = await updateCreativeMemory({
            userId: input.userId,
            id: memory.id,
            status: 'active',
            expectedStatus: memory.status,
          })
        } else if (memory.status === 'revoked' && currentEvidence.length > 0) {
          effective = await updateCreativeMemory({
            userId: input.userId,
            id: memory.id,
            status: 'candidate',
            expectedStatus: 'revoked',
          })
        }
        changes.push({
          memoryId: effective.id,
          relation: relation === 'unrelated' ? 'created' : relation,
          observationCreated: recorded.created,
          effectiveStatus: effective.status,
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { status: receiptStatus(changes, errors), changes, errors }
}

export async function learnCreativeKnowledgeFromSample(input: {
  userId: number
  taskId: string
  sampleName?: string
  sourceContentHash: string
  items: Array<{
    statement: string
    applicability: string
    methodIds: string[]
    evidenceRanges: Array<{ start_sec: number; end_sec: number }>
  }>
}, dependencies: CreativeLearningDependencies = {}): Promise<CreativeKnowledgeLearningReceipt> {
  const changes: CreativeKnowledgeLearningReceipt['changes'] = []
  const errors: string[] = []
  for (const item of input.items) {
    try {
      const allKnowledge = await listCreativeKnowledge({ limit: 200 })
      const exact = allKnowledge.find((candidate) =>
        normalizeCreativeText(candidate.statement) === normalizeCreativeText(item.statement)
        && normalizeCreativeText(candidate.applicability) === normalizeCreativeText(item.applicability))
      const ranked = exact ? [] : (await searchCreativeKnowledge({
        query: `${item.statement} ${item.applicability}`,
        statuses: ['active', 'candidate'],
        requireReviewed: false,
      })).items.map((candidate) => candidate.knowledge)
      const candidates = exact ? [exact] : ranked
      const judged = exact
        ? { relation: 'equivalent' as const, targetId: exact.id, confidence: 1 }
        : candidates.length
          ? KnowledgeRelationSchema.parse(await (dependencies.judgeKnowledgeRelation ?? defaultJudgeKnowledgeRelation)(
              item,
              candidates.map(({ id, statement, applicability, status }) => ({ id, statement, applicability, status })),
            ))
          : { relation: 'unrelated' as const, confidence: 1 }
      const equivalent = judged.relation === 'equivalent'
        && judged.confidence >= RELATION_CONFIDENCE_THRESHOLD
        ? candidates.find((candidate) => candidate.id === judged.targetId)
        : undefined
      const source: CreativeKnowledgeSampleSource = {
        type: 'sample',
        taskId: input.taskId,
        contentHash: input.sourceContentHash,
        ...(input.sampleName ? { sampleName: input.sampleName } : {}),
        methodIds: item.methodIds,
        evidenceRanges: item.evidenceRanges,
      }
      const knowledge = equivalent ?? await createCreativeKnowledgeCandidate({
        userId: input.userId,
        statement: item.statement,
        applicability: item.applicability,
        source,
      })
      const recorded = await recordCreativeKnowledgeObservation({
        userId: input.userId,
        knowledgeId: knowledge.id,
        sourceType: 'sample',
        sourceId: input.taskId,
        sourceContentHash: input.sourceContentHash,
        statement: item.statement,
        applicability: item.applicability,
        evidence: { methodIds: item.methodIds, ranges: item.evidenceRanges },
      })
      if (equivalent) await mergeCreativeKnowledgeSource({ id: knowledge.id, source })
      const evidence = await listCreativeKnowledgeObservations({ knowledgeId: knowledge.id })
      const independentSources = new Set(evidence.map((observation) => observation.sourceFingerprint)).size
      const effective = independentSources >= MIN_INDEPENDENT_KNOWLEDGE_SOURCES
        ? await activateCreativeKnowledgeFromEvidence({ id: knowledge.id, observationCount: independentSources })
        : (await getCreativeKnowledgeById(knowledge.id)) ?? knowledge
      changes.push({
        knowledgeId: effective.id,
        relation: equivalent ? 'equivalent' : 'created',
        observationCreated: recorded.created,
        effectiveStatus: effective.status,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { status: receiptStatus(changes, errors), changes, errors }
}
