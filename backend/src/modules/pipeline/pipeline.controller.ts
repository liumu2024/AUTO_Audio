import type { Request, Response, NextFunction } from 'express'

import { getPipelineBundle } from './pipeline.service.js'

export async function getTaskPipeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bundle = await getPipelineBundle(String(req.params.taskId))
    if (!bundle) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json(bundle)
  } catch (e) {
    next(e)
  }
}
