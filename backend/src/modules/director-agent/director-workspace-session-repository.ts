import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { DirectorWorkspaceState } from './director-workspace-session.js'

export interface DirectorWorkspaceSessionRecord {
  id: string
  userId: number
  state: DirectorWorkspaceState
  createdAt: string
  updatedAt: string
}

interface StoredSessions {
  sessions: DirectorWorkspaceSessionRecord[]
}

function storagePath(): string {
  return path.resolve(
    process.cwd(),
    process.env.V2_DIRECTOR_SESSION_DIR ??
      path.join(process.env.DPL304_LOCAL_DATA_DIR ?? 'data', 'v2-director-sessions'),
    'sessions.json',
  )
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Director discussion is V2 application state but exists before a draft does.
 * Keep it in an isolated server-side store instead of reusing V1 task tables
 * or letting browser defaults become the source of truth.
 */
export function createDirectorWorkspaceSessionRepository() {
  let queue = Promise.resolve()

  async function readAll(): Promise<StoredSessions> {
    try {
      const raw = await readFile(storagePath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredSessions>
      return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: [] }
      throw error
    }
  }

  async function writeAll(value: StoredSessions): Promise<void> {
    const file = storagePath()
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }

  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    get: async (id: string, userId: number): Promise<DirectorWorkspaceSessionRecord | null> => {
      const data = await readAll()
      const found = data.sessions.find((item) => item.id === id && item.userId === userId)
      return found ? clone(found) : null
    },
    save: async (input: {
      id: string
      userId: number
      state: DirectorWorkspaceState
    }): Promise<DirectorWorkspaceSessionRecord> =>
      locked(async () => {
        const data = await readAll()
        const now = new Date().toISOString()
        const index = data.sessions.findIndex(
          (item) => item.id === input.id && item.userId === input.userId,
        )
        const next: DirectorWorkspaceSessionRecord = {
          id: input.id,
          userId: input.userId,
          state: clone(input.state),
          createdAt: index >= 0 ? data.sessions[index]!.createdAt : now,
          updatedAt: now,
        }
        if (index >= 0) data.sessions[index] = next
        else data.sessions.push(next)
        await writeAll(data)
        return clone(next)
      }),
  }
}
