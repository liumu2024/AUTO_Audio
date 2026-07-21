import type { NextFunction, Request, Response } from 'express'

import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import {
  getTaskRenderPlan,
  updateTaskRenderPlan,
} from './render-plan.service.js'

export async function getRenderPlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const renderPlan = await getTaskRenderPlan(String(req.params.taskId))
    if (!renderPlan) {
      res.status(404).json({ error: 'Render plan not found' })
      return
    }
    res.json({ renderPlan })
  } catch (e) {
    next(e)
  }
}

export async function patchRenderPlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const renderPlan = req.body?.renderPlan as RenderPlanV1 | undefined
    if (renderPlan?.version !== '1.0' || !Array.isArray(renderPlan.scenes)) {
      res.status(400).json({ error: 'renderPlan v1.0 is required' })
      return
    }
    const updated = await updateTaskRenderPlan(
      String(req.params.taskId),
      renderPlan,
    )
    res.json({ renderPlan: updated })
  } catch (e) {
    next(e)
  }
}
