import type { Request, Response } from 'express'

import { analyzeV2Sample } from './sample-understanding-service.js'
import { previewV2RemotionTimeline } from './remotion-timeline-service.js'
import { V2_TIMELINE_PLANNER_PROTOCOL_VERSION } from './remotion-timeline-llm-planner.js'
import type { V2PlannerInput, V2PlannerMaterialInput } from './v2-input.js'
import { RENDER_COMPONENT_VISUAL_POLICY_VERSION } from '../modules/render-components/component-registry.js'
import {
  executeV2JsonIdempotentOperation,
  V2IdempotencyConflictError,
  v2IdempotencyRequestHash,
} from './idempotency-repository.js'

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

function creationModeValue(
  value: unknown,
): V2PlannerInput['creationMode'] {
  if (
    value === 'sample_replicate' ||
    value === 'material_brief' ||
    value === 'text_to_video'
  ) {
    return value
  }
  return undefined
}

function materialInputsValue(value: unknown): V2PlannerMaterialInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const materials = value
    .map((item): V2PlannerMaterialInput | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const type = record.type
      const src = stringValue(record.src)
      if (type !== 'video' && type !== 'image' && type !== 'audio') return null
      if (!src) return null
      return {
        id: stringValue(record.id, `material_${Date.now()}`),
        name: stringValue(record.name) || undefined,
        type,
        src,
        publicUrl: stringValue(record.publicUrl) || undefined,
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === 'string')
          : undefined,
      }
    })
    .filter((item): item is V2PlannerMaterialInput => Boolean(item))
  return materials.length ? materials : undefined
}

function sampleUnderstandingValue(value: unknown): V2PlannerInput['sampleUnderstanding'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.schema_version !== 'v2_sample_understanding.v2') return undefined
  if (!Array.isArray(record.method_observations) || !Array.isArray(record.shot_evidence)) return undefined
  return value as V2PlannerInput['sampleUnderstanding']
}

function planningContextValue(value: unknown): V2PlannerInput['planningContext'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'initial' && kind !== 'revision') return undefined
  return {
    kind,
    activeRequirements: [],
    draftId: stringValue(record.draftId) || undefined,
    baseRevision: numberValue(record.baseRevision),
    authorizationEvidence: stringValue(record.authorizationEvidence) || undefined,
  }
}

export function v2PlannerInputFromRequest(
  req: Request,
  taskId: string,
): V2PlannerInput & { imageSrc?: string } {
  const mainVideoPath = stringValue(req.body?.mainVideoPath)
  return {
    taskId,
    prompt: stringValue(req.body?.prompt, 'V2 Remotion Timeline Agent'),
    creationMode: creationModeValue(req.body?.creationMode),
    mainVideoPath: mainVideoPath || undefined,
    inputImageUrl: stringValue(req.body?.inputImageUrl) || undefined,
    referenceVideoPath: stringValue(req.body?.referenceVideoPath) || undefined,
    sampleUnderstanding: sampleUnderstandingValue(req.body?.sampleUnderstanding),
    conversationSummary: stringValue(req.body?.conversationSummary) || undefined,
    planningContext: planningContextValue(req.body?.planningContext),
    imageSrc: stringValue(req.body?.imageSrc) || undefined,
    materials: materialInputsValue(req.body?.materials),
    durationSec: numberValue(req.body?.durationSec),
    plannerMode: plannerModeValue(req.body?.plannerMode),
    allowPlannerFallback: booleanValue(req.body?.allowPlannerFallback),
    canvas: {
      width: numberValue(req.body?.canvas?.width),
      height: numberValue(req.body?.canvas?.height),
      fps: numberValue(req.body?.canvas?.fps),
    },
  }
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

export async function postV2TimelinePreview(req: Request, res: Response): Promise<void> {
  const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim()
  if (!idempotencyKey || idempotencyKey.length > 200) {
    res.status(400).json({ error: 'A valid Idempotency-Key header is required.' })
    return
  }
  const userId = Number(req.headers['x-user-id'] ?? 1) || 1
  const taskId = stringValue(
    req.body?.taskId,
    `v2_timeline_preview_${v2IdempotencyRequestHash({ userId, idempotencyKey }).slice(0, 16)}`,
  )
  try {
    const outcome = await executeV2JsonIdempotentOperation({
      reservation: {
        userId,
        operation: 'timeline.preview',
        idempotencyKey,
        resourceKey: 'ephemeral-preview',
        requestHash: v2IdempotencyRequestHash({
          userId,
          body: req.body,
          plannerProtocol: V2_TIMELINE_PLANNER_PROTOCOL_VERSION,
          componentVisualPolicy: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
        }),
      },
      execute: () => previewV2RemotionTimeline(v2PlannerInputFromRequest(req, taskId)),
    })
    if (outcome.kind === 'running') {
      res.status(202).json({ status: 'running' })
      return
    }
    if (outcome.kind === 'failed' || !outcome.value) {
      res.status(422).json({ error: outcome.receipt.failure?.message ?? 'Timeline preview failed.' })
      return
    }
    res.json(outcome.value)
  } catch (error) {
    if (error instanceof V2IdempotencyConflictError) {
      res.status(409).json({ error: error.message })
      return
    }
    throw error
  }
}
