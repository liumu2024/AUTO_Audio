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

interface LocalUserMaterial {
  id: string
  userId: number
  materialType: string
  ossUrl: string
  label: string
  aiTags: unknown
  status: string
}

interface LocalReplicationTask {
  id: string
  userId: number
  sampleVideoUrl: string
  globalPrompt: string | null
  structureJson: unknown
  renderPlanJson: unknown
  finalVideoUrl: string | null
  taskStatus: string
  createdAt: string
  completedAt: string | null
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

interface LocalDbState {
  users: LocalUser[]
  userMaterials: LocalUserMaterial[]
  replicationTasks: LocalReplicationTask[]
  v2TimelineDrafts: LocalV2TimelineDraft[]
  v2TimelineRevisions: LocalV2TimelineRevision[]
  v2TimelineRenderRuns: LocalV2TimelineRenderRun[]
  creativeMemories: LocalCreativeMemory[]
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
    userMaterials: [],
    replicationTasks: [],
    v2TimelineDrafts: [],
    v2TimelineRevisions: [],
    v2TimelineRenderRuns: [],
    creativeMemories: [],
  }
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
    creativeMemories: saved.creativeMemories ?? [],
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

function taskOut(task: LocalReplicationTask): Record<string, unknown> {
  return {
    ...clone(task),
    createdAt: new Date(task.createdAt),
    completedAt: ensureDate(task.completedAt),
  }
}

function userOut(user: LocalUser): Record<string, unknown> {
  return {
    ...clone(user),
    createdAt: new Date(user.createdAt),
  }
}

function materialOut(material: LocalUserMaterial): Record<string, unknown> {
  return clone(material) as unknown as Record<string, unknown>
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

function applySelect(
  row: Record<string, unknown> | null,
  select: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!row || !select) return row
  const selected: Record<string, unknown> = {}
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) selected[key] = row[key]
  }
  return selected
}

function attachUser(
  state: LocalDbState,
  row: Record<string, unknown> | null,
  includeUser: unknown,
): Record<string, unknown> | null {
  if (!row || !includeUser) return row
  const user = state.users.find((candidate) => candidate.id === row.userId)
  if (!user) return { ...row, user: null }
  const userRow = userOut(user)
  const include = includeUser as {
    include?: { materials?: boolean }
    select?: Record<string, unknown>
  }
  const materials = state.userMaterials
    .filter((material) => material.userId === user.id)
    .map(materialOut)
  const nextUser = include.select
    ? applySelect(userRow, include.select)
    : {
        ...userRow,
        ...(include.include?.materials ? { materials } : {}),
      }
  return { ...row, user: nextUser }
}

function taskMatchesWhere(
  task: LocalReplicationTask,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true
  if (where.id !== undefined && task.id !== where.id) return false
  if (where.userId !== undefined && task.userId !== where.userId) return false
  const structureJson = where.structureJson as { not?: unknown } | undefined
  if (structureJson?.not !== undefined && task.structureJson == null) return false
  const finalVideoUrl = where.finalVideoUrl as { not?: unknown } | undefined
  if (finalVideoUrl?.not === null && task.finalVideoUrl == null) return false
  if (where.taskStatus !== undefined && task.taskStatus !== where.taskStatus) return false
  return true
}

function sortTasks(
  tasks: LocalReplicationTask[],
  orderBy: Record<string, 'asc' | 'desc'> | undefined,
): LocalReplicationTask[] {
  if (!orderBy) return tasks
  const [field, direction] = Object.entries(orderBy)[0] ?? []
  if (!field) return tasks
  const factor = direction === 'asc' ? 1 : -1
  return [...tasks].sort((left, right) => {
    const a = String((left as unknown as Record<string, unknown>)[field] ?? '')
    const b = String((right as unknown as Record<string, unknown>)[field] ?? '')
    return a.localeCompare(b) * factor
  })
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
    userMaterial: {
      upsert: async (args: {
        where: { id: string }
        create: LocalUserMaterial
        update: Partial<LocalUserMaterial>
      }) =>
        write(() => {
          const index = state.userMaterials.findIndex((item) => item.id === args.where.id)
          if (index >= 0) {
            state.userMaterials[index] = {
              ...state.userMaterials[index]!,
              ...clone(args.update),
            }
            return materialOut(state.userMaterials[index]!)
          }
          state.userMaterials.push(clone(args.create))
          return materialOut(args.create)
        }),
    },
    replicationTask: {
      create: async (args: { data: Partial<LocalReplicationTask> }) =>
        write(() => {
          const task: LocalReplicationTask = {
            id: String(args.data.id),
            userId: Number(args.data.userId),
            sampleVideoUrl: String(args.data.sampleVideoUrl),
            globalPrompt: (args.data.globalPrompt as string | null | undefined) ?? null,
            structureJson: args.data.structureJson ?? null,
            renderPlanJson: args.data.renderPlanJson ?? null,
            finalVideoUrl: (args.data.finalVideoUrl as string | null | undefined) ?? null,
            taskStatus: String(args.data.taskStatus ?? 'QUEUED'),
            createdAt: new Date().toISOString(),
            completedAt: null,
          }
          state.replicationTasks.push(task)
          return taskOut(task)
        }),
      update: async (args: {
        where: Record<string, unknown>
        data: Partial<LocalReplicationTask>
        include?: Record<string, unknown>
        select?: Record<string, unknown>
      }) =>
        write(() => {
          const task = state.replicationTasks.find((item) =>
            taskMatchesWhere(item, args.where),
          )
          if (!task) throw new Error('Task not found')
          const data = args.data as Record<string, unknown>
          Object.assign(task, clone(args.data))
          if (data.completedAt instanceof Date) {
            task.completedAt = data.completedAt.toISOString()
          }
          const row = attachUser(state, taskOut(task), args.include?.user)
          return applySelect(row, args.select)
        }),
      updateMany: async (args: {
        where?: Record<string, unknown>
        data: Partial<LocalReplicationTask>
      }) =>
        write(() => {
          let count = 0
          for (const task of state.replicationTasks) {
            if (!taskMatchesWhere(task, args.where)) continue
            Object.assign(task, clone(args.data))
            count += 1
          }
          return { count }
        }),
      findUnique: async (args: {
        where: Record<string, unknown>
        include?: Record<string, unknown>
        select?: Record<string, unknown>
      }) => {
        const task = state.replicationTasks.find((item) =>
          taskMatchesWhere(item, args.where),
        )
        const row = task ? attachUser(state, taskOut(task), args.include?.user) : null
        return applySelect(row, args.select)
      },
      findFirst: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        const task = sortTasks(
          state.replicationTasks.filter((item) => taskMatchesWhere(item, args.where)),
          args.orderBy,
        )[0]
        return task ? taskOut(task) : null
      },
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        take?: number
        select?: Record<string, unknown>
      }) =>
        sortTasks(
          state.replicationTasks.filter((item) => taskMatchesWhere(item, args.where)),
          args.orderBy,
        )
          .slice(0, args.take ?? undefined)
          .map((task) => applySelect(taskOut(task), args.select)),
      delete: async (args: { where: { id: string } }) =>
        write(() => {
          const index = state.replicationTasks.findIndex((item) => item.id === args.where.id)
          if (index < 0) throw new Error('Task not found')
          const [deleted] = state.replicationTasks.splice(index, 1)
          return taskOut(deleted!)
        }),
    },
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
          const memory: LocalCreativeMemory = {
            id: String(args.data.id),
            userId: Number(args.data.userId),
            scopeType: args.data.scopeType === 'draft' ? 'draft' : 'user',
            draftId: (args.data.draftId as string | null | undefined) ?? null,
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
