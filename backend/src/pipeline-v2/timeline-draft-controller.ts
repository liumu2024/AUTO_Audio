import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Request, Response } from 'express'

import { validateRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { v2PlannerInputFromRequest } from './controller.js'
import { previewV2RemotionTimeline, runV2RemotionTimeline } from './remotion-timeline-service.js'
import {
  createV2TimelineDraftRepository,
  V2TimelineRevisionConflictError,
  type V2TimelineDraftHistoryRecord,
  type V2TimelineDraftRecord,
} from './timeline-draft-repository.js'

const repository = createV2TimelineDraftRepository()

function userIdFrom(req: Request): number {
  const raw = req.headers['x-user-id'] ?? '1'
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function revisionValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function limitValue(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 48
}

function draftDto(draft: V2TimelineDraftRecord) {
  return {
    draftId: draft.id,
    revision: draft.revision,
    spec: draft.spec,
    plannerSource: draft.plannerSource,
    review: draft.review,
    traceDir: draft.traceDir,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

function draftHistoryDto(draft: V2TimelineDraftHistoryRecord) {
  return {
    draftId: draft.id,
    revision: draft.revision,
    creationMode: draft.creationMode,
    plannerSource: draft.plannerSource,
    traceDir: draft.traceDir,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    latestRevision: {
      revision: draft.latestRevision.revision,
      kind: draft.latestRevision.kind,
      plannerSource: draft.latestRevision.plannerSource,
      traceDir: draft.latestRevision.traceDir,
      createdAt: draft.latestRevision.createdAt.toISOString(),
    },
    latestRun: draft.latestRun
      ? {
          id: draft.latestRun.id,
          sourceRevision: draft.latestRun.sourceRevision,
          status: draft.latestRun.status,
          outputUrl: draft.latestRun.outputUrl,
          traceDir: draft.latestRun.traceDir,
          createdAt: draft.latestRun.createdAt.toISOString(),
          completedAt: draft.latestRun.completedAt?.toISOString(),
        }
      : undefined,
  }
}

function sendConflict(res: Response, error: V2TimelineRevisionConflictError) {
  res.status(409).json({
    error: error.message,
    code: 'V2_TIMELINE_REVISION_CONFLICT',
    draftId: error.draftId,
    expectedRevision: error.expectedRevision,
    actualRevision: error.actualRevision,
  })
}

export async function postV2TimelineDraftPreview(req: Request, res: Response): Promise<void> {
  const taskId = `v2_preview_${Date.now()}_${randomUUID().slice(0, 8)}`
  const plannerInput = v2PlannerInputFromRequest(req, taskId)
  const preview = await previewV2RemotionTimeline(plannerInput)
  if (!preview.validation.ok) {
    res.status(422).json({ error: 'V2 timeline preview is not valid.', validation: preview.validation })
    return
  }

  const userId = userIdFrom(req)
  const draftId = typeof req.body?.draftId === 'string' ? req.body.draftId : undefined
  const baseRevision = revisionValue(req.body?.baseRevision)
  try {
    const draft = draftId
      ? await repository.saveDraft({
          draftId,
          userId,
          baseRevision: baseRevision ?? 0,
          spec: preview.spec,
          kind: 'preview',
          plannerInput,
          plannerSource: preview.plannerSource,
          review: preview.review,
          traceDir: preview.traceDir,
        })
      : await repository.createDraft({
          userId,
          plannerInput,
          spec: preview.spec,
          plannerSource: preview.plannerSource,
          review: preview.review,
          traceDir: preview.traceDir,
        })
    res.json({ ...preview, draft: draftDto(draft) })
  } catch (error) {
    if (error instanceof V2TimelineRevisionConflictError) {
      sendConflict(res, error)
      return
    }
    throw error
  }
}

export async function getV2TimelineDraft(req: Request, res: Response): Promise<void> {
  const draft = await repository.getDraftHistory(String(req.params.draftId), userIdFrom(req))
  if (!draft) {
    res.status(404).json({ error: 'V2 timeline draft not found.' })
    return
  }
  res.json({ draft: { ...draftDto(draft), ...draftHistoryDto(draft) } })
}

export async function getV2TimelineDrafts(req: Request, res: Response): Promise<void> {
  const drafts = await repository.listDrafts(userIdFrom(req), limitValue(req.query.limit))
  res.json({ drafts: drafts.map(draftHistoryDto) })
}

export async function deleteV2TimelineDraft(req: Request, res: Response): Promise<void> {
  const draftId = String(req.params.draftId)
  const deleted = await repository.deleteDraft(draftId, userIdFrom(req))
  if (!deleted) {
    res.status(404).json({ error: 'V2 timeline draft not found.' })
    return
  }
  res.json({ draftId, deleted: true })
}

export async function putV2TimelineDraft(req: Request, res: Response): Promise<void> {
  const draftId = String(req.params.draftId)
  const baseRevision = revisionValue(req.body?.baseRevision)
  const spec = req.body?.spec as RemotionTimelineSpecV1 | undefined
  if (!baseRevision || !spec) {
    res.status(400).json({ error: 'baseRevision and spec are required.' })
    return
  }
  const validation = validateRemotionTimelineSpec(spec)
  if (!validation.ok) {
    res.status(422).json({ error: 'Invalid RemotionTimelineSpec.', validation })
    return
  }
  try {
    const draft = await repository.saveDraft({
      draftId,
      userId: userIdFrom(req),
      baseRevision,
      spec,
      kind: 'user_edit',
    })
    res.json({ draft: draftDto(draft) })
  } catch (error) {
    if (error instanceof V2TimelineRevisionConflictError) {
      sendConflict(res, error)
      return
    }
    throw error
  }
}

export async function postV2TimelineDraftRun(req: Request, res: Response): Promise<void> {
  const draftId = String(req.params.draftId)
  const revision = revisionValue(req.body?.revision)
  if (!revision) {
    res.status(400).json({ error: 'revision is required.' })
    return
  }
  const userId = userIdFrom(req)
  const draft = await repository.getDraft(draftId, userId)
  const source = await repository.getRevision(draftId, revision, userId)
  if (!draft || !source) {
    res.status(404).json({ error: 'V2 timeline draft revision not found.' })
    return
  }

  const runId = `v2_run_${Date.now()}_${randomUUID().slice(0, 8)}`
  await repository.createRenderRun({
    id: runId,
    draftId,
    sourceRevision: source.revision,
    sourceSpec: source.spec,
  })
  try {
    const result = await runV2RemotionTimeline({
      ...draft.plannerInput,
      taskId: runId,
      timelineSpecOverride: source.spec,
    })
    const outputUrl = `/v2-renders/${encodeURIComponent(result.taskId)}/${encodeURIComponent(path.basename(result.outputPath))}`
    const run = await repository.completeRenderRun({
      id: runId,
      resolvedSpec: result.spec,
      outputPath: result.outputPath,
      outputUrl,
      traceDir: result.traceDir,
      materialResolution: result.materialResolution,
      evaluation: result.evaluation,
    })
    res.json({
      ok: result.ok,
      draftId,
      draftRevision: source.revision,
      renderRunId: run.id,
      plannerSource: result.plannerSource,
      resolvedSpec: run.resolvedSpec,
      outputPath: run.outputPath,
      outputUrl: run.outputUrl,
      traceDir: run.traceDir,
      review: result.review,
      validation: result.validation,
      materialResolution: result.materialResolution,
      standardizedAssets: result.standardizedAssets,
      evaluation: result.evaluation,
    })
  } catch (error) {
    await repository.failRenderRun(runId)
    throw error
  }
}
