import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import { timelineRenderComponentReferences } from '../modules/render-components/component-registry.js'
import { ensureTimelineRenderComponentVisualEvidence } from '../modules/render-components/component-authoring-agent.js'
import {
  runV2RemotionTimeline,
  type V2TimelineRunOptions,
  type V2TimelineRunResult,
} from './remotion-timeline-service.js'
import type { V2TraceContext } from './trace.js'
import type { V2MaterialGenerationAdapter } from './material-generation-adapter.js'
import { buildV2TimelinePlanningReview } from './remotion-timeline-review.js'
import {
  createV2IdempotencyRepository,
  V2IdempotencyConflictError,
  v2IdempotencyRequestHash,
  type V2IdempotencyRepository,
} from './idempotency-repository.js'
import type { V2TimelineDraftRepository, V2TimelineRenderRunRecord } from './timeline-draft-repository.js'

export interface V2TimelineDraftRunExecutionResult {
  ok: boolean
  draftId: string
  draftRevision: number
  renderRunId: string
  plannerSource: string
  resolvedSpec: V2TimelineRunResult['spec']
  outputPath: string
  outputUrl?: string
  traceDir: string
  review: V2TimelineRunResult['review']
  validation: V2TimelineRunResult['validation']
  materialResolution: V2TimelineRunResult['materialResolution']
  standardizedAssets: V2TimelineRunResult['standardizedAssets']
  evaluation: V2TimelineRunResult['evaluation']
}

type TimelineRunner = typeof runV2RemotionTimeline
const inFlightRuns = new Map<string, {
  requestHash: string
  promise: Promise<V2TimelineDraftRunExecutionResult>
}>()

export class V2TimelineIdempotencyRunningError extends Error {
  constructor(readonly renderRunId: string) {
    super(`RenderRun ${renderRunId} is already running.`)
  }
}

export class V2TimelineIdempotencyFailedError extends Error {
  constructor(readonly renderRunId: string, message: string) {
    super(message)
  }
}

function resultFromCompletedRun(input: {
  run: V2TimelineRenderRunRecord
  plannerSource?: string
}): V2TimelineDraftRunExecutionResult {
  if (!input.run.resolvedSpec || !input.run.outputPath || !input.run.traceDir) {
    throw new Error(`Completed RenderRun ${input.run.id} is missing persisted output facts.`)
  }
  const validation = validateRemotionTimelineSpec(input.run.resolvedSpec)
  const evaluation = input.run.evaluation as V2TimelineRunResult['evaluation']
  return {
    ok: evaluation?.ok !== false,
    draftId: input.run.draftId,
    draftRevision: input.run.sourceRevision,
    renderRunId: input.run.id,
    plannerSource: input.plannerSource ?? 'override',
    resolvedSpec: input.run.resolvedSpec,
    outputPath: input.run.outputPath,
    outputUrl: input.run.outputUrl,
    traceDir: input.run.traceDir,
    review: buildV2TimelinePlanningReview({ spec: input.run.resolvedSpec, validation }),
    validation,
    materialResolution: input.run.materialResolution as V2TimelineRunResult['materialResolution'],
    standardizedAssets: input.run.resolvedSpec.assets.map((asset) => ({ id: asset.id, src: asset.src })),
    evaluation,
  }
}

interface V2TimelineDraftRunInput {
  repository: V2TimelineDraftRepository
  draftId: string
  revision: number
  userId: number
  idempotencyKey: string
  idempotency?: V2IdempotencyRepository
  materialAdapter?: V2MaterialGenerationAdapter
  /** Internal evaluation seam; public HTTP requests cannot set this path. */
  renderOutputBaseDir?: string
  onProgress?: V2TimelineRunOptions['onProgress']
  traceContext?: V2TraceContext
  runTimeline?: TimelineRunner
}

async function executeV2TimelineDraftRunOnce(
  input: V2TimelineDraftRunInput,
): Promise<V2TimelineDraftRunExecutionResult> {
  const [draft, source] = await Promise.all([
    input.repository.getDraft(input.draftId, input.userId),
    input.repository.getRevision(input.draftId, input.revision, input.userId),
  ])
  if (!draft || !source) throw new Error('V2 timeline draft revision not found.')
  const runId = `v2_run_${Date.now()}_${randomUUID().slice(0, 8)}`
  const idempotency = input.idempotency ?? createV2IdempotencyRepository()
  const operation = 'timeline.render'
  const reservation = await idempotency.reserve({
    userId: input.userId,
    draftId: input.draftId,
    operation,
    idempotencyKey: input.idempotencyKey,
    resourceKey: `${input.draftId}:${source.revision}`,
    requestHash: v2IdempotencyRequestHash({ draftId: input.draftId, revision: source.revision }),
    resultRef: runId,
  })
  if (reservation.kind === 'replay') {
    if (reservation.receipt.status === 'failed') {
      throw new V2TimelineIdempotencyFailedError(
        reservation.receipt.resultRef ?? runId,
        reservation.receipt.failure?.message ?? 'The original render request failed.',
      )
    }
    if (reservation.receipt.status === 'completed' && reservation.receipt.resultRef) {
      const previous = await input.repository.getRenderRun(reservation.receipt.resultRef, input.userId)
      if (!previous) throw new Error(`Idempotent RenderRun ${reservation.receipt.resultRef} was not found.`)
      return resultFromCompletedRun({ run: previous, plannerSource: draft.plannerSource })
    }
    throw new V2TimelineIdempotencyRunningError(reservation.receipt.resultRef ?? runId)
  }
  const execution = (async () => {
    let renderRunCreated = false
    try {
      await input.repository.createRenderRun({
        id: runId,
        draftId: input.draftId,
        sourceRevision: source.revision,
        sourceSpec: source.spec,
      })
      renderRunCreated = true
      await ensureTimelineRenderComponentVisualEvidence(source.spec)
      const previousCompletedRun = await input.repository.getLatestCompletedRenderRun(input.draftId, input.userId)
      await idempotency.update({ id: reservation.receipt.id, phase: 'rendering', resultRef: runId })
      const result = await (input.runTimeline ?? runV2RemotionTimeline)(
        {
          ...draft.plannerInput,
          taskId: runId,
          timelineSpecOverride: source.spec,
        },
        {
          materialAdapter: input.materialAdapter,
          outputBaseDir: input.renderOutputBaseDir,
          onProgress: input.onProgress,
          traceContext: input.traceContext,
          authorizedDraftComponentIds: timelineRenderComponentReferences(source.spec)
            .map((reference) => reference.id),
          materialExecution: {
            idempotency: {
              repository: idempotency,
              userId: input.userId,
              draftId: input.draftId,
              renderRunId: runId,
              renderKey: input.idempotencyKey,
            },
            reusableRun: previousCompletedRun?.resolvedSpec && previousCompletedRun.materialResolution
              ? {
                  runId: previousCompletedRun.id,
                  spec: previousCompletedRun.resolvedSpec,
                  report: previousCompletedRun.materialResolution as V2TimelineRunResult['materialResolution'],
                }
              : undefined,
          },
        },
      )
      const outputUrl = input.renderOutputBaseDir
        ? undefined
        : `/v2-renders/${encodeURIComponent(result.taskId)}/${encodeURIComponent(path.basename(result.outputPath))}`
      const run = await input.repository.completeRenderRun({
        id: runId,
        resolvedSpec: result.spec,
        outputPath: result.outputPath,
        outputUrl,
        traceDir: result.traceDir,
        materialResolution: result.materialResolution,
        evaluation: result.evaluation,
      })
      await idempotency.update({ id: reservation.receipt.id, status: 'completed', resultRef: run.id })
      return {
        ok: result.ok,
        draftId: input.draftId,
        draftRevision: source.revision,
        renderRunId: run.id,
        plannerSource: result.plannerSource,
        resolvedSpec: run.resolvedSpec!,
        outputPath: run.outputPath!,
        outputUrl: run.outputUrl,
        traceDir: run.traceDir!,
        review: result.review,
        validation: result.validation,
        materialResolution: result.materialResolution,
        standardizedAssets: result.standardizedAssets,
        evaluation: result.evaluation,
      }
    } catch (error) {
      const cleanupTasks: Promise<unknown>[] = [
        rm(path.resolve(input.renderOutputBaseDir ?? path.resolve(process.cwd(), 'v2-renders'), runId), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        }),
      ]
      if (renderRunCreated) cleanupTasks.unshift(input.repository.failRenderRun(runId))
      const cleanup = await Promise.allSettled(cleanupTasks)
      for (const result of cleanup) {
        if (result.status === 'rejected') {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
          console.error(`[v2-timeline-run] failure cleanup failed: ${message}`)
        }
      }
      await idempotency.update({
        id: reservation.receipt.id,
        status: 'failed',
        resultRef: runId,
        failure: {
          code: 'render_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }).catch((receiptError) => {
        console.error(`[v2-timeline-run] idempotency failure update failed: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}`)
      })
      throw error
    }
  })()
  return execution
}

/** The single RenderRun boundary used by both HTTP and Director execution. */
export function executeV2TimelineDraftRun(
  input: V2TimelineDraftRunInput,
): Promise<V2TimelineDraftRunExecutionResult> {
  const inFlightKey = `${input.userId}:timeline.render:${input.idempotencyKey}`
  const requestHash = v2IdempotencyRequestHash({ draftId: input.draftId, revision: input.revision })
  const current = inFlightRuns.get(inFlightKey)
  if (current) {
    return current.requestHash === requestHash
      ? current.promise
      : Promise.reject(new V2IdempotencyConflictError())
  }
  const execution = executeV2TimelineDraftRunOnce(input).finally(() => {
    if (inFlightRuns.get(inFlightKey)?.promise === execution) inFlightRuns.delete(inFlightKey)
  })
  inFlightRuns.set(inFlightKey, { requestHash, promise: execution })
  return execution
}
