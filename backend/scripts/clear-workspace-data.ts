import { PrismaClient } from '@prisma/client'
import { readdir, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const prisma = new PrismaClient()

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
  ])

  const uploadsRemoved = await clearDir(path.join(backendRoot, 'uploads'))
  const rendersRemoved = await clearDir(path.join(backendRoot, 'renders'))
  const v2RendersRemoved = await clearDir(path.join(backendRoot, 'v2-renders'))
  const tmpRemoved = await clearDir(path.join(backendRoot, 'tmp'))

  console.log(
    JSON.stringify(
      {
        replication_tasks_deleted: tasks.count,
        user_materials_deleted: materials.count,
        uploads_files_removed: uploadsRemoved,
        renders_entries_removed: rendersRemoved,
        v2_renders_entries_removed: v2RendersRemoved,
        tmp_entries_removed: tmpRemoved,
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
