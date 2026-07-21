import { Queue } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { readdir, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBullmqConnection, QUEUE_NAMES } from '../src/config/redis.js'

const prisma = new PrismaClient()

async function drainBullmqQueues(): Promise<Record<string, string>> {
  const connection = getBullmqConnection()
  const drained: Record<string, string> = {}
  for (const name of Object.values(QUEUE_NAMES)) {
    const queue = new Queue(name, { connection })
    await queue.obliterate({ force: true })
    await queue.close()
    drained[name] = 'obliterated'
  }
  return drained
}
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function clearDir(dir: string): Promise<number> {
  let removed = 0
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const full = path.join(dir, entry)
      const info = await stat(full)
      if (info.isDirectory()) {
        await rm(full, { recursive: true, force: true })
      } else {
        await unlink(full)
      }
      removed += 1
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return removed
}

async function main(): Promise<void> {
  const [tasks, materials] = await Promise.all([
    prisma.replicationTask.deleteMany(),
    prisma.userMaterial.deleteMany(),
  ])

  const uploadsRemoved = await clearDir(path.join(backendRoot, 'uploads'))
  const rendersRemoved = await clearDir(path.join(backendRoot, 'renders'))
  const bullmq = await drainBullmqQueues()

  console.log(
    JSON.stringify(
      {
        replication_tasks_deleted: tasks.count,
        user_materials_deleted: materials.count,
        uploads_files_removed: uploadsRemoved,
        renders_entries_removed: rendersRemoved,
        bullmq,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
