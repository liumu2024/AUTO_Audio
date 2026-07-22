import type { Request, Response, NextFunction } from 'express'

import type { MigrationProtocolV12 } from '../../shared/types.js'
import {
  cancelTaskForUser,
  deleteTaskForUser,
  getLatestTaskForUser,
  getTaskById,
  listTasksForUser,
  updateTaskStructure,
} from './task.service.js'

function parseUserId(req: Request): number {
  const raw = req.headers['x-user-id'] ?? req.body?.userId ?? '1'
  return Number(raw)
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
