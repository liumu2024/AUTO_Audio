import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface LocalUser {
  id: number
  userIdHash: string
  username: string
  concurrentLimit: number
  availableCredits: number
  createdAt: string
}

interface LocalV2TimelineDraft {
  id: string
  userId: number
  revision: number
  creationMode: string
  plannerInputJson: unknown
  specJson: unknown
  plannerSource: string | null
  reviewJson: unknown
  traceDir: string | null
  createdAt: string
  updatedAt: string
}

interface LocalV2TimelineRevision {
  id: string
  draftId: string
  revision: number
  kind: string
  specJson: unknown
  plannerSource: string | null
  reviewJson: unknown
  traceDir: string | null
  createdAt: string
}

interface LocalV2TimelineRenderRun {
  id: string
  draftId: string
  sourceRevision: number
  sourceSpecJson: unknown
  resolvedSpecJson: unknown
  status: string
  outputPath: string | null
  outputUrl: string | null
  traceDir: string | null
  materialResolutionJson: unknown
  evaluationJson: unknown
  createdAt: string
  completedAt: string | null
}

interface LocalCreativeMemory {
  id: string
  userId: number
  scopeType: 'user' | 'draft'
  draftId: string | null
  scopeKey: string
  semanticKey: string
  statement: string
  status: 'active' | 'candidate' | 'revoked'
  origin: 'explicit' | 'inferred'
  sourceWorkspaceSessionId: string | null
  sourceTurnIdsJson: unknown
  sourceExcerpt: string | null
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

interface LocalCreativeKnowledge {
  id: string
  statement: string
  applicability: string
  status: 'active' | 'candidate' | 'revoked'
  semanticKey: string
  sourcesJson: unknown
  createdByUserId: number | null
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

interface LocalV2IdempotencyReceipt {
  id: string
  userId: number
  draftId: string | null
  operation: string
  idempotencyKey: string
  resourceKey: string
  requestHash: string
  status: 'running' | 'completed' | 'failed'
  phase: string | null
  resultRef: string | null
  resultJson: unknown
  providerTaskId: string | null
  failureJson: unknown
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

interface LocalDbState {
  users: LocalUser[]
  v2TimelineDrafts: LocalV2TimelineDraft[]
  v2TimelineRevisions: LocalV2TimelineRevision[]
  v2TimelineRenderRuns: LocalV2TimelineRenderRun[]
  creativeMemories: LocalCreativeMemory[]
  creativeKnowledge: LocalCreativeKnowledge[]
  v2IdempotencyReceipts: LocalV2IdempotencyReceipt[]
}

function localDataDir(): string {
  return path.resolve(
    process.env.DPL304_LOCAL_DATA_DIR ??
      path.join(process.cwd(), 'tmp', 'desktop-local-data'),
  )
}

function dbPath(): string {
  return path.join(localDataDir(), 'db.json')
}

function defaultState(): LocalDbState {
  return {
    users: [
      {
        id: 1,
        userIdHash: 'desktop_user_hash',
        username: 'desktop',
        concurrentLimit: 2,
        availableCredits: 100,
        createdAt: new Date().toISOString(),
      },
    ],
    v2TimelineDrafts: [],
    v2TimelineRevisions: [],
    v2TimelineRenderRuns: [],
    creativeMemories: [],
    creativeKnowledge: [],
    v2IdempotencyReceipts: [],
  }
}

function localMemoryScopeKey(memory: Pick<LocalCreativeMemory, 'scopeType' | 'draftId'>): string {
  return memory.scopeType === 'draft' ? `draft:${memory.draftId}` : 'user'
}

function localMemorySemanticKey(statement: string): string {
  return createHash('md5')
    .update(statement.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
}

function loadState(): LocalDbState {
  const filePath = dbPath()
  if (!existsSync(filePath)) {
    const state = defaultState()
    saveState(state)
    return state
  }
  const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LocalDbState>
  const defaults = defaultState()
  return {
    ...defaults,
    ...saved,
    v2TimelineDrafts: saved.v2TimelineDrafts ?? [],
    v2TimelineRevisions: saved.v2TimelineRevisions ?? [],
    v2TimelineRenderRuns: saved.v2TimelineRenderRuns ?? [],
    creativeMemories: (saved.creativeMemories ?? []).map((memory) => ({
      ...memory,
      scopeKey: memory.scopeKey || localMemoryScopeKey(memory),
      semanticKey: memory.semanticKey || localMemorySemanticKey(memory.statement),
    })),
    creativeKnowledge: saved.creativeKnowledge ?? [],
    v2IdempotencyReceipts: saved.v2IdempotencyReceipts ?? [],
  }
}

function saveState(state: LocalDbState): void {
  mkdirSync(localDataDir(), { recursive: true })
  writeFileSync(dbPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function ensureDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function v2DraftOut(draft: LocalV2TimelineDraft): Record<string, unknown> {
  return {
    ...clone(draft),
    createdAt: new Date(draft.createdAt),
    updatedAt: new Date(draft.updatedAt),
  }
}

function v2RevisionOut(revision: LocalV2TimelineRevision): Record<string, unknown> {
  return {
    ...clone(revision),
    createdAt: new Date(revision.createdAt),
  }
}

function v2RenderRunOut(run: LocalV2TimelineRenderRun): Record<string, unknown> {
  return {
    ...clone(run),
    createdAt: new Date(run.createdAt),
    completedAt: ensureDate(run.completedAt),
  }
}

function creativeMemoryOut(memory: LocalCreativeMemory): Record<string, unknown> {
  return {
    ...clone(memory),
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.updatedAt),
    revokedAt: ensureDate(memory.revokedAt),
  }
}

function creativeKnowledgeOut(knowledge: LocalCreativeKnowledge): Record<string, unknown> {
  return {
    ...clone(knowledge),
    createdAt: new Date(knowledge.createdAt),
    updatedAt: new Date(knowledge.updatedAt),
    revokedAt: ensureDate(knowledge.revokedAt),
  }
}

function idempotencyReceiptOut(receipt: LocalV2IdempotencyReceipt): Record<string, unknown> {
  return {
    ...clone(receipt),
    createdAt: new Date(receipt.createdAt),
    updatedAt: new Date(receipt.updatedAt),
    completedAt: ensureDate(receipt.completedAt),
  }
}

function makeLocalPrisma() {
  let state = loadState()
  let writeLock = Promise.resolve()

  async function write<T>(fn: () => T): Promise<T> {
    const next = writeLock.then(() => {
      const result = fn()
      saveState(state)
      return result
    })
    writeLock = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    v2TimelineDraft: {
      create: async (args: { data: Partial<LocalV2TimelineDraft> }) =>
        write(() => {
          const now = new Date().toISOString()
          const draft: LocalV2TimelineDraft = {
            id: String(args.data.id),
            userId: Number(args.data.userId),
            revision: Number(args.data.revision ?? 1),
            creationMode: String(args.data.creationMode),
            plannerInputJson: args.data.plannerInputJson ?? null,
            specJson: args.data.specJson ?? null,
            plannerSource: (args.data.plannerSource as string | null | undefined) ?? null,
            reviewJson: args.data.reviewJson ?? null,
            traceDir: (args.data.traceDir as string | null | undefined) ?? null,
            createdAt: now,
            updatedAt: now,
          }
          if (state.v2TimelineDrafts.some((item) => item.id === draft.id)) {
            throw new Error('V2 timeline draft already exists')
          }
          state.v2TimelineDrafts.push(draft)
          return v2DraftOut(draft)
        }),
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const draft = state.v2TimelineDrafts.find((item) =>
          Object.entries(args.where ?? {}).every(([key, value]) => item[key as keyof LocalV2TimelineDraft] === value),
        )
        return draft ? v2DraftOut(draft) : null
      },
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        take?: number
      }) => {
        const drafts = state.v2TimelineDrafts.filter((item) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => item[key as keyof LocalV2TimelineDraft] === value,
          ),
        )
        const [field, direction] = Object.entries(args.orderBy ?? {})[0] ?? []
        if (field) {
          const factor = direction === 'asc' ? 1 : -1
          drafts.sort((left, right) =>
            String(left[field as keyof LocalV2TimelineDraft] ?? '').localeCompare(
              String(right[field as keyof LocalV2TimelineDraft] ?? ''),
            ) * factor,
          )
        }
        return drafts
          .slice(0, args.take ?? undefined)
          .map((draft) => v2DraftOut(draft))
      },
      updateMany: async (args: {
        where: Record<string, unknown>
        data: Partial<LocalV2TimelineDraft>
      }) =>
        write(() => {
          let count = 0
          for (const draft of state.v2TimelineDrafts) {
            const matches = Object.entries(args.where).every(
              ([key, value]) => draft[key as keyof LocalV2TimelineDraft] === value,
            )
            if (!matches) continue
            Object.assign(draft, clone(args.data), { updatedAt: new Date().toISOString() })
            count += 1
          }
          return { count }
        }),
      deleteMany: async (args: { where: Record<string, unknown> }) =>
        write(() => {
          const deletedIds = new Set(
            state.v2TimelineDrafts
              .filter((draft) =>
                Object.entries(args.where).every(
                  ([key, value]) => draft[key as keyof LocalV2TimelineDraft] === value,
                ),
              )
              .map((draft) => draft.id),
          )
          state.v2TimelineDrafts = state.v2TimelineDrafts.filter(
            (draft) => !deletedIds.has(draft.id),
          )
          state.v2TimelineRevisions = state.v2TimelineRevisions.filter(
            (revision) => !deletedIds.has(revision.draftId),
          )
          state.v2TimelineRenderRuns = state.v2TimelineRenderRuns.filter(
            (run) => !deletedIds.has(run.draftId),
          )
          state.creativeMemories = state.creativeMemories.filter(
            (memory) => !memory.draftId || !deletedIds.has(memory.draftId),
          )
          state.v2IdempotencyReceipts = state.v2IdempotencyReceipts.filter(
            (receipt) => receipt.draftId === null || !deletedIds.has(receipt.draftId),
          )
          return { count: deletedIds.size }
        }),
    },
    v2TimelineRevision: {
      create: async (args: { data: Partial<LocalV2TimelineRevision> }) =>
        write(() => {
          const revision: LocalV2TimelineRevision = {
            id: String(args.data.id),
            draftId: String(args.data.draftId),
            revision: Number(args.data.revision),
            kind: String(args.data.kind),
            specJson: args.data.specJson ?? null,
            plannerSource: (args.data.plannerSource as string | null | undefined) ?? null,
            reviewJson: args.data.reviewJson ?? null,
            traceDir: (args.data.traceDir as string | null | undefined) ?? null,
            createdAt: new Date().toISOString(),
          }
          if (
            state.v2TimelineRevisions.some(
              (item) => item.draftId === revision.draftId && item.revision === revision.revision,
            )
          ) {
            throw new Error('V2 timeline revision already exists')
          }
          state.v2TimelineRevisions.push(revision)
          return v2RevisionOut(revision)
        }),
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const revision = state.v2TimelineRevisions.find((item) =>
          Object.entries(args.where ?? {}).every(([key, value]) => item[key as keyof LocalV2TimelineRevision] === value),
        )
        return revision ? v2RevisionOut(revision) : null
      },
    },
    creativeMemory: {
      create: async (args: { data: Partial<LocalCreativeMemory> }) =>
        write(() => {
          const now = new Date().toISOString()
          const scopeType = args.data.scopeType === 'draft' ? 'draft' : 'user'
          const draftId = (args.data.draftId as string | null | undefined) ?? null
          const scopeKey = String(args.data.scopeKey ?? localMemoryScopeKey({ scopeType, draftId }))
          const semanticKey = String(
            args.data.semanticKey ?? localMemorySemanticKey(String(args.data.statement)),
          )
          if (state.creativeMemories.some((item) =>
            item.userId === Number(args.data.userId)
            && item.scopeKey === scopeKey
            && item.semanticKey === semanticKey)) {
            throw new Error('Creative memory semantic identity already exists')
          }
          const memory: LocalCreativeMemory = {
            id: String(args.data.id),
            userId: Number(args.data.userId),
            scopeType,
            draftId,
            scopeKey,
            semanticKey,
            statement: String(args.data.statement),
            status: (args.data.status as LocalCreativeMemory['status']) ?? 'active',
            origin: (args.data.origin as LocalCreativeMemory['origin']) ?? 'explicit',
            sourceWorkspaceSessionId:
              (args.data.sourceWorkspaceSessionId as string | null | undefined) ?? null,
            sourceTurnIdsJson: args.data.sourceTurnIdsJson ?? [],
            sourceExcerpt: (args.data.sourceExcerpt as string | null | undefined) ?? null,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          }
          state.creativeMemories.push(memory)
          return creativeMemoryOut(memory)
        }),
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        take?: number
      }) => {
        const memories = state.creativeMemories.filter((memory) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => memory[key as keyof LocalCreativeMemory] === value,
          ),
        )
        const [field, direction] = Object.entries(args.orderBy ?? {})[0] ?? []
        if (field) {
          const factor = direction === 'asc' ? 1 : -1
          memories.sort((left, right) =>
            String(left[field as keyof LocalCreativeMemory] ?? '').localeCompare(
              String(right[field as keyof LocalCreativeMemory] ?? ''),
            ) * factor,
          )
        }
        return memories.slice(0, args.take ?? undefined).map(creativeMemoryOut)
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const memory = state.creativeMemories.find((item) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => item[key as keyof LocalCreativeMemory] === value,
          ),
        )
        return memory ? creativeMemoryOut(memory) : null
      },
      updateMany: async (args: {
        where: Record<string, unknown>
        data: Partial<LocalCreativeMemory>
      }) =>
        write(() => {
          let count = 0
          for (const memory of state.creativeMemories) {
            if (!Object.entries(args.where).every(
              ([key, value]) => memory[key as keyof LocalCreativeMemory] === value,
            )) continue
            const rawRevokedAt = (args.data as unknown as Record<string, unknown>).revokedAt
            const data = clone(args.data) as Partial<LocalCreativeMemory>
            if (data.semanticKey && state.creativeMemories.some((item) =>
              item.id !== memory.id
              && item.userId === memory.userId
              && item.scopeKey === memory.scopeKey
              && item.semanticKey === data.semanticKey)) {
              throw new Error('Creative memory semantic identity already exists')
            }
            Object.assign(memory, data, { updatedAt: new Date().toISOString() })
            if (rawRevokedAt instanceof Date) {
              memory.revokedAt = rawRevokedAt.toISOString()
            }
            count += 1
          }
          return { count }
        }),
      deleteMany: async (args: { where: Record<string, unknown> }) =>
        write(() => {
          const before = state.creativeMemories.length
          state.creativeMemories = state.creativeMemories.filter((memory) =>
            !Object.entries(args.where).every(
              ([key, value]) => memory[key as keyof LocalCreativeMemory] === value,
            ),
          )
          return { count: before - state.creativeMemories.length }
        }),
    },
    creativeKnowledge: {
      create: async (args: { data: Partial<LocalCreativeKnowledge> }) =>
        write(() => {
          const semanticKey = String(args.data.semanticKey)
          if (state.creativeKnowledge.some((item) => item.semanticKey === semanticKey)) {
            throw new Error('Creative knowledge semantic identity already exists')
          }
          const now = new Date().toISOString()
          const knowledge: LocalCreativeKnowledge = {
            id: String(args.data.id),
            statement: String(args.data.statement),
            applicability: String(args.data.applicability),
            status: (args.data.status as LocalCreativeKnowledge['status']) ?? 'candidate',
            semanticKey,
            sourcesJson: args.data.sourcesJson ?? [],
            createdByUserId: args.data.createdByUserId == null ? null : Number(args.data.createdByUserId),
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          }
          state.creativeKnowledge.push(knowledge)
          return creativeKnowledgeOut(knowledge)
        }),
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        take?: number
      }) => {
        const rows = state.creativeKnowledge.filter((knowledge) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => knowledge[key as keyof LocalCreativeKnowledge] === value,
          ),
        )
        const [field, direction] = Object.entries(args.orderBy ?? {})[0] ?? []
        if (field) {
          const factor = direction === 'asc' ? 1 : -1
          rows.sort((left, right) => String(left[field as keyof LocalCreativeKnowledge] ?? '')
            .localeCompare(String(right[field as keyof LocalCreativeKnowledge] ?? '')) * factor)
        }
        return rows.slice(0, args.take ?? undefined).map(creativeKnowledgeOut)
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const row = state.creativeKnowledge.find((knowledge) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => knowledge[key as keyof LocalCreativeKnowledge] === value,
          ),
        )
        return row ? creativeKnowledgeOut(row) : null
      },
      updateMany: async (args: {
        where: Record<string, unknown>
        data: Partial<LocalCreativeKnowledge>
      }) => write(() => {
        let count = 0
        for (const knowledge of state.creativeKnowledge) {
          if (!Object.entries(args.where).every(
            ([key, value]) => knowledge[key as keyof LocalCreativeKnowledge] === value,
          )) continue
          if (args.data.semanticKey && state.creativeKnowledge.some((item) =>
            item.id !== knowledge.id && item.semanticKey === args.data.semanticKey)) {
            throw new Error('Creative knowledge semantic identity already exists')
          }
          const rawRevokedAt = (args.data as unknown as Record<string, unknown>).revokedAt
          Object.assign(knowledge, clone(args.data), { updatedAt: new Date().toISOString() })
          if (rawRevokedAt instanceof Date) knowledge.revokedAt = rawRevokedAt.toISOString()
          count += 1
        }
        return { count }
      }),
      deleteMany: async (args: { where: Record<string, unknown> }) => write(() => {
        const before = state.creativeKnowledge.length
        state.creativeKnowledge = state.creativeKnowledge.filter((knowledge) =>
          !Object.entries(args.where).every(
            ([key, value]) => knowledge[key as keyof LocalCreativeKnowledge] === value,
          ),
        )
        return { count: before - state.creativeKnowledge.length }
      }),
    },
    v2IdempotencyReceipt: {
      create: async (args: { data: Partial<LocalV2IdempotencyReceipt> }) =>
        write(() => {
          const duplicate = state.v2IdempotencyReceipts.some((receipt) =>
            receipt.userId === Number(args.data.userId)
            && receipt.operation === String(args.data.operation)
            && receipt.idempotencyKey === String(args.data.idempotencyKey))
          if (duplicate) throw new Error('V2 idempotency receipt already exists')
          const now = new Date().toISOString()
          const receipt: LocalV2IdempotencyReceipt = {
            id: String(args.data.id),
            userId: Number(args.data.userId),
            draftId: args.data.draftId == null ? null : String(args.data.draftId),
            operation: String(args.data.operation),
            idempotencyKey: String(args.data.idempotencyKey),
            resourceKey: String(args.data.resourceKey),
            requestHash: String(args.data.requestHash),
            status: (args.data.status as LocalV2IdempotencyReceipt['status']) ?? 'running',
            phase: (args.data.phase as string | null | undefined) ?? null,
            resultRef: (args.data.resultRef as string | null | undefined) ?? null,
            resultJson: args.data.resultJson ?? null,
            providerTaskId: (args.data.providerTaskId as string | null | undefined) ?? null,
            failureJson: args.data.failureJson ?? null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          }
          state.v2IdempotencyReceipts.push(receipt)
          return idempotencyReceiptOut(receipt)
        }),
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const receipt = state.v2IdempotencyReceipts.find((item) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => item[key as keyof LocalV2IdempotencyReceipt] === value,
          ))
        return receipt ? idempotencyReceiptOut(receipt) : null
      },
      update: async (args: { where: Record<string, unknown>; data: Partial<LocalV2IdempotencyReceipt> }) =>
        write(() => {
          const receipt = state.v2IdempotencyReceipts.find((item) => item.id === args.where.id)
          if (!receipt) throw new Error('V2 idempotency receipt not found')
          const data = args.data as Record<string, unknown>
          Object.assign(receipt, clone(args.data), { updatedAt: new Date().toISOString() })
          if (data.completedAt instanceof Date) receipt.completedAt = data.completedAt.toISOString()
          return idempotencyReceiptOut(receipt)
        }),
    },
    v2TimelineRenderRun: {
      create: async (args: { data: Partial<LocalV2TimelineRenderRun> }) =>
        write(() => {
          const run: LocalV2TimelineRenderRun = {
            id: String(args.data.id),
            draftId: String(args.data.draftId),
            sourceRevision: Number(args.data.sourceRevision),
            sourceSpecJson: args.data.sourceSpecJson ?? null,
            resolvedSpecJson: args.data.resolvedSpecJson ?? null,
            status: String(args.data.status ?? 'running'),
            outputPath: (args.data.outputPath as string | null | undefined) ?? null,
            outputUrl: (args.data.outputUrl as string | null | undefined) ?? null,
            traceDir: (args.data.traceDir as string | null | undefined) ?? null,
            materialResolutionJson: args.data.materialResolutionJson ?? null,
            evaluationJson: args.data.evaluationJson ?? null,
            createdAt: new Date().toISOString(),
            completedAt: null,
          }
          state.v2TimelineRenderRuns.push(run)
          return v2RenderRunOut(run)
        }),
      update: async (args: {
        where: Record<string, unknown>
        data: Partial<LocalV2TimelineRenderRun>
      }) =>
        write(() => {
          const run = state.v2TimelineRenderRuns.find((item) => item.id === args.where.id)
          if (!run) throw new Error('V2 timeline render run not found')
          const data = args.data as Record<string, unknown>
          Object.assign(run, clone(args.data))
          if (data.completedAt instanceof Date) run.completedAt = data.completedAt.toISOString()
          return v2RenderRunOut(run)
        }),
      findFirst: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        const runs = state.v2TimelineRenderRuns.filter((run) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => run[key as keyof LocalV2TimelineRenderRun] === value,
          ),
        )
        const [field, direction] = Object.entries(args.orderBy ?? {})[0] ?? []
        if (field) {
          const factor = direction === 'asc' ? 1 : -1
          runs.sort((left, right) =>
            String(left[field as keyof LocalV2TimelineRenderRun] ?? '').localeCompare(
              String(right[field as keyof LocalV2TimelineRenderRun] ?? ''),
            ) * factor,
          )
        }
        return runs[0] ? v2RenderRunOut(runs[0]) : null
      },
    },
    $disconnect: async () => undefined,
  }
}

export const localPrisma = makeLocalPrisma()
