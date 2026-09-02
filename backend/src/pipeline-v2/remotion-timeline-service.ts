import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../config/env.js'
import {
  validateRemotionTimelineSpec,
  type RemotionTimelineValidationReport,
} from '../../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../../shared/lib/remotion-timeline-text-ownership.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { bindRegisteredRenderComponentDisplayNames } from '../modules/render-components/component-registry.js'
import { createConfiguredV2MaterialGenerationAdapter } from './configured-material-adapter.js'
import type { V2MaterialGenerationAdapter } from './material-generation-adapter.js'
import type { V2IdempotencyRepository } from './idempotency-repository.js'
import {
  resolveRemotionTimelineMaterialJobs,
  standardizeRemotionTimelineVideoAssets,
  type V2ProviderSubmissionPermit,
  type V2TimelineMaterialResolutionReport,
} from './remotion-timeline-material-resolver.js'
import type { V2RemotionTimelinePlannerInput } from './remotion-timeline-planner.js'
import { renderV2RemotionTimeline, type V2TimelineRenderResult } from './remotion-timeline-renderer.js'
import {
  buildV2TimelinePlanningReview,
  renderV2TimelinePlanningReviewMarkdown,
  type V2TimelinePlanningReview,
} from './remotion-timeline-review.js'
import { createV2TraceWriter } from './trace.js'
import type { V2TraceContext } from './trace.js'
import type { V2PlannerInput } from './v2-input.js'
import {
  buildV2TimelineSemanticCorrectionPrompt,
  deriveV2TimelineReviewSourceContext,
  type V2TimelineVisualInputReport,
} from './remotion-timeline-llm-planner.js'
import { applyV2TimelineRevisionPreservation } from './timeline-revision-context.js'
import { assertV2TimelinePlanningComplete } from './timeline-planning-gaps.js'
import {
  reviewV2TimelineRevisionOutcome,
  V2TimelineRevisionOutcomeError,
} from './timeline-revision-outcome-review.js'

export interface V2TimelinePreviewResult {
  taskId: string
  plannerSource: string
  spec: RemotionTimelineSpecV1
  validation: RemotionTimelineValidationReport
  review: V2TimelinePlanningReview
  traceDir: string
}

export interface V2TimelineRunResult {
  ok: boolean
  taskId: string
  plannerSource: string
  spec: RemotionTimelineSpecV1
  validation: RemotionTimelineValidationReport
  review: V2TimelinePlanningReview
  materialResolution: V2TimelineMaterialResolutionReport
  standardizedAssets: Array<{ id: string; src: string }>
  render: V2TimelineRenderResult
  outputPath: string
  traceDir: string
  evaluation: {
    ok: boolean
    metrics: Record<string, number>
    warnings: string[]
  }
}

export interface V2TimelineRunProgress {
  phase: 'prepare' | 'material_generation' | 'standardize' | 'remotion_render' | 'complete'
  progress: number
  message: string
  elapsedMs?: number
  jobId?: string
  sceneId?: string
  renderRunId?: string
}

export interface V2TimelineRunOptions {
  onProgress?: (event: V2TimelineRunProgress) => void | Promise<void>
  signal?: AbortSignal
  traceContext?: V2TraceContext
  /** Server-authorized draft components already bound to the persisted source timeline. */
  authorizedDraftComponentIds?: readonly string[]
  /** Internal test seam. Public HTTP callers cannot bind this option. */
  materialAdapter?: V2MaterialGenerationAdapter
  /** Internal evaluation seam. Production callers use the default v2-renders directory. */
  outputBaseDir?: string
  /** Internal RenderRun facts used for Provider idempotency and generated-shot reuse. */
  materialExecution?: {
    idempotency: {
      repository: V2IdempotencyRepository
      userId: number
      draftId: string
      renderRunId: string
      renderKey: string
      withProviderSubmissionPermit?: V2ProviderSubmissionPermit
    }
    reusableRun?: {
      runId: string
      spec: RemotionTimelineSpecV1
      report: V2TimelineMaterialResolutionReport
    }
  }
}

export interface V2TimelinePreviewOptions {
  traceContext?: V2TraceContext
}

function plannerInputFrom(input: V2PlannerInput & { imageSrc?: string }): V2RemotionTimelinePlannerInput {
  return {
    ...input,
    imageSrc: input.imageSrc,
  }
}

function outputRootFor(taskId: string, outputBaseDir?: string): string {
  return path.resolve(outputBaseDir ?? path.resolve(process.cwd(), 'v2-renders'), taskId)
}

function traceablePlannerInput(input: V2PlannerInput & { imageSrc?: string }) {
  // The full persisted base spec is server-only preservation state. Trace the
  // compact revision contract separately so input traces mirror model context.
  const { revisionBaseSpec: _revisionBaseSpec, ...traceInput } = input
  return traceInput
}

function semanticCaptionPolicy(plannerSource: string, attachedImages: number): string {
  if (plannerSource === 'override') return 'render_existing_revision_without_replanning'
  if (attachedImages > 0) {
    return 'planner_may_create_captions_from_attached_image_inputs'
  }
  return 'planner_must_not_claim_image_understanding_without_accessible_image_inputs'
}

async function resolveTimelineSpec(input: {
  plannerInput: V2PlannerInput & { imageSrc?: string }
  trace: ReturnType<typeof createV2TraceWriter>
  timelineSpecOverride?: unknown
}): Promise<{
  spec: RemotionTimelineSpecV1
  plannerSource: string
  visualInputReport?: V2TimelineVisualInputReport
}> {
  const bindComponentNames = (spec: RemotionTimelineSpecV1) =>
    bindRegisteredRenderComponentDisplayNames(spec)
  if (input.timelineSpecOverride) {
    await input.trace.writeJson('02-planning', 'timeline-spec-override.json', input.timelineSpecOverride)
    return {
      spec: input.timelineSpecOverride as RemotionTimelineSpecV1,
      plannerSource: 'override',
    }
  }

  {
    try {
      const { runV2TimelineLlmPlanner } = await import('./remotion-timeline-llm-planner.js')
      let llmPlanner = await runV2TimelineLlmPlanner(plannerInputFrom(input.plannerInput))
      let correctionApplied = false
      await input.trace.writeText('02-planning', 'llm-timeline-planner-prompt.md', llmPlanner.promptText)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-model-response.audit.json', llmPlanner.initialResponseAudit)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-json-candidate.audit.json', llmPlanner.rawResponse)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-extraction-report.json', llmPlanner.extractionReport)
      await input.trace.writeJson('02-planning', 'llm-timeline-visual-inputs.json', llmPlanner.visualInputReport)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-repairs.json', llmPlanner.repairs)
      if (llmPlanner.revisionFragment) {
        await input.trace.writeJson('02-planning', 'timeline-revision-fragment.json', llmPlanner.revisionFragment)
        await input.trace.writeJson('02-planning', 'timeline-scoped-candidate.json', llmPlanner.spec)
      }
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-protocol-diagnostic.json', {
        structured_output: llmPlanner.structuredOutput,
        json_repair_error: llmPlanner.jsonRepair?.error ?? null,
      })
      if (llmPlanner.jsonRepair) {
        await input.trace.writeText('02-planning', 'llm-timeline-planner-json-repair-request.md', llmPlanner.jsonRepair.request)
        await input.trace.writeJson('02-planning', 'llm-timeline-planner-json-repair-result.audit.json',
          llmPlanner.jsonRepair.responseAudit ?? { error: llmPlanner.jsonRepair.error ?? null })
      }
      {
        llmPlanner = {
          ...llmPlanner,
          spec: await bindComponentNames(llmPlanner.spec),
        }
        let reviewSourceContext = deriveV2TimelineReviewSourceContext(
          input.plannerInput,
          llmPlanner.visualInputReport,
        )
        let outcomeReview = await reviewV2TimelineRevisionOutcome({
          prompt: input.plannerInput.prompt,
          baseSpec: input.plannerInput.revisionBaseSpec,
          candidateSpec: llmPlanner.spec,
          availableComponents: input.plannerInput.availableComponents,
          confirmedContext: JSON.stringify(input.plannerInput.planningContext?.activeRequirements ?? []),
          revisionScope: input.plannerInput.revisionScope,
          revisionSceneId: input.plannerInput.revisionSceneId,
          revisionSceneIds: input.plannerInput.revisionSceneIds,
          revisionOverlayIds: input.plannerInput.revisionOverlayIds,
          revisionTransitionIds: input.plannerInput.revisionTransitionIds,
          revisionGlobalMode: input.plannerInput.revisionGlobalMode,
          revisionDurationMode: input.plannerInput.revisionDurationMode,
          revisionGroup: input.plannerInput.revisionGroup,
          ...reviewSourceContext,
        })
        await input.trace.writeJson('02-planning', 'timeline-outcome-review.json', outcomeReview)
        if (!outcomeReview.pass) {
          correctionApplied = true
          const correctionPrompt = buildV2TimelineSemanticCorrectionPrompt({
            plannerInput: input.plannerInput,
            rejectedCandidate: llmPlanner.revisionFragment ?? llmPlanner.spec,
            violations: outcomeReview.violations,
            repairInstruction: outcomeReview.repairInstruction,
            outputKind: llmPlanner.revisionFragment ? 'fragment' : 'timeline',
            visualInputReport: llmPlanner.visualInputReport,
          })
          await input.trace.writeText('02-planning', 'timeline-outcome-correction-request.md', correctionPrompt)
          const correctionMayRepairProtocol = !llmPlanner.jsonRepair
          llmPlanner = await runV2TimelineLlmPlanner(
            plannerInputFrom(input.plannerInput),
            { promptText: correctionPrompt, allowJsonRepair: correctionMayRepairProtocol },
          )
          await input.trace.writeJson('02-planning', 'timeline-outcome-correction-model-response.audit.json', llmPlanner.initialResponseAudit)
          await input.trace.writeJson('02-planning', 'timeline-outcome-correction-json-candidate.audit.json', llmPlanner.rawResponse)
          if (llmPlanner.jsonRepair) {
            await input.trace.writeText(
              '02-planning',
              'timeline-outcome-correction-json-repair-request.md',
              llmPlanner.jsonRepair.request,
            )
            await input.trace.writeJson(
              '02-planning',
              'timeline-outcome-correction-json-repair-result.audit.json',
              llmPlanner.jsonRepair.responseAudit ?? { error: llmPlanner.jsonRepair.error ?? null },
            )
          }
          if (llmPlanner.revisionFragment) {
            await input.trace.writeJson(
              '02-planning',
              'timeline-outcome-correction-fragment.json',
              llmPlanner.revisionFragment,
            )
            await input.trace.writeJson(
              '02-planning',
              'timeline-outcome-correction-scoped-candidate.json',
              llmPlanner.spec,
            )
          }
          llmPlanner = {
            ...llmPlanner,
            spec: await bindComponentNames(llmPlanner.spec),
          }
          reviewSourceContext = deriveV2TimelineReviewSourceContext(
            input.plannerInput,
            llmPlanner.visualInputReport,
          )
          outcomeReview = await reviewV2TimelineRevisionOutcome({
            prompt: input.plannerInput.prompt,
            baseSpec: input.plannerInput.revisionBaseSpec,
            candidateSpec: llmPlanner.spec,
            availableComponents: input.plannerInput.availableComponents,
            confirmedContext: JSON.stringify(input.plannerInput.planningContext?.activeRequirements ?? []),
            revisionScope: input.plannerInput.revisionScope,
            revisionSceneId: input.plannerInput.revisionSceneId,
            revisionSceneIds: input.plannerInput.revisionSceneIds,
            revisionOverlayIds: input.plannerInput.revisionOverlayIds,
            revisionTransitionIds: input.plannerInput.revisionTransitionIds,
            revisionGlobalMode: input.plannerInput.revisionGlobalMode,
            revisionDurationMode: input.plannerInput.revisionDurationMode,
            revisionGroup: input.plannerInput.revisionGroup,
            requiredCorrections: outcomeReview.violations,
            ...reviewSourceContext,
          })
          await input.trace.writeJson('02-planning', 'timeline-outcome-correction-review.json', outcomeReview)
          if (!outcomeReview.pass) {
            throw new V2TimelineRevisionOutcomeError(outcomeReview)
          }
        }
      }
      return {
        spec: llmPlanner.spec,
        plannerSource: correctionApplied ? 'llm_revision_corrected' : 'llm',
        visualInputReport: llmPlanner.visualInputReport,
      }
    } catch (error) {
      if (error instanceof V2TimelineRevisionOutcomeError && input.plannerInput.revisionBaseSpec) throw error
      const message = error instanceof Error ? error.message : String(error)
      const protocol = error && typeof error === 'object' && 'diagnostic' in error
        ? (error as { diagnostic?: Record<string, unknown> }).diagnostic
        : undefined
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-error.json', { message })
      if (protocol) {
        await input.trace.writeJson('02-planning', 'llm-timeline-planner-model-response.audit.json', protocol.initialResponseAudit ?? null)
        await input.trace.writeJson('02-planning', 'llm-timeline-planner-json-candidate.audit.json', protocol.rawResponse ?? null)
        await input.trace.writeJson('02-planning', 'llm-timeline-planner-extraction-report.json', protocol.extractionReport ?? null)
        await input.trace.writeJson('02-planning', 'llm-timeline-planner-protocol-diagnostic.json', {
          structured_output: protocol.structuredOutput ?? null,
          validation_issues: protocol.validationIssues ?? null,
          fallback_reason: 'unrepairable_structured_output',
        })
        const repair = protocol.jsonRepair as { request?: unknown; responseAudit?: unknown; error?: unknown } | undefined
        if (typeof repair?.request === 'string') {
          await input.trace.writeText('02-planning', 'llm-timeline-planner-json-repair-request.md', repair.request)
          await input.trace.writeJson('02-planning', 'llm-timeline-planner-json-repair-result.audit.json',
            repair.responseAudit ?? { error: repair.error ?? null })
        }
      }
      throw error
    }
  }

}

export async function previewV2RemotionTimeline(
  input: V2PlannerInput & { imageSrc?: string },
  options: V2TimelinePreviewOptions = {},
): Promise<V2TimelinePreviewResult> {
  const trace = createV2TraceWriter({
    taskId: input.taskId,
    sessionId: options.traceContext?.sessionId,
    operationId: options.traceContext?.operationId,
  })
  await trace.writeJson('01-input', 'timeline-planner-input.json', traceablePlannerInput(input))
  const resolved = await resolveTimelineSpec({
    plannerInput: input,
    trace,
  })
  const attachedImages = resolved.visualInputReport?.attached_image_input_count ?? 0
  await trace.writeJson('02-planning', 'planning-decision.json', {
    planner_source: resolved.plannerSource,
    planning_context: input.planningContext ?? null,
    image_inputs_attached: attachedImages,
    visual_input_report: resolved.visualInputReport ?? null,
    semantic_caption_policy: semanticCaptionPolicy(resolved.plannerSource, attachedImages),
  })
  let spec = normalizeV2TimelineTextOwnership(resolved.spec)
  const revision = input.revisionContext && input.revisionBaseSpec
    ? applyV2TimelineRevisionPreservation({
        baseSpec: input.revisionBaseSpec,
        nextSpec: spec,
        baseRevision: input.revisionContext.base_revision,
      })
    : undefined
  if (revision) spec = revision.spec
  const validation = validateRemotionTimelineSpec(spec)
  const review = buildV2TimelinePlanningReview({ spec, validation })
  await trace.writeJson('02-planning', 'timeline-spec.json', spec)
  await trace.writeJson('02-planning', 'timeline-validation.json', validation)
  if (input.revisionContext) {
    await trace.writeJson('02-planning', 'revision-context.json', input.revisionContext)
  }
  if (revision) {
    await trace.writeJson('02-planning', 'revision-diff.json', revision.audit)
    await trace.writeJson('02-planning', 'revision-preservation.json', {
      preserved_scene_notes: revision.audit.preserved_scene_notes,
      warnings: revision.audit.warnings,
    })
  }
  await trace.writeJson('02-plan-review', 'timeline-review.json', review)
  await trace.writeText('02-plan-review', 'timeline-review.zh.md', renderV2TimelinePlanningReviewMarkdown(review))
  await trace.writeSummary([
    '# V2 时间线方案预览',
    '',
    `- 任务 ID：${input.taskId}`,
    `- 规划来源：${resolved.plannerSource}`,
    `- 镜头数量：${review.metrics.scene_count}`,
    `- 已解析 AI 视频镜头：${review.metrics.ai_video_scene_count}`,
    `- 计划 AI 视频镜头：${review.metrics.planned_ai_video_scene_count}`,
    `- 当前 Remotion 兜底镜头（待生成或失败）：${review.metrics.remotion_preview_fallback_scene_count}`,
    `- 纯 Remotion 程序化镜头：${review.metrics.remotion_scene_count}`,
    `- 转场数量：${review.metrics.transition_count}`,
    `- 视觉素材覆盖：${review.metrics.used_visual_asset_count}/${review.metrics.visual_asset_count}`,
    `- 风险等级：${review.risk_level}`,
    '',
    '本步骤只规划并审查 V2 时间线：待生成的 AI 视频会保留预览兜底，尚不生成素材，也不渲染成片。',
  ])
  await trace.appendSessionEvent({
    type: 'timeline_preview_completed',
    planner_source: resolved.plannerSource,
    scene_count: spec.scenes.length,
    planned_ai_video_scene_count: review.metrics.planned_ai_video_scene_count,
    validation_ok: validation.ok,
    artifact_dir: trace.rootDir,
  })
  return {
    taskId: input.taskId,
    plannerSource: resolved.plannerSource,
    spec,
    validation,
    review,
    traceDir: trace.rootDir,
  }
}

export async function runV2RemotionTimeline(
  input: V2PlannerInput & { imageSrc?: string; timelineSpecOverride?: unknown },
  options: V2TimelineRunOptions = {},
): Promise<V2TimelineRunResult> {
  const startedAt = Date.now()
  const trace = createV2TraceWriter({
    taskId: input.timelineSpecOverride
      ? `${input.taskId}__run_${Date.now()}`
      : input.taskId,
    sessionId: options.traceContext?.sessionId,
    operationId: options.traceContext?.operationId,
  })
  const reportProgress = async (event: V2TimelineRunProgress) => {
    options.signal?.throwIfAborted()
    const progressEvent = { ...event, elapsedMs: Date.now() - startedAt }
    await trace.appendSessionEvent({
      type: 'render_progress',
      ...progressEvent,
      artifact_dir: trace.rootDir,
    })
    await options.onProgress?.(progressEvent)
  }
  await trace.writeJson('01-input', 'timeline-planner-input.json', traceablePlannerInput(input))
  await reportProgress({ phase: 'prepare', progress: 5, message: '正在读取并校验当前方案。' })
  const outputRoot = outputRootFor(input.taskId, options.outputBaseDir)
  await mkdir(outputRoot, { recursive: true })

  const resolved = await resolveTimelineSpec({
    plannerInput: input,
    trace,
    timelineSpecOverride: input.timelineSpecOverride,
  })
  assertV2TimelinePlanningComplete(resolved.spec)
  const attachedImages = resolved.visualInputReport?.attached_image_input_count ?? 0
  await trace.writeJson('02-planning', 'planning-decision.json', {
    planner_source: resolved.plannerSource,
    planning_context: input.planningContext ?? null,
    image_inputs_attached: attachedImages,
    visual_input_report: resolved.visualInputReport ?? null,
    semantic_caption_policy: semanticCaptionPolicy(resolved.plannerSource, attachedImages),
  })
  let spec = input.timelineSpecOverride
    ? resolved.spec
    : normalizeV2TimelineTextOwnership(resolved.spec)
  const revision = !input.timelineSpecOverride && input.revisionContext && input.revisionBaseSpec
    ? applyV2TimelineRevisionPreservation({
        baseSpec: input.revisionBaseSpec,
        nextSpec: spec,
        baseRevision: input.revisionContext.base_revision,
      })
    : undefined
  if (revision) spec = revision.spec
  const validation = validateRemotionTimelineSpec(spec)
  const review = buildV2TimelinePlanningReview({ spec, validation })
  await trace.writeJson('02-planning', 'timeline-spec.json', spec)
  await trace.writeJson('02-planning', 'timeline-validation.json', validation)
  if (input.revisionContext) {
    await trace.writeJson('02-planning', 'revision-context.json', input.revisionContext)
  }
  if (revision) {
    await trace.writeJson('02-planning', 'revision-diff.json', revision.audit)
    await trace.writeJson('02-planning', 'revision-preservation.json', {
      preserved_scene_notes: revision.audit.preserved_scene_notes,
      warnings: revision.audit.warnings,
    })
  }
  await trace.writeJson('02-plan-review', 'timeline-review.json', review)
  await trace.writeText('02-plan-review', 'timeline-review.zh.md', renderV2TimelinePlanningReviewMarkdown(review))
  if (!validation.ok) {
    throw new Error(`RemotionTimelineSpec validation failed: ${JSON.stringify(validation.issues, null, 2)}`)
  }
  await reportProgress({
    phase: 'prepare',
    progress: 10,
    message: resolved.plannerSource === 'override'
      ? '已读取当前草稿；本次渲染不会重新规划方案。'
      : '视频方案规划与检查已经完成。',
  })

  const materialResolution = await resolveRemotionTimelineMaterialJobs({
    spec,
    adapter: options.materialAdapter
      ?? createConfiguredV2MaterialGenerationAdapter({ outputDir: outputRoot }),
    outputDir: outputRoot,
    maxConcurrency: env.v2MaterialGenerationConcurrency,
    idempotency: options.materialExecution?.idempotency,
    reusableRun: options.materialExecution?.reusableRun,
    signal: options.signal,
    onProgress: async (event) => {
      const fraction = event.total > 0 ? event.completed / event.total : 1
      await reportProgress({
        phase: 'material_generation',
        progress: Math.round(10 + fraction * 70),
        message: event.status === 'started'
          ? '正在生成一个镜头的画面素材。'
          : '一个镜头的画面素材已经处理完毕。',
        jobId: event.jobId,
        sceneId: event.sceneId,
      })
    },
  })
  await trace.writeJson('03-material-jobs', 'timeline-material-resolution.json', materialResolution.report)
  options.signal?.throwIfAborted()
  await trace.writeJson('03-material-jobs', 'delivery-readiness.json', materialResolution.report.delivery_readiness)
  if (!materialResolution.report.ok) {
    throw new Error(`Timeline material resolution failed: ${JSON.stringify(materialResolution.report.failed_jobs, null, 2)}`)
  }
  if (!materialResolution.report.delivery_readiness.ready) {
    throw new Error(
      `Timeline delivery is incomplete; generated scenes are missing: ${
        materialResolution.report.delivery_readiness.missing_generated_scene_ids.join(', ')
      }`,
    )
  }

  await reportProgress({ phase: 'standardize', progress: 85, message: '正在标准化已生成的视频素材。' })
  const standardized = await standardizeRemotionTimelineVideoAssets({
    spec: materialResolution.spec,
    outputDir: outputRoot,
    signal: options.signal,
    alreadyStandardizedAssetIds: materialResolution.report.generation_trace
      .flatMap((trace) =>
        trace.status === 'fulfilled' && trace.output_asset_id && trace.output_sha256
          ? [trace.output_asset_id]
          : [],
      ),
  })
  options.signal?.throwIfAborted()
  await trace.writeJson('04-material-assets', 'timeline-standardized-assets.json', standardized.standardized_assets)
  const renderValidation = validateRemotionTimelineSpec(standardized.spec)
  await trace.writeJson('05-remotion-props', 'timeline-render-validation.json', renderValidation)
  await trace.writeJson('05-remotion-props', 'timeline-render-spec.json', standardized.spec)
  if (!renderValidation.ok) {
    throw new Error(`Renderable timeline validation failed: ${JSON.stringify(renderValidation.issues, null, 2)}`)
  }

  await reportProgress({ phase: 'remotion_render', progress: 92, message: '素材已齐备，正在合成成片。' })
  const render = await renderV2RemotionTimeline({
    spec: standardized.spec,
    outputDir: outputRoot,
    outputName: `${input.taskId}.mp4`,
    authorizedDraftComponentIds: options.authorizedDraftComponentIds,
    signal: options.signal,
  })
  await trace.writeJson('06-remotion-render', 'timeline-render-result.json', render)
  await trace.writeText('06-remotion-render', 'timeline-render-command.txt', render.command.join(' '))
  await trace.writeText('06-remotion-render', 'timeline-render.log', render.log)

  const warnings: string[] = []
  if (render.fileSizeBytes < 10_000) warnings.push('Rendered file is unexpectedly small.')
  const evaluation = {
    ok: warnings.length === 0,
    metrics: {
      file_size_bytes: render.fileSizeBytes,
      scene_count: standardized.spec.scenes.length,
      transition_count: standardized.spec.transitions.length,
      overlay_count: standardized.spec.overlays.length,
      standardized_video_asset_count: standardized.standardized_assets.length,
      planned_generated_scene_count: materialResolution.report.delivery_readiness.planned_generated_scene_count,
      resolved_generated_scene_count: materialResolution.report.delivery_readiness.resolved_generated_scene_count,
      fallback_scene_count: materialResolution.report.delivery_readiness.fallback_scene_count,
    },
    warnings,
  }
  await trace.writeJson('07-evaluation', 'timeline-evaluation.json', evaluation)
  await reportProgress({ phase: 'complete', progress: 100, message: '视频成片已经生成。' })
  await trace.appendSessionEvent({
    type: 'render_completed',
    ok: evaluation.ok,
    output_path: render.outputPath,
    material_delivery: materialResolution.report.delivery_readiness,
    artifact_dir: trace.rootDir,
  })
  await trace.writeSummary([
    '# V2 时间线渲染',
    '',
    `- 任务 ID：${input.taskId}`,
    `- 规划来源：${resolved.plannerSource}`,
    `- 镜头数量：${standardized.spec.scenes.length}`,
    `- 转场数量：${standardized.spec.transitions.length}`,
    `- 素材任务是否成功：${materialResolution.report.ok}`,
    `- 已标准化视频素材：${standardized.standardized_assets.length}`,
    `- 输出文件：${render.outputPath}`,
    `- 输出大小：${render.fileSizeBytes} bytes`,
    `- 基础评估：${evaluation.ok ? '通过' : '有警告'}`,
  ])

  return {
    ok: evaluation.ok,
    taskId: input.taskId,
    plannerSource: resolved.plannerSource,
    spec: standardized.spec,
    validation: renderValidation,
    review,
    materialResolution: materialResolution.report,
    standardizedAssets: standardized.standardized_assets,
    render,
    outputPath: render.outputPath,
    traceDir: trace.rootDir,
    evaluation,
  }
}
