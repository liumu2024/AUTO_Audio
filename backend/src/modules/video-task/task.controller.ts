import type { Request, Response, NextFunction } from 'express'

import type { AnalyzeTaskRequest } from '../../../../shared/types/analyze-request.js'
import type { UserMaterialDto } from '../../../../shared/types/pipeline.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import type { MigrationProtocolV12 } from '../../shared/types.js'
import {
  createAnalyzerTask,
  cancelTaskForUser,
  deleteTaskForUser,
  getLatestTaskForUser,
  getTaskById,
  listTasksForUser,
  submitCopilotPrompt,
  updateTaskStructure,
} from './task.service.js'

function parseUserId(req: Request): number {
  const raw = req.headers['x-user-id'] ?? req.body?.userId ?? '1'
  return Number(raw)
}

export async function postAnalyzeTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = parseUserId(req)
    const sampleVideo = req.body?.sampleVideo
    const videoUrl = String(
      sampleVideo?.url ?? req.body?.videoUrl ?? req.body?.sampleVideoUrl ?? '',
    )
    if (!videoUrl) {
      res.status(400).json({ error: 'videoUrl is required' })
      return
    }

    const globalPrompt =
      typeof req.body?.globalPrompt === 'string'
        ? req.body.globalPrompt
        : typeof req.body?.prompt === 'string'
          ? req.body.prompt
          : undefined

    const materials = Array.isArray(req.body?.materials)
      ? (req.body.materials as UserMaterialDto[])
      : undefined

    const payload: AnalyzeTaskRequest = {
      videoUrl,
      sampleVideo:
        sampleVideo && typeof sampleVideo.url === 'string'
          ? {
              id: String(sampleVideo.id ?? 'sample_video'),
              name:
                typeof sampleVideo.name === 'string'
                  ? sampleVideo.name
                  : undefined,
              url: videoUrl,
            }
          : undefined,
      referenceMaterials: Array.isArray(req.body?.referenceMaterials)
        ? req.body.referenceMaterials
        : undefined,
      creativeIntent:
        typeof req.body?.creativeIntent === 'object'
          ? req.body.creativeIntent
          : undefined,
      directorIntent:
        typeof req.body?.directorIntent === 'object'
          ? req.body.directorIntent
          : undefined,
      globalPrompt,
      materials,
    }
    const result = await createAnalyzerTask(userId, payload)
    res.status(201).json(result)
  } catch (e) {
    next(e)
  }
}

export async function getTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const taskId = String(req.params.taskId)
    const task = await getTaskById(taskId)
    if (!task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json(task)
  } catch (e) {
    next(e)
  }
}

export async function deleteTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = parseUserId(req)
    const result = await deleteTaskForUser(userId, String(req.params.taskId))
    res.json(result)
  } catch (e) {
    next(e)
  }
}

export async function cancelTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = parseUserId(req)
    const result = await cancelTaskForUser(userId, String(req.params.taskId))
    res.json(result)
  } catch (e) {
    next(e)
  }
}

export async function patchTaskStructure(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const structureJson = req.body?.structureJson as MigrationProtocolV12
    if (!structureJson?.version) {
      res.status(400).json({ error: 'structureJson (v1.2) is required' })
      return
    }
    const task = await updateTaskStructure(String(req.params.taskId), structureJson)
    res.json(task)
  } catch (e) {
    next(e)
  }
}

export async function getTasksList(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = parseUserId(req)
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit) || 48),
    )
    const tasks = await listTasksForUser(userId, limit)
    res.json({
      tasks: tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    })
  } catch (e) {
    next(e)
  }
}

export async function getLatestTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = parseUserId(req)
    const task = await getLatestTaskForUser(userId)
    if (!task) {
      res.status(404).json({ error: 'No task found' })
      return
    }
    res.json(task)
  } catch (e) {
    next(e)
  }
}

export async function postCopilot(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const prompt = String(req.body?.prompt ?? '')
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }
    const renderPlan =
      req.body?.renderPlan?.version === '1.0'
        ? (req.body.renderPlan as RenderPlanV1)
        : undefined
    const result = await submitCopilotPrompt(
      String(req.params.taskId),
      prompt,
      renderPlan,
    )
    res.json(result)
  } catch (e) {
    next(e)
  }
}
