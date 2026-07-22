import { Prisma } from '@prisma/client'

import { prisma } from '../../shared/prisma.service.js'
import type { MigrationProtocolV12 } from '../../shared/types.js'
import { TASK_STATUS } from '../../shared/types.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'
import { cancelRemotionRender } from '../render-engine/remotion-renderer.service.js'

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

  const removedJobs = 0
  const stoppedRender = cancelRemotionRender(taskId)

  broadcastTaskProgress(taskId, {
    progress: 100,
    stage: 'Cancelled',
    log:
      stoppedRender
        ? 'Task cancelled. Active Remotion render was stopped.'
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
