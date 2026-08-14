import type { Request, Response } from 'express'

import { analyzeV2Sample } from './sample-understanding-service.js'

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export async function postV2SampleAnalyze(req: Request, res: Response): Promise<void> {
  const taskId = stringValue(req.body?.taskId, `v2_sample_${Date.now()}`)
  const sampleVideoPath = stringValue(req.body?.sampleVideoPath)
  if (!sampleVideoPath) {
    res.status(400).json({ error: 'sampleVideoPath is required.' })
    return
  }

  const result = await analyzeV2Sample({
    userId: Number(req.headers['x-user-id'] ?? 1) || 1,
    taskId,
    prompt: stringValue(req.body?.prompt, 'V2 Sample Understanding'),
    sampleVideoPath,
    sampleVideoName: stringValue(req.body?.sampleVideoName) || undefined,
  })

  res.json(result)
}
