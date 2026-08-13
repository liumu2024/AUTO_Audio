import { directorActionFromIntentResult } from '../../../../shared/lib/director-action-engine.js'
import {
  deriveRuntimeSlotStatus,
  summarizeDirectorReference,
} from '../../../../shared/lib/director-understanding.js'
import type { V2SampleUnderstandingResult } from '../../../../shared/types/v2-sample-understanding.js'
import { randomUUID } from 'node:crypto'
import { createV2TraceWriter } from '../../pipeline-v2/trace.js'
import { buildDirectorTimelineFacts } from '../../pipeline-v2/timeline-revision-outcome-review.js'
import { createV2TimelineDraftRepository } from '../../pipeline-v2/timeline-draft-repository.js'
import {
  dispatchV2AgentTool,
  toolResultTimelineFacts,
  type V2AgentToolProgress,
  type V2AgentToolResult,
} from '../../pipeline-v2/agent-tools/dispatcher.js'
import { resolveV2AgentExecutionPlan } from '../../pipeline-v2/agent-skills/registry.js'
import {
  deliveryAuthorizationFromDirectorDecision,
  pendingDismissalAuthorizationFromDirectorDecision,
} from '../../pipeline-v2/agent-tools/authorization.js'
import { routeDirectorIntentWithLlm, type LlmIntentRouterOutput } from './llm-intent-router.js'
import {
  applyCreativeMemoryActions,
  searchCreativeMemories,
  type CreativeMemoryActionReceipt,
} from '../creative-memory/creative-memory.service.js'
import { normalizeCreativeText } from '../creative-memory/creative-text-retrieval.js'
import { searchCreativeKnowledge } from '../creative-knowledge/creative-knowledge.service.js'
import {
  appendDirectorWorkspaceTurn,
  applyDirectorRequirementChange,
  applyDirectorWorkspacePatch,
  compactDirectorWorkspaceContext,
  compactDirectorWorkspaceTurns,
  createDirectorWorkspaceState,
  type RequirementChanges,
  type DirectorWorkspaceState,
} from './director-workspace-session.js'
import { createDirectorWorkspaceSessionRepository } from './director-workspace-session-repository.js'
import { routeConversationSurface } from './surface-router.js'
import type {
  DirectorAgentChatRequest,
} from './director-agent.types.js'
import { normalizeDirectorWorkspaceId } from './director-turn-idempotency.js'
import type {
  DirectorContextSlots,
  DirectorEffectiveCreativeConfig,
} from '../../../../shared/types/director-context.js'
import type { DirectorAgentStreamEvent, DirectorTimelineRevisionIntent } from '../../../../shared/types/director-stream.js'
import { buildV2TimelineRevisionIntent } from '../../pipeline-v2/timeline-revision-receipt.js'

const workspaceSessions = createDirectorWorkspaceSessionRepository()
const timelineDrafts = createV2TimelineDraftRepository()

export async function getDirectorWorkspaceSession(input: {
  workspaceSessionId: string
  userId: number
}) {
  return workspaceSessions.get(input.workspaceSessionId, input.userId)
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

function runtimeObservationPatch(input: DirectorAgentChatRequest) {
  const explicitUiControls = input.context.explicitUiControls
  return {
    context: {
      ...(input.contextSampleAuthoritative
        ? { sampleVideo: input.context.sampleVideo ?? null }
        : {}),
      ...(input.contextMaterialsAuthoritative
        ? { materials: input.context.materials }
        : {}),
      currentTimeline: input.context.currentTimeline,
      directorState: input.context.directorState,
      slots: {
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
  for (const key of ['draftId', 'baseRevision', 'selectedItemId', 'pendingQuestion', 'pendingTimelineRevisions', 'pendingTimelineRevisionConfirmation', 'responseId'] as const) {
    if (before[key] !== after[key]) changed.push(key)
  }
  if (JSON.stringify(before.context.slots) !== JSON.stringify(after.context.slots)) changed.push('context.slots')
  if (JSON.stringify(before.context.userIntent) !== JSON.stringify(after.context.userIntent)) changed.push('context.userIntent')
  if (JSON.stringify(before.context.timelineFacts) !== JSON.stringify(after.context.timelineFacts)) changed.push('context.timelineFacts')
  if (JSON.stringify(before.confirmedRequirements) !== JSON.stringify(after.confirmedRequirements)) changed.push('confirmedRequirements')
  return changed
}

const requirementPersistenceClaim = /(?:我|本轮|现已|已经).{0,12}(?:记录|保存|沉淀|更新|撤销|作废).{0,20}(?:要求|偏好|约束)|(?:已|已经|现已)(?:为你)?(?:成功)?(?:记录|保存|沉淀)(?:了)?(?::|：|(?:本轮|该|这|您的|你的)?(?:要求|偏好|约束))|(?:已|已经|现已)(?:成功)?(?:撤销|更新).{0,30}(?:偏好|要求|约束)|已将.{0,20}(?:要求|偏好|约束).{0,8}(?:更新|撤销|作废)|\b(?:I|this turn|now).{0,12}(?:recorded|saved|updated|revoked).{0,20}(?:requirement|preference|constraint)s?\b/i

function hasUnsupportedRequirementPersistenceClaim(message: string) {
  const withoutNegatedActions = message
    .replace(/(?:不|不会|不要|未|没有|无需).{0,4}(?:记录|保存|更新|撤销|作废)/gu, '')
    .replace(/\b(?:do not|don't|will not|won't|did not|not)\s+(?:record|save|update|revoke)\b/giu, '')
  return requirementPersistenceClaim.test(withoutNegatedActions)
}

function stripUnsupportedPersistenceClaims(message: string) {
  return (message.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [message])
    .filter((sentence) => !hasUnsupportedRequirementPersistenceClaim(sentence))
    .join('')
    .trim()
}

function requirementConfirmation(changes: RequirementChanges) {
  const messages = [
    ...changes.added.map((item) => `已记录：${item.statement}`),
    ...changes.replaced.map((item) => `已更新：${item.previous.statement} → ${item.current.statement}`),
    ...changes.revoked.map((item) => `已撤销：${item.statement}`),
  ]
  if (messages.length === 0 && changes.unchanged.length > 0) {
    messages.push('相关要求已在当前有效要求中，无需重复记录')
  }
  return messages.join('。')
}

function toolOutcomeConfirmation(
  results: V2AgentToolResult[],
  receipts: DirectorActionReceipt[],
  requests: Array<{ callId: string; arguments: Record<string, unknown> }>,
) {
  const friendlyError = (summary: string) => {
    if (summary.startsWith('invalid tool arguments: sceneId is only valid')) {
      return '修订参数不合法：目标场景只能用于场景或视觉策略范围。'
    }
    return summary
  }
  return results.map((result) => {
    const status = receipts.find((receipt) => receipt.callId === result.callId)?.status
    const instruction = requests.find((request) => request.callId === result.callId)?.arguments.instruction
    const target = typeof instruction === 'string' && instruction.trim()
      ? `“${instruction.trim()}”`
      : undefined
    if (status === 'skipped') return `已跳过 ${result.toolId}：${result.summary}`
    if (result.ok) return target ? `${result.summary} 已按本轮指令处理：${target}` : result.summary
    return `未完成 ${target ?? result.toolId}：${friendlyError(result.summary)}${result.recovery ? `；恢复建议：${result.recovery}` : ''}`
  }).join('；')
}

function workspaceSaveFailureConfirmation(results: V2AgentToolResult[]) {
  const savedDraft = [...results].reverse().find((result) => result.ok && result.draft)?.draft
  if (savedDraft) {
    return `草稿 v${savedDraft.revision} 已保存，但会话状态同步失败；重新打开该草稿可恢复结果。`
  }
  if (results.some((result) => result.ok)) {
    return '工具执行已返回成功，但依赖工作区的状态未保存，请重试。'
  }
  return '工作区保存失败，本轮要求和状态均不能确认为已保存，请稍后重试。'
}

function traceRequirementChanges(changes: RequirementChanges) {
  return {
    added: changes.added.map((item) => ({ id: item.id, statement: item.statement, status: item.status })),
    replaced: changes.replaced.map((item) => ({
      target_id: item.previous.id,
      previous_statement: item.previous.statement,
      previous_status: 'superseded',
      id: item.current.id,
      statement: item.current.statement,
      status: item.current.status,
    })),
    revoked: changes.revoked.map((item) => ({ id: item.id, statement: item.statement, status: item.status })),
    unchanged: changes.unchanged.map((item) => ({ id: item.id, statement: item.statement, status: item.status })),
    rejected: changes.rejected,
  }
}

interface DirectorActionReceipt {
  ref: string
  kind: 'requirements.update' | 'memory.update' | 'tool.call'
  status: 'succeeded' | 'failed' | 'skipped'
  reason?: string
  callId?: string
  toolId?: string
  dependsOn: string[]
}

function creativeMemoryConfirmation(
  receipts: CreativeMemoryActionReceipt[],
  actions: Array<{ ref: string; status?: 'active' | 'candidate' }>,
) {
  if (!receipts.length) return ''
  const memoryErrorLabels: Record<string, string> = {
    'Draft-scoped creative memory requires draftId.': '草稿级偏好需要先关联当前草稿。',
    'Creative memory action must cite the current source turn.': '记忆动作缺少本轮引用，已拒绝。',
    'Creative memory target was not recalled in this turn.': '目标偏好不在本轮召回中，已拒绝。',
    'Creative memory target belongs to another draft.': '目标偏好属于其他草稿，已拒绝。',
    'Creative memory target is missing or inactive.': '目标偏好不存在或已失效。',
    'Creative memory statement must contain 1-500 characters.': '偏好内容需要 1-500 字。',
  }
  const active = receipts.filter((receipt) =>
    receipt.status === 'succeeded' && receipt.effectiveStatus === 'active').length
  const candidates = receipts.filter((receipt) =>
    receipt.status === 'succeeded' && receipt.effectiveStatus === 'candidate').length
  const duplicates = receipts.filter((receipt) =>
    receipt.status === 'skipped' && receipt.reason === 'duplicate_of_requirement').length
  const failed = receipts.filter((receipt) => receipt.status === 'failed')
  return [
    active ? `已沉淀 ${active} 条创作偏好，可在“创作偏好”中查看或撤销` : '',
    candidates ? `另有 ${candidates} 条仅作为待观察候选，不会直接影响创作` : '',
    duplicates ? `${duplicates} 条已作为当前项目要求记录，未重复沉淀为长期偏好` : '',
    failed.length
      ? `${failed.length} 条偏好未保存：${failed.map((item) => memoryErrorLabels[item.reason ?? ''] ?? item.reason).filter(Boolean).join('；')}`
      : '',
  ].filter(Boolean).join('；')
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
  dependencies: {
    dispatchTool?: typeof dispatchV2AgentTool
    saveWorkspace?: typeof workspaceSessions.save
  } = {},
): AsyncGenerator<DirectorAgentStreamEvent> {
  const id = normalizeDirectorWorkspaceId(input.workspaceSessionId)
  const turnRequestId = input.turnRequestId?.trim().slice(0, 200) || randomUUID()
  const userId = input.userId ?? 1
  const persisted = await workspaceSessions.get(id, userId)
  const before = persisted?.state ?? createDirectorWorkspaceState({ context: input.context })
  if (
    persisted
    && input.workspaceStateRevision !== undefined
    && input.workspaceStateRevision !== before.stateRevision
  ) {
    yield {
      type: 'error',
      message: `工作区已从 v${input.workspaceStateRevision} 更新到 v${before.stateRevision}，请基于最新状态重试本轮请求。`,
    }
    yield { type: 'done' }
    return
  }
  // Confirmation/rejection must operate on the server-owned proposal snapshot;
  // UI context arriving with the decision is not a new workspace observation.
  let workspaceState = persisted && !input.timelineRevisionDecision
    ? applyDirectorWorkspacePatch(before, runtimeObservationPatch(input))
    : before
  if (workspaceState.draftId) {
    const persistedDraft = await timelineDrafts.getDraft(workspaceState.draftId, userId)
    if (persistedDraft) {
      workspaceState = applyDirectorWorkspacePatch(workspaceState, {
        pendingTimelineRevisions: persistedDraft.pendingTimelineRevisions,
      })
    }
  }
  const selectedSampleId = workspaceState.context.sampleVideo?.id
  if (selectedSampleId && workspaceState.context.materials.some((material) => material.id === selectedSampleId)) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      context: {
        materials: workspaceState.context.materials.filter((material) => material.id !== selectedSampleId),
      },
    })
  }
  const effectiveRuntime = {
    ...input.runtime,
    sampleUrl: workspaceState.context.sampleVideo?.url ?? '',
    isSampleParsed: Boolean(
      workspaceState.context.sampleVideo?.reference
      || workspaceState.context.sampleVideo?.sampleUnderstanding,
    ),
    hasVisualMaterial: workspaceState.context.materials.some(
      (material) => material.type === 'image' || material.type === 'video',
    ),
    materialCount: workspaceState.context.materials.length,
  }
  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    context: { slots: deriveRuntimeSlotStatus(effectiveRuntime) },
  })
  const explicitlyAttachedImages = input.currentTurnMaterialIds?.length
    ? [...new Set(input.currentTurnMaterialIds)].filter((materialId) =>
      workspaceState.context.materials.some((material) => material.id === materialId && material.type === 'image'))
      .slice(0, 12)
    : []
  if (input.currentTurnMaterialIds?.length) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      recentVisualMaterialIds: explicitlyAttachedImages,
    })
  }
  const persistedTimelineRevision = workspaceState.draftId && workspaceState.baseRevision
    ? await timelineDrafts.getRevision(workspaceState.draftId, workspaceState.baseRevision, userId)
    : null
  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    context: {
      timelineFacts: persistedTimelineRevision
        ? buildDirectorTimelineFacts(persistedTimelineRevision.revision, persistedTimelineRevision.spec)
        : null,
    },
  })
  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    context: {
      conversationSummary: JSON.stringify(compactDirectorWorkspaceContext(workspaceState)),
    },
  })
  const turnOperationId = `turn_${turnRequestId}`
  const trace = createV2TraceWriter({
    taskId: `${id}__${turnOperationId}`,
    sessionId: id,
    operationId: turnOperationId,
  })
  await trace.appendSessionEvent({
    type: 'turn_started',
    prompt: input.prompt,
    artifact_dir: trace.rootDir,
  })
  await trace.writeJson('00-director-turn', 'turn-input.json', {
    input_reached: true,
    workspace_session_id: id,
    turn_request_id: turnRequestId,
    prompt: input.prompt,
    context: compactDirectorWorkspaceContext(workspaceState),
    runtime: effectiveRuntime,
  })
  const pendingRevisionDecision = input.timelineRevisionDecision
  const pendingRevisionConfirmation = workspaceState.pendingTimelineRevisionConfirmation
  if (pendingRevisionDecision && (
    !pendingRevisionConfirmation
    || pendingRevisionConfirmation.confirmationId !== pendingRevisionDecision.confirmationId
  )) {
    yield { type: 'error', message: '待确认的修改已变化或不存在，请基于当前方案重新提出修改。' }
    yield { type: 'done' }
    return
  }
  if (pendingRevisionDecision?.action === 'confirm' && pendingRevisionConfirmation) {
    const currentDraft = await timelineDrafts.getDraft(pendingRevisionConfirmation.draftId, userId)
    if (
      !currentDraft
      || currentDraft.revision !== pendingRevisionConfirmation.baseRevision
      || workspaceState.draftId !== pendingRevisionConfirmation.draftId
      || workspaceState.baseRevision !== pendingRevisionConfirmation.baseRevision
    ) {
      const assistantMessage = '草稿版本已变化，这项旧修改提案没有执行。请基于当前方案重新提出修改。'
      workspaceState = applyDirectorWorkspacePatch(before, {
        pendingTimelineRevisionConfirmation: null,
        ...(currentDraft && before.draftId === pendingRevisionConfirmation.draftId
          ? { draftId: currentDraft.id, baseRevision: currentDraft.revision }
          : {}),
      })
      workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
        role: 'assistant', content: assistantMessage, at: new Date().toISOString(), intent: 'revise', outcome: 'revision_confirmation_stale',
      })
      const saved = await (dependencies.saveWorkspace ?? workspaceSessions.save)({
        id, userId, state: compactDirectorWorkspaceTurns(workspaceState), expectedStateRevision: before.stateRevision,
      })
      await trace.writeJson('00-director-turn', 'turn-result.json', {
        router_called: false, core_model_called: false, tool_called: false, action: 'revision_confirmation_stale',
        expected_draft_id: pendingRevisionConfirmation.draftId,
        expected_revision: pendingRevisionConfirmation.baseRevision,
        actual_revision: currentDraft?.revision ?? null,
      })
      yield { type: 'assistant_reply', message: assistantMessage }
      yield { type: 'error', message: assistantMessage }
      yield {
        type: 'workspace_session', workspaceSessionId: id, turnRequestId,
        stateRevision: saved.state.stateRevision, state: saved.state, traceDir: trace.rootDir, modelCalled: false,
      }
      yield { type: 'done' }
      return
    }
  }
  if (pendingRevisionDecision?.action === 'reject' && pendingRevisionConfirmation) {
    const assistantMessage = '已取消这次修改提案，当前草稿没有变化。你可以补充新的目标或保留项后重新提出修改。'
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      pendingTimelineRevisionConfirmation: null,
    })
    workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
      role: 'user', content: input.prompt, at: new Date().toISOString(), intent: 'revise', outcome: 'revision_rejected',
    })
    workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
      role: 'assistant', content: assistantMessage, at: new Date().toISOString(), intent: 'revise', outcome: 'revision_rejected',
    })
    const saved = await (dependencies.saveWorkspace ?? workspaceSessions.save)({
      id, userId, state: compactDirectorWorkspaceTurns(workspaceState), expectedStateRevision: before.stateRevision,
    })
    await trace.writeJson('00-director-turn', 'turn-result.json', {
      router_called: false, core_model_called: false, tool_called: false, action: 'revision_rejected',
    })
    yield { type: 'assistant_reply', message: assistantMessage }
    yield {
      type: 'workspace_session', workspaceSessionId: id, turnRequestId,
      stateRevision: saved.state.stateRevision, state: saved.state, traceDir: trace.rootDir, modelCalled: false,
    }
    yield { type: 'done' }
    return
  }
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
    content: `${sampleLabel({ ...input, runtime: effectiveRuntime })}；${materialLabel(
      effectiveRuntime.materialCount,
      effectiveRuntime.hasVisualMaterial,
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

  const confirmedRevisionProposal = pendingRevisionDecision?.action === 'confirm'
    ? pendingRevisionConfirmation
    : undefined
  let creativeMemoryRetrieval = { active: [], candidate: [], audit: [] } as Awaited<ReturnType<typeof searchCreativeMemories>>
  let creativeMemoryRetrievalError: string | undefined
  if (!confirmedRevisionProposal) {
    try {
      creativeMemoryRetrieval = await searchCreativeMemories({
        userId,
        draftId: workspaceState.draftId,
        query: input.prompt,
      })
    } catch (error) {
      creativeMemoryRetrievalError = error instanceof Error ? error.message : String(error)
    }
  }
  await trace.writeJson('00-director-turn', 'creative-memory-retrieval.json', {
    query: input.prompt,
    draft_id: workspaceState.draftId ?? null,
    active: creativeMemoryRetrieval.active.map((item) => ({
      id: item.memory.id,
      scope_type: item.memory.scopeType,
      statement: item.memory.statement,
      score: item.score,
    })),
    candidate: creativeMemoryRetrieval.candidate.map((item) => ({
      id: item.memory.id,
      scope_type: item.memory.scopeType,
      statement: item.memory.statement,
      score: item.score,
    })),
    audit_summary: creativeMemoryRetrieval.audit.reduce((summary, item) => {
      summary[item.reason] = (summary[item.reason] ?? 0) + 1
      return summary
    }, {} as Record<string, number>),
    error: creativeMemoryRetrievalError ?? null,
  })
  let creativeKnowledgeRetrieval = { items: [], audit: [] } as Awaited<ReturnType<typeof searchCreativeKnowledge>>
  let creativeKnowledgeRetrievalError: string | undefined
  if (!confirmedRevisionProposal) {
    try {
      creativeKnowledgeRetrieval = await searchCreativeKnowledge({ query: input.prompt })
    } catch (error) {
      creativeKnowledgeRetrievalError = error instanceof Error ? error.message : String(error)
    }
  }
  await trace.writeJson('00-director-turn', 'creative-knowledge-retrieval.json', {
    query: input.prompt,
    selected: creativeKnowledgeRetrieval.items.map((item) => ({
      id: item.knowledge.id,
      statement: item.knowledge.statement,
      applicability: item.knowledge.applicability,
      score: item.score,
      rank: item.rank,
    })),
    audit: creativeKnowledgeRetrieval.audit,
    error: creativeKnowledgeRetrievalError ?? null,
  })
  const routed: LlmIntentRouterOutput = confirmedRevisionProposal
    ? {
        source: 'context_fallback',
        modelCalled: false,
        result: {
          intent: 'revise_timeline',
          confidence: 1,
          contentDomain: workspaceState.context.slots.contentDomain,
          slotsPatch: deriveRuntimeSlotStatus(effectiveRuntime),
          missingSlots: [],
          requiresConfirmation: false,
          nextAction: 'REVISE_TIMELINE',
          executionEffect: 'draft_change',
          assistantMessage: '正在执行已确认的修改提案。',
          skillRequests: confirmedRevisionProposal.skillRequests,
          toolRequests: confirmedRevisionProposal.toolRequests,
        },
        publicThoughts: ['已读取服务端保存的修改提案；本轮不重新解释修改范围。'],
        conversationIntent: confirmedRevisionProposal.intent,
        stateActions: [],
        memoryActions: [],
        missingInformation: [],
      }
    : await routeDirectorIntentWithLlm({
    ...input,
    runtime: effectiveRuntime,
    currentTurnMaterialIds: workspaceState.recentVisualMaterialIds,
    timelineSpec: persistedTimelineRevision?.spec,
    currentTurnId: turnOperationId,
    context: workspaceState.context,
    confirmedRequirements: workspaceState.confirmedRequirements,
    pendingTimelineRevisions: workspaceState.pendingTimelineRevisions,
    retrievedCreativeMemories: creativeMemoryRetrieval,
    previousResponseId:
      workspaceState.responseContinuityDisabled ? undefined : workspaceState.responseId,
      })
  await trace.writeJson('00-director-turn', 'model-call.json', {
    source: routed.source,
    model_called: routed.modelCalled,
    response_audit: routed.modelResponseAudit ?? {
      output_text: routed.modelOutputText ?? null,
    },
    protocol_error: routed.protocolError ?? null,
    fallback_reason: routed.fallbackReason ?? null,
    image_input_warnings: routed.imageInputWarnings ?? [],
    structured_output: routed.structuredOutput ?? null,
    effective_v2_creation_mode: effectiveV2CreationMode(workspaceState.context),
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

  const stateAction = routed.stateActions[0]
  const requirementResult = applyDirectorRequirementChange(
    workspaceState,
    stateAction
      ? { type: 'apply', operations: stateAction.operations }
      : { type: 'none' },
    turnOperationId,
  )
  workspaceState = requirementResult.state
  const actionReceipts: DirectorActionReceipt[] = stateAction
    ? [{
        ref: stateAction.ref,
        kind: 'requirements.update',
        status: requirementResult.ok ? 'succeeded' : 'failed',
        reason: requirementResult.ok ? undefined : requirementResult.error,
        dependsOn: [],
      }]
    : []
  const memoryActionReceipts = await applyCreativeMemoryActions({
    userId,
    workspaceSessionId: id,
    currentTurnId: turnOperationId,
    currentUserText: input.prompt,
    currentDraftId: workspaceState.draftId,
    recalledMemoryIds: new Set([
      ...creativeMemoryRetrieval.active.map((item) => item.memory.id),
      ...creativeMemoryRetrieval.candidate.map((item) => item.memory.id),
    ]),
    actions: routed.memoryActions,
    requirementStatements: [...new Map([
      ...workspaceState.confirmedRequirements
        .filter((item) => item.status === 'active')
        .map((item) => item.statement),
      ...(requirementResult.changes.added ?? []).map((item) => item.statement),
      ...(requirementResult.changes.replaced ?? []).map((item) => item.current.statement),
    ].map((statement) => [normalizeCreativeText(statement), statement])).values()],
  })
  actionReceipts.push(...memoryActionReceipts.map((receipt) => ({
    ref: receipt.ref,
    kind: 'memory.update' as const,
    // A duplicate project requirement is intentionally not persisted as
    // memory, but it is a handled no-op rather than a failed dependency.
    status: receipt.status === 'skipped' ? 'succeeded' : receipt.status,
    reason: receipt.reason,
    dependsOn: [],
  })))

  const unresovedAction = directorActionFromIntentResult({
    prompt: input.prompt,
    context: workspaceState.context,
    runtime: effectiveRuntime,
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
  const modelToolProposals = routed.result.toolRequests ?? []
  const shouldExecute = modelToolProposals.length > 0

  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    context: {
      slots: action.slots,
      userIntent: {
        goal: action.intent.goal,
        aspectRatio: effectiveCreativeConfig.aspectRatio,
        durationSec: effectiveCreativeConfig.durationSec,
        styleIntensity: effectiveCreativeConfig.styleIntensity,
      },
      effectiveCreativeConfig,
    },
    // A previous model failure must never become a durable gate for new input.
    pendingQuestion:
      routed.conversationIntent === 'clarify'
        ? routed.missingInformation.join('；') || routed.result.assistantMessage
        : null,
    responseId: routed.responseId,
    responseContinuityDisabled: routed.responseContinuityRejected || undefined,
  })
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'user',
    content: input.prompt,
    at: new Date().toISOString(),
  })
  const executionPlan = await resolveV2AgentExecutionPlan({
    intent: routed.conversationIntent ?? 'chat',
    skillRequests: routed.result.skillRequests,
    toolRequests: modelToolProposals,
    stateActionRefs: confirmedRevisionProposal?.resolvedStateActionRefs
      ?? routed.stateActions.map((item) => item.ref),
    callIdContext: {
      workspaceSessionId: id,
      turnRequestId: confirmedRevisionProposal?.originalTurnRequestId ?? turnRequestId,
    },
  })
  const requestedTools = executionPlan.toolRequests
  const revisionIntents = requestedTools.flatMap((request): DirectorTimelineRevisionIntent[] => {
    if (request.toolId !== 'timeline.patch') return []
    const confirmed = confirmedRevisionProposal?.revisionIntents.find((item) => item.callId === request.callId)
    const intent = confirmed ?? buildV2TimelineRevisionIntent({
      callId: request.callId,
      userRequest: input.prompt,
      arguments: request.arguments,
    })
    return intent ? [intent] : []
  })
  const invalidUnconfirmedRevisionPlan = !confirmedRevisionProposal
    && revisionIntents.length > 0
    && (
      executionPlan.rejectedSkills.length > 0
      || executionPlan.rejectedTools.length > 0
      || !executionPlan.stages.some((stage) => stage.toolRequest.toolId === 'timeline.patch')
    )
  const awaitsRevisionConfirmation = !confirmedRevisionProposal
    && revisionIntents.length > 0
    && !invalidUnconfirmedRevisionPlan
  if (awaitsRevisionConfirmation) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      pendingTimelineRevisionConfirmation: {
        confirmationId: revisionIntents[0]!.callId,
        draftId: workspaceState.draftId!,
        baseRevision: workspaceState.baseRevision!,
        originalTurnRequestId: turnRequestId,
        originalRequest: input.prompt,
        intent: routed.conversationIntent === 'execute' ? 'execute' : 'revise',
        skillRequests: executionPlan.selectedSkills,
        resolvedStateActionRefs: routed.stateActions.map((item) => item.ref),
        toolRequests: executionPlan.stages
          .filter(({ toolRequest }) => toolRequest.toolId !== 'timeline.render')
          .map(({ toolRequest }) => ({
          ref: toolRequest.ref,
          toolId: toolRequest.toolId,
          skillId: toolRequest.skillId,
          arguments: toolRequest.arguments,
          requestedMode: toolRequest.requestedMode,
          dependsOn: toolRequest.dependsOn,
        })),
        revisionIntents,
        executionContext: {
          context: workspaceState.context,
          runtime: effectiveRuntime,
          confirmedRequirements: workspaceState.confirmedRequirements,
          selectedItemId: workspaceState.selectedItemId,
          recalledCreativeMemories: creativeMemoryRetrieval.active.map((item) => item.memory.statement),
          recalledCreativeKnowledge: creativeKnowledgeRetrieval.items.map((item) => item.knowledge.statement),
        },
      },
    })
  }
  await trace.writeJson('00-director-turn', 'skill-tool-execution-plan.json', {
    requested_skills: routed.result.skillRequests ?? [],
    model_tool_proposals: modelToolProposals,
    selected_skills: executionPlan.selectedSkills,
    rejected_skills: executionPlan.rejectedSkills,
    rejected_tools: executionPlan.rejectedTools,
    loaded_skills: executionPlan.loadedSkills.map(({ id, version, source, stage, loadLevel, hash }) => ({
      id, version, source, stage, load_level: loadLevel, hash,
    })),
    stages: executionPlan.stages.map((stage) => ({
      call_id: stage.toolRequest.callId,
      ref: stage.toolRequest.ref,
      depends_on: stage.toolRequest.dependsOn,
      tool_id: stage.toolRequest.toolId,
      primary_skill_id: stage.primarySkill.id,
      dependency_skill_ids: stage.references.map((reference) => reference.id),
      normalized_arguments: stage.toolRequest.arguments,
    })),
  })
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
    intent: routed.conversationIntent,
    requestsDelivery: modelToolProposals.some((proposal) => proposal.toolId === 'timeline.render'),
  })
  const pendingDismissalAuthorization = pendingDismissalAuthorizationFromDirectorDecision({
    prompt: input.prompt,
    intent: routed.conversationIntent,
    requestedCallId: (() => {
      const proposals = modelToolProposals.filter((proposal) => proposal.toolId === 'timeline.pending.dismiss')
      return proposals.length === 1 && typeof proposals[0]?.arguments.callId === 'string'
        ? proposals[0].arguments.callId
        : undefined
    })(),
    pendingRevisions: workspaceState.pendingTimelineRevisions ?? [],
  })
  const executionPrompt = confirmedRevisionProposal?.originalRequest ?? input.prompt
  const executionContext = confirmedRevisionProposal?.executionContext
  const dispatchWorkspace = executionContext
    ? {
        ...workspaceState,
        context: executionContext.context,
        confirmedRequirements: executionContext.confirmedRequirements,
        draftId: confirmedRevisionProposal.draftId,
        baseRevision: confirmedRevisionProposal.baseRevision,
        selectedItemId: executionContext.selectedItemId,
      }
    : workspaceState
  if (shouldExecute) {
    for (const request of requestedTools) {
      const rejected = executionPlan.rejectedTools.find((item) => item.callId === request.callId)
      const stage = executionPlan.stages.find((item) => item.toolRequest.callId === request.callId)
      const failedDependency = request.dependsOn
        .map((ref) => actionReceipts.find((receipt) => receipt.ref === ref))
        .find((receipt) => receipt?.status !== 'succeeded')
      const revisionIntent = revisionIntents.find((item) => item.callId === request.callId)
      yield {
        type: 'tool_proposed',
        callId: request.callId,
        toolId: request.toolId,
        requestedMode: request.requestedMode,
        effectiveMode: stage?.modeResolution.effectiveMode ?? request.requestedMode,
        modeNormalized: stage?.modeResolution.normalized ?? false,
        revisionIntent,
        revisionConfirmationId: revisionIntent
          ? confirmedRevisionProposal?.confirmationId ?? (awaitsRevisionConfirmation ? revisionIntents[0]!.callId : undefined)
          : undefined,
      }
      if (awaitsRevisionConfirmation) continue
      let result: V2AgentToolResult
      let didDispatch = false
      if (invalidUnconfirmedRevisionPlan) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'revision_confirmation',
          summary: '修改提案包含未通过协议校验的动作；为避免部分执行，本轮没有运行任何 Tool。',
          recovery: '请基于当前草稿重新提出一组完整、可确认的修改。',
        }
      } else if (failedDependency) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'dependency',
          summary: `因依赖动作 ${failedDependency.ref} 未成功，本动作已跳过。`,
        }
      } else if (rejected || !stage) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'registry',
          summary: rejected?.reason ?? '本轮 Skill/Tool 执行阶段无法建立。',
          recovery: '请让导演模型重新选择一致且可用的 Skill 与 Tool。',
        }
      } else {
        didDispatch = true
        dispatchedToolCount += 1
        yield { type: 'tool_started', callId: request.callId, toolId: request.toolId }
        try {
          const progressQueue: V2AgentToolProgress[] = []
          let wakeProgress: (() => void) | undefined
          let dispatchSettled = false
          let dispatchResult: V2AgentToolResult | undefined
          let dispatchError: unknown
          void (dependencies.dispatchTool ?? dispatchV2AgentTool)({
            stage,
            prompt: executionPrompt,
            requestInstruction:
              typeof request.arguments?.instruction === 'string'
                ? request.arguments.instruction
                : undefined,
            userId,
            context: executionContext?.context ?? workspaceState.context,
            runtime: executionContext?.runtime ?? effectiveRuntime,
            workspace: dispatchWorkspace,
            authorization: request.toolId === 'timeline.pending.dismiss'
              ? pendingDismissalAuthorization
              : deliveryAuthorization,
            traceSessionId: id,
            recalledCreativeMemories: executionContext?.recalledCreativeMemories
              ?? creativeMemoryRetrieval.active.map((item) => item.memory.statement),
            recalledCreativeKnowledge: executionContext?.recalledCreativeKnowledge
              ?? creativeKnowledgeRetrieval.items.map((item) => item.knowledge.statement),
            authorizedDraftComponentIds: request.dependsOn.flatMap((ref) => {
              const dependencyRequest = requestedTools.find((item) => item.ref === ref)
              const dependencyResult = dependencyRequest
                ? toolResults.find((item) => item.callId === dependencyRequest.callId && item.ok)
                : undefined
              const componentId = dependencyResult?.toolId === 'render.author'
                ? dependencyResult.output?.componentId
                : undefined
              return typeof componentId === 'string' ? [componentId] : []
            }),
            onProgress: (event) => {
              progressQueue.push(event)
              wakeProgress?.()
            },
          }).then((value) => {
            dispatchResult = value
          }).catch((error: unknown) => {
            dispatchError = error
          }).finally(() => {
            dispatchSettled = true
            wakeProgress?.()
          })
          while (!dispatchSettled || progressQueue.length > 0) {
            const progress = progressQueue.shift()
            if (progress) {
              yield {
                type: 'tool_progress',
                callId: request.callId,
                toolId: request.toolId,
                ...progress,
              }
              continue
            }
            await new Promise<void>((resolve) => {
              if (dispatchSettled || progressQueue.length > 0) resolve()
              else wakeProgress = resolve
            })
            wakeProgress = undefined
          }
          if (dispatchError) throw dispatchError
          if (!dispatchResult) throw new Error('V2 Tool completed without a result.')
          result = dispatchResult
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
      if (
        request.toolId === 'timeline.patch'
        && !result.ok
        && workspaceState.draftId
        && workspaceState.baseRevision
      ) {
        const marked = await timelineDrafts.markPendingRevision({
          draftId: workspaceState.draftId,
          userId,
          baseRevision: workspaceState.baseRevision,
          callId: request.callId,
          replacesCallId: typeof request.arguments.resolvesPendingCallId === 'string'
            ? request.arguments.resolvesPendingCallId
            : undefined,
          instruction: typeof request.arguments.instruction === 'string'
            ? request.arguments.instruction
            : input.prompt,
        })
        if (marked) workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          pendingTimelineRevisions: marked.pendingTimelineRevisions,
        })
      }
      const receiptStatus: 'skipped' | 'succeeded' | 'failed' = failedDependency
        ? 'skipped'
        : result.ok
          ? 'succeeded'
          : 'failed'
      actionReceipts.push({
        ref: request.ref,
        kind: 'tool.call',
        status: receiptStatus,
        reason: result.ok ? undefined : result.summary,
        callId: request.callId,
        toolId: request.toolId,
        dependsOn: request.dependsOn,
      })
      await trace.writeJson('00-director-turn', `tool-${request.callId}.json`, {
        request: {
          call_id: request.callId,
          ref: request.ref,
          depends_on: request.dependsOn,
          tool_id: request.toolId,
          skill_id: request.skillId,
          requested_mode: request.requestedMode,
          effective_mode: stage?.modeResolution.effectiveMode ?? request.requestedMode,
          mode_normalized: stage?.modeResolution.normalized ?? false,
          arguments: request.arguments,
        },
        result: {
          status: receiptStatus,
          ok: result.ok,
          summary: result.summary,
          gate: result.gate ?? null,
          output: result.output ?? null,
          draft: result.draft ? { id: result.draft.id, revision: result.draft.revision, trace_dir: result.draft.traceDir ?? null } : null,
          trace_dir: result.draft?.traceDir ?? result.output?.traceDir ?? null,
          recovery: result.recovery ?? null,
        },
      })
      const facts = toolResultTimelineFacts(result)
      if (result.sampleUnderstanding && result.sampleSelection) {
        const understanding = result.sampleUnderstanding as V2SampleUnderstandingResult
        workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          context: {
            sampleVideo: {
              ...result.sampleSelection,
              sampleUnderstanding: understanding,
              reference: summarizeDirectorReference(understanding),
            },
            materials: workspaceState.context.materials.filter(
              (material) => material.id !== result.sampleSelection!.id,
            ),
          },
        })
      }
      if (result.draft && facts) {
        const selectedItemId = typeof result.output?.selectedItemId === 'string'
          ? result.output.selectedItemId
          : null
        workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          draftId: result.draft.id,
          baseRevision: result.draft.revision,
          selectedItemId,
          context: {
            currentTimeline: {
              kind: 'v2_timeline', status: 'saved', draftId: result.draft.id,
              currentRevision: result.draft.revision, savedRevision: result.draft.revision,
              selectedClipId: selectedItemId ?? undefined,
              lastChangeSummary: result.summary,
              sceneCount: result.draft.spec.scenes.length,
            },
            timelineFacts: facts,
          },
        })
      }
      workspaceState = applyDirectorWorkspacePatch(workspaceState, {
        recentToolCallIds: didDispatch
          ? [...(workspaceState.recentToolCallIds ?? []), request.callId].slice(-48)
          : workspaceState.recentToolCallIds,
        latestExecution: { action: request.toolId, outcome: result.ok ? result.summary : `failed: ${result.summary}`, traceDir: result.draft?.traceDir },
        recentFailure: result.ok ? null : { reason: result.summary, recovery: result.recovery },
        pendingTimelineRevisions: request.toolId === 'timeline.patch' || request.toolId === 'timeline.pending.dismiss'
          ? result.ok
            ? result.draft
              ? result.draft.pendingTimelineRevisions ?? workspaceState.pendingTimelineRevisions
              : workspaceState.pendingTimelineRevisions
            : workspaceState.pendingTimelineRevisions
          : workspaceState.pendingTimelineRevisions,
      })
      const revisionActualDiff = result.output?.revisionActualDiff
      const revisionReceipt = revisionIntent
        ? {
            ...revisionIntent,
            status: receiptStatus,
            summary: result.summary,
            revision: result.draft?.revision,
            ...(revisionActualDiff && typeof revisionActualDiff === 'object'
              ? { actualDiff: revisionActualDiff as NonNullable<Extract<DirectorAgentStreamEvent, { type: 'tool_result' }>['revisionReceipt']>['actualDiff'] }
              : {}),
          }
        : undefined
      yield {
        type: 'tool_result',
        actionRef: request.ref,
        status: receiptStatus,
        callId: result.callId,
        toolId: result.toolId,
        ok: result.ok,
        summary: result.summary,
        revisionReceipt,
        result: result.output,
        draft: result.draft
          ? {
              draftId: result.draft.id,
              revision: result.draft.revision,
              spec: result.draft.spec,
              traceDir: result.draft.traceDir,
              pendingTimelineRevisions: result.draft.pendingTimelineRevisions,
            }
          : undefined,
      }
    }
  }
  if (confirmedRevisionProposal) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      pendingTimelineRevisionConfirmation: null,
    })
  }
  const shouldReportToolOutcome = dispatchedToolCount > 0
    || (toolResults.length > 0 && routed.conversationIntent !== 'chat' && routed.conversationIntent !== 'clarify')
  const toolConfirmation = shouldReportToolOutcome
    ? toolOutcomeConfirmation(toolResults, actionReceipts, requestedTools)
    : ''
  const modelAssistantMessage = awaitsRevisionConfirmation
    ? `修改范围已解析并保存，尚未执行。请先核对修改目标与保护边界，再选择确认执行或取消。${requestedTools.some((request) => request.toolId === 'timeline.render') ? '正式渲染不包含在本次修改确认中，修改完成后仍需单独确认导出。' : ''}`
    : shouldReportToolOutcome
    ? toolConfirmation
    : routed.result.assistantMessage
  const requirementMessage = !stateAction
    ? ''
    : requirementResult.ok
      ? requirementConfirmation(requirementResult.changes)
      : '本轮要求变更未通过校验，因此没有保存这些要求。'
  const memoryMessage = creativeMemoryConfirmation(memoryActionReceipts, routed.memoryActions)
  const baseAssistantMessage = stateAction
    ? toolResults.length > 0
      ? [requirementMessage, modelAssistantMessage]
          .filter(Boolean)
          .map((message) => message.replace(/[。！!？?]+$/u, ''))
          .join('。')
      : requirementMessage
    : memoryActionReceipts.length > 0
      && toolResults.length === 0
      && hasUnsupportedRequirementPersistenceClaim(modelAssistantMessage)
      ? stripUnsupportedPersistenceClaims(modelAssistantMessage)
      : toolResults.length === 0
      && memoryActionReceipts.every((receipt) => receipt.status !== 'succeeded')
      && hasUnsupportedRequirementPersistenceClaim(modelAssistantMessage)
      ? '本轮没有产生可验证的要求变更，因此未将其标记为已保存。'
      : modelAssistantMessage
  const assistantMessage = memoryMessage
    ? [memoryMessage, baseAssistantMessage]
        .filter(Boolean)
        .map((message) => message.replace(/[。！!；;]+$/u, ''))
        .join('。')
    : baseAssistantMessage
  const failedReceiptCount = actionReceipts.filter((receipt) => receipt.status !== 'succeeded').length
  const succeededReceiptCount = actionReceipts.filter((receipt) => receipt.status === 'succeeded').length
  workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
    role: 'assistant',
    content: assistantMessage,
    at: new Date().toISOString(),
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    outcome: actionReceipts.length > 0
      ? `${failedReceiptCount ? succeededReceiptCount ? 'partial' : 'failed' : 'completed'}:${actionReceipts.map((receipt) => receipt.ref).join(',')}`
      : 'discussion',
  })
  workspaceState = compactDirectorWorkspaceTurns(workspaceState)
  let saved
  try {
    saved = await (dependencies.saveWorkspace ?? workspaceSessions.save)({
      id,
      userId,
      state: workspaceState,
      expectedStateRevision: before.stateRevision,
    })
  } catch (error) {
    const message = workspaceSaveFailureConfirmation(toolResults)
    await trace.writeJson('00-director-turn', 'workspace-save-failure.json', {
      error: error instanceof Error ? error.message : String(error),
    })
    yield { type: 'assistant_reply', message }
    yield { type: 'error', message }
    yield { type: 'done' }
    return
  }
  await trace.writeJson('00-director-turn', 'turn-result.json', {
    router_called: !confirmedRevisionProposal,
    core_model_called: routed.modelCalled,
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
    effective_config_changed:
      JSON.stringify(before.context.effectiveCreativeConfig) !==
      JSON.stringify(saved.state.context.effectiveCreativeConfig),
    requirement_changes: traceRequirementChanges(requirementResult.changes),
    creative_memory_retrieval: {
      active: creativeMemoryRetrieval.active,
      candidate: creativeMemoryRetrieval.candidate,
      audit: creativeMemoryRetrieval.audit,
      error: creativeMemoryRetrievalError ?? null,
    },
    creative_memory_requests: routed.memoryActions,
    creative_memory_changes: memoryActionReceipts,
    creative_knowledge_retrieval: {
      selected: creativeKnowledgeRetrieval.items,
      audit: creativeKnowledgeRetrieval.audit,
      error: creativeKnowledgeRetrievalError ?? null,
    },
    action_receipts: actionReceipts,
    effective_creative_config: effectiveCreativeConfig,
    fallback_reason: routed.fallbackReason ?? null,
    effective_v2_creation_mode: effectiveV2CreationMode(saved.state.context),
    skill_requests: routed.result.skillRequests ?? [],
    selected_skills: executionPlan.selectedSkills,
    loaded_skills: executionPlan.loadedSkills.map(({ id, version, source, hash }) => ({ id, version, source, hash })),
    rejected_skills: executionPlan.rejectedSkills,
    rejected_tools: executionPlan.rejectedTools,
    tool_requests: requestedTools,
    tool_results: toolResults.map((result) => {
      const receipt = actionReceipts.find((item) => item.callId === result.callId)
      return { call_id: result.callId, ref: receipt?.ref, status: receipt?.status, tool_id: result.toolId, ok: result.ok, summary: result.summary }
    }),
  })
  await trace.appendSessionEvent({
    type: 'turn_completed',
    prompt: input.prompt,
    assistant_message: assistantMessage,
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    model_source: routed.source,
    response_id: saved.state.responseId ?? null,
    action_receipts: actionReceipts,
    skill_requests: routed.result.skillRequests ?? [],
    tool_results: toolResults.map((result) => ({
      call_id: result.callId,
      tool_id: result.toolId,
      ok: result.ok,
      summary: result.summary,
    })),
    draft_id: saved.state.draftId ?? null,
    revision: saved.state.baseRevision ?? null,
    artifact_dir: trace.rootDir,
  })
  await trace.writeSummary([
    '# V2 Director turn',
    `- session: ${id}`,
    `- core model called: ${routed.modelCalled}`,
    `- intent: ${intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent })}`,
    `- action: ${action.type}`,
  ])

  yield { type: 'assistant_reply', message: assistantMessage }
  yield {
    type: 'workspace_session',
    workspaceSessionId: id,
    turnRequestId,
    stateRevision: saved.state.stateRevision,
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

  yield { type: 'done' }
}
