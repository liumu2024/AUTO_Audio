import { Queue } from 'bullmq'
import { Prisma } from '@prisma/client'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { env } from '../../config/env.js'
import { getBullmqConnection, QUEUE_NAMES } from '../../config/redis.js'
import { prisma } from '../../shared/prisma.service.js'
import type { AnalyzeTaskRequest } from '../../../../shared/types/analyze-request.js'
import type { UserMaterialDto } from '../../../../shared/types/pipeline.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import { analyzeAssetHeuristically } from '../../../../shared/lib/asset-analysis-heuristic.js'
import type { MigrationProtocolV12 } from '../../shared/types.js'
import { TASK_STATUS } from '../../shared/types.js'
import { updateTaskRenderPlan } from '../render-plan/render-plan.service.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'
import { cancelRemotionRender } from '../render-engine/remotion-renderer.service.js'

function isLocalMode(): boolean {
  return process.env.DPL304_LOCAL_MODE === 'true'
}

const analyzerQueue = isLocalMode()
  ? null
  : new Queue(QUEUE_NAMES.ANALYZER, {
      connection: getBullmqConnection(),
    })

const generatorQueue = isLocalMode()
  ? null
  : new Queue(QUEUE_NAMES.GENERATOR, {
      connection: getBullmqConnection(),
    })

function isRemoteOrBrowserUrl(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value) || value.startsWith('/local-assets/')
}

function resolveLocalMaterialPath(value: string): string | null {
  if (!value || isRemoteOrBrowserUrl(value)) return null
  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value)
    } catch {
      return null
    }
  }
  if (path.isAbsolute(value)) return value
  return path.resolve(process.cwd(), value)
}

function safeAssetFileName(material: UserMaterialDto, sourcePath: string): string {
  const ext = path.extname(sourcePath)
  const base = (material.id || path.basename(sourcePath, ext))
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset'
  return `${base}${ext || ''}`
}

async function stageMaterialsForRemotion(
  taskId: string,
  materials: UserMaterialDto[] | undefined,
): Promise<UserMaterialDto[] | undefined> {
  if (!materials?.length) return materials

  const publicAssetDir = path.resolve(
    process.cwd(),
    env.remotionRoot,
    'public',
    'local-assets',
    taskId,
  )
  let hasLocalMaterial = false

  const staged = await Promise.all(
    materials.map(async (material) => {
      const localPath = resolveLocalMaterialPath(material.oss_url)
      if (!localPath) return material

      hasLocalMaterial = true
      await mkdir(publicAssetDir, { recursive: true })
      const fileName = safeAssetFileName(material, localPath)
      const targetPath = path.join(publicAssetDir, fileName)
      await copyFile(localPath, targetPath)

      return {
        ...material,
        oss_url: `/local-assets/${taskId}/${fileName}`,
      }
    }),
  )

  return hasLocalMaterial ? staged : materials
}

function runDetached(taskId: string, label: string, job: () => Promise<void>): void {
  void job().catch((error) => {
    console.error(
      `[local-job] ${label} ${taskId} failed:`,
      error instanceof Error ? error.message : error,
    )
  })
}

async function enqueueAnalyzerJob(data: {
  taskId: string
  videoUrl: string
  sampleVideo?: AnalyzeTaskRequest['sampleVideo']
  referenceMaterials?: AnalyzeTaskRequest['referenceMaterials']
  creativeIntent?: AnalyzeTaskRequest['creativeIntent']
  directorIntent?: AnalyzeTaskRequest['directorIntent']
  globalPrompt?: string
  materials?: AnalyzeTaskRequest['materials']
}): Promise<void> {
  if (!isLocalMode()) {
    await analyzerQueue!.add('analyze', data)
    return
  }

  runDetached(data.taskId, 'analyze', async () => {
    const { processAnalyzerJobData } = await import('../../workers/analyzer.worker.js')
    await processAnalyzerJobData(data)
  })
}

async function enqueueGeneratorJob(data: {
  taskId: string
  prompt?: string
  userId?: number
}): Promise<void> {
  if (!isLocalMode()) {
    await generatorQueue!.add(data.prompt ? 'copilot' : 'generate', data)
    return
  }

  runDetached(data.taskId, 'generate', async () => {
    const { processGeneratorJobData } = await import('../../workers/generator.worker.js')
    await processGeneratorJobData(data, data.prompt ? 'copilot' : 'generate')
  })
}

async function syncUserMaterials(
  userId: number,
  materials: UserMaterialDto[] | undefined,
): Promise<void> {
  if (!materials?.length) return

  for (const m of materials) {
    const analysis =
      m.asset_analysis ??
      analyzeAssetHeuristically({
        id: m.id,
        type: m.material_type,
        name: m.label,
        url: m.oss_url,
        tags: m.ai_tags,
      })
    const aiTags = [...new Set([...(m.ai_tags ?? []), ...analysis.tags])]
    await prisma.userMaterial.upsert({
      where: { id: m.id },
      create: {
        id: m.id,
        userId,
        materialType: m.material_type,
        ossUrl: m.oss_url,
        label: m.label,
        aiTags,
        status: m.status ?? 'READY',
      },
      update: {
        materialType: m.material_type,
        ossUrl: m.oss_url,
        label: m.label,
        aiTags,
        status: m.status ?? 'READY',
      },
    })
  }
}

export async function createAnalyzerTask(
  userId: number,
  input: AnalyzeTaskRequest,
) {
  const taskId = `task_ana_${Date.now()}`
  const videoUrl = input.videoUrl
  const globalPrompt = input.globalPrompt?.trim() || null
  const materials = await stageMaterialsForRemotion(taskId, input.materials)

  await syncUserMaterials(userId, materials)

  await prisma.replicationTask.create({
    data: {
      id: taskId,
      userId,
      sampleVideoUrl: videoUrl,
      globalPrompt,
      taskStatus: TASK_STATUS.QUEUED,
    },
  })

  await enqueueAnalyzerJob({
    taskId,
    videoUrl,
    sampleVideo: input.sampleVideo,
    referenceMaterials: input.referenceMaterials,
    creativeIntent: input.creativeIntent,
    directorIntent: input.directorIntent,
    globalPrompt: globalPrompt ?? undefined,
    materials,
  })

  return { taskId, status: 'queued' as const }
}

export async function createGeneratorTask(
  userId: number,
  taskId: string,
  structureJson: MigrationProtocolV12,
) {
  await prisma.replicationTask.update({
    where: { id: taskId, userId },
    data: {
      structureJson: structureJson as unknown as Prisma.InputJsonValue,
      taskStatus: TASK_STATUS.GENERATING,
    },
  })

  await enqueueGeneratorJob({ taskId, userId })

  return { taskId, status: 'generating' as const }
}

export async function getTaskById(taskId: string) {
  return prisma.replicationTask.findUnique({
    where: { id: taskId },
    include: { user: { select: { id: true, username: true, userIdHash: true } } },
  })
}

export async function deleteTaskForUser(userId: number, taskId: string) {
  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { id: true, userId: true },
  })
  if (!task || task.userId !== userId) {
    throw new Error('Task not found')
  }

  await prisma.replicationTask.delete({ where: { id: taskId } })
  return { taskId, deleted: true as const }
}

async function removeQueuedJobsByTaskId(
  queue: Queue | null,
  taskId: string,
): Promise<number> {
  if (!queue) return 0
  const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])
  let removed = 0
  for (const job of jobs) {
    if ((job.data as { taskId?: string } | undefined)?.taskId !== taskId) continue
    await job.remove()
    removed += 1
  }
  return removed
}

export async function cancelTaskForUser(userId: number, taskId: string) {
  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { id: true, userId: true, taskStatus: true },
  })
  if (!task || task.userId !== userId) {
    throw new Error('Task not found')
  }

  const terminal = new Set<string>([
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ])
  if (terminal.has(task.taskStatus)) {
    return {
      taskId,
      status: task.taskStatus,
      removedJobs: 0,
      alreadyTerminal: true as const,
    }
  }

  await prisma.replicationTask.update({
    where: { id: taskId },
    data: {
      taskStatus: TASK_STATUS.CANCELLED,
      completedAt: new Date(),
    },
  })

  const removedJobs =
    (await removeQueuedJobsByTaskId(analyzerQueue, taskId)) +
    (await removeQueuedJobsByTaskId(generatorQueue, taskId))
  const stoppedRender = cancelRemotionRender(taskId)

  broadcastTaskProgress(taskId, {
    progress: 100,
    stage: 'Cancelled',
    log:
      stoppedRender
        ? 'Task cancelled. Active Remotion render was stopped.'
        : removedJobs > 0
          ? `Task cancelled. Removed ${removedJobs} queued job(s).`
        : 'Task cancellation requested. If a render is already running, it will stop at the next cancellation check.',
  })

  return {
    taskId,
    status: TASK_STATUS.CANCELLED,
    removedJobs,
    stoppedRender,
    alreadyTerminal: false as const,
  }
}

export interface TaskListItem {
  id: string
  title: string
  taskStatus: string
  createdAt: Date
  completedAt: Date | null
  sampleVideoUrl: string
  finalVideoUrl: string | null
  globalPrompt: string | null
  previewUrl: string | null
  hasStructure: boolean
}

function formatTaskTitle(globalPrompt: string | null, createdAt: Date): string {
  const date = createdAt
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const dateLabel = `${y}.${m}.${d}`
  const raw = globalPrompt?.trim()
  if (raw) {
    const short =
      raw.length > 28 ? `${raw.slice(0, 28).trim()}…` : raw
    return `${short} - ${dateLabel}`
  }
  return `未命名复刻项目 - ${dateLabel}`
}

export async function listTasksForUser(
  userId: number,
  limit = 48,
): Promise<TaskListItem[]> {
  const rows = await prisma.replicationTask.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      globalPrompt: true,
      taskStatus: true,
      createdAt: true,
      completedAt: true,
      sampleVideoUrl: true,
      finalVideoUrl: true,
      structureJson: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    title: formatTaskTitle(row.globalPrompt, row.createdAt),
    taskStatus: row.taskStatus,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    sampleVideoUrl: row.sampleVideoUrl,
    finalVideoUrl: row.finalVideoUrl,
    globalPrompt: row.globalPrompt,
    previewUrl: row.finalVideoUrl ?? row.sampleVideoUrl,
    hasStructure: row.structureJson != null,
  }))
}

export async function getLatestTaskForUser(userId: number) {
  const withVideo = await prisma.replicationTask.findFirst({
    where: {
      userId,
      structureJson: { not: Prisma.JsonNull },
      finalVideoUrl: { not: null },
    },
    orderBy: { completedAt: 'desc' },
  })
  if (withVideo) return withVideo

  return prisma.replicationTask.findFirst({
    where: { userId, structureJson: { not: Prisma.JsonNull } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function updateTaskStructure(
  taskId: string,
  structureJson: MigrationProtocolV12,
) {
  return prisma.replicationTask.update({
    where: { id: taskId },
    data: {
      structureJson: structureJson as unknown as Prisma.InputJsonValue,
      taskStatus: TASK_STATUS.WAITING_USER_EDIT,
    },
  })
}

export async function submitCopilotPrompt(
  taskId: string,
  prompt: string,
  renderPlan?: RenderPlanV1,
): Promise<{ taskId: string; status: string }> {
  const task = await prisma.replicationTask.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')

  if (renderPlan) {
    await updateTaskRenderPlan(taskId, {
      ...renderPlan,
      task_id: taskId,
    })
  }

  await enqueueGeneratorJob({ taskId, prompt, userId: task.userId })

  await prisma.replicationTask.update({
    where: { id: taskId },
    data: {
      taskStatus: TASK_STATUS.GENERATING,
      finalVideoUrl: null,
      completedAt: null,
    },
  })

  return { taskId, status: 'generating' }
}
