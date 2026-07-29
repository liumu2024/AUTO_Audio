import { directorActionFromIntentResult } from '../../../../shared/lib/director-action-engine.js'
import { randomUUID } from 'node:crypto'
import { createV2TraceWriter } from '../../pipeline-v2/trace.js'
import { buildV2TimelineFactDigest } from '../../pipeline-v2/timeline-revision-outcome-review.js'
import { createV2TimelineDraftRepository } from '../../pipeline-v2/timeline-draft-repository.js'
import {
  dispatchV2AgentTool,
  toolResultTimelineFacts,
  type V2AgentToolResult,
} from '../../pipeline-v2/agent-tools/dispatcher.js'
import { resolveV2AgentExecutionPlan } from '../../pipeline-v2/agent-skills/registry.js'
import { deliveryAuthorizationFromDirectorDecision } from '../../pipeline-v2/agent-tools/authorization.js'
import {
  respondToDirectorToolResultsWithLlm,
  routeDirectorIntentWithLlm,
} from './llm-intent-router.js'
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
import type {
  DirectorContextSlots,
  DirectorEffectiveCreativeConfig,
} from '../../../../shared/types/director-context.js'

const workspaceSessions = createDirectorWorkspaceSessionRepository()
const timelineDrafts = createV2TimelineDraftRepository()

function directorTimelineFacts(input: {
  revision: number
  spec: Parameters<typeof buildV2TimelineFactDigest>[0]
}) {
  const digest = buildV2TimelineFactDigest(input.spec)
  return {
    revision: input.revision,
    scenes: digest.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      description: scene.description,
      visualRole: scene.visual_role,
      durationSec: scene.duration_sec,
    })),
    visibleText: digest.visible_text.map((text) => ({
      id: text.id,
      sceneId: text.scene_id,
      type: text.type,
      text: text.text,
      yPct: text.position.y_pct,
      maxLines: text.position.max_lines,
      animation: text.animation,
    })),
    transitions: digest.transitions.map((transition) => ({
      type: transition.type,
      durationSec: transition.duration_sec,
    })),
    audioClipCount: digest.audio.length,
    notes: digest.notes,
  }
}

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
  const draftId = input.currentTimeline?.draftId
  const revision = input.currentTimeline?.currentRevision
  const persistedRevision = draftId && revision
    ? await timelineDrafts.getRevision(draftId, revision, input.userId)
    : null
  const timelineFacts = persistedRevision
    ? directorTimelineFacts({ revision: persistedRevision.revision, spec: persistedRevision.spec })
    : undefined
  let state = applyDirectorWorkspacePatch(current.state, {
    context: input.currentTimeline
      ? { currentTimeline: input.currentTimeline, timelineFacts }
      : undefined,
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
  if (timelineFacts) await trace.writeJson('00-director-turn', 'persisted-v2-timeline-facts.json', timelineFacts)
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
  const explicitUiControls = input.context.explicitUiControls
  return {
    context: {
      sampleVideo: input.context.sampleVideo,
      materials: input.context.materials,
      currentTimeline: input.context.currentTimeline,
      directorState: input.context.directorState,
      slots: {
        sampleVideoStatus: slots.sampleVideoStatus,
        materialStatus: slots.materialStatus,
        ...(explicitUiControls?.aspectRatio ? { aspectRatio: explicitUiControls.aspectRatio } : {}),
        ...(explicitUiControls?.durationSec !== undefined ? { durationSec: explicitUiControls.durationSec } : {}),
        ...(explicitUiControls?.styleIntensity ? { styleIntensity: explicitUiControls.styleIntensity } : {}),
      },
      explicitUiControls,
      userIntent: {
        ...(explicitUiControls?.aspectRatio
          ? { aspectRatio: explicitUiControls.aspectRatio }
          : {}),
        ...(explicitUiControls?.durationSec !== undefined
          ? { durationSec: explicitUiControls.durationSec }
          : {}),
        ...(explicitUiControls?.styleIntensity
          ? { styleIntensity: explicitUiControls.styleIntensity }
          : {}),
      },
    },
    draftId: input.context.currentTimeline?.draftId,
    baseRevision: input.context.currentTimeline?.currentRevision,
    selectedItemId:
      input.context.currentTimeline?.selectedClipId ?? input.context.currentTimeline?.selectedSceneId,
  }
}

function resolveEffectiveCreativeConfig(input: {
  uiControls?: DirectorAgentChatRequest['context']['explicitUiControls']
  previous?: DirectorAgentChatRequest['context']['effectiveCreativeConfig']
  actionSlots: DirectorContextSlots
  modelSlots?: Partial<DirectorContextSlots>
}): DirectorEffectiveCreativeConfig {
  const ui = input.uiControls
  const model = input.modelSlots ?? {}
  const conflicts: DirectorEffectiveCreativeConfig['conflicts'] = []
  const addConflict = (
    field: 'aspectRatio' | 'durationSec' | 'styleIntensity',
    uiValue: string | number | undefined,
    modelValue: string | number | undefined,
    effectiveValue: string | number | undefined,
  ) => {
    if (uiValue !== undefined && modelValue !== undefined && uiValue !== modelValue && effectiveValue !== undefined) {
      conflicts.push({ field, uiValue, modelValue, effectiveValue })
    }
  }

  const aspectRatio = ui?.aspectRatio ?? input.actionSlots.aspectRatio
  const durationSec = ui?.durationSec ?? input.actionSlots.durationSec
  const styleIntensity = ui?.styleIntensity ?? input.actionSlots.styleIntensity
  addConflict('aspectRatio', ui?.aspectRatio, model.aspectRatio, aspectRatio)
  addConflict('durationSec', ui?.durationSec, model.durationSec, durationSec)
  addConflict('styleIntensity', ui?.styleIntensity, model.styleIntensity, styleIntensity)

  return {
    aspectRatio,
    durationSec,
    styleIntensity,
    sources: {
      aspectRatio: ui?.aspectRatio ? 'ui' : model.aspectRatio ? 'model' : input.previous?.sources.aspectRatio ?? 'default',
      durationSec: ui?.durationSec !== undefined ? 'ui' : model.durationSec !== undefined ? 'model' : input.previous?.sources.durationSec ?? 'default',
      styleIntensity: ui?.styleIntensity ? 'ui' : model.styleIntensity ? 'model' : input.previous?.sources.styleIntensity ?? 'default',
    },
    conflicts,
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
  if (JSON.stringify(before.context.timelineFacts) !== JSON.stringify(after.context.timelineFacts)) changed.push('context.timelineFacts')
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
    prompt: input.prompt,
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

  const unresovedAction = directorActionFromIntentResult({
    prompt: input.prompt,
    context: workspaceState.context,
    runtime: input.runtime,
    result: routed.result,
  })
  const effectiveCreativeConfig = resolveEffectiveCreativeConfig({
    uiControls: input.context.explicitUiControls,
    previous: workspaceState.context.effectiveCreativeConfig,
    actionSlots: unresovedAction.slots,
    modelSlots: routed.result.modelInferredSlots,
  })
  const action = {
    ...unresovedAction,
    slots: {
      ...unresovedAction.slots,
      aspectRatio: effectiveCreativeConfig.aspectRatio,
      durationSec: effectiveCreativeConfig.durationSec,
      styleIntensity: effectiveCreativeConfig.styleIntensity,
    },
  }
  const requestedTools = routed.result.toolRequests ?? []
  const shouldExecute =
    routed.result.executionEffect !== undefined &&
    routed.result.executionEffect !== 'none' &&
    requestedTools.length > 0

  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    ...routed.statePatch,
    context: {
      ...((routed.statePatch?.context as Record<string, unknown> | undefined) ?? {}),
      slots: action.slots,
      userIntent: {
        goal:
          action.intent.goal,
        rawText: input.prompt || workspaceState.context.userIntent.rawText,
        aspectRatio: effectiveCreativeConfig.aspectRatio,
        durationSec: effectiveCreativeConfig.durationSec,
        styleIntensity: effectiveCreativeConfig.styleIntensity,
      },
      effectiveCreativeConfig,
    },
    // A previous model failure must never become a durable gate for new input.
    pendingQuestion:
      routed.conversationIntent === 'clarify'
        ? routed.requirements?.join('；') || routed.result.assistantMessage
        : null,
    responseId: routed.responseId,
    responseContinuityDisabled: routed.responseContinuityRejected || undefined,
  })
  await trace.writeJson('00-director-turn', 'effective-creative-config.json', {
    explicit_ui_controls: input.context.explicitUiControls ?? {},
    model_inferred_slots: routed.result.modelInferredSlots ?? {},
    effective_config: effectiveCreativeConfig,
  })
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'user',
    content: input.prompt,
    at: new Date().toISOString(),
  })
  const executionPlan = await resolveV2AgentExecutionPlan({
    skillRequests: routed.result.skillRequests,
    toolRequests: requestedTools,
  })
  await trace.writeJson('00-director-turn', 'skill-tool-execution-plan.json', {
    requested_skills: routed.result.skillRequests ?? [],
    selected_skills: executionPlan.selectedSkills,
    rejected_skills: executionPlan.rejectedSkills,
    rejected_tools: executionPlan.rejectedTools,
    loaded_skills: executionPlan.loadedSkills.map(({ id, version, source, stage, loadLevel, hash }) => ({
      id, version, source, stage, load_level: loadLevel, hash,
    })),
    stages: executionPlan.stages.map((stage) => ({
      call_id: stage.toolRequest.callId,
      tool_id: stage.toolRequest.toolId,
      primary_skill_id: stage.primarySkill.id,
      dependency_skill_ids: stage.references.map((reference) => reference.id),
      normalized_arguments: stage.toolRequest.arguments,
    })),
  })
  if (executionPlan.loadedSkills.length) {
    await trace.writeText(
      '00-director-turn',
      'loaded-skill-instructions.md',
      executionPlan.loadedSkills
        .map((skill) => [
          `# ${skill.id}`,
          `version: ${skill.version}`,
          `source: ${skill.source}`,
          `sha256: ${skill.hash}`,
          '',
          skill.content,
        ].join('\n'))
        .join('\n\n---\n\n'),
    )
  }
  for (const selected of executionPlan.selectedSkills) {
    yield { type: 'skill_selected', skillId: selected.skillId, purpose: selected.purpose }
  }
  for (const loaded of executionPlan.loadedSkills) {
    yield {
      type: 'skill_loaded',
      skillId: loaded.id,
      version: loaded.version,
      source: loaded.source,
      hash: loaded.hash,
      dependency: !executionPlan.selectedSkills.some((selected) => selected.skillId === loaded.id),
    }
  }
  const toolResults: V2AgentToolResult[] = []
  let dispatchedToolCount = 0
  const deliveryAuthorization = deliveryAuthorizationFromDirectorDecision({
    prompt: input.prompt,
    executionEffect: routed.result.executionEffect ?? 'none',
    nextAction: routed.result.nextAction,
    conversationIntent: routed.conversationIntent,
  })
  if (shouldExecute) {
    for (const request of requestedTools) {
      yield { type: 'tool_proposed', callId: request.callId, toolId: request.toolId, requestedMode: request.requestedMode }
      const rejected = executionPlan.rejectedTools.find((item) => item.callId === request.callId)
      const stage = executionPlan.stages.find((item) => item.toolRequest.callId === request.callId)
      let result: V2AgentToolResult
      if (rejected || !stage) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          summary: rejected?.reason ?? '本轮 Skill/Tool 执行阶段无法建立。',
          recovery: '请让导演模型重新选择一致且可用的 Skill 与 Tool。',
        }
      } else {
        dispatchedToolCount += 1
        yield { type: 'tool_started', callId: request.callId, toolId: request.toolId }
        try {
          result = await dispatchV2AgentTool({
            stage,
            prompt: input.prompt,
            userId,
            context: workspaceState.context,
            workspace: workspaceState,
            authorization: deliveryAuthorization,
          })
        } catch (error) {
          result = {
            callId: request.callId,
            toolId: request.toolId,
            ok: false,
            summary: `Tool 执行异常：${error instanceof Error ? error.message : String(error)}`,
            recovery: '当前 V2 会话和草稿保持不变；修复异常后可从本轮继续。',
          }
        }
      }
      toolResults.push(result)
      await trace.writeJson('00-director-turn', `tool-${request.callId}.json`, {
        request: { call_id: request.callId, tool_id: request.toolId, skill_id: request.skillId, requested_mode: request.requestedMode, arguments: request.arguments },
        result: {
          ok: result.ok,
          summary: result.summary,
          output: result.output ?? null,
          draft: result.draft ? { id: result.draft.id, revision: result.draft.revision, trace_dir: result.draft.traceDir ?? null } : null,
          trace_dir: result.draft?.traceDir ?? result.output?.traceDir ?? null,
          recovery: result.recovery ?? null,
        },
      })
      const facts = toolResultTimelineFacts(result)
      if (result.sampleUnderstanding && workspaceState.context.sampleVideo) {
        const understanding = result.sampleUnderstanding as {
          summary_zh?: string; atmosphere_zh?: string; editing_zh?: string; rhythm_zh?: string; reusable_style_zh?: string; segments?: unknown[]; warnings_zh?: string[]
        }
        workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          context: {
            sampleVideo: {
              ...workspaceState.context.sampleVideo,
              sampleUnderstanding: result.sampleUnderstanding as import('../../../../shared/types/v2-sample-understanding.js').V2SampleUnderstandingResult,
              reference: {
                source: 'sample_video', summary: understanding.summary_zh ?? 'V2 sample understanding completed.',
                atmosphere: understanding.atmosphere_zh, editing: understanding.editing_zh, rhythm: understanding.rhythm_zh,
                reusableStyle: understanding.reusable_style_zh, segmentCount: understanding.segments?.length ?? 0, warnings: understanding.warnings_zh,
              },
            },
          },
        })
      }
      if (result.draft && facts) {
        workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          draftId: result.draft.id,
          baseRevision: result.draft.revision,
          context: {
            currentTimeline: {
              kind: 'v2_timeline', status: 'saved', draftId: result.draft.id,
              currentRevision: result.draft.revision, savedRevision: result.draft.revision,
              selectedClipId: workspaceState.selectedItemId,
              lastChangeSummary: result.summary,
              sceneCount: result.draft.spec.scenes.length,
            },
            timelineFacts: facts,
          },
        })
      }
      workspaceState = applyDirectorWorkspacePatch(workspaceState, {
        recentToolCallIds: [...(workspaceState.recentToolCallIds ?? []), request.callId].slice(-48),
        latestExecution: { action: request.toolId, outcome: result.ok ? result.summary : `failed: ${result.summary}`, traceDir: result.draft?.traceDir },
        recentFailure: result.ok ? null : { reason: result.summary, recovery: result.recovery },
      })
      yield {
        type: 'tool_result',
        callId: result.callId,
        toolId: result.toolId,
        ok: result.ok,
        summary: result.summary,
        result: result.output,
        draft: result.draft
          ? {
              draftId: result.draft.id,
              revision: result.draft.revision,
              spec: result.draft.spec,
              traceDir: result.draft.traceDir,
            }
          : undefined,
      }
      if (!result.ok) break
    }
  } else if (
    routed.result.executionEffect !== undefined &&
    routed.result.executionEffect !== 'none' &&
    requestedTools.length === 0
  ) {
    toolResults.push({
      callId: `missing_tool_${Date.now()}`,
      toolId: 'agent.execution-plan',
      ok: false,
      summary: '导演模型声明了执行动作，但没有给出可调度的 V2 Tool。',
      recovery: '保留本轮需求，由导演模型重新输出完整 Skill/Tool 提案。',
    })
  }
  const failedTool = toolResults.find((result) => !result.ok)
  const feedback = toolResults.length
    ? await respondToDirectorToolResultsWithLlm({
        prompt: input.prompt,
        previousResponseId: routed.responseId,
        initialAssistantMessage: routed.result.assistantMessage,
        workspaceFacts: compactDirectorWorkspaceContext(workspaceState),
        selectedSkills: executionPlan.selectedSkills.flatMap((selected) => {
          const loaded = executionPlan.loadedSkills.find((skill) => skill.id === selected.skillId)
          return loaded ? [{ id: loaded.id, version: loaded.version, hash: loaded.hash }] : []
        }),
        toolResults: toolResults.map((result) => ({
          callId: result.callId,
          toolId: result.toolId,
          ok: result.ok,
          summary: result.summary,
          output: result.output,
          recovery: result.recovery,
        })),
      })
    : undefined
  if (feedback) {
    await trace.writeJson('00-director-turn', 'tool-result-model-response.audit.json', {
      model_called: feedback.modelCalled,
      response: feedback.responseAudit ?? null,
      fallback_reason: feedback.fallbackReason ?? null,
      json_repair: feedback.jsonRepair ?? null,
      final_message: feedback.assistantMessage,
    })
    if (feedback.responseId) {
      workspaceState = applyDirectorWorkspacePatch(workspaceState, {
        responseId: feedback.responseId,
      })
    }
    if (feedback.responseContinuityRejected) {
      workspaceState = applyDirectorWorkspacePatch(workspaceState, {
        responseContinuityDisabled: true,
      })
    }
    for (const thought of feedback.publicThoughts) {
      yield { type: 'thought', title: '执行结果', content: thought }
    }
  }
  const assistantMessage = feedback?.assistantMessage ?? routed.result.assistantMessage
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'assistant',
    content: assistantMessage,
    at: new Date().toISOString(),
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    outcome: toolResults.length > 0
      ? `${failedTool ? 'failed' : 'completed'}:${toolResults.map((tool) => tool.toolId).join(',')}`
      : 'discussion',
  })
  workspaceState = compactDirectorWorkspaceTurns(workspaceState)
  const saved = await workspaceSessions.save({ id, userId, state: workspaceState })
  await trace.writeJson('00-director-turn', 'turn-result.json', {
    router_called: true,
    core_model_called: routed.modelCalled,
    result_model_called: feedback?.modelCalled ?? false,
    planner_called: toolResults.some((result) => result.plannerInvoked),
    tool_called: dispatchedToolCount > 0,
    tool_call_count: dispatchedToolCount,
    source: routed.source,
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    action: action.type,
    previous_response_id: before.responseId ?? null,
    response_id: saved.state.responseId ?? null,
    response_continuity_disabled: Boolean(saved.state.responseContinuityDisabled),
    state_changed: stateDiff(before, saved.state),
    effective_creative_config: effectiveCreativeConfig,
    fallback_reason: routed.fallbackReason ?? null,
    proposed_v2_creation_mode: routed.proposedV2CreationMode ?? null,
    effective_v2_creation_mode: effectiveV2CreationMode(saved.state.context),
    skill_requests: routed.result.skillRequests ?? [],
    selected_skills: executionPlan.selectedSkills,
    loaded_skills: executionPlan.loadedSkills.map(({ id, version, source, hash }) => ({ id, version, source, hash })),
    rejected_skills: executionPlan.rejectedSkills,
    rejected_tools: executionPlan.rejectedTools,
    tool_requests_ignored:
      requestedTools.length > 0 && routed.result.executionEffect === 'none'
        ? 'execution_effect_none'
        : null,
    tool_requests: requestedTools,
    tool_results: toolResults.map((result) => ({ call_id: result.callId, tool_id: result.toolId, ok: result.ok, summary: result.summary })),
  })
  await trace.writeSummary([
    '# V2 Director turn',
    `- session: ${id}`,
    `- core model called: ${routed.modelCalled}`,
    `- intent: ${intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent })}`,
    `- action: ${action.type}`,
  ])

  yield { type: 'assistant_reply', message: assistantMessage }
  yield { type: 'workspace_snapshot', workspaceSessionId: id, state: saved.state }
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

  yield { type: 'constraint_resolution', config: effectiveCreativeConfig }
  await wait(15)

  // Formal V2 execution ran through the server dispatcher above. Do not emit
  // a client-executable action plan for the same proposal.
  if (false && shouldExecute) {
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
        state: input.context.directorState!,
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
    message: assistantMessage,
  }
}
