import type { Request, Response } from 'express'
import path from 'node:path'

import { previewV2RemotionTimeline, runV2RemotionTimeline } from './remotion-timeline-service.js'

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function plannerModeValue(value: unknown): 'deterministic' | 'llm' | undefined {
  if (value === 'deterministic' || value === 'llm') return value
  return undefined
}

export async function postV2TimelinePreview(req: Request, res: Response): Promise<void> {
  const taskId = stringValue(req.body?.taskId, `v2_timeline_preview_${Date.now()}`)
  const mainVideoPath = stringValue(req.body?.mainVideoPath)
  if (!mainVideoPath) {
    res.status(400).json({ error: 'mainVideoPath is required.' })
    return
  }

  const result = await previewV2RemotionTimeline({
    taskId,
    prompt: stringValue(req.body?.prompt, 'V2 Remotion Timeline Agent'),
    mainVideoPath,
    inputImageUrl: stringValue(req.body?.inputImageUrl) || undefined,
    referenceVideoPath: stringValue(req.body?.referenceVideoPath) || undefined,
    imageSrc: stringValue(req.body?.imageSrc) || undefined,
    durationSec: numberValue(req.body?.durationSec),
    plannerMode: plannerModeValue(req.body?.plannerMode),
    allowPlannerFallback: booleanValue(req.body?.allowPlannerFallback),
    canvas: {
      width: numberValue(req.body?.canvas?.width),
      height: numberValue(req.body?.canvas?.height),
      fps: numberValue(req.body?.canvas?.fps),
    },
  })

  res.json(result)
}

export async function postV2TimelineRun(req: Request, res: Response): Promise<void> {
  const taskId = stringValue(req.body?.taskId, `v2_timeline_run_${Date.now()}`)
  const mainVideoPath = stringValue(req.body?.mainVideoPath)
  if (!mainVideoPath) {
    res.status(400).json({ error: 'mainVideoPath is required.' })
    return
  }

  const result = await runV2RemotionTimeline({
    taskId,
    prompt: stringValue(req.body?.prompt, 'V2 Remotion Timeline Agent'),
    mainVideoPath,
    inputImageUrl: stringValue(req.body?.inputImageUrl) || undefined,
    referenceVideoPath: stringValue(req.body?.referenceVideoPath) || undefined,
    imageSrc: stringValue(req.body?.imageSrc) || undefined,
    durationSec: numberValue(req.body?.durationSec),
    plannerMode: plannerModeValue(req.body?.plannerMode),
    allowPlannerFallback: booleanValue(req.body?.allowPlannerFallback),
    timelineSpecOverride: req.body?.timelineSpecOverride,
    canvas: {
      width: numberValue(req.body?.canvas?.width),
      height: numberValue(req.body?.canvas?.height),
      fps: numberValue(req.body?.canvas?.fps),
    },
  })

  res.json({
    ok: result.ok,
    taskId: result.taskId,
    plannerSource: result.plannerSource,
    outputPath: result.outputPath,
    outputUrl: `/v2-renders/${encodeURIComponent(result.taskId)}/${encodeURIComponent(path.basename(result.outputPath))}`,
    traceDir: result.traceDir,
    review: result.review,
    validation: result.validation,
    materialResolution: result.materialResolution,
    standardizedAssets: result.standardizedAssets,
    evaluation: result.evaluation,
  })
}
