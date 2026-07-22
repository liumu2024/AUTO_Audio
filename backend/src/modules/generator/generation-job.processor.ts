import { prisma } from '../../shared/prisma.service.js'
import { TASK_STATUS } from '../../shared/types.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'
import {
  getTaskRenderPlan,
  prepareRenderPlanForRender,
} from '../render-plan/render-plan.service.js'
import { remotionVideoGenerator } from './remotion-generator.service.js'
import type { GenerateOutput } from './generator.port.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'

export interface GenerationJobData {
  taskId: string
  userId?: number
  prompt?: string
}

export interface GenerationJobOptions {
  mode?: 'remotion'
}

function patchGeneratedVideo(
  structure: MigrationProtocolV12,
  output: GenerateOutput,
): MigrationProtocolV12 {
  return {
    ...structure,
    generated_video: {
      url: output.finalVideoUrl,
      duration: output.durationSec || structure.metadata.duration_sec,
    },
  }
}

function taskNotFoundError(taskId: string): Error {
  return new Error(
    `ReplicationTask ${taskId} not found. The DB may have been cleared while a legacy generator job still existed.`,
  )
}

function isCancelledStatus(status: string | null | undefined): boolean {
  return status === TASK_STATUS.CANCELLED || status === TASK_STATUS.CANCELLING
}

async function throwIfCancelled(taskId: string): Promise<void> {
  const current = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { taskStatus: true },
  })
  if (isCancelledStatus(current?.taskStatus)) {
    broadcastTaskProgress(taskId, {
      progress: 100,
      stage: 'Cancelled',
      log: 'Generation task was cancelled by user.',
    })
    throw new Error(`Task ${taskId} was cancelled.`)
  }
}

export async function processGenerationJob(
  data: GenerationJobData,
  _options: GenerationJobOptions = {},
): Promise<GenerateOutput> {
  const { taskId, prompt } = data

  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
  })
  if (!task) {
    console.warn(`[generation] ${taskId} skipped: task not in database`)
    broadcastTaskProgress(taskId, {
      progress: 100,
      stage: 'Failed',
      log: `Task ${taskId} not found. Re-analyze or clear stale generator queue jobs.`,
    })
    throw taskNotFoundError(taskId)
  }

  if (isCancelledStatus(task.taskStatus)) {
    throw new Error(`Task ${taskId} was cancelled.`)
  }

  await prisma.replicationTask.update({
    where: { id: taskId },
    data: { taskStatus: TASK_STATUS.GENERATING },
  })

  broadcastTaskProgress(taskId, {
    progress: 8,
    stage: 'Generating',
    log: 'Preparing render inputs...',
  })

  try {
    const structure = task.structureJson as MigrationProtocolV12 | null

    if (!structure) {
      throw new Error('structureJson is required for video generation')
    }

    const storedRenderPlan = await getTaskRenderPlan(taskId)

    broadcastTaskProgress(taskId, {
      progress: 18,
      stage: 'Generating',
      log: 'Selected Remotion generator.',
    })

    if (!storedRenderPlan) {
      throw new Error('renderPlan is required for Remotion generation')
    }

    const renderPlan = await prepareRenderPlanForRender(taskId, storedRenderPlan)

    broadcastTaskProgress(taskId, {
      progress: 22,
      stage: 'Generating',
      log: `Using RenderPlan revision ${renderPlan.plan_revision ?? 1}.`,
    })

    const output = await remotionVideoGenerator.generate({
      taskId,
      prompt,
      structure,
      renderPlan,
      sampleVideoUrl: task.sampleVideoUrl,
    })

    await throwIfCancelled(taskId)

    const nextStructure = patchGeneratedVideo(structure, output)

    await prisma.replicationTask.update({
      where: { id: taskId },
      data: {
        taskStatus: TASK_STATUS.COMPLETED,
        finalVideoUrl: output.finalVideoUrl,
        structureJson: nextStructure as object,
        completedAt: new Date(),
      },
    })

    broadcastTaskProgress(taskId, {
      progress: 100,
      stage: 'Completed',
      log: `Generated video ready: ${output.finalVideoUrl}`,
    })

    return output
  } catch (error) {
    const current = await prisma.replicationTask.findUnique({
      where: { id: taskId },
      select: { taskStatus: true },
    })
    if (!isCancelledStatus(current?.taskStatus)) {
      await prisma.replicationTask.updateMany({
        where: { id: taskId },
        data: { taskStatus: TASK_STATUS.FAILED },
      })
    }
    broadcastTaskProgress(taskId, {
      progress: 100,
      stage: isCancelledStatus(current?.taskStatus) ? 'Cancelled' : 'Failed',
      log: isCancelledStatus(current?.taskStatus)
        ? 'Generation task was cancelled by user.'
        : error instanceof Error
          ? error.message
          : String(error),
    })
    throw error
  }
}
