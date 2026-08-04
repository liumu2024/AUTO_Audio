import { randomUUID } from 'node:crypto'

import { validateRemotionTimelineSpec } from '../../../../shared/lib/remotion-timeline-validator.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorContext, DirectorTimelineFacts } from '../../../../shared/types/director-context.js'
import type { DirectorWorkspaceState } from '../../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { analyzeV2Sample } from '../sample-understanding-service.js'
import { previewV2RemotionTimeline, runV2RemotionTimeline } from '../remotion-timeline-service.js'
import { buildV2TimelineRevisionContext } from '../timeline-revision-context.js'
import { evaluateV2TimelineRevisionCommit } from '../timeline-revision-outcome-review.js'
import { createV2TimelineDraftRepository } from '../timeline-draft-repository.js'
import type { V2PlannerInput } from '../v2-input.js'
import {
  bindV2AgentToolArguments,
  evaluateV2AgentToolReadiness,
  validateV2AgentToolRequest,
  type V2AgentToolMode,
} from './registry.js'
import type { V2AgentExecutionStage } from '../agent-skills/registry.js'

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
  draft?: { id: string; revision: number; spec: RemotionTimelineSpecV1; traceDir?: string }
  sampleUnderstanding?: unknown
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
}): V2PlannerInput {
  return {
    taskId: input.taskId,
    prompt: input.prompt,
    creationMode: creationMode(input.context),
    referenceVideoPath: input.context.sampleVideo?.url,
    sampleUnderstanding: input.context.sampleVideo?.sampleUnderstanding,
    conversationSummary: input.context.conversationSummary,
    materials: input.context.materials.map((material) => ({
      id: material.id, name: material.name, type: material.type, src: material.url, tags: material.tags,
    })),
    durationSec: input.context.effectiveCreativeConfig?.durationSec ?? input.context.userIntent.durationSec ?? input.context.slots.durationSec,
    plannerMode: 'llm',
    allowPlannerFallback: true,
    canvas: canvas(input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio),
    planningContext: {
      kind: input.workspace.draftId ? 'revision' : 'initial',
      activeRequirements: input.workspace.confirmedRequirements
        .filter((item) => item.status === 'active')
        .map((item) => item.statement),
      recalledCreativeMemories: input.recalledCreativeMemories ?? [],
      draftId: input.workspace.draftId,
      baseRevision: input.workspace.baseRevision,
      selectedClipId: input.workspace.selectedItemId,
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
  }
}

function timelineFacts(revision: number, spec: RemotionTimelineSpecV1): DirectorTimelineFacts {
  return {
    revision,
    scenes: spec.scenes.map((scene) => ({ id: scene.id, title: scene.title, description: scene.creative_intent?.description ?? scene.body, visualRole: scene.visual_role, durationSec: scene.duration_sec })),
    visibleText: spec.overlays.filter((item) => Boolean(item.text?.trim())).map((item) => ({ id: item.id, sceneId: item.scene_id, type: item.type, text: item.text ?? '', yPct: item.y_pct, maxLines: item.max_lines, animation: item.animation })),
    transitions: spec.transitions.map((item) => ({ type: item.type, durationSec: item.duration_sec })),
    audioClipCount: spec.audio?.length ?? 0,
    notes: spec.notes ?? [],
  }
}

export async function dispatchV2AgentTool(input: {
  stage: V2AgentExecutionStage
  prompt: string
  userId: number
  context: DirectorContext
  runtime: DirectorConversationRuntime
  workspace: DirectorWorkspaceState
  authorization?: V2AgentToolAuthorizationGrant
  traceSessionId?: string
  recalledCreativeMemories?: string[]
  onProgress?: (event: V2AgentToolProgress) => void | Promise<void>
}): Promise<V2AgentToolResult> {
  const request = input.stage.toolRequest
  if (input.stage.primarySkill.id !== request.skillId) {
    return { callId: request.callId, toolId: request.toolId, ok: false, summary: 'Tool 与本轮主 Skill 不一致。', recovery: '重新生成一致的 Skill/Tool 提案。' }
  }
  const checked = validateV2AgentToolRequest(request, {
    selectedSkillIds: new Set([input.stage.primarySkill.id]),
  })
  if (!checked.ok) return { callId: request.callId, toolId: request.toolId, ok: false, summary: checked.reason, recovery: '请使用当前 V2 可用能力重新提出请求。' }
  if (input.workspace.recentToolCallIds?.includes(request.callId)) {
    return { callId: request.callId, toolId: request.toolId, ok: false, summary: '重复的工具调用已被拒绝。', recovery: '等待已有调用的真实结果。' }
  }
  const readiness = evaluateV2AgentToolReadiness({
    toolId: request.toolId,
    context: input.context,
    runtime: input.runtime,
    workspace: input.workspace,
    authorizationGranted: input.authorization?.granted,
  })
  if (readiness.status !== 'ready') {
    return {
      callId: request.callId,
      toolId: request.toolId,
      ok: false,
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

  if (request.toolId === 'material.inspect') {
    const selected = new Set(bound.system.materialIds)
    const materials = input.context.materials.filter((material) => selected.has(material.id))
    return { callId: request.callId, toolId: request.toolId, ok: true, summary: `已检查 ${materials.length} 个 V2 候选素材。`, output: { materials: materials.map(({ id, type, name, tags }) => ({ id, type, name, tags })) } }
  }
  if (request.toolId === 'sample.analyze') {
    const sample = input.context.sampleVideo
    if (!sample?.url) return { callId: request.callId, toolId: request.toolId, ok: false, summary: '没有用户选中的样例视频。', recovery: checked.tool.recovery }
    const resolvedContext = plannerInput({
      taskId: 'sample-skill-context',
      prompt: input.prompt,
      context: input.context,
      workspace: input.workspace,
      authorization: input.authorization,
      stage: input.stage,
      recalledCreativeMemories: input.recalledCreativeMemories,
    })
    const result = await analyzeV2Sample({
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
    return { callId: request.callId, toolId: request.toolId, ok: true, summary: '样例理解已完成；结果仅作为 V2 风格与节奏参考。', sampleUnderstanding: result.understanding, output: { traceDir: result.traceDir } }
  }

  const readsExistingDraft = request.toolId !== 'timeline.plan'
  const existing = readsExistingDraft && input.workspace.draftId && input.workspace.baseRevision
    ? await drafts.getRevision(input.workspace.draftId, input.workspace.baseRevision, input.userId)
    : null
  if (request.toolId === 'timeline.patch' && !existing) {
    return { callId: request.callId, toolId: request.toolId, ok: false, summary: '字幕局部修订需要当前 V2 草稿。', recovery: checked.tool.recovery }
  }
  if (request.toolId === 'timeline.plan' || request.toolId === 'timeline.patch') {
    let plan = plannerInput({
      taskId: `v2_tool_${Date.now()}_${randomUUID().slice(0, 8)}`,
      prompt: input.prompt,
      context: input.context,
      workspace: request.toolId === 'timeline.plan'
        ? { ...input.workspace, draftId: undefined, baseRevision: undefined, selectedItemId: undefined }
        : input.workspace,
      authorization: input.authorization,
      stage: input.stage,
      recalledCreativeMemories: input.recalledCreativeMemories,
    })
    if (existing && input.workspace.draftId && input.workspace.baseRevision) {
      const selectedClipId = bound.system.selectedTimelineItemId
      plan = {
        ...plan,
        planningContext: {
          ...plan.planningContext!,
          kind: 'revision',
          draftId: input.workspace.draftId,
          baseRevision: input.workspace.baseRevision,
          selectedClipId,
          authorizationEvidence: input.authorization?.evidence,
        },
        revisionBaseSpec: existing.spec,
        revisionScope: request.toolId === 'timeline.patch' ? 'subtitle' : undefined,
        revisionContext: buildV2TimelineRevisionContext({ draftId: input.workspace.draftId, baseRevision: input.workspace.baseRevision, spec: existing.spec, selectedClipId }),
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
    let spec = preview.spec
    if (request.toolId === 'timeline.patch' && existing) {
      const commit = evaluateV2TimelineRevisionCommit({
        baseSpec: existing.spec,
        candidateSpec: spec,
        scope: 'subtitle',
      })
      if (!commit.ok) {
        return {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          summary: commit.violation?.message ?? '字幕修订没有产生可保存的变化。',
          output: { revisionCommit: commit },
          recovery: '保留当前 V2 草稿，请规划模型依据本轮字幕要求重新生成实际差异。',
          plannerInvoked: true,
        }
      }
    }
    const validation = validateRemotionTimelineSpec(spec)
    if (!validation.ok) return { callId: request.callId, toolId: request.toolId, ok: false, summary: 'V2 时间线未通过结构校验。', output: { validation }, recovery: checked.tool.recovery, plannerInvoked: true }
    const draft = existing && input.workspace.draftId && input.workspace.baseRevision
      ? await drafts.saveDraft({ draftId: input.workspace.draftId, userId: input.userId, baseRevision: input.workspace.baseRevision, spec, kind: 'preview', plannerInput: plan, plannerSource: preview.plannerSource, review: preview.review, traceDir: preview.traceDir })
      : await drafts.createDraft({ userId: input.userId, plannerInput: plan, spec, plannerSource: preview.plannerSource, review: preview.review, traceDir: preview.traceDir })
    return { callId: request.callId, toolId: request.toolId, ok: true, summary: request.toolId === 'timeline.patch' ? '字幕轨修订已保存为新的 V2 草稿版本。' : 'V2 时间线方案已保存为可编辑草稿。', draft: { id: draft.id, revision: draft.revision, spec: draft.spec, traceDir: preview.traceDir }, output: { timelineFacts: timelineFacts(draft.revision, draft.spec), validation }, plannerInvoked: true }
  }
  if (request.toolId === 'timeline.render') {
    if (!existing) return { callId: request.callId, toolId: request.toolId, ok: false, summary: '正式渲染需要当前 V2 草稿版本。', recovery: checked.tool.recovery }
    const sourceDraft = await drafts.getDraft(bound.system.draftId!, bound.system.userId)
    if (!sourceDraft) return { callId: request.callId, toolId: request.toolId, ok: false, summary: '当前 V2 草稿已不可读取。', recovery: checked.tool.recovery }
    const result = await runV2RemotionTimeline(
      {
        ...sourceDraft.plannerInput,
        taskId: `v2_render_tool_${Date.now()}_${randomUUID().slice(0, 8)}`,
        timelineSpecOverride: existing.spec,
      },
      {
        onProgress: input.onProgress,
        traceContext: input.traceSessionId
          ? { sessionId: input.traceSessionId, operationId: `render_${request.callId}` }
          : undefined,
      },
    )
    return { callId: request.callId, toolId: request.toolId, ok: result.ok, summary: result.ok ? 'V2 正式渲染已完成。' : 'V2 正式渲染未完成。', output: { traceDir: result.traceDir, outputPath: result.outputPath } }
  }
  return { callId: request.callId, toolId: request.toolId, ok: false, summary: '当前 V2 Tool 尚无执行器。', recovery: checked.tool.recovery }
}

export function toolResultTimelineFacts(result: V2AgentToolResult): DirectorTimelineFacts | undefined {
  return result.draft ? timelineFacts(result.draft.revision, result.draft.spec) : undefined
}
