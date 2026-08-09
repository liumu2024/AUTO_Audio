import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { timelineRenderComponentReferences } from '../modules/render-components/component-registry.js'
import {
  runV2RemotionTimeline,
  type V2TimelineRunOptions,
  type V2TimelineRunResult,
} from './remotion-timeline-service.js'
import type { V2TraceContext } from './trace.js'
import type { V2TimelineDraftRepository } from './timeline-draft-repository.js'

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

/** The single RenderRun boundary used by both HTTP and Director execution. */
export async function executeV2TimelineDraftRun(input: {
  repository: V2TimelineDraftRepository
  draftId: string
  revision: number
  userId: number
  onProgress?: V2TimelineRunOptions['onProgress']
  traceContext?: V2TraceContext
  runTimeline?: TimelineRunner
}): Promise<V2TimelineDraftRunExecutionResult> {
  const [draft, source] = await Promise.all([
    input.repository.getDraft(input.draftId, input.userId),
    input.repository.getRevision(input.draftId, input.revision, input.userId),
  ])
  if (!draft || !source) throw new Error('V2 timeline draft revision not found.')

  const runId = `v2_run_${Date.now()}_${randomUUID().slice(0, 8)}`
  await input.repository.createRenderRun({
    id: runId,
    draftId: input.draftId,
    sourceRevision: source.revision,
    sourceSpec: source.spec,
  })
  try {
    const result = await (input.runTimeline ?? runV2RemotionTimeline)(
      {
        ...draft.plannerInput,
        taskId: runId,
        timelineSpecOverride: source.spec,
      },
      {
        onProgress: input.onProgress,
        traceContext: input.traceContext,
        authorizedDraftComponentIds: timelineRenderComponentReferences(source.spec)
          .map((reference) => reference.id),
      },
    )
    const outputUrl = `/v2-renders/${encodeURIComponent(result.taskId)}/${encodeURIComponent(path.basename(result.outputPath))}`
    const run = await input.repository.completeRenderRun({
      id: runId,
      resolvedSpec: result.spec,
      outputPath: result.outputPath,
      outputUrl,
      traceDir: result.traceDir,
      materialResolution: result.materialResolution,
      evaluation: result.evaluation,
    })
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
    await input.repository.failRenderRun(runId)
    throw error
  }
}
