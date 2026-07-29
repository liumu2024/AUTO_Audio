import { randomUUID } from 'node:crypto'

import { validateRemotionTimelineSpec } from '../../../../shared/lib/remotion-timeline-validator.js'
import type { DirectorContext, DirectorTimelineFacts } from '../../../../shared/types/director-context.js'
import type { DirectorWorkspaceState } from '../../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { analyzeV2Sample } from '../sample-understanding-service.js'
import { previewV2RemotionTimeline, runV2RemotionTimeline } from '../remotion-timeline-service.js'
import { buildV2TimelineRevisionContext } from '../timeline-revision-context.js'
import { createV2TimelineDraftRepository } from '../timeline-draft-repository.js'
import type { V2PlannerInput } from '../v2-input.js'
import { validateV2AgentToolRequest, type V2AgentToolMode } from './registry.js'

export interface V2AgentToolRequest {
  callId: string
  toolId: string
  skillId: string
  arguments: Record<string, unknown>
  requestedMode: V2AgentToolMode
  authorizationEvidence?: string
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
  authorizationEvidence?: string
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
      draftId: input.workspace.draftId,
      baseRevision: input.workspace.baseRevision,
      selectedClipId: input.workspace.selectedItemId,
      authorizationEvidence: input.authorizationEvidence,
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

function subtitleOnly(base: RemotionTimelineSpecV1, candidate: RemotionTimelineSpecV1): RemotionTimelineSpecV1 {
  return {
    ...base,
    caption_tracks: candidate.caption_tracks ?? base.caption_tracks,
    overlays: [
      ...base.overlays.filter((overlay) => overlay.type !== 'caption'),
      ...candidate.overlays.filter((overlay) => overlay.type === 'caption'),
    ],
  }
}

export async function dispatchV2AgentTool(input: {
  request: V2AgentToolRequest
  prompt: string
  userId: number
  context: DirectorContext
  workspace: DirectorWorkspaceState
}): Promise<V2AgentToolResult> {
  const checked = validateV2AgentToolRequest(input.request)
  if (!checked.ok) return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: checked.reason, recovery: '请使用当前 V2 可用能力重新提出请求。' }
  if (input.workspace.recentToolCallIds?.includes(input.request.callId)) {
    return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '重复的工具调用已被拒绝。', recovery: '等待已有调用的真实结果。' }
  }
  if (checked.tool.requiresExplicitAuthorization && !input.request.authorizationEvidence?.trim()) {
    return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '该操作缺少本轮明确授权。', recovery: checked.tool.recovery }
  }

  if (input.request.toolId === 'material.inspect') {
    return { callId: input.request.callId, toolId: input.request.toolId, ok: true, summary: `已检查 ${input.context.materials.length} 个 V2 候选素材。`, output: { materials: input.context.materials.map(({ id, type, name, tags }) => ({ id, type, name, tags })) } }
  }
  if (input.request.toolId === 'sample.analyze') {
    const sample = input.context.sampleVideo
    if (!sample?.url) return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '没有用户选中的样例视频。', recovery: checked.tool.recovery }
    const result = await analyzeV2Sample({ taskId: `v2_sample_tool_${Date.now()}_${randomUUID().slice(0, 8)}`, prompt: input.prompt, sampleVideoPath: sample.url, sampleVideoName: sample.name })
    return { callId: input.request.callId, toolId: input.request.toolId, ok: true, summary: '样例理解已完成；结果仅作为 V2 风格与节奏参考。', sampleUnderstanding: result.understanding, output: { traceDir: result.traceDir } }
  }

  const readsExistingDraft = input.request.toolId !== 'timeline.plan'
  const existing = readsExistingDraft && input.workspace.draftId && input.workspace.baseRevision
    ? await drafts.getRevision(input.workspace.draftId, input.workspace.baseRevision, input.userId)
    : null
  if (input.request.toolId === 'timeline.patch' && !existing) {
    return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '字幕局部修订需要当前 V2 草稿。', recovery: checked.tool.recovery }
  }
  if (input.request.toolId === 'timeline.plan' || input.request.toolId === 'timeline.patch') {
    let plan = plannerInput({
      taskId: `v2_tool_${Date.now()}_${randomUUID().slice(0, 8)}`,
      prompt: input.prompt,
      context: input.context,
      workspace: input.request.toolId === 'timeline.plan'
        ? { ...input.workspace, draftId: undefined, baseRevision: undefined, selectedItemId: undefined }
        : input.workspace,
      authorizationEvidence: input.request.authorizationEvidence,
    })
    if (existing && input.workspace.draftId && input.workspace.baseRevision) {
      plan = { ...plan, planningContext: { kind: 'revision', draftId: input.workspace.draftId, baseRevision: input.workspace.baseRevision, selectedClipId: input.workspace.selectedItemId, authorizationEvidence: input.request.authorizationEvidence }, revisionBaseSpec: existing.spec, revisionContext: buildV2TimelineRevisionContext({ draftId: input.workspace.draftId, baseRevision: input.workspace.baseRevision, spec: existing.spec, selectedClipId: input.workspace.selectedItemId }) }
    }
    const preview = await previewV2RemotionTimeline(plan)
    let spec = preview.spec
    if (input.request.toolId === 'timeline.patch' && existing) spec = subtitleOnly(existing.spec, preview.spec)
    const validation = validateRemotionTimelineSpec(spec)
    if (!validation.ok) return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: 'V2 时间线未通过结构校验。', output: { validation }, recovery: checked.tool.recovery, plannerInvoked: true }
    const draft = existing && input.workspace.draftId && input.workspace.baseRevision
      ? await drafts.saveDraft({ draftId: input.workspace.draftId, userId: input.userId, baseRevision: input.workspace.baseRevision, spec, kind: 'preview', plannerInput: plan, plannerSource: preview.plannerSource, review: preview.review, traceDir: preview.traceDir })
      : await drafts.createDraft({ userId: input.userId, plannerInput: plan, spec, plannerSource: preview.plannerSource, review: preview.review, traceDir: preview.traceDir })
    return { callId: input.request.callId, toolId: input.request.toolId, ok: true, summary: input.request.toolId === 'timeline.patch' ? '字幕轨修订已保存为新的 V2 草稿版本。' : 'V2 时间线方案已保存为可编辑草稿。', draft: { id: draft.id, revision: draft.revision, spec: draft.spec, traceDir: preview.traceDir }, output: { timelineFacts: timelineFacts(draft.revision, draft.spec), validation }, plannerInvoked: true }
  }
  if (input.request.toolId === 'timeline.render') {
    if (!existing) return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '正式渲染需要当前 V2 草稿版本。', recovery: checked.tool.recovery }
    const sourceDraft = await drafts.getDraft(input.workspace.draftId!, input.userId)
    if (!sourceDraft) return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '当前 V2 草稿已不可读取。', recovery: checked.tool.recovery }
    const result = await runV2RemotionTimeline({ ...sourceDraft.plannerInput, taskId: `v2_render_tool_${Date.now()}_${randomUUID().slice(0, 8)}`, timelineSpecOverride: existing.spec })
    return { callId: input.request.callId, toolId: input.request.toolId, ok: result.ok, summary: result.ok ? 'V2 正式渲染已完成。' : 'V2 正式渲染未完成。', output: { traceDir: result.traceDir, outputPath: result.outputPath } }
  }
  return { callId: input.request.callId, toolId: input.request.toolId, ok: false, summary: '当前 V2 Tool 尚无执行器。', recovery: checked.tool.recovery }
}

export function toolResultTimelineFacts(result: V2AgentToolResult): DirectorTimelineFacts | undefined {
  return result.draft ? timelineFacts(result.draft.revision, result.draft.spec) : undefined
}
