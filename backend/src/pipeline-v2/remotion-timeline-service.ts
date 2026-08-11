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
  type V2TimelineMaterialResolutionReport,
} from './remotion-timeline-material-resolver.js'
import {
  buildDeterministicRemotionTimelineSpec,
  buildV2PlanningGapTimelineSpec,
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
import type { V2TraceContext } from './trace.js'
import type { V2PlannerInput } from './v2-input.js'
import type { V2TimelineVisualInputReport } from './remotion-timeline-llm-planner.js'
import { applyV2TimelineRevisionPreservation } from './timeline-revision-context.js'
import { applyV2TimelineRevisionScope } from './timeline-revision-scope.js'
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
}

export interface V2TimelineRunOptions {
  onProgress?: (event: V2TimelineRunProgress) => void | Promise<void>
  traceContext?: V2TraceContext
  /** Server-authorized draft components already bound to the persisted source timeline. */
  authorizedDraftComponentIds?: readonly string[]
  /** Internal test seam. Public HTTP callers cannot bind this option. */
  materialAdapter?: V2MaterialGenerationAdapter
  /** Internal RenderRun facts used for Provider idempotency and generated-shot reuse. */
  materialExecution?: {
    idempotency: {
      repository: V2IdempotencyRepository
      userId: number
      draftId: string
      renderRunId: string
      renderKey: string
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
  if (plannerSource.startsWith('llm') && attachedImages > 0) {
    return 'planner_may_create_captions_from_attached_image_inputs'
  }
  if (plannerSource.startsWith('llm')) {
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
  const bindComponentNames = (spec: RemotionTimelineSpecV1) =>
    bindRegisteredRenderComponentDisplayNames(spec)
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
      let llmPlanner = await runV2TimelineLlmPlanner(plannerInputFrom(input.plannerInput))
      let correctionApplied = false
      await input.trace.writeText('02-planning', 'llm-timeline-planner-prompt.md', llmPlanner.promptText)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-model-response.audit.json', llmPlanner.initialResponseAudit)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-json-candidate.audit.json', llmPlanner.rawResponse)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-extraction-report.json', llmPlanner.extractionReport)
      await input.trace.writeJson('02-planning', 'llm-timeline-visual-inputs.json', llmPlanner.visualInputReport)
      await input.trace.writeJson('02-planning', 'llm-timeline-planner-repairs.json', llmPlanner.repairs)
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
        if (input.plannerInput.revisionBaseSpec && input.plannerInput.revisionScope) {
          llmPlanner = {
            ...llmPlanner,
            spec: applyV2TimelineRevisionScope({
              baseSpec: input.plannerInput.revisionBaseSpec,
              candidateSpec: llmPlanner.spec,
              scope: input.plannerInput.revisionScope,
              sceneId: input.plannerInput.revisionSceneId,
              sceneIds: input.plannerInput.revisionSceneIds,
              transitionIds: input.plannerInput.revisionTransitionIds,
              globalMode: input.plannerInput.revisionGlobalMode,
            }),
          }
          await input.trace.writeJson('02-planning', 'timeline-scoped-candidate.json', llmPlanner.spec)
        }
        llmPlanner = {
          ...llmPlanner,
          spec: await bindComponentNames(llmPlanner.spec),
        }
        let outcomeReview = await reviewV2TimelineRevisionOutcome({
          prompt: input.plannerInput.prompt,
          baseSpec: input.plannerInput.revisionBaseSpec,
          candidateSpec: llmPlanner.spec,
          availableComponents: input.plannerInput.availableComponents,
          confirmedContext: input.plannerInput.conversationSummary,
          revisionScope: input.plannerInput.revisionScope,
          revisionSceneId: input.plannerInput.revisionSceneId,
          revisionSceneIds: input.plannerInput.revisionSceneIds,
          revisionTransitionIds: input.plannerInput.revisionTransitionIds,
        })
        await input.trace.writeJson('02-planning', 'timeline-outcome-review.json', outcomeReview)
        if (!outcomeReview.pass) {
          correctionApplied = true
          const correctionPrompt = [
            llmPlanner.promptText,
            '',
            'The candidate revision did not satisfy the independent V2 outcome review.',
            input.plannerInput.revisionBaseSpec
              ? 'Return a corrected full timeline JSON. Preserve all confirmed content that the user did not ask to change.'
              : 'Return a corrected full timeline JSON that fulfils the user request.',
            `Review violations: ${JSON.stringify(outcomeReview.violations)}`,
            `Required repair: ${outcomeReview.repairInstruction ?? 'Correct the listed semantic violations without broadening the revision scope.'}`,
          ].join('\n')
          await input.trace.writeText('02-planning', 'timeline-outcome-correction-request.md', correctionPrompt)
          llmPlanner = await runV2TimelineLlmPlanner(
            plannerInputFrom(input.plannerInput),
            { promptText: correctionPrompt, allowJsonRepair: false },
          )
          await input.trace.writeJson('02-planning', 'timeline-outcome-correction-model-response.audit.json', llmPlanner.initialResponseAudit)
          await input.trace.writeJson('02-planning', 'timeline-outcome-correction-json-candidate.audit.json', llmPlanner.rawResponse)
          if (input.plannerInput.revisionBaseSpec && input.plannerInput.revisionScope) {
            llmPlanner = {
              ...llmPlanner,
              spec: applyV2TimelineRevisionScope({
                baseSpec: input.plannerInput.revisionBaseSpec,
                candidateSpec: llmPlanner.spec,
                scope: input.plannerInput.revisionScope,
                sceneId: input.plannerInput.revisionSceneId,
                sceneIds: input.plannerInput.revisionSceneIds,
                transitionIds: input.plannerInput.revisionTransitionIds,
                globalMode: input.plannerInput.revisionGlobalMode,
              }),
            }
            await input.trace.writeJson('02-planning', 'timeline-outcome-correction-scoped-candidate.json', llmPlanner.spec)
          }
          llmPlanner = {
            ...llmPlanner,
            spec: await bindComponentNames(llmPlanner.spec),
          }
          outcomeReview = await reviewV2TimelineRevisionOutcome({
            prompt: input.plannerInput.prompt,
            baseSpec: input.plannerInput.revisionBaseSpec,
            candidateSpec: llmPlanner.spec,
            availableComponents: input.plannerInput.availableComponents,
            confirmedContext: input.plannerInput.conversationSummary,
            revisionScope: input.plannerInput.revisionScope,
            revisionSceneId: input.plannerInput.revisionSceneId,
            revisionSceneIds: input.plannerInput.revisionSceneIds,
            revisionTransitionIds: input.plannerInput.revisionTransitionIds,
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
      // A deterministic initial plan is not a valid substitute for an edit:
      // it has no scoped relation to the saved base and could replace it.
      if (input.plannerInput.revisionBaseSpec) throw error
      const hasParsedSampleFacts = Boolean(input.plannerInput.sampleUnderstanding)
      const hasUnparsedSample = Boolean(input.plannerInput.referenceVideoPath) && !hasParsedSampleFacts
      const hasVisualMaterial = Boolean(
        input.plannerInput.imageSrc
        || input.plannerInput.inputImageUrl
        || input.plannerInput.materials?.some((material) => material.type === 'image' || material.type === 'video'),
      )
      const requestsUnavailableVisualFallback = input.plannerInput.creationMode === 'material_brief'
        || input.plannerInput.creationMode === 'sample_replicate'
      const canFallbackDeterministically = hasParsedSampleFacts
        || (!hasUnparsedSample && !hasVisualMaterial && !requestsUnavailableVisualFallback)
      if (!canFallbackDeterministically) {
        const area = input.plannerInput.creationMode === 'sample_replicate'
          ? 'sample_transfer'
          : hasVisualMaterial
            ? 'image_understanding'
            : 'scene_plan'
        const spec = await bindComponentNames(buildV2PlanningGapTimelineSpec(input.plannerInput, [{
          area,
          message: `Planner could not produce a verified timeline: ${message}`,
        }]))
        await input.trace.writeJson('02-planning', 'timeline-planning-gap-spec.json', spec)
        return { spec, plannerSource: 'llm_planning_gap' }
      }
      if (!input.plannerInput.allowPlannerFallback) throw error
      const spec = await bindComponentNames(await buildTimelineSpec(input.plannerInput))
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
  options: V2TimelinePreviewOptions = {},
): Promise<V2TimelinePreviewResult> {
  const trace = createV2TraceWriter({
    taskId: input.taskId,
    sessionId: options.traceContext?.sessionId,
    operationId: options.traceContext?.operationId,
  })
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
    synthesizeMissing: !input.revisionBaseSpec,
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
  if (input.revisionBaseSpec && !hardRequirementCheck.ok) {
    throw new Error(`V2 hard requirements failed: ${JSON.stringify(hardRequirementCheck.missing_captions)}`)
  }
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
    const progressEvent = { ...event, elapsedMs: Date.now() - startedAt }
    await trace.appendSessionEvent({
      type: 'render_progress',
      ...progressEvent,
      artifact_dir: trace.rootDir,
    })
    await options.onProgress?.(progressEvent)
  }
  await trace.writeJson('01-input', 'timeline-planner-input.json', traceablePlannerInput(input))
  await reportProgress({ phase: 'prepare', progress: 5, message: '正在读取并校验当前 V2 草稿。' })
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  await trace.writeJson('01-input', 'timeline-hard-requirements.json', hardRequirements)
  const outputRoot = outputRootFor(input.taskId)
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
    : applyV2TimelineHardRequirements({
        spec: normalizeV2TimelineTextOwnership(resolved.spec),
        requirements: hardRequirements,
        synthesizeMissing: !input.revisionBaseSpec,
      })
  const revision = !input.timelineSpecOverride && input.revisionContext && input.revisionBaseSpec
    ? applyV2TimelineRevisionPreservation({
        baseSpec: input.revisionBaseSpec,
        nextSpec: spec,
        baseRevision: input.revisionContext.base_revision,
      })
    : undefined
  if (revision) spec = revision.spec
  const validation = validateRemotionTimelineSpec(spec)
  const hardRequirementCheck = input.timelineSpecOverride
    ? { ok: true, missing_captions: [] as string[] }
    : evaluateV2TimelineHardRequirements({ spec, requirements: hardRequirements })
  if (!input.timelineSpecOverride && !hardRequirementCheck.ok) {
    throw new Error(`V2 hard requirements failed: ${JSON.stringify(hardRequirementCheck.missing_captions)}`)
  }
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
  await reportProgress({
    phase: 'prepare',
    progress: 10,
    message: resolved.plannerSource === 'override'
      ? '已读取当前草稿；本次渲染不会重新规划方案。'
      : 'V2 时间线规划与校验已完成。',
  })

  const materialResolution = await resolveRemotionTimelineMaterialJobs({
    spec,
    adapter: options.materialAdapter
      ?? createConfiguredV2MaterialGenerationAdapter({ outputDir: outputRoot }),
    outputDir: outputRoot,
    maxConcurrency: env.v2MaterialGenerationConcurrency,
    idempotency: options.materialExecution?.idempotency,
    reusableRun: options.materialExecution?.reusableRun,
    onProgress: async (event) => {
      const fraction = event.total > 0 ? event.completed / event.total : 1
      await reportProgress({
        phase: 'material_generation',
        progress: Math.round(10 + fraction * 70),
        message: event.status === 'started'
          ? `正在生成镜头素材：${event.sceneId}`
          : `镜头素材 ${event.sceneId}：${event.status}`,
        jobId: event.jobId,
        sceneId: event.sceneId,
      })
    },
  })
  await trace.writeJson('03-material-jobs', 'timeline-material-resolution.json', materialResolution.report)
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
  })
  await trace.writeJson('04-material-assets', 'timeline-standardized-assets.json', standardized.standardized_assets)
  const renderValidation = validateRemotionTimelineSpec(standardized.spec)
  await trace.writeJson('05-remotion-props', 'timeline-render-validation.json', renderValidation)
  await trace.writeJson('05-remotion-props', 'timeline-render-spec.json', standardized.spec)
  if (!renderValidation.ok) {
    throw new Error(`Renderable timeline validation failed: ${JSON.stringify(renderValidation.issues, null, 2)}`)
  }

  await reportProgress({ phase: 'remotion_render', progress: 92, message: '素材已齐备，正在由 Remotion 编排并渲染。' })
  const render = await renderV2RemotionTimeline({
    spec: standardized.spec,
    outputDir: outputRoot,
    outputName: `${input.taskId}.mp4`,
    authorizedDraftComponentIds: options.authorizedDraftComponentIds,
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
  await reportProgress({ phase: 'complete', progress: 100, message: 'V2 视频渲染已完成。' })
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
