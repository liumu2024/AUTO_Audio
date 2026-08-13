import { randomUUID } from 'node:crypto'

import { env } from '../../config/env.js'
import { validateRemotionTimelineSpec } from '../../../../shared/lib/remotion-timeline-validator.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorContext, DirectorTimelineFacts } from '../../../../shared/types/director-context.js'
import type { DirectorWorkspaceState } from '../../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { analyzeV2Sample } from '../sample-understanding-service.js'
import { previewV2RemotionTimeline } from '../remotion-timeline-service.js'
import { buildV2TimelinePlanningReview } from '../remotion-timeline-review.js'
import { executeV2TimelineDraftRun } from '../timeline-draft-runner.js'
import { buildV2TimelineRevisionContext } from '../timeline-revision-context.js'
import { normalizeV2TimelineSelection } from '../timeline-selection.js'
import {
  buildDirectorTimelineFacts,
  describeV2TimelineSpecDiff,
  evaluateV2TimelineRevisionCommit,
  verifyV2TimelinePendingResolution,
} from '../timeline-revision-outcome-review.js'
import type { V2TimelineRevisionScope } from '../timeline-revision-scope.js'
import {
  listPromotedComponents,
  readRenderComponent,
  RENDER_COMPONENT_VISUAL_POLICY_VERSION,
  timelineRenderComponentReferences,
  type RenderComponentSummary,
} from '../../modules/render-components/component-registry.js'
import {
  authorRenderComponent,
  RENDER_COMPONENT_AUTHORING_POLICY_VERSION,
  RENDER_COMPONENT_RUNTIME_VERSION,
  settleTimelineRenderComponentVisualEvidence,
} from '../../modules/render-components/component-authoring-agent.js'
import { RENDER_COMPONENT_SANDBOX_POLICY_VERSION } from '../../modules/render-components/component-sandbox.js'
import {
  createV2TimelineDraftRepository,
  V2TimelineComponentReferenceError,
  type V2TimelineDraftRecord,
} from '../timeline-draft-repository.js'
import type { V2PlannerInput } from '../v2-input.js'
import {
  bindV2AgentToolArguments,
  evaluateV2AgentToolReadiness,
  resolveV2AgentSample,
  validateV2AgentToolRequest,
  type V2AgentToolMode,
} from './registry.js'
import type { V2AgentExecutionStage } from '../agent-skills/registry.js'
import {
  executeV2JsonIdempotentOperation,
  V2IdempotencyConflictError,
  v2IdempotencyRequestHash,
} from '../idempotency-repository.js'
import { V2_TIMELINE_PLANNER_PROTOCOL_VERSION } from '../remotion-timeline-llm-planner.js'
import type { V2MaterialGenerationAdapter } from '../material-generation-adapter.js'

export interface V2AgentToolProposal {
  /** Model-local action reference. It is never used as an execution identity. */
  ref: string
  toolId: string
  skillId: string
  arguments: Record<string, unknown>
  requestedMode: V2AgentToolMode
  dependsOn: string[]
}

export interface V2AgentToolRequest extends V2AgentToolProposal {
  /** Canonical server-owned execution identity. */
  callId: string
}

export interface V2AgentToolResult {
  callId: string
  toolId: string
  ok: boolean
  summary: string
  /** Which review gate rejected the tool, when applicable. */
  gate?: string
  draft?: {
    id: string
    revision: number
    spec: RemotionTimelineSpecV1
    traceDir?: string
    pendingTimelineRevisions?: V2TimelineDraftRecord['pendingTimelineRevisions']
  }
  sampleUnderstanding?: unknown
  sampleSelection?: { id: string; url: string; name?: string }
  output?: Record<string, unknown>
  recovery?: string
  /** True only when the V2 timeline planner was actually invoked. */
  plannerInvoked?: boolean
}

export interface V2AgentToolProgress {
  phase: string
  progress: number
  message: string
  elapsedMs?: number
  jobId?: string
  sceneId?: string
}

export interface V2AgentToolAuthorizationGrant {
  granted: boolean
  evidence: string
}

export interface V2AgentToolDispatchInput {
  stage: V2AgentExecutionStage
  prompt: string
  /** The tool request's own instruction, used as the revision review boundary
   * for scoped edits. Falls back to the full conversation prompt when absent. */
  requestInstruction?: string
  userId: number
  context: DirectorContext
  runtime: DirectorConversationRuntime
  workspace: DirectorWorkspaceState
  authorization?: V2AgentToolAuthorizationGrant
  traceSessionId?: string
  recalledCreativeMemories?: string[]
  recalledCreativeKnowledge?: string[]
  authorizedDraftComponentIds?: string[]
  onProgress?: (event: V2AgentToolProgress) => void | Promise<void>
  /** Internal evaluation seam; public requests cannot supply an adapter. */
  materialAdapter?: V2MaterialGenerationAdapter
  /** Internal evaluation seam; public requests cannot select an output directory. */
  renderOutputBaseDir?: string
}

const drafts = createV2TimelineDraftRepository()

function creationMode(context: DirectorContext): V2PlannerInput['creationMode'] {
  if (context.sampleVideo?.url) return 'sample_replicate'
  if (context.materials.some((material) => material.type === 'image' || material.type === 'video')) return 'material_brief'
  return 'text_to_video'
}

function canvas(aspectRatio: DirectorContext['slots']['aspectRatio']) {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080, fps: 30 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080, fps: 30 }
  if (aspectRatio === '4:3') return { width: 1440, height: 1080, fps: 30 }
  return { width: 1080, height: 1920, fps: 30 }
}

function plannerInput(input: {
  taskId: string
  prompt: string
  context: DirectorContext
  workspace: DirectorWorkspaceState
  authorization?: V2AgentToolAuthorizationGrant
  stage: V2AgentExecutionStage
  recalledCreativeMemories?: string[]
  recalledCreativeKnowledge?: string[]
  availableComponents?: RenderComponentSummary[]
}): V2PlannerInput {
  return {
    taskId: input.taskId,
    prompt: input.prompt,
    creationMode: creationMode(input.context),
    referenceVideoPath: input.context.sampleVideo?.url,
    sampleUnderstanding: input.context.sampleVideo?.sampleUnderstanding,
    conversationSummary: input.context.conversationSummary,
    materials: input.context.materials.map((material) => ({
      id: material.id, name: material.name, type: material.type,
      src: material.url,
      tags: material.tags,
    })),
    durationSec: input.context.effectiveCreativeConfig?.durationSec ?? input.context.userIntent.durationSec ?? input.context.slots.durationSec,
    plannerMode: 'llm',
    allowPlannerFallback: !input.workspace.draftId,
    canvas: canvas(input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio),
    planningContext: {
      kind: input.workspace.draftId ? 'revision' : 'initial',
      activeRequirements: input.workspace.confirmedRequirements
        .filter((item) => item.status === 'active')
        .map((item) => item.statement),
      recalledCreativeMemories: input.recalledCreativeMemories ?? [],
      recalledCreativeKnowledge: input.recalledCreativeKnowledge ?? [],
      draftId: input.workspace.draftId,
      baseRevision: input.workspace.baseRevision,
      authorizationEvidence: input.authorization?.evidence,
    },
    agentSkillContext: {
      primary: {
        id: input.stage.primarySkill.id,
        version: input.stage.primarySkill.version,
        source: input.stage.primarySkill.source,
        hash: input.stage.primarySkill.hash,
        content: input.stage.primarySkill.content,
        purpose: input.stage.primarySkill.purpose,
      },
      references: input.stage.references.map(({ id, version, source, hash, content }) => ({
        id, version, source, hash, content,
      })),
    },
    agentToolContext: {
      callId: input.stage.toolRequest.callId,
      toolId: input.stage.toolRequest.toolId,
      arguments: input.stage.toolRequest.arguments,
    },
    availableComponents: input.availableComponents,
  }
}

async function dispatchV2AgentToolOnce(input: V2AgentToolDispatchInput): Promise<V2AgentToolResult> {
  const request = input.stage.toolRequest
  if (input.stage.primarySkill.id !== request.skillId) {
    return { callId: request.callId, toolId: request.toolId, ok: false, summary: 'Tool 与本轮主 Skill 不一致。', recovery: '重新生成一致的 Skill/Tool 提案。' }
  }
  const checked = validateV2AgentToolRequest(request, {
    selectedSkillIds: new Set([input.stage.primarySkill.id]),
  })
  if (!checked.ok) return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'registry_arguments', summary: checked.reason, recovery: '请使用当前 V2 可用能力重新提出请求。' }
  if (input.workspace.recentToolCallIds?.includes(request.callId)) {
    return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'idempotency', summary: '重复的工具调用已被拒绝。', recovery: '等待已有调用的真实结果。' }
  }
  const existing = input.workspace.draftId && input.workspace.baseRevision
    ? await drafts.getRevision(input.workspace.draftId, input.workspace.baseRevision, input.userId)
    : null
  const readiness = evaluateV2AgentToolReadiness({
    toolId: request.toolId,
    context: input.context,
    runtime: input.runtime,
    workspace: input.workspace,
    authorizationGranted: input.authorization?.granted,
    timelineSpec: existing?.spec,
  })
  if (readiness.status !== 'ready') {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'readiness',
      summary: readiness.status === 'needs_authorization'
        ? '当前操作需要用户明确授权。'
        : readiness.missing.map((item) => item.description).join('；'),
      recovery: checked.tool.recovery,
    }
  }
  const bound = bindV2AgentToolArguments({
    modelArguments: checked.arguments,
    context: input.context,
    workspace: input.workspace,
    userId: input.userId,
  })

  if (request.toolId === 'timeline.pending.dismiss') {
    if (!input.workspace.draftId || !input.workspace.baseRevision) {
      return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'dispatcher_draft', summary: '当前没有可处理失败修订的草稿。' }
    }
    const draft = await drafts.dismissPendingRevision({
      draftId: input.workspace.draftId,
      userId: input.userId,
      baseRevision: input.workspace.baseRevision,
      callId: checked.arguments.callId as string,
    })
    if (!draft) return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'dispatcher_draft', summary: '当前草稿不存在。' }
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: true,
      summary: '已按本轮明确要求放弃该失败修改；当前已保存方案保持不变。',
      draft: { id: draft.id, revision: draft.revision, spec: draft.spec, traceDir: draft.traceDir, pendingTimelineRevisions: draft.pendingTimelineRevisions },
      output: { selectedItemId: input.workspace.selectedItemId },
    }
  }

  if (request.toolId === 'material.inspect') {
    const selected = new Set(bound.system.materialIds)
    const materials = input.context.materials.filter((material) => selected.has(material.id))
    return { callId: request.callId, toolId: request.toolId, ok: true, summary: `已检查 ${materials.length} 个 V2 候选素材。`, output: { materials: materials.map(({ id, type, name, tags }) => ({ id, type, name, tags })) } }
  }
  if (request.toolId === 'render.author') {
    const args = checked.arguments as {
      purpose: 'scene' | 'transition'
      displayName: string
      effectBrief: string
      acceptanceCriteria: string[]
    }
    await input.onProgress?.({ phase: 'component_authoring', progress: 0.1, message: '编码 Agent 正在生成并验证 Remotion 组件。' })
    const authored = await authorRenderComponent({
      purpose: args.purpose,
      displayName: args.displayName,
      effectBrief: args.effectBrief,
      acceptanceCriteria: args.acceptanceCriteria,
      canvas: {
        ...canvas(input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio),
        durationSec: input.context.effectiveCreativeConfig?.durationSec
          ?? input.context.userIntent.durationSec
          ?? input.context.slots.durationSec
          ?? 15,
      },
      skillContent: input.stage.primarySkill.content,
      sourceWorkspaceSessionId: input.traceSessionId,
    })
    if (authored.ok) {
      await input.onProgress?.({ phase: 'component_promoted', progress: 1, message: `“${authored.displayName}”组件已通过试渲染和视觉验收。` })
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: true,
        summary: authored.reused
          ? `已复用通过验收的“${authored.displayName}”组件。`
          : `“${authored.displayName}”组件已生成并通过验收。`,
        output: {
          componentId: authored.componentId,
          purpose: authored.purpose,
          displayName: authored.displayName,
          effectSummary: authored.effectSummary,
          status: authored.status,
          repaired: authored.repaired,
          codingCalls: authored.codingCalls,
          reused: authored.reused,
          visualVerdict: authored.visualVerdict,
        },
      }
    }
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: authored.stage,
      summary: `组件创建失败（${authored.stage}）：${authored.reason}`,
      recovery: '已清理失败组件和试渲染产物；可缩小或澄清效果说明后重试。',
      output: { repaired: authored.repaired, codingCalls: authored.codingCalls, failureStage: authored.stage },
    }
  }
  if (request.toolId === 'sample.analyze') {
    const sample = resolveV2AgentSample(input.context, input.runtime)
    if (!sample?.url) return { callId: request.callId, toolId: request.toolId, ok: false, summary: '没有用户选中的样例视频。', recovery: checked.tool.recovery }
    const resolvedContext = plannerInput({
      taskId: 'sample-skill-context',
      prompt: input.prompt,
      context: input.context,
      workspace: input.workspace,
      authorization: input.authorization,
      stage: input.stage,
      recalledCreativeMemories: input.recalledCreativeMemories,
      recalledCreativeKnowledge: input.recalledCreativeKnowledge,
    })
    const result = await analyzeV2Sample({
      userId: input.userId,
      taskId: `v2_sample_tool_${Date.now()}_${randomUUID().slice(0, 8)}`,
      prompt: input.prompt,
      sampleVideoPath: sample.url,
      sampleVideoName: sample.name,
      agentSkillContext: resolvedContext.agentSkillContext,
      agentToolContext: resolvedContext.agentToolContext,
      traceContext: input.traceSessionId
        ? { sessionId: input.traceSessionId, operationId: `sample_${request.callId}` }
        : undefined,
    })
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: true,
      summary: '样例理解已完成；结果仅作为 V2 风格与节奏参考。',
      sampleUnderstanding: result.understanding,
      sampleSelection: { id: sample.id, url: sample.url, name: sample.name },
      output: { traceDir: result.traceDir },
    }
  }

  if (request.toolId === 'timeline.patch' && !existing) {
    return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'dispatcher_draft', summary: '局部修订需要当前 V2 草稿。', recovery: checked.tool.recovery }
  }
  const patchScope = request.toolId === 'timeline.patch'
    ? (checked.arguments.scope as V2TimelineRevisionScope)
    : undefined
  const requestedGlobalMode = request.toolId === 'timeline.patch' && patchScope === 'global'
    ? checked.arguments.mode as 'brief_update' | 'full_replan'
    : undefined
  const requestedSceneId = request.toolId === 'timeline.patch'
    ? (checked.arguments.sceneId as string | undefined)
    : undefined
  const requestedOverlayIds = request.toolId === 'timeline.patch' && patchScope === 'subtitle'
    ? (checked.arguments.overlayIds as string[] | undefined)
    : undefined
  const existingSceneIds = new Set((existing?.spec.scenes ?? []).map((scene) => scene.id))
  const requestedTransitionIds = request.toolId === 'timeline.patch' && patchScope === 'transition'
    ? (checked.arguments.transitionIds as string[])
    : undefined
  const requestedStructureSceneIds = request.toolId === 'timeline.patch' && patchScope === 'structure'
    ? (checked.arguments.sceneIds as string[])
    : undefined
  const requestedDurationMode = request.toolId === 'timeline.patch' && patchScope === 'structure'
    ? checked.arguments.durationMode as 'preserve_range' | 'resize_timeline'
    : undefined
  const requestedPendingCallId = request.toolId === 'timeline.patch'
    ? checked.arguments.resolvesPendingCallId as string | undefined
    : undefined
  const pendingResolution = requestedPendingCallId
    ? (await drafts.getDraft(input.workspace.draftId!, input.userId))?.pendingTimelineRevisions
        .find((item) => item.callId === requestedPendingCallId)
    : undefined
  if (requestedPendingCallId && !pendingResolution) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'pending_resolution_target',
      summary: '指定的失败修改不属于当前草稿或已不再待处理。',
      recovery: '请从当前草稿的 pendingTimelineRevisions 中选择真实 callId。',
    }
  }
  const existingTransitionIds = new Set((existing?.spec.transitions ?? []).map((transition) => transition.id))
  const resolvedSceneId = requestedSceneId && existingSceneIds.has(requestedSceneId)
    ? requestedSceneId
    : undefined
  if (request.toolId === 'timeline.patch' && existing && requestedSceneId && !existingSceneIds.has(requestedSceneId)) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'dispatcher_target',
      summary: `目标场景 ${requestedSceneId} 不存在。当前草稿可用场景：${[...existingSceneIds].join('、') || '无'}。`,
      recovery: '从当前草稿场景中选择目标后重试。',
    }
  }
  const missingTransitionIds = (requestedTransitionIds ?? []).filter((id) => !existingTransitionIds.has(id))
  const missingStructureSceneIds = (requestedStructureSceneIds ?? []).filter((id) => !existingSceneIds.has(id))
  const missingOverlayIds = (requestedOverlayIds ?? []).filter((id) => !existing?.spec.overlays.some((overlay) =>
    overlay.id === id && overlay.type === 'caption' && (!requestedSceneId || overlay.scene_id === requestedSceneId)))
  if (request.toolId === 'timeline.patch' && missingOverlayIds.length > 0) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'dispatcher_target',
      summary: `目标字幕不存在或不属于目标场景：${missingOverlayIds.join('、')}。`,
      recovery: '请从当前草稿的可见字幕对象中选择目标后重试。',
    }
  }
  if (request.toolId === 'timeline.patch' && existing && missingStructureSceneIds.length > 0) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'dispatcher_target',
      summary: `目标场景不存在：${missingStructureSceneIds.join('、')}。`,
      recovery: '请从当前草稿的场景对象中选择一个连续范围后重试。',
    }
  }
  if (request.toolId === 'timeline.patch' && existing && requestedStructureSceneIds) {
    const indices = requestedStructureSceneIds
      .map((id) => existing.spec.scenes.findIndex((scene) => scene.id === id))
      .sort((a, b) => a - b)
    if (indices.some((index, offset) => index !== indices[0]! + offset)) {
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: false,
        gate: 'dispatcher_scope',
        summary: '结构修订的目标场景必须是一个连续范围。',
        recovery: '请缩小为连续镜头范围；不连续区域应分别修订。',
      }
    }
  }
  if (request.toolId === 'timeline.patch' && existing && missingTransitionIds.length > 0) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'dispatcher_target',
      summary: `目标转场不存在：${missingTransitionIds.join('、')}。`,
      recovery: '从当前草稿的转场对象中选择目标后重试。',
    }
  }
  if (
    request.toolId === 'timeline.patch'
    && existing
    && (patchScope === 'scene' || patchScope === 'visual_strategy')
    && !resolvedSceneId
  ) {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'dispatcher_scope',
      summary: `${patchScope} 修订需要模型根据当前草稿解析出明确的 sceneId。`,
      recovery: '请明确描述目标镜头；模型应使用当前草稿中的真实 sceneId 重试。',
    }
  }
  if (request.toolId === 'timeline.plan' || request.toolId === 'timeline.patch') {
    const targetCanvas = existing?.spec.canvas
      ?? canvas(input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio)
    const promotedComponents = await listPromotedComponents(targetCanvas)
    const authorizedDraftComponents = (await Promise.all(
      (input.authorizedDraftComponentIds ?? []).map((id) => readRenderComponent(id)),
    )).flatMap((component) => component?.manifest.status === 'draft'
      ? [{
          id: component.id,
          purpose: component.manifest.purpose,
          displayName: component.manifest.displayName,
          effectSummary: component.manifest.effectSummary,
        }]
      : [])
    const availableComponents = [...promotedComponents, ...authorizedDraftComponents]
    let plan = plannerInput({
      taskId: `v2_tool_${Date.now()}_${randomUUID().slice(0, 8)}`,
      prompt: input.requestInstruction ?? input.prompt,
      context: input.context,
      workspace: input.workspace,
      authorization: input.authorization,
      stage: input.stage,
      recalledCreativeMemories: input.recalledCreativeMemories,
      recalledCreativeKnowledge: input.recalledCreativeKnowledge,
      availableComponents,
    })
    if (existing && input.workspace.draftId && input.workspace.baseRevision) {
      plan = {
        ...plan,
        ...(patchScope !== 'global'
          ? {
              durationSec: existing.spec.canvas.duration_sec,
              canvas: {
                width: existing.spec.canvas.width,
                height: existing.spec.canvas.height,
                fps: existing.spec.canvas.fps,
              },
            }
          : {}),
        planningContext: {
          ...plan.planningContext!,
          kind: 'revision',
          draftId: input.workspace.draftId,
          baseRevision: input.workspace.baseRevision,
          authorizationEvidence: input.authorization?.evidence,
        },
        revisionBaseSpec: existing.spec,
        revisionScope: patchScope,
        revisionGlobalMode: requestedGlobalMode,
        revisionDurationMode: requestedDurationMode,
        revisionSceneId: resolvedSceneId,
        revisionOverlayIds: requestedOverlayIds,
        revisionSceneIds: requestedStructureSceneIds,
        revisionTransitionIds: requestedTransitionIds,
        revisionContext: buildV2TimelineRevisionContext({ draftId: input.workspace.draftId, baseRevision: input.workspace.baseRevision, spec: existing.spec }),
      }
    }
    const preview = await previewV2RemotionTimeline(
      plan,
      {
        traceContext: input.traceSessionId
          ? {
              sessionId: input.traceSessionId,
              operationId: `${request.toolId}_${request.callId}`,
            }
          : undefined,
      },
    )
    const settled = await settleTimelineRenderComponentVisualEvidence(preview.spec)
    const spec = settled.spec
    if (request.toolId === 'timeline.patch' && existing) {
      const scope = patchScope as V2TimelineRevisionScope
      const commit = evaluateV2TimelineRevisionCommit({
        baseSpec: existing.spec,
        candidateSpec: spec,
        scope,
        sceneId: resolvedSceneId,
        sceneIds: requestedStructureSceneIds,
        transitionIds: requestedTransitionIds,
        overlayIds: requestedOverlayIds,
      })
      if (!commit.ok) {
        return {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'revision_commit',
          summary: commit.violation?.message ?? '修订没有产生可保存的变化。',
          output: { revisionCommit: commit },
          recovery: '保留当前 V2 草稿，请规划模型依据本轮修订范围重新生成实际差异。',
          plannerInvoked: true,
        }
      }
    }
    const validation = validateRemotionTimelineSpec(spec)
    if (!validation.ok) return { callId: request.callId, toolId: request.toolId, ok: false, gate: 'spec_validation', summary: 'V2 时间线未通过结构校验。', output: { validation }, recovery: checked.tool.recovery, plannerInvoked: true }
    const pendingResolutionReview = pendingResolution
      ? await verifyV2TimelinePendingResolution({
          instruction: pendingResolution.instruction,
          candidateSpec: spec,
          availableComponents,
          confirmedContext: plan.conversationSummary,
        })
      : undefined
    if (pendingResolutionReview && !pendingResolutionReview.pass) {
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: false,
        gate: 'pending_resolution_review',
        summary: '本轮结果尚未落实原失败修改，因此未解除渲染门禁。',
        output: { pendingResolutionReview },
        recovery: pendingResolutionReview.repairInstruction ?? '继续针对原失败要求修订，或由用户明确放弃该要求。',
        plannerInvoked: true,
      }
    }
    const review = settled.degradations.length > 0
      ? buildV2TimelinePlanningReview({ spec, validation })
      : preview.review
    let draft: Awaited<ReturnType<typeof drafts.createDraft>>
    try {
      draft = existing && input.workspace.draftId && input.workspace.baseRevision
        ? await drafts.saveDraft({ draftId: input.workspace.draftId, userId: input.userId, baseRevision: input.workspace.baseRevision, spec, kind: 'preview', plannerInput: plan, plannerSource: preview.plannerSource, review, traceDir: preview.traceDir, authorizedDraftComponentIds: input.authorizedDraftComponentIds, resolvesPendingCallIds: pendingResolutionReview?.pass && requestedPendingCallId ? [requestedPendingCallId] : [] })
        : await drafts.createDraft({ userId: input.userId, plannerInput: plan, spec, plannerSource: preview.plannerSource, review, traceDir: preview.traceDir, authorizedDraftComponentIds: input.authorizedDraftComponentIds })
    } catch (error) {
      if (!(error instanceof V2TimelineComponentReferenceError)) throw error
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: false,
        gate: 'component_reference',
        summary: `custom_render 组件引用无效：${error.issues.join('；')}`,
        recovery: '仅引用已注册且对象类型匹配的组件；新 draft 必须来自本轮显式依赖的 render.author。',
        plannerInvoked: true,
      }
    }
    const degradationSummary = settled.degradations.length > 0
      ? `；以下可选效果未通过视觉验收，已保留对应对象的基础呈现：${settled.degradations.map((item) => `${item.displayName}（${item.targetIds.join('、')}）`).join('；')}`
      : ''
    const selectedItemId = existing
      ? normalizeV2TimelineSelection({
          selectedItemId: input.workspace.selectedItemId,
          nextSpec: draft.spec,
        })
      : null
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: true,
      summary: `${request.toolId === 'timeline.patch' ? 'V2 时间线修订已保存为新的草稿版本。' : 'V2 时间线方案已保存为可编辑草稿。'}${degradationSummary}`,
      draft: { id: draft.id, revision: draft.revision, spec: draft.spec, traceDir: preview.traceDir, pendingTimelineRevisions: draft.pendingTimelineRevisions },
      output: {
        timelineFacts: buildDirectorTimelineFacts(draft.revision, draft.spec),
        ...(request.toolId === 'timeline.patch' && existing
          ? { revisionActualDiff: describeV2TimelineSpecDiff(existing.spec, draft.spec) }
          : {}),
        validation,
        componentDegradations: settled.degradations,
        selectedItemId,
        ...(pendingResolutionReview?.pass && requestedPendingCallId
          ? {
              pendingResolution: {
                callId: requestedPendingCallId,
                pass: true,
                reviewSource: pendingResolutionReview.audit.source,
              },
            }
          : {}),
      },
      plannerInvoked: true,
    }
  }
  if (request.toolId === 'timeline.render') {
    if (!existing) return { callId: request.callId, toolId: request.toolId, ok: false, summary: '正式渲染需要当前 V2 草稿版本。', recovery: checked.tool.recovery }
    let renderPhase = 'prepare'
    try {
      const result = await executeV2TimelineDraftRun({
        repository: drafts,
        draftId: bound.system.draftId!,
        revision: bound.system.revision!,
        userId: bound.system.userId,
        idempotencyKey: request.callId,
        materialAdapter: input.materialAdapter,
        renderOutputBaseDir: input.renderOutputBaseDir,
        onProgress: async (event) => {
          renderPhase = event.phase
          await input.onProgress?.(event)
        },
        traceContext: input.traceSessionId
          ? { sessionId: input.traceSessionId, operationId: `render_${request.callId}` }
          : undefined,
      })
      if (!result.ok) {
        throw new Error(`Render evaluation failed: ${result.evaluation.warnings.join('; ') || 'unknown evaluation failure'}`)
      }
      return { callId: request.callId, toolId: request.toolId, ok: result.ok, summary: result.ok ? 'V2 正式渲染已完成。' : 'V2 正式渲染未完成。', output: { ...result } }
    } catch (error) {
      const cause = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 500)
      const componentIds = [...new Set(
        timelineRenderComponentReferences(existing.spec)
          .map((reference) => reference.id)
          .filter((id) => cause.includes(id)),
      )]
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: false,
        gate: 'render_failed',
        summary: 'V2 正式渲染失败，当前草稿保持不变。',
        output: {
          phase: renderPhase,
          componentIds,
          cause,
        },
        recovery: '根据渲染错误修复浏览器、素材或自定义组件后，由用户重新确认渲染。',
      }
    }
  }
  return { callId: request.callId, toolId: request.toolId, ok: false, summary: '当前 V2 Tool 尚无执行器。', recovery: checked.tool.recovery }
}

const IDEMPOTENT_TOOL_OPERATIONS: Partial<Record<string, string>> = {
  'timeline.plan': 'timeline.plan',
  'timeline.patch': 'timeline.save',
  'timeline.pending.dismiss': 'timeline.pending.dismiss',
  'render.author': 'render.author',
}

export async function dispatchV2AgentTool(
  input: V2AgentToolDispatchInput,
): Promise<V2AgentToolResult> {
  const request = input.stage.toolRequest
  const operation = IDEMPOTENT_TOOL_OPERATIONS[request.toolId]
  if (!operation) return dispatchV2AgentToolOnce(input)

  try {
    const outcome = await executeV2JsonIdempotentOperation({
      reservation: {
        userId: input.userId,
        draftId: input.workspace.draftId,
        operation,
        idempotencyKey: request.callId,
        resourceKey: `${input.traceSessionId ?? 'director'}:${input.workspace.draftId ?? 'new'}:${input.workspace.baseRevision ?? 0}`,
        requestHash: v2IdempotencyRequestHash({
          request,
          prompt: input.prompt,
          requestInstruction: input.requestInstruction,
          context: input.context,
          runtime: input.runtime,
          workspace: {
            draftId: input.workspace.draftId,
            baseRevision: input.workspace.baseRevision,
            selectedItemId: input.workspace.selectedItemId,
            confirmedRequirements: input.workspace.confirmedRequirements,
          },
          authorization: input.authorization,
          skill: {
            id: input.stage.primarySkill.id,
            version: input.stage.primarySkill.version,
            hash: input.stage.primarySkill.hash,
            referenceHashes: input.stage.references.map((item) => item.hash),
          },
          recalledCreativeMemories: input.recalledCreativeMemories,
          recalledCreativeKnowledge: input.recalledCreativeKnowledge,
          authorizedDraftComponentIds: input.authorizedDraftComponentIds,
          componentAuthoring: request.toolId === 'render.author'
            ? {
                model: env.directorAgentModel,
                runtime: RENDER_COMPONENT_RUNTIME_VERSION,
                authoringPolicy: RENDER_COMPONENT_AUTHORING_POLICY_VERSION,
                sandboxPolicy: RENDER_COMPONENT_SANDBOX_POLICY_VERSION,
                visualPolicy: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
              }
            : undefined,
          timelinePlanning: request.toolId === 'timeline.plan' || request.toolId === 'timeline.patch'
            ? {
                plannerProtocol: V2_TIMELINE_PLANNER_PROTOCOL_VERSION,
                componentVisualPolicy: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
              }
            : undefined,
        }),
      },
      execute: () => dispatchV2AgentToolOnce(input),
      failureFromResult: (result) => result.ok
        ? undefined
        : { code: 'request_rejected', message: result.summary },
    })
    if (outcome.kind === 'running') {
      return {
        callId: request.callId,
        toolId: request.toolId,
        ok: false,
        gate: 'idempotency_running',
        summary: '相同工具请求仍在执行，未重复调用。',
        recovery: '等待首次调用完成后重试同一请求。',
      }
    }
    if (outcome.value) return outcome.value
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'idempotency_failed',
      summary: outcome.receipt.failure?.message ?? '首次工具请求失败。',
    }
  } catch (error) {
    if (!(error instanceof V2IdempotencyConflictError)) throw error
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
      gate: 'idempotency_conflict',
      summary: error.message,
      recovery: '为新的工具意图生成新的服务端 callId。',
    }
  }
}

export function toolResultTimelineFacts(result: V2AgentToolResult): DirectorTimelineFacts | undefined {
  return result.draft ? buildDirectorTimelineFacts(result.draft.revision, result.draft.spec) : undefined
}
