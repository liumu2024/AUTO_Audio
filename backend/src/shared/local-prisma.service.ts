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

interface LocalDbState {
  users: LocalUser[]
  userMaterials: LocalUserMaterial[]
  replicationTasks: LocalReplicationTask[]
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
  }
}

function loadState(): LocalDbState {
  const filePath = dbPath()
  if (!existsSync(filePath)) {
    const state = defaultState()
    saveState(state)
    return state
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as LocalDbState
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
    $disconnect: async () => undefined,
  }
}

export const localPrisma = makeLocalPrisma()
