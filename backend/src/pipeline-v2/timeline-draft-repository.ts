import { randomUUID } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import {
  bindRegisteredRenderComponentDisplayNames,
  timelineRenderComponentReferences,
  validateRenderComponentReferences,
} from '../modules/render-components/component-registry.js'
import type { V2PlannerInput } from './v2-input.js'
import { prisma } from '../shared/prisma.service.js'
import { hydrateV2TimelineAssetIds } from './timeline-asset-id-hydration.js'

export type V2StoredPlannerInput = V2PlannerInput & { imageSrc?: string }

export interface V2PendingTimelineRevision {
  callId: string
  instruction: string
  baseRevision: number
}

export interface V2TimelineDraftRecord {
  id: string
  userId: number
  revision: number
  creationMode: string
  plannerInput: V2StoredPlannerInput
  spec: RemotionTimelineSpecV1
  plannerSource?: string
  review?: unknown
  traceDir?: string
  pendingTimelineRevisions: V2PendingTimelineRevision[]
  createdAt: Date
  updatedAt: Date
}

export interface V2TimelineRevisionRecord {
  id: string
  draftId: string
  revision: number
  kind: 'preview' | 'user_edit'
  spec: RemotionTimelineSpecV1
  plannerSource?: string
  review?: unknown
  traceDir?: string
  createdAt: Date
}

export interface V2TimelineRenderRunRecord {
  id: string
  draftId: string
  sourceRevision: number
  sourceSpec: RemotionTimelineSpecV1
  resolvedSpec?: RemotionTimelineSpecV1
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  outputPath?: string
  outputUrl?: string
  traceDir?: string
  materialResolution?: unknown
  evaluation?: unknown
  providerSubmitClaims: number
  providerSubmissionsClosed: boolean
  createdAt: Date
  completedAt?: Date
}

export interface V2TimelineRevisionSummary {
  revision: number
  kind: 'preview' | 'user_edit'
  plannerSource?: string
  traceDir?: string
  createdAt: Date
}

export interface V2TimelineRenderRunSummary {
  id: string
  sourceRevision: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  outputUrl?: string
  traceDir?: string
  createdAt: Date
  completedAt?: Date
}

export interface V2TimelineDraftHistoryRecord extends V2TimelineDraftRecord {
  latestRevision: V2TimelineRevisionSummary
  latestRun?: V2TimelineRenderRunSummary
}

export class V2TimelineRevisionConflictError extends Error {
  constructor(
    readonly draftId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`V2 timeline draft revision conflict: expected ${expectedRevision}, actual ${actualRevision}.`)
  }
}

export class V2TimelineComponentReferenceError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid timeline component reference: ${issues.join('; ')}`)
  }
}

export class V2TimelinePendingRevisionError extends Error {
  constructor(readonly pending: V2PendingTimelineRevision[]) {
    super(`V2 timeline draft has a pending timeline revision: ${pending.map((item) => item.instruction).join('; ')}`)
  }
}

async function assertTimelineComponentReferences(
  spec: RemotionTimelineSpecV1,
  allowedDraftIds: ReadonlySet<string>,
): Promise<void> {
  const issues = await validateRenderComponentReferences(
    timelineRenderComponentReferences(spec),
    allowedDraftIds,
    spec.canvas,
  )
  if (issues.length) throw new V2TimelineComponentReferenceError(issues)
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function hydrateStoredTimelineSpec(
  spec: RemotionTimelineSpecV1,
  plannerInput: V2StoredPlannerInput,
): RemotionTimelineSpecV1 {
  const hydrated = hydrateV2TimelineAssetIds(spec, plannerInput)
  if (hydrated.creative_brief) {
    return {
      ...hydrated,
      creative_brief: {
        ...hydrated.creative_brief,
        applied_preferences: hydrated.creative_brief.applied_preferences ?? [],
      },
    }
  }

  const imageAssets = new Set(
    hydrated.assets
      .filter((asset) => asset.type === 'image' && asset.source === 'user_asset')
      .map((asset) => asset.id),
  )
  const imageReferences = new Map<string, { intendedUse: string }>()
  const rememberImageReference = (assetId: string | undefined, intendedUse: string): void => {
    if (!assetId || !imageAssets.has(assetId) || imageReferences.has(assetId)) return
    imageReferences.set(assetId, { intendedUse })
  }
  for (const scene of hydrated.scenes) {
    rememberImageReference(
      scene.asset_id,
      scene.creative_intent?.description?.trim()
        || 'Use the original image as the authoritative scene visual.',
    )
  }
  for (const overlay of hydrated.overlays) {
    rememberImageReference(
      overlay.asset_id,
      'Use the original image as the authoritative overlay visual.',
    )
  }
  for (const job of hydrated.material_jobs) {
    const scene = hydrated.scenes.find((item) => item.id === job.scene_id)
    rememberImageReference(
      job.input_asset_id,
      scene?.creative_intent?.description?.trim()
        || job.prompt?.trim()
        || 'Use the original image as the authoritative visual reference.',
    )
  }

  return {
    ...hydrated,
    creative_brief: {
      direction: plannerInput.prompt.trim()
        || hydrated.notes?.find((note) => note.trim())
        || 'Continue the existing editable video plan.',
      image_references: [...imageReferences].map(([assetId, reference]) => ({
        asset_id: assetId,
        observed_facts: [],
        intended_use: reference.intendedUse,
      })),
      sample_methods: [],
      applied_preferences: [],
    },
  }
}

function draftFromRow(row: Record<string, unknown>): V2TimelineDraftRecord {
  const plannerInput = row.plannerInputJson as V2StoredPlannerInput
  const storedPending = Array.isArray(row.pendingRevisionJson) ? row.pendingRevisionJson : []
  return {
    id: String(row.id),
    userId: Number(row.userId),
    revision: Number(row.revision),
    creationMode: plannerInput.creationMode ?? String(row.creationMode),
    plannerInput,
    spec: hydrateStoredTimelineSpec(row.specJson as RemotionTimelineSpecV1, plannerInput),
    plannerSource: (row.plannerSource as string | null) ?? undefined,
    review: row.reviewJson ?? undefined,
    traceDir: (row.traceDir as string | null) ?? undefined,
    pendingTimelineRevisions: storedPending.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      return typeof value.callId === 'string'
        && typeof value.instruction === 'string'
        && Number.isInteger(value.baseRevision)
        ? [{ callId: value.callId, instruction: value.instruction, baseRevision: Number(value.baseRevision) }]
        : []
    }),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

function revisionFromRow(
  row: Record<string, unknown>,
  plannerInput: V2StoredPlannerInput,
): V2TimelineRevisionRecord {
  return {
    id: String(row.id),
    draftId: String(row.draftId),
    revision: Number(row.revision),
    kind: row.kind as V2TimelineRevisionRecord['kind'],
    spec: hydrateStoredTimelineSpec(row.specJson as RemotionTimelineSpecV1, plannerInput),
    plannerSource: (row.plannerSource as string | null) ?? undefined,
    review: row.reviewJson ?? undefined,
    traceDir: (row.traceDir as string | null) ?? undefined,
    createdAt: row.createdAt as Date,
  }
}

function runFromRow(row: Record<string, unknown>): V2TimelineRenderRunRecord {
  return {
    id: String(row.id),
    draftId: String(row.draftId),
    sourceRevision: Number(row.sourceRevision),
    sourceSpec: row.sourceSpecJson as RemotionTimelineSpecV1,
    resolvedSpec: (row.resolvedSpecJson as RemotionTimelineSpecV1 | null) ?? undefined,
    status: row.status as V2TimelineRenderRunRecord['status'],
    outputPath: (row.outputPath as string | null) ?? undefined,
    outputUrl: (row.outputUrl as string | null) ?? undefined,
    traceDir: (row.traceDir as string | null) ?? undefined,
    materialResolution: row.materialResolutionJson ?? undefined,
    evaluation: row.evaluationJson ?? undefined,
    providerSubmitClaims: Number(row.providerSubmitClaims ?? 0),
    providerSubmissionsClosed: Boolean(row.providerSubmissionsClosed ?? false),
    createdAt: row.createdAt as Date,
    completedAt: (row.completedAt as Date | null) ?? undefined,
  }
}

function revisionSummaryFromRow(row: Record<string, unknown>): V2TimelineRevisionSummary {
  return {
    revision: Number(row.revision),
    kind: row.kind as V2TimelineRevisionSummary['kind'],
    plannerSource: (row.plannerSource as string | null) ?? undefined,
    traceDir: (row.traceDir as string | null) ?? undefined,
    createdAt: row.createdAt as Date,
  }
}

function runSummaryFromRow(row: Record<string, unknown>): V2TimelineRenderRunSummary {
  return {
    id: String(row.id),
    sourceRevision: Number(row.sourceRevision),
    status: row.status as V2TimelineRenderRunSummary['status'],
    outputUrl: (row.outputUrl as string | null) ?? undefined,
    traceDir: (row.traceDir as string | null) ?? undefined,
    createdAt: row.createdAt as Date,
    completedAt: (row.completedAt as Date | null) ?? undefined,
  }
}

export interface CreateV2TimelineDraftInput {
  userId: number
  plannerInput: V2StoredPlannerInput
  spec: RemotionTimelineSpecV1
  plannerSource: string
  review: unknown
  traceDir: string
  authorizedDraftComponentIds?: readonly string[]
}

export interface SaveV2TimelineDraftInput {
  draftId: string
  userId: number
  baseRevision: number
  spec: RemotionTimelineSpecV1
  kind: 'preview' | 'user_edit'
  plannerInput?: V2StoredPlannerInput
  plannerSource?: string
  review?: unknown
  traceDir?: string
  authorizedDraftComponentIds?: readonly string[]
  /** Exact failed Director patches that this successful revision resolves. */
  resolvesPendingCallIds?: readonly string[]
}

export interface V2TimelineDraftRepository {
  createDraft(input: CreateV2TimelineDraftInput): Promise<V2TimelineDraftRecord>
  getDraft(draftId: string, userId: number): Promise<V2TimelineDraftRecord | null>
  getDraftHistory(draftId: string, userId: number): Promise<V2TimelineDraftHistoryRecord | null>
  listDrafts(userId: number, limit?: number): Promise<V2TimelineDraftHistoryRecord[]>
  deleteDraft(draftId: string, userId: number): Promise<boolean>
  saveDraft(input: SaveV2TimelineDraftInput): Promise<V2TimelineDraftRecord>
  markPendingRevision(input: {
    draftId: string
    userId: number
    baseRevision: number
    callId: string
    replacesCallId?: string
    instruction: string
  }): Promise<V2TimelineDraftRecord | null>
  dismissPendingRevision(input: {
    draftId: string
    userId: number
    baseRevision: number
    callId: string
  }): Promise<V2TimelineDraftRecord | null>
  getRevision(
    draftId: string,
    revision: number,
    userId: number,
  ): Promise<V2TimelineRevisionRecord | null>
  getRenderRun(id: string, userId: number): Promise<V2TimelineRenderRunRecord | null>
  getLatestCompletedRenderRun(draftId: string, userId: number): Promise<V2TimelineRenderRunRecord | null>
  createRenderRun(input: {
    id: string
    draftId: string
    userId: number
    sourceRevision: number
    sourceSpec: RemotionTimelineSpecV1
  }): Promise<V2TimelineRenderRunRecord>
  closeRenderRunProviderSubmissions(id: string): Promise<boolean>
  claimRenderRunProviderSubmission(id: string): Promise<boolean>
  releaseRenderRunProviderSubmission(id: string): Promise<void>
  completeRenderRun(input: {
    id: string
    resolvedSpec: RemotionTimelineSpecV1
    outputPath: string
    outputUrl?: string
    traceDir: string
    materialResolution: unknown
    evaluation: unknown
  }): Promise<V2TimelineRenderRunRecord>
  failRenderRun(id: string, traceDir?: string): Promise<void>
  cancelRenderRun(id: string, traceDir?: string): Promise<boolean>
}

export function createV2TimelineDraftRepository(): V2TimelineDraftRepository {
  async function historyForDraft(
    draft: V2TimelineDraftRecord,
  ): Promise<V2TimelineDraftHistoryRecord> {
    const [revision, latestRun] = await Promise.all([
      prisma.v2TimelineRevision.findFirst({
        where: { draftId: draft.id, revision: draft.revision },
      }),
      prisma.v2TimelineRenderRun.findFirst({
        where: { draftId: draft.id },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    if (!revision) {
      throw new Error(`V2 timeline draft ${draft.id} is missing revision ${draft.revision}.`)
    }
    return {
      ...draft,
      latestRevision: revisionSummaryFromRow(asRecord(revision)),
      latestRun: latestRun ? runSummaryFromRow(asRecord(latestRun)) : undefined,
    }
  }

  return {
    async createDraft(input) {
      const hydratedInputSpec = hydrateStoredTimelineSpec(input.spec, input.plannerInput)
      await assertTimelineComponentReferences(
        hydratedInputSpec,
        new Set(input.authorizedDraftComponentIds),
      )
      const spec = assertValidRemotionTimelineSpec(
        await bindRegisteredRenderComponentDisplayNames(hydratedInputSpec),
      )
      const id = `v2_draft_${randomUUID()}`
      const draft = await prisma.v2TimelineDraft.create({
        data: {
          id,
          userId: input.userId,
          revision: 1,
          creationMode: input.plannerInput.creationMode ?? 'text_to_video',
          plannerInputJson: asJson(input.plannerInput),
          specJson: asJson(spec),
          plannerSource: input.plannerSource,
          reviewJson: asJson(input.review),
          traceDir: input.traceDir,
        },
      })
      await prisma.v2TimelineRevision.create({
        data: {
          id: `v2_revision_${randomUUID()}`,
          draftId: id,
          revision: 1,
          kind: 'preview',
          specJson: asJson(spec),
          plannerSource: input.plannerSource,
          reviewJson: asJson(input.review),
          traceDir: input.traceDir,
        },
      })
      return draftFromRow(asRecord(draft))
    },

    async getDraft(draftId, userId) {
      const draft = await prisma.v2TimelineDraft.findFirst({
        where: { id: draftId, userId },
      })
      return draft ? draftFromRow(asRecord(draft)) : null
    },

    async getDraftHistory(draftId, userId) {
      const draft = await this.getDraft(draftId, userId)
      return draft ? historyForDraft(draft) : null
    },

    async listDrafts(userId, limit = 48) {
      const drafts = await prisma.v2TimelineDraft.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: Math.max(1, Math.min(limit, 100)),
      })
      return Promise.all(drafts.map((draft) => historyForDraft(draftFromRow(asRecord(draft)))))
    },

    async deleteDraft(draftId, userId) {
      const deleted = await prisma.v2TimelineDraft.deleteMany({
        where: { id: draftId, userId },
      })
      return deleted.count === 1
    },

    async saveDraft(input) {
      const current = await prisma.v2TimelineDraft.findFirst({
        where: { id: input.draftId, userId: input.userId },
      })
      if (!current) throw new Error('V2 timeline draft not found.')
      if (current.revision !== input.baseRevision) {
        throw new V2TimelineRevisionConflictError(
          input.draftId,
          input.baseRevision,
          current.revision,
        )
      }
      const currentPlannerInput = current.plannerInputJson as unknown as V2StoredPlannerInput
      const pending = draftFromRow(asRecord(current)).pendingTimelineRevisions
      const resolvedPendingIds = new Set(input.resolvesPendingCallIds ?? [])
      if ([...resolvedPendingIds].some((callId) => !pending.some((item) => item.callId === callId))) {
        throw new V2TimelinePendingRevisionError(pending)
      }
      const currentSpec = hydrateStoredTimelineSpec(
        current.specJson as unknown as RemotionTimelineSpecV1,
        currentPlannerInput,
      )
      const nextPlannerInput = input.plannerInput ?? currentPlannerInput
      const hydratedInputSpec = hydrateStoredTimelineSpec(input.spec, nextPlannerInput)
      await assertTimelineComponentReferences(
        hydratedInputSpec,
        new Set([
          ...timelineRenderComponentReferences(currentSpec).map((reference) => reference.id),
          ...(input.authorizedDraftComponentIds ?? []),
        ]),
      )
      const spec = assertValidRemotionTimelineSpec(
        await bindRegisteredRenderComponentDisplayNames(hydratedInputSpec),
      )

      const nextRevision = input.baseRevision + 1
      const updated = await prisma.v2TimelineDraft.updateMany({
        where: {
          id: input.draftId,
          userId: input.userId,
          revision: input.baseRevision,
          pendingRevisionJson: { equals: current.pendingRevisionJson as Prisma.InputJsonValue },
        },
        data: {
          revision: nextRevision,
          creationMode: nextPlannerInput.creationMode ?? String(current.creationMode),
          specJson: asJson(spec),
          ...(input.plannerInput ? { plannerInputJson: asJson(input.plannerInput) } : {}),
          ...(input.plannerSource !== undefined ? { plannerSource: input.plannerSource } : {}),
          ...(input.review !== undefined ? { reviewJson: asJson(input.review) } : {}),
          ...(input.traceDir !== undefined ? { traceDir: input.traceDir } : {}),
          pendingRevisionJson: asJson(pending.filter((item) => !resolvedPendingIds.has(item.callId))),
        },
      })
      if (updated.count !== 1) {
        const latest = await prisma.v2TimelineDraft.findFirst({
          where: { id: input.draftId, userId: input.userId },
        })
        if (latest && Number(latest.revision) === input.baseRevision) return this.saveDraft(input)
        throw new V2TimelineRevisionConflictError(
          input.draftId,
          input.baseRevision,
          latest?.revision ?? input.baseRevision,
        )
      }
      await prisma.v2TimelineRevision.create({
        data: {
          id: `v2_revision_${randomUUID()}`,
          draftId: input.draftId,
          revision: nextRevision,
          kind: input.kind,
          specJson: asJson(spec),
          plannerSource: input.plannerSource ?? current.plannerSource,
          reviewJson: asJson(input.review ?? current.reviewJson),
          traceDir: input.traceDir ?? current.traceDir,
        },
      })
      const draft = await prisma.v2TimelineDraft.findFirst({
        where: { id: input.draftId, userId: input.userId },
      })
      if (!draft) throw new Error('V2 timeline draft disappeared after save.')
      return draftFromRow(asRecord(draft))
    },

    async markPendingRevision(input) {
      const current = await prisma.v2TimelineDraft.findFirst({
        where: { id: input.draftId, userId: input.userId },
      })
      if (!current) return null
      if (Number(current.revision) !== input.baseRevision) {
        throw new V2TimelineRevisionConflictError(
          input.draftId,
          input.baseRevision,
          Number(current.revision),
        )
      }
      const pending = draftFromRow(asRecord(current)).pendingTimelineRevisions
      const next = [
        ...pending.filter((item) => item.callId !== input.callId && item.callId !== input.replacesCallId),
        {
          callId: input.callId,
          instruction: input.instruction.trim(),
          baseRevision: input.baseRevision,
        },
      ]
      const updated = await prisma.v2TimelineDraft.updateMany({
        where: {
          id: input.draftId,
          userId: input.userId,
          revision: input.baseRevision,
          pendingRevisionJson: { equals: current.pendingRevisionJson as Prisma.InputJsonValue },
        },
        data: { pendingRevisionJson: asJson(next) },
      })
      if (updated.count !== 1) {
        const latest = await this.getDraft(input.draftId, input.userId)
        if (!latest) return null
        return this.markPendingRevision(input)
      }
      return this.getDraft(input.draftId, input.userId)
    },

    async dismissPendingRevision(input) {
      const current = await prisma.v2TimelineDraft.findFirst({
        where: { id: input.draftId, userId: input.userId },
      })
      if (!current) return null
      if (Number(current.revision) !== input.baseRevision) {
        throw new V2TimelineRevisionConflictError(
          input.draftId,
          input.baseRevision,
          Number(current.revision),
        )
      }
      const pending = draftFromRow(asRecord(current)).pendingTimelineRevisions
      if (!pending.some((item) => item.callId === input.callId)) {
        throw new V2TimelinePendingRevisionError(pending)
      }
      const updated = await prisma.v2TimelineDraft.updateMany({
        where: {
          id: input.draftId,
          userId: input.userId,
          revision: input.baseRevision,
          pendingRevisionJson: { equals: current.pendingRevisionJson as Prisma.InputJsonValue },
        },
        data: {
          pendingRevisionJson: asJson(pending.filter((item) => item.callId !== input.callId)),
        },
      })
      if (updated.count !== 1) return this.dismissPendingRevision(input)
      return this.getDraft(input.draftId, input.userId)
    },

    async getRevision(draftId, revision, userId) {
      const draft = await prisma.v2TimelineDraft.findFirst({
        where: { id: draftId, userId },
      })
      if (!draft) return null
      const row = await prisma.v2TimelineRevision.findFirst({
        where: { draftId, revision },
      })
      return row
        ? revisionFromRow(asRecord(row), draft.plannerInputJson as unknown as V2StoredPlannerInput)
        : null
    },

    async getRenderRun(id, userId) {
      const row = await prisma.v2TimelineRenderRun.findFirst({ where: { id } })
      if (!row) return null
      const draft = await prisma.v2TimelineDraft.findFirst({ where: { id: row.draftId, userId } })
      return draft ? runFromRow(asRecord(row)) : null
    },

    async getLatestCompletedRenderRun(draftId, userId) {
      const draft = await prisma.v2TimelineDraft.findFirst({ where: { id: draftId, userId } })
      if (!draft) return null
      const row = await prisma.v2TimelineRenderRun.findFirst({
        where: { draftId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
      })
      return row ? runFromRow(asRecord(row)) : null
    },

    async createRenderRun(input) {
      try {
        await prisma.v2TimelineDraft.update({
          where: {
            id: input.draftId,
            userId: input.userId,
            revision: input.sourceRevision,
          },
          data: {
            renderRuns: {
              create: {
                id: input.id,
                sourceRevision: input.sourceRevision,
                sourceSpecJson: asJson(input.sourceSpec),
                status: 'running',
              },
            },
          },
        })
      } catch (error) {
        const current = await prisma.v2TimelineDraft.findFirst({
          where: { id: input.draftId, userId: input.userId },
        })
        if (!current) throw new Error('V2 timeline draft not found.')
        if (Number(current.revision) !== input.sourceRevision) {
          throw new V2TimelineRevisionConflictError(
            input.draftId,
            input.sourceRevision,
            Number(current.revision),
          )
        }
        throw error
      }
      const row = await prisma.v2TimelineRenderRun.findFirst({ where: { id: input.id } })
      if (!row) throw new Error('V2 timeline RenderRun disappeared after creation.')
      return runFromRow(asRecord(row))
    },

    async completeRenderRun(input) {
      const updated = await prisma.v2TimelineRenderRun.updateMany({
        where: { id: input.id, status: 'running', providerSubmissionsClosed: false },
        data: {
          status: 'completed',
          resolvedSpecJson: asJson(input.resolvedSpec),
          outputPath: input.outputPath,
          outputUrl: input.outputUrl,
          traceDir: input.traceDir,
          materialResolutionJson: asJson(input.materialResolution),
          evaluationJson: asJson(input.evaluation),
          completedAt: new Date(),
        },
      })
      if (updated.count !== 1) throw new Error(`RenderRun ${input.id} is no longer running.`)
      const row = await prisma.v2TimelineRenderRun.findFirst({ where: { id: input.id } })
      if (!row) throw new Error(`RenderRun ${input.id} was not found after completion.`)
      return runFromRow(asRecord(row))
    },

    async claimRenderRunProviderSubmission(id) {
      const result = await prisma.v2TimelineRenderRun.updateMany({
        where: { id, status: 'running', providerSubmissionsClosed: false },
        data: { providerSubmitClaims: { increment: 1 } },
      })
      return result.count === 1
    },

    async closeRenderRunProviderSubmissions(id) {
      const result = await prisma.v2TimelineRenderRun.updateMany({
        where: { id, status: 'running' },
        data: { providerSubmissionsClosed: true },
      })
      return result.count === 1
    },

    async releaseRenderRunProviderSubmission(id) {
      const result = await prisma.v2TimelineRenderRun.updateMany({
        where: { id, providerSubmitClaims: { gt: 0 } },
        data: { providerSubmitClaims: { decrement: 1 } },
      })
      if (result.count !== 1) throw new Error(`RenderRun ${id} lost its Provider-submit claim.`)
    },

    async failRenderRun(id, traceDir) {
      await prisma.v2TimelineRenderRun.updateMany({
        where: { id, status: 'running' },
        data: {
          status: 'failed',
          traceDir,
          completedAt: new Date(),
        },
      })
    },

    async cancelRenderRun(id, traceDir) {
      const result = await prisma.v2TimelineRenderRun.updateMany({
        where: { id, status: 'running', providerSubmitClaims: 0, providerSubmissionsClosed: true },
        data: {
          status: 'cancelled',
          traceDir,
          completedAt: new Date(),
        },
      })
      return result.count === 1
    },
  }
}
