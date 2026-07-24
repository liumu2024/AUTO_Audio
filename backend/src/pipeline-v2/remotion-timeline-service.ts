import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  validateRemotionTimelineSpec,
  type RemotionTimelineValidationReport,
} from '../../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../../shared/lib/remotion-timeline-text-ownership.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { createConfiguredV2MaterialGenerationAdapter } from './configured-material-adapter.js'
import {
  resolveRemotionTimelineMaterialJobs,
  standardizeRemotionTimelineVideoAssets,
  type V2TimelineMaterialResolutionReport,
} from './remotion-timeline-material-resolver.js'
import {
  buildDeterministicRemotionTimelineSpec,
  type V2RemotionTimelinePlannerInput,
} from './remotion-timeline-planner.js'
import {
  applyV2TimelineHardRequirements,
  evaluateV2TimelineHardRequirements,
  extractV2TimelineHardRequirements,
} from './hard-requirements.js'
import { renderV2RemotionTimeline, type V2TimelineRenderResult } from './remotion-timeline-renderer.js'
import {
  buildV2TimelinePlanningReview,
  renderV2TimelinePlanningReviewMarkdown,
  type V2TimelinePlanningReview,
} from './remotion-timeline-review.js'
import { createV2TraceWriter } from './trace.js'
import type { V2PlannerInput } from './v2-input.js'
import type { V2TimelineVisualInputReport } from './remotion-timeline-llm-planner.js'
import { applyV2TimelineRevisionPreservation } from './timeline-revision-context.js'

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

function plannerInputFrom(input: V2PlannerInput & { imageSrc?: string }): V2RemotionTimelinePlannerInput {
  return {
    ...input,
    imageSrc: input.imageSrc,
  }
}

function outputRootFor(taskId: string): string {
  return path.resolve(process.cwd(), 'v2-renders', taskId)
}

function traceablePlannerInput(input: V2PlannerInput & { imageSrc?: string }) {
  // The full persisted base spec is server-only preservation state. Trace the
  // compact revision contract separately so input traces mirror model context.
  const { revisionBaseSpec: _revisionBaseSpec, ...traceInput } = input
  return traceInput
}

function semanticCaptionPolicy(plannerSource: string, attachedImages: number): string {
  if (plannerSource === 'override') return 'render_existing_revision_without_replanning'
  if (plannerSource === 'llm' && attachedImages > 0) {
    return 'planner_may_create_captions_from_attached_image_inputs'
  }
  if (plannerSource === 'llm') {
    return 'planner_must_not_claim_image_understanding_without_accessible_image_inputs'
  }
  return 'fallback_preserves_only_explicit_user_caption_requirements'
}

async function buildTimelineSpec(input: V2PlannerInput & { imageSrc?: string }): Promise<RemotionTimelineSpecV1> {
  return buildDeterministicRemotionTimelineSpec(plannerInputFrom(input))
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
  if (input.timelineSpecOverride) {
    await input.trace.writeJson('02-planning', 'timeline-spec-override.json', input.timelineSpecOverride)
    return {
      spec: input.timelineSpecOverride as RemotionTimelineSpecV1,
      plannerSource: 'override',
    }
  }

  if (input.plannerInput.plannerMode === 'llm') {
    try {
      const { runV2TimelineLlmPlanner } = await import('./remotion-timeline-llm-planner.js')
      const llmPlanner = await runV2TimelineLlmPlanner(plannerInputFrom(input.plannerInput))
      await input.trace.writeText('02-planning', 'llm-timeline-planner-prompt.md', llmPlanner.promptText)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-raw-response.json', llmPlanner.rawResponse)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-extraction-report.json', llmPlanner.extractionReport)
      await input.trace.writeJson('02-planning', 'llm-timeline-visual-inputs.json', llmPlanner.visualInputReport)
      return {
        spec: llmPlanner.spec,
        plannerSource: 'llm',
        visualInputReport: llmPlanner.visualInputReport,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-error.json', { message })
      if (!input.plannerInput.allowPlannerFallback) throw error
      const spec = await buildTimelineSpec(input.plannerInput)
      await input.trace.writeJson('02-planning', 'timeline-fallback-spec.json', spec)
      return {
        spec,
        plannerSource: 'llm_fallback_deterministic',
      }
    }
  }

  const spec = await buildTimelineSpec(input.plannerInput)
  return {
    spec,
    plannerSource: input.plannerInput.plannerMode ?? 'deterministic',
  }
}

export async function previewV2RemotionTimeline(
  input: V2PlannerInput & { imageSrc?: string },
): Promise<V2TimelinePreviewResult> {
  const trace = createV2TraceWriter({ taskId: input.taskId })
  await trace.writeJson('01-input', 'timeline-planner-input.json', traceablePlannerInput(input))
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  await trace.writeJson('01-input', 'timeline-hard-requirements.json', hardRequirements)
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
  let spec = applyV2TimelineHardRequirements({
    spec: normalizeV2TimelineTextOwnership(resolved.spec),
    requirements: hardRequirements,
  })
  const revision = input.revisionContext && input.revisionBaseSpec
    ? applyV2TimelineRevisionPreservation({
        baseSpec: input.revisionBaseSpec,
        nextSpec: spec,
        baseRevision: input.revisionContext.base_revision,
      })
    : undefined
  if (revision) spec = revision.spec
  const validation = validateRemotionTimelineSpec(spec)
  const hardRequirementCheck = evaluateV2TimelineHardRequirements({
    spec,
    requirements: hardRequirements,
  })
  const review = buildV2TimelinePlanningReview({ spec, validation })
  await trace.writeJson('02-planning', 'timeline-spec.json', spec)
  await trace.writeJson('02-planning', 'timeline-validation.json', validation)
  await trace.writeJson('02-planning', 'timeline-hard-requirement-check.json', hardRequirementCheck)
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
    `- Remotion 镜头：${review.metrics.remotion_scene_count}`,
    `- AI 视频镜头：${review.metrics.ai_video_scene_count}`,
    `- 转场数量：${review.metrics.transition_count}`,
    `- 视觉素材覆盖：${review.metrics.used_visual_asset_count}/${review.metrics.visual_asset_count}`,
    `- 风险等级：${review.risk_level}`,
    '',
    '本步骤只规划并审查 Remotion-first 时间线，不生成素材，也不渲染成片。',
  ])
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
): Promise<V2TimelineRunResult> {
  const trace = createV2TraceWriter({
    taskId: input.timelineSpecOverride
      ? `${input.taskId}__run_${Date.now()}`
      : input.taskId,
  })
  await trace.writeJson('01-input', 'timeline-planner-input.json', traceablePlannerInput(input))
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  await trace.writeJson('01-input', 'timeline-hard-requirements.json', hardRequirements)
  const outputRoot = outputRootFor(input.taskId)
  await mkdir(outputRoot, { recursive: true })

  const resolved = await resolveTimelineSpec({
    plannerInput: input,
    trace,
    timelineSpecOverride: input.timelineSpecOverride,
  })
  const attachedImages = resolved.visualInputReport?.attached_image_input_count ?? 0
  await trace.writeJson('02-planning', 'planning-decision.json', {
    planner_source: resolved.plannerSource,
    planning_context: input.planningContext ?? null,
    image_inputs_attached: attachedImages,
    visual_input_report: resolved.visualInputReport ?? null,
    semantic_caption_policy: semanticCaptionPolicy(resolved.plannerSource, attachedImages),
  })
  let spec = applyV2TimelineHardRequirements({
    spec: normalizeV2TimelineTextOwnership(resolved.spec),
    requirements: hardRequirements,
  })
  const revision = input.revisionContext && input.revisionBaseSpec
    ? applyV2TimelineRevisionPreservation({
        baseSpec: input.revisionBaseSpec,
        nextSpec: spec,
        baseRevision: input.revisionContext.base_revision,
      })
    : undefined
  if (revision) spec = revision.spec
  const validation = validateRemotionTimelineSpec(spec)
  const hardRequirementCheck = evaluateV2TimelineHardRequirements({
    spec,
    requirements: hardRequirements,
  })
  const review = buildV2TimelinePlanningReview({ spec, validation })
  await trace.writeJson('02-planning', 'timeline-spec.json', spec)
  await trace.writeJson('02-planning', 'timeline-validation.json', validation)
  await trace.writeJson('02-planning', 'timeline-hard-requirement-check.json', hardRequirementCheck)
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

  const materialResolution = await resolveRemotionTimelineMaterialJobs({
    spec,
    adapter: createConfiguredV2MaterialGenerationAdapter({ outputDir: outputRoot }),
    outputDir: outputRoot,
  })
  await trace.writeJson('03-material-jobs', 'timeline-material-resolution.json', materialResolution.report)
  if (!materialResolution.report.ok) {
    throw new Error(`Timeline material resolution failed: ${JSON.stringify(materialResolution.report.failed_jobs, null, 2)}`)
  }

  const standardized = await standardizeRemotionTimelineVideoAssets({
    spec: materialResolution.spec,
    outputDir: outputRoot,
  })
  await trace.writeJson('04-material-assets', 'timeline-standardized-assets.json', standardized.standardized_assets)
  const renderValidation = validateRemotionTimelineSpec(standardized.spec)
  await trace.writeJson('05-remotion-props', 'timeline-render-validation.json', renderValidation)
  await trace.writeJson('05-remotion-props', 'timeline-render-spec.json', standardized.spec)
  if (!renderValidation.ok) {
    throw new Error(`Renderable timeline validation failed: ${JSON.stringify(renderValidation.issues, null, 2)}`)
  }

  const render = await renderV2RemotionTimeline({
    spec: standardized.spec,
    outputDir: outputRoot,
    outputName: `${input.taskId}.mp4`,
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
    },
    warnings,
  }
  await trace.writeJson('07-evaluation', 'timeline-evaluation.json', evaluation)
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
