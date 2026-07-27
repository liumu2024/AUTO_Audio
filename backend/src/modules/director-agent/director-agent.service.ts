import { directorActionFromIntentResult } from '../../../../shared/lib/director-action-engine.js'
import { randomUUID } from 'node:crypto'
import { createV2TraceWriter } from '../../pipeline-v2/trace.js'
import { routeDirectorIntentWithLlm } from './llm-intent-router.js'
import {
  appendDirectorWorkspaceTurn,
  applyDirectorWorkspacePatch,
  compactDirectorWorkspaceContext,
  compactDirectorWorkspaceTurns,
  createDirectorWorkspaceState,
  type DirectorWorkspaceState,
} from './director-workspace-session.js'
import { createDirectorWorkspaceSessionRepository } from './director-workspace-session-repository.js'
import { routeConversationSurface } from './surface-router.js'
import type {
  DirectorAgentChatRequest,
  DirectorAgentStreamEvent,
} from './director-agent.types.js'

const workspaceSessions = createDirectorWorkspaceSessionRepository()

export async function getDirectorWorkspaceSession(input: {
  workspaceSessionId: string
  userId: number
}) {
  return workspaceSessions.get(input.workspaceSessionId, input.userId)
}

export async function recordDirectorWorkspaceOutcome(input: {
  workspaceSessionId: string
  userId: number
  action: string
  ok: boolean
  outcome: string
  traceDir?: string
  currentTimeline?: DirectorAgentChatRequest['context']['currentTimeline']
}) {
  const current = await workspaceSessions.get(input.workspaceSessionId, input.userId)
  if (!current) return null
  let state = applyDirectorWorkspacePatch(current.state, {
    context: input.currentTimeline ? { currentTimeline: input.currentTimeline } : undefined,
    draftId: input.currentTimeline?.draftId,
    baseRevision: input.currentTimeline?.currentRevision,
    selectedItemId:
      input.currentTimeline?.selectedClipId ?? input.currentTimeline?.selectedSceneId,
    latestExecution: {
      action: input.action,
      outcome: input.outcome,
      traceDir: input.traceDir,
    },
    recentFailure: input.ok
      ? null
      : { reason: input.outcome, recovery: '保留当前 V2 草稿；修正问题后可继续讨论或重试。' },
  })
  state = appendDirectorWorkspaceTurn(state, {
    role: 'system',
    content: `${input.action}: ${input.outcome}`,
    at: new Date().toISOString(),
    outcome: input.ok ? 'completed' : 'failed',
  })
  state = compactDirectorWorkspaceTurns(state)
  const saved = await workspaceSessions.save({
    id: input.workspaceSessionId,
    userId: input.userId,
    state,
  })
  const trace = createV2TraceWriter({
    taskId: `${input.workspaceSessionId}__outcome_${Date.now()}`,
  })
  await trace.writeJson('00-director-turn', 'execution-outcome.json', {
    action: input.action,
    ok: input.ok,
    outcome: input.outcome,
    trace_dir: input.traceDir ?? null,
    draft_id: saved.state.draftId ?? null,
    revision: saved.state.baseRevision ?? null,
  })
  return { state: saved.state, traceDir: trace.rootDir }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function materialLabel(count: number, hasVisualMaterial: boolean) {
  if (!count) return '没有创作素材'
  if (!hasVisualMaterial) return `收到 ${count} 个素材，但缺少可用于画面的图片或视频`
  return `收到 ${count} 个候选创作素材`
}

function sampleLabel(input: DirectorAgentChatRequest) {
  if (input.runtime.isSampleParsed) return '样例视频已完成结构和风格解析'
  if (input.runtime.sampleUrl) return '样例视频已上传，尚未解析'
  return '尚未上传样例视频'
}

function actionLabel(type: string) {
  const labels: Record<string, string> = {
    ANALYZE_SAMPLE: '解析样例视频',
    ANALYZE_MATERIALS: '分析创作素材',
    GENERATE_TIMELINE: '生成 V2 时间线方案',
    REVISE_TIMELINE: '修改当前时间线方案',
    RENDER_VIDEO: '提交 V2 渲染',
    ASK_USER: '回复并等待用户补充',
    REQUEST_PLUGIN: '记录缺失 Remotion 能力',
  }
  return labels[type] ?? type
}

function workspaceId(value: string | undefined): string {
  const candidate = value?.trim()
  return candidate && /^[a-zA-Z0-9_-]{8,100}$/.test(candidate)
    ? candidate
    : `v2_director_${randomUUID()}`
}

function runtimeObservationPatch(input: DirectorAgentChatRequest) {
  const slots = input.context.slots
  return {
    context: {
      sampleVideo: input.context.sampleVideo,
      materials: input.context.materials,
      currentTimeline: input.context.currentTimeline,
      directorState: input.context.directorState,
      slots: {
        sampleVideoStatus: slots.sampleVideoStatus,
        materialStatus: slots.materialStatus,
      },
    },
    draftId: input.context.currentTimeline?.draftId,
    baseRevision: input.context.currentTimeline?.currentRevision,
    selectedItemId:
      input.context.currentTimeline?.selectedClipId ?? input.context.currentTimeline?.selectedSceneId,
  }
}

function intentForWorkspace(input: {
  actionType: string
  modelIntent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
}): 'chat' | 'create' | 'revise' | 'execute' | 'clarify' {
  if (input.modelIntent) return input.modelIntent
  if (input.actionType === 'GENERATE_TIMELINE') return 'create'
  if (input.actionType === 'REVISE_TIMELINE') return 'revise'
  if (input.actionType === 'RENDER_VIDEO' || input.actionType === 'ANALYZE_SAMPLE') return 'execute'
  return 'chat'
}

function stateDiff(before: DirectorWorkspaceState, after: DirectorWorkspaceState) {
  const changed: string[] = []
  for (const key of ['draftId', 'baseRevision', 'selectedItemId', 'pendingQuestion', 'responseId'] as const) {
    if (before[key] !== after[key]) changed.push(key)
  }
  if (JSON.stringify(before.context.slots) !== JSON.stringify(after.context.slots)) changed.push('context.slots')
  if (JSON.stringify(before.context.userIntent) !== JSON.stringify(after.context.userIntent)) changed.push('context.userIntent')
  return changed
}

function effectiveV2CreationMode(context: DirectorAgentChatRequest['context']) {
  if (context.sampleVideo?.url?.trim()) return 'sample_replicate' as const
  if (context.materials.some((material) => material.type === 'image' || material.type === 'video')) {
    return 'material_brief' as const
  }
  return 'text_to_video' as const
}

export async function* streamDirectorAgentChat(
  input: DirectorAgentChatRequest,
): AsyncGenerator<DirectorAgentStreamEvent> {
  const id = workspaceId(input.workspaceSessionId)
  const userId = input.userId ?? 1
  const persisted = await workspaceSessions.get(id, userId)
  const before = persisted?.state ?? createDirectorWorkspaceState({ context: input.context })
  let workspaceState = persisted
    ? applyDirectorWorkspacePatch(before, runtimeObservationPatch(input))
    : before
  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    context: {
      userIntent: { rawText: input.prompt || workspaceState.context.userIntent.rawText },
      conversationSummary: JSON.stringify(compactDirectorWorkspaceContext(workspaceState)),
    },
  })
  const trace = createV2TraceWriter({ taskId: `${id}__turn_${Date.now()}` })
  await trace.writeJson('00-director-turn', 'turn-input.json', {
    input_reached: true,
    workspace_session_id: id,
    context: compactDirectorWorkspaceContext(workspaceState),
    runtime: input.runtime,
  })
  const surface = routeConversationSurface(input)

  yield {
    type: 'surface',
    mode: surface.mode,
    confidence: surface.confidence,
    shouldRunIntentRouter: surface.shouldRunIntentRouter,
    directMessage: surface.directMessage,
  }
  await wait(10)

  for (const thought of surface.publicThoughts ?? []) {
    yield {
      type: 'thought',
      title: '对话入口',
      content: thought,
    }
    await wait(15)
  }

  yield {
    type: 'thought',
    title: '读取上下文',
    content: `${sampleLabel(input)}；${materialLabel(
      input.runtime.materialCount,
      input.runtime.hasVisualMaterial,
    )}；当前画幅 ${input.context.slots.aspectRatio}。`,
  }
  await wait(20)

  yield {
    type: 'thought',
    title: '区分样例和素材',
    content:
      '样例视频只作为结构、节奏和风格来源；reference materials 才是成片候选素材。',
  }
  await wait(20)

  const routed = await routeDirectorIntentWithLlm({
    ...input,
    context: workspaceState.context,
    previousResponseId:
      workspaceState.responseContinuityDisabled ? undefined : workspaceState.responseId,
  })
  await trace.writeJson('00-director-turn', 'model-response.audit.json', routed.modelResponseAudit ?? {
    output_text: routed.modelOutputText ?? null,
  })
  await trace.writeJson('00-director-turn', 'model-protocol-diagnostic.json', {
    source: routed.source,
    protocol_error: routed.protocolError ?? null,
    fallback_reason: routed.fallbackReason ?? null,
    structured_output: routed.structuredOutput ?? null,
    proposed_v2_creation_mode: routed.proposedV2CreationMode ?? null,
    effective_v2_creation_mode: effectiveV2CreationMode(workspaceState.context),
    v2_creation_mode_mismatch:
      routed.proposedV2CreationMode
        ? routed.proposedV2CreationMode !== effectiveV2CreationMode(workspaceState.context)
        : false,
  })
  if (routed.jsonRepair) {
    await trace.writeText('00-director-turn', 'model-json-repair-request.md', routed.jsonRepair.request)
    await trace.writeJson('00-director-turn', 'model-json-repair-result.audit.json', {
      response: routed.jsonRepair.responseAudit ?? null,
      protocol_error: routed.jsonRepair.protocolError ?? null,
    })
  }
  for (const thought of routed.publicThoughts) {
    yield {
      type: 'thought',
      title:
        routed.source === 'context_fallback'
          ? '上下文保留'
          : routed.source === 'llm_unstructured_safe_reply'
            ? '自由回复'
            : '导演判断',
      content: thought,
    }
    await wait(20)
  }

  const action = directorActionFromIntentResult({
    prompt: input.prompt,
    context: workspaceState.context,
    runtime: input.runtime,
    result: routed.result,
  })
  const shouldExecute =
    routed.result.executionEffect !== undefined &&
    routed.result.executionEffect !== 'none' &&
    action.type !== 'ASK_USER'

  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    ...routed.statePatch,
    context: {
      ...((routed.statePatch?.context as Record<string, unknown> | undefined) ?? {}),
      slots: action.slots,
      userIntent: {
        goal:
          action.intent.goal,
        rawText: input.prompt || workspaceState.context.userIntent.rawText,
      },
    },
    // A previous model failure must never become a durable gate for new input.
    pendingQuestion:
      routed.conversationIntent === 'clarify'
        ? routed.requirements?.join('；') || routed.result.assistantMessage
        : null,
    responseId: routed.responseId,
    responseContinuityDisabled: routed.responseContinuityRejected || undefined,
  })
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'user',
    content: input.prompt,
    at: new Date().toISOString(),
  })
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'assistant',
    content: routed.result.assistantMessage,
    at: new Date().toISOString(),
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    outcome: shouldExecute ? `planned:${action.type}` : 'discussion',
  })
  workspaceState = compactDirectorWorkspaceTurns(workspaceState)
  const saved = await workspaceSessions.save({ id, userId, state: workspaceState })
  await trace.writeJson('00-director-turn', 'turn-result.json', {
    router_called: true,
    core_model_called: routed.modelCalled,
    planner_called: false,
    tool_called: false,
    source: routed.source,
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    action: action.type,
    previous_response_id: before.responseId ?? null,
    response_id: saved.state.responseId ?? null,
    response_continuity_disabled: Boolean(saved.state.responseContinuityDisabled),
    state_changed: stateDiff(before, saved.state),
    fallback_reason: routed.fallbackReason ?? null,
    proposed_v2_creation_mode: routed.proposedV2CreationMode ?? null,
    effective_v2_creation_mode: effectiveV2CreationMode(saved.state.context),
  })
  await trace.writeSummary([
    '# V2 Director turn',
    `- session: ${id}`,
    `- core model called: ${routed.modelCalled}`,
    `- intent: ${intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent })}`,
    `- action: ${action.type}`,
  ])

  yield {
    type: 'workspace_session',
    workspaceSessionId: id,
    state: saved.state,
    traceDir: trace.rootDir,
    modelCalled: routed.modelCalled,
    responseId: saved.state.responseId,
    responseContinuityDisabled: saved.state.responseContinuityDisabled,
  }

  yield {
    type: 'intent',
    intent: action.result.intent,
    confidence: action.result.confidence,
    contentDomain: action.result.contentDomain,
    source: routed.source,
  }
  await wait(15)

  yield {
    type: 'slot_update',
    slots: action.slots,
    missingSlots: action.payload?.missingSlots ?? [],
  }
  await wait(15)

  if (shouldExecute) {
    yield {
      type: 'thought',
      title: '执行建议',
      content: `${actionLabel(action.type)}。${action.message}`,
    }
    await wait(15)

    yield {
      type: 'action_plan',
      action,
    }
    await wait(5)

    if (input.context.directorState) {
      yield {
        type: 'state_update',
        state: input.context.directorState,
      }
      await wait(5)
    }

    yield {
      type: 'done',
      action,
    }
    return
  }

  yield {
    type: 'done',
    message: routed.result.assistantMessage,
  }
}
