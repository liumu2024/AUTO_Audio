import { randomUUID } from 'node:crypto'

import type { Request, Response } from 'express'

import { validateRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { v2PlannerInputFromRequest } from './controller.js'
import { previewV2RemotionTimeline } from './remotion-timeline-service.js'
import { executeV2TimelineDraftRun } from './timeline-draft-runner.js'
import { ensureTimelineRenderComponentVisualEvidence } from '../modules/render-components/component-authoring-agent.js'
import { buildV2TimelineRevisionContext } from './timeline-revision-context.js'
import {
  createV2TimelineDraftRepository,
  V2TimelineComponentReferenceError,
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

function oneLine(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized
}

function aspectRatioForSpec(spec: RemotionTimelineSpecV1): '9:16' | '16:9' | '1:1' | '4:3' {
  const actual = spec.canvas.width / spec.canvas.height
  const supported = [
    { value: '9:16' as const, ratio: 9 / 16 },
    { value: '16:9' as const, ratio: 16 / 9 },
    { value: '1:1' as const, ratio: 1 },
    { value: '4:3' as const, ratio: 4 / 3 },
  ]
  return supported.reduce((closest, candidate) =>
    Math.abs(candidate.ratio - actual) < Math.abs(closest.ratio - actual)
      ? candidate
      : closest,
  ).value
}

function draftHistoryDto(draft: V2TimelineDraftHistoryRecord) {
  const firstScene = draft.spec.scenes
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)[0]
  return {
    draftId: draft.id,
    revision: draft.revision,
    creationMode: draft.creationMode,
    title:
      oneLine(firstScene?.title, 56) ??
      oneLine(firstScene?.creative_intent?.title, 56) ??
      oneLine(draft.plannerInput.prompt, 56),
    summary:
      oneLine(firstScene?.creative_intent?.description, 140) ??
      oneLine(firstScene?.body, 140) ??
      oneLine(draft.plannerInput.prompt, 140),
    aspectRatio: aspectRatioForSpec(draft.spec),
    durationSec: draft.spec.canvas.duration_sec,
    sceneCount: draft.spec.scenes.length,
    visibleTextCount: draft.spec.overlays.filter((overlay) => Boolean(overlay.text?.trim())).length,
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

function sendComponentReferenceError(res: Response, error: V2TimelineComponentReferenceError) {
  res.status(422).json({
    error: 'Invalid timeline component reference.',
    code: 'V2_TIMELINE_COMPONENT_REFERENCE',
    issues: error.issues,
  })
}

function persistedPlannerInput(input: ReturnType<typeof v2PlannerInputFromRequest>) {
  const { revisionContext: _revisionContext, revisionBaseSpec: _revisionBaseSpec, ...persisted } = input
  return persisted
}

export async function postV2TimelineDraftPreview(req: Request, res: Response): Promise<void> {
  const taskId = `v2_preview_${Date.now()}_${randomUUID().slice(0, 8)}`
  const userId = userIdFrom(req)
  const draftId = typeof req.body?.draftId === 'string' ? req.body.draftId : undefined
  const baseRevision = revisionValue(req.body?.baseRevision)
  let plannerInput = v2PlannerInputFromRequest(req, taskId)
  if (draftId) {
    if (!baseRevision) {
      res.status(400).json({ error: 'baseRevision is required when revising a V2 draft.' })
      return
    }
    const [draft, base] = await Promise.all([
      repository.getDraft(draftId, userId),
      repository.getRevision(draftId, baseRevision, userId),
    ])
    if (!draft || !base) {
      res.status(404).json({ error: 'V2 timeline draft revision not found.' })
      return
    }
    if (draft.revision !== baseRevision) {
      sendConflict(res, new V2TimelineRevisionConflictError(draftId, baseRevision, draft.revision))
      return
    }
    plannerInput = {
      ...plannerInput,
      planningContext: {
        kind: 'revision',
        activeRequirements: plannerInput.planningContext?.activeRequirements ?? [],
        draftId,
        baseRevision,
        selectedClipId: plannerInput.planningContext?.selectedClipId,
        authorizationEvidence: plannerInput.planningContext?.authorizationEvidence,
      },
      revisionContext: buildV2TimelineRevisionContext({
        draftId,
        baseRevision,
        spec: base.spec,
        selectedClipId: plannerInput.planningContext?.selectedClipId,
      }),
      revisionBaseSpec: base.spec,
    }
  }
  const preview = await previewV2RemotionTimeline(plannerInput)
  if (!preview.validation.ok) {
    res.status(422).json({ error: 'V2 timeline preview is not valid.', validation: preview.validation })
    return
  }

  try {
    await ensureTimelineRenderComponentVisualEvidence(preview.spec)
    const draft = draftId
      ? await repository.saveDraft({
          draftId,
          userId,
          baseRevision: baseRevision ?? 0,
          spec: preview.spec,
          kind: 'preview',
          plannerInput: persistedPlannerInput(plannerInput),
          plannerSource: preview.plannerSource,
          review: preview.review,
          traceDir: preview.traceDir,
        })
      : await repository.createDraft({
          userId,
          plannerInput: persistedPlannerInput(plannerInput),
          spec: preview.spec,
          plannerSource: preview.plannerSource,
          review: preview.review,
          traceDir: preview.traceDir,
        })
    res.json({ ...preview, draft: draftDto(draft) })
  } catch (error) {
    if (error instanceof V2TimelineComponentReferenceError) {
      sendComponentReferenceError(res, error)
      return
    }
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
    await ensureTimelineRenderComponentVisualEvidence(spec)
    const draft = await repository.saveDraft({
      draftId,
      userId: userIdFrom(req),
      baseRevision,
      spec,
      kind: 'user_edit',
    })
    res.json({ draft: draftDto(draft) })
  } catch (error) {
    if (error instanceof V2TimelineComponentReferenceError) {
      sendComponentReferenceError(res, error)
      return
    }
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
  try {
    res.json(await executeV2TimelineDraftRun({ repository, draftId, revision, userId }))
  } catch (error) {
    if (error instanceof Error && error.message === 'V2 timeline draft revision not found.') {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
}
