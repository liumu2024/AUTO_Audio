import { directorActionFromIntentResult } from '../../../../shared/lib/director-action-engine.js'
import {
  deriveRuntimeSlotStatus,
  summarizeDirectorReference,
} from '../../../../shared/lib/director-understanding.js'
import type { V2SampleUnderstandingResult } from '../../../../shared/types/v2-sample-understanding.js'
import { randomUUID } from 'node:crypto'
import { createV2TraceWriter } from '../../pipeline-v2/trace.js'
import { buildDirectorTimelineFacts } from '../../pipeline-v2/timeline-revision-outcome-review.js'
import {
  partitionV2TimelineRevisionGroups,
  type V2TimelineRevisionGroup,
} from '../../pipeline-v2/timeline-revision-scope.js'
import { createV2TimelineDraftRepository } from '../../pipeline-v2/timeline-draft-repository.js'
import {
  dispatchV2AgentTool,
  toolResultTimelineFacts,
  type V2AgentToolProgress,
  type V2AgentToolResult,
} from '../../pipeline-v2/agent-tools/dispatcher.js'
import {
  completeV2SampleAnalysisDependencies,
  resolveV2AgentExecutionPlan,
} from '../../pipeline-v2/agent-skills/registry.js'
import {
  deliveryAuthorizationFromDirectorDecision,
  pendingDismissalAuthorizationFromDirectorDecision,
} from '../../pipeline-v2/agent-tools/authorization.js'
import {
  composeDirectorFinalReply,
  routeDirectorIntentWithLlm,
  type DirectorFinalReplyFact,
  type DirectorFinalReplyResult,
  type DirectorStateAction,
  type LlmIntentRouterOutput,
} from './llm-intent-router.js'
import {
  searchCreativeMemories,
} from '../creative-memory/creative-memory.service.js'
import { searchCreativeKnowledge } from '../creative-knowledge/creative-knowledge.service.js'
import {
  learnCreativePreferencesFromUserTurn,
  type CreativePreferenceLearningReceipt,
} from '../creative-learning/creative-learning.service.js'
import {
  appendDirectorWorkspaceTurn,
  applyDirectorRequirementChange,
  applyDirectorWorkspacePatch,
  compactDirectorConversationContext,
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
import type {
  DirectorAgentStreamEvent,
  DirectorCreativeSummary,
  DirectorTimelineRevisionIntent,
} from '../../../../shared/types/director-stream.js'
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

function usesChineseAsPrimaryLanguage(value: string) {
  const hanCount = [...value.matchAll(/[\p{Script=Han}]/gu)].length
  const latinCount = [...value.matchAll(/[\p{Script=Latin}]/gu)].length
  return hanCount > 0 && hanCount * 2 >= latinCount
}

function proposalReply(input: {
  userPrompt: string
  modelMessage: string
  kind: 'creation' | 'revision'
}) {
  if (!input.userPrompt.trim()
    || usesChineseAsPrimaryLanguage(input.userPrompt) === usesChineseAsPrimaryLanguage(input.modelMessage)) {
    return input.modelMessage
  }
  if (!usesChineseAsPrimaryLanguage(input.userPrompt)) {
    return input.kind === 'creation'
      ? 'I summarized your goal below. Please confirm it before I generate the full plan.'
      : 'I summarized the requested changes below. Please confirm them before I update the current plan.'
  }
  return input.kind === 'creation'
    ? '我先把你的目标整理成了下面这份创作摘要。你确认无误后，我再生成完整方案。'
    : '我把这次需要调整的内容整理在下面了。你确认无误后，我再应用到当前方案。'
}

function stateDiff(before: DirectorWorkspaceState, after: DirectorWorkspaceState) {
  const changed: string[] = []
  for (const key of ['draftId', 'baseRevision', 'selectedItemId', 'pendingQuestion', 'pendingTimelineRevisions', 'pendingTimelineRevisionConfirmation', 'pendingTimelinePlanConfirmation', 'responseId'] as const) {
    if (before[key] !== after[key]) changed.push(key)
  }
  if (JSON.stringify(before.context.slots) !== JSON.stringify(after.context.slots)) changed.push('context.slots')
  if (JSON.stringify(before.context.userIntent) !== JSON.stringify(after.context.userIntent)) changed.push('context.userIntent')
  if (JSON.stringify(before.context.timelineFacts) !== JSON.stringify(after.context.timelineFacts)) changed.push('context.timelineFacts')
  if (JSON.stringify(before.confirmedRequirements) !== JSON.stringify(after.confirmedRequirements)) changed.push('confirmedRequirements')
  return changed
}

function creativeSummary(input: {
  prompt: string
  modelSummary?: { goal: string; audience?: string; openQuestions: string[] }
  config: DirectorEffectiveCreativeConfig
  requirements: DirectorWorkspaceState['confirmedRequirements']
}): DirectorCreativeSummary {
  const usesChinese = usesChineseAsPrimaryLanguage(input.prompt)
  const normalizedPrompt = input.prompt.trim().toLocaleLowerCase()
  const followsPromptLanguage = (value?: string, allowExplicitFragment = false) => {
    const normalizedValue = value?.trim().toLocaleLowerCase()
    if (!normalizedValue) return false
    if (!normalizedPrompt) return true
    return allowExplicitFragment
      ? normalizedPrompt.includes(normalizedValue)
      : usesChinese === usesChineseAsPrimaryLanguage(normalizedValue)
  }
  const modelGoal = input.modelSummary?.goal.trim()
  return {
    goal: followsPromptLanguage(modelGoal) ? modelGoal! : input.prompt.trim(),
    audience: followsPromptLanguage(input.modelSummary?.audience, true)
      ? input.modelSummary?.audience?.trim()
      : undefined,
    aspectRatio: input.config.aspectRatio,
    durationSec: input.config.durationSec,
    styleIntensity: input.config.styleIntensity,
    mustKeep: input.requirements
      .filter((item) => item.status === 'active')
      .map((item) => item.statement),
    openQuestions: (input.modelSummary?.openQuestions ?? []).filter((question) => followsPromptLanguage(question)),
  }
}

function requirementConfirmation(changes: RequirementChanges) {
  const messages = [
    ...changes.added.map((item) => `我已经记下“${item.statement}”`),
    ...changes.replaced.map((item) => `我已经把“${item.previous.statement}”更新为“${item.current.statement}”`),
    ...changes.revoked.map((item) => `我已经不再沿用“${item.statement}”`),
  ]
  if (messages.length === 0 && changes.unchanged.length > 0) {
    messages.push('这项要求已经在当前方案中生效，不需要重复记录')
  }
  return messages.join('；')
}

function userFacingExecutionText(message: string) {
  return message
    .replace(/V2\s+正式渲染/giu, '成片导出')
    .replace(/V2\s+(?:Timeline|时间线)/giu, '视频方案')
    .replace(/\bV\d+(?:\s+Timeline)?\b/giu, '当前方案')
    .replace(/\bRemotion\b/giu, '程序化画面')
    .replace(/\bTool\b/giu, '处理')
    .replace(/\bSkill\b/giu, '能力')
    .replace(/\bProvider\b/giu, '生成服务')
    .replace(/\bBackend\b/giu, '创作服务')
    .replace(/\bWorker\b/giu, '后台任务')
    .replace(/API\s*Key/giu, '创作服务配置')
    .replace(/input_asset(?:_id)?/giu, '参考素材')
    .replace(/output_asset(?:_id)?/giu, '生成产物')
    .replace(/\bsceneIds?\b/giu, '目标镜头')
    .replace(/\bcustom_render\b/giu, '自定义画面效果')
    .replace(/\bpendingTimelineRevisions?\b/giu, '待处理修改')
    .replace(/\bscene_[a-z0-9_-]+\b/giu, '目标镜头')
    .replace(/\boverlay_[a-z0-9_-]+\b/giu, '目标字幕')
    .replace(/\btransition_[a-z0-9_-]+\b/giu, '目标转场')
    .replace(/\b(?:component|cmp)_[a-z0-9_-]+\b/giu, '画面效果')
    .replace(/\bmat_[a-z0-9_-]+\b/giu, '素材')
    .replace(/call\s*id/giu, '处理标识')
    .replace(/\brevision\s*\d*/giu, '当前方案')
    .trim()
}

function userFacingRevisionDiff(
  diff: NonNullable<Extract<DirectorAgentStreamEvent, { type: 'tool_result' }>['revisionReceipt']>['actualDiff'],
) {
  if (!diff) return undefined
  return {
    scenes: diff.scenes.length ? ['镜头内容或呈现已更新'] : [],
    visibleText: diff.visibleText.length ? ['字幕或画面文字已更新'] : [],
    transitions: diff.transitions.length ? ['转场已更新'] : [],
    audio: diff.audio.length ? ['音频已更新'] : [],
    other: diff.other.length ? ['方案设置或素材安排已更新'] : [],
  }
}

function toolOutcomeConfirmation(
  results: V2AgentToolResult[],
  receipts: DirectorActionReceipt[],
) {
  const friendlyError = (summary: string) => {
    if (summary.startsWith('invalid tool arguments: sceneId is only valid')) {
      return '修订参数不合法：目标场景只能用于场景或视觉策略范围。'
    }
    return userFacingExecutionText(summary)
  }
  return results.map((result) => {
    const status = receipts.find((receipt) => receipt.callId === result.callId)?.status
    if (status === 'skipped') return `这一步没有继续：${userFacingExecutionText(result.summary)}`
    if (result.ok) return userFacingExecutionText(result.summary)
    return `这次没能完成这项操作：${friendlyError(result.summary).replace(/[。；;]+$/u, '')}${result.recovery ? `；${userFacingExecutionText(result.recovery)}` : ''}`
  }).join('；')
}

function workspaceSaveFailureConfirmation(results: V2AgentToolResult[]) {
  const savedDraft = [...results].reverse().find((result) => result.ok && result.draft)?.draft
  if (savedDraft) {
    return '方案修改已经保存，但对话状态没有同步成功；重新打开当前方案即可恢复结果。'
  }
  if (results.some((result) => result.ok)) {
    return '这次处理已经返回结果，但对话中的状态没有保存成功，请重试。'
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

function requirementEvidenceError(userPrompt: string, action?: DirectorStateAction) {
  for (const operation of action?.operations ?? []) {
    const evidence = operation.sourceExcerpt.trim()
    if (!userPrompt.includes(evidence)) {
      return 'Requirement evidence must be copied from the current user input.'
    }
  }
  return undefined
}

function explicitPreferenceRequirementStatements(
  action: DirectorStateAction | undefined,
  receipt: CreativePreferenceLearningReceipt,
) {
  const preferenceEvidence = receipt.changes
    .filter((change) => change.observationKind === 'explicit_preference' && change.scopeType === 'user')
    .map((change) => change.sourceExcerpt.trim())
    .filter(Boolean)
  if (!action || preferenceEvidence.length === 0) return new Set<string>()
  return new Set(action.operations.flatMap((operation) => {
    if (operation.operation !== 'add') return []
    const evidence = operation.sourceExcerpt.trim()
    const sameSource = preferenceEvidence.some((candidate) =>
      evidence === candidate || evidence.includes(candidate) || candidate.includes(evidence))
    return sameSource ? [operation.statement.replace(/\s+/g, ' ').trim()] : []
  }))
}

interface DirectorActionReceipt {
  ref: string
  kind: 'requirements.update' | 'tool.call'
  status: 'succeeded' | 'failed' | 'skipped'
  reason?: string
  callId?: string
  toolId?: string
  dependsOn: string[]
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
    composeFinalReply?: typeof composeDirectorFinalReply
    learnPreferences?: typeof learnCreativePreferencesFromUserTurn
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
      code: 'workspace_changed',
      message: '你操作期间当前方案已经发生了其他修改。本轮输入仍会保留，请基于最新方案重试。',
    }
    yield {
      type: 'workspace_session',
      workspaceSessionId: id,
      turnRequestId,
      stateRevision: before.stateRevision,
      state: before,
      traceDir: before.latestExecution?.traceDir ?? '',
      modelCalled: false,
      responseId: before.responseId,
    }
    yield { type: 'done' }
    return
  }
  // Confirmation/rejection must operate on the server-owned proposal snapshot;
  // UI context arriving with the decision is not a new workspace observation.
  let workspaceState = persisted && !input.timelineRevisionDecision && !input.timelinePlanDecision
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
    isSampleParsed: workspaceState.context.sampleVideo?.sampleUnderstanding?.source === 'llm',
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
  workspaceState = applyDirectorWorkspacePatch(workspaceState, {
    recentVisualMaterialIds: explicitlyAttachedImages,
  })
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
      conversationSummary: JSON.stringify(compactDirectorConversationContext(workspaceState)),
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
  const pendingPlanDecision = input.timelinePlanDecision
  const pendingPlanConfirmation = workspaceState.pendingTimelinePlanConfirmation
  if (pendingPlanDecision && (
    !pendingPlanConfirmation
    || pendingPlanConfirmation.confirmationId !== pendingPlanDecision.confirmationId
  )) {
    yield { type: 'error', message: '待确认的创作摘要已变化或不存在，请重新提出首次创作要求。' }
    yield { type: 'done' }
    return
  }
  if (pendingPlanDecision?.action === 'reject' && pendingPlanConfirmation) {
    const assistantMessage = '已取消这次方案生成，尚未开始规划。你可以调整目标、受众或保留项后再继续。'
    workspaceState = applyDirectorWorkspacePatch(workspaceState, { pendingTimelinePlanConfirmation: null })
    workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
      role: 'user', content: input.prompt, at: new Date().toISOString(), intent: 'create', outcome: 'creation_summary_rejected',
    })
    workspaceState = appendDirectorWorkspaceTurn(workspaceState, {
      role: 'assistant', content: assistantMessage, at: new Date().toISOString(), intent: 'create', outcome: 'creation_summary_rejected',
    })
    const saved = await (dependencies.saveWorkspace ?? workspaceSessions.save)({
      id, userId, state: compactDirectorWorkspaceTurns(workspaceState), expectedStateRevision: before.stateRevision,
    })
    yield { type: 'assistant_reply', message: assistantMessage }
    yield {
      type: 'workspace_session', workspaceSessionId: id, turnRequestId,
      stateRevision: saved.state.stateRevision, state: saved.state, traceDir: trace.rootDir, modelCalled: false,
    }
    yield { type: 'done' }
    return
  }
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
      const assistantMessage = '你确认前，当前方案已经发生了其他修改，所以这项旧提案没有执行。请基于最新方案重新提出修改。'
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
  const confirmedPlanProposal = pendingPlanDecision?.action === 'confirm'
    ? pendingPlanConfirmation
    : undefined
  let creativeMemoryRetrieval = { active: [], candidate: [], audit: [] } as Awaited<ReturnType<typeof searchCreativeMemories>>
  let creativeMemoryRetrievalError: string | undefined
  if (!confirmedRevisionProposal && !confirmedPlanProposal) {
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
  const confirmedProposal = confirmedRevisionProposal ?? confirmedPlanProposal
  const routed: LlmIntentRouterOutput = confirmedProposal
    ? {
        source: 'context_fallback',
        modelCalled: false,
        result: {
          intent: confirmedRevisionProposal ? 'revise_timeline' : 'generate_timeline',
          confidence: 1,
          contentDomain: workspaceState.context.slots.contentDomain,
          slotsPatch: deriveRuntimeSlotStatus(effectiveRuntime),
          missingSlots: [],
          requiresConfirmation: false,
          nextAction: confirmedRevisionProposal ? 'REVISE_TIMELINE' : 'GENERATE_TIMELINE',
          executionEffect: 'draft_change',
          assistantMessage: confirmedRevisionProposal ? '正在执行已确认的修改提案。' : '正在按已确认的创作摘要生成方案。',
          skillRequests: confirmedProposal.skillRequests,
          toolRequests: confirmedProposal.toolRequests,
        },
        publicThoughts: [confirmedRevisionProposal
          ? '已读取服务端保存的修改提案；本轮不重新解释修改范围。'
          : '已读取服务端保存的创作摘要；本轮不重新解释创作目标。'],
        conversationIntent: confirmedRevisionProposal?.intent ?? 'create',
        stateActions: [],
        missingInformation: [],
      }
    : await routeDirectorIntentWithLlm({
    ...input,
    surfaceMode: surface.mode,
    runtime: effectiveRuntime,
    currentTurnMaterialIds: workspaceState.recentVisualMaterialIds,
    timelineSpec: persistedTimelineRevision?.spec,
    currentTurnId: turnOperationId,
    context: workspaceState.context,
    confirmedRequirements: workspaceState.confirmedRequirements,
    pendingTimelineRevisions: workspaceState.pendingTimelineRevisions,
    recentFailure: workspaceState.recentFailure,
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
  const requirementEvidenceFailure = requirementEvidenceError(input.prompt, stateAction)
  const requirementResult = requirementEvidenceFailure
    ? {
        ok: false as const,
        state: workspaceState,
        changes: {
          added: [], replaced: [], revoked: [], unchanged: [],
          rejected: [requirementEvidenceFailure],
        },
        error: requirementEvidenceFailure,
      }
    : applyDirectorRequirementChange(
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
  const creativeLearningPromise: Promise<CreativePreferenceLearningReceipt> = confirmedProposal
    ? Promise.resolve({ status: 'skipped', changes: [], errors: [] })
    : (dependencies.learnPreferences ?? learnCreativePreferencesFromUserTurn)({
        userId,
        workspaceSessionId: id,
        turnId: turnOperationId,
        userText: input.prompt,
        turnIntent: routed.conversationIntent ?? 'chat',
        currentDraftId: workspaceState.draftId,
        requirementStatements: workspaceState.confirmedRequirements
          .filter((item) => item.status === 'active')
          .map((item) => item.statement),
        recalledMemories: [
          ...creativeMemoryRetrieval.active.map((item) => item.memory),
          ...creativeMemoryRetrieval.candidate.map((item) => item.memory),
        ],
      }).catch((error) => ({
        status: 'failed',
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)],
      }))
  const resolvedStateActionRefs = stateAction && requirementResult.ok ? [stateAction.ref] : []

  const unresovedAction = directorActionFromIntentResult({
    context: workspaceState.context,
    result: routed.result,
  })
  const effectiveCreativeConfig = confirmedProposal?.executionContext.context.effectiveCreativeConfig
    ?? resolveEffectiveCreativeConfig({
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
  const modelToolProposals = completeV2SampleAnalysisDependencies({
    proposals: routed.result.toolRequests ?? [],
    sampleAvailable: Boolean(workspaceState.context.sampleVideo?.url),
    sampleReady: workspaceState.context.sampleVideo?.sampleUnderstanding?.source === 'llm',
  })
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
    stateActionRefs: confirmedProposal?.resolvedStateActionRefs
      ?? resolvedStateActionRefs,
    callIdContext: {
      workspaceSessionId: id,
      turnRequestId: confirmedProposal?.originalTurnRequestId ?? turnRequestId,
    },
  })
  const requestedTools = executionPlan.toolRequests
  const shouldRetrieveCreativeKnowledge = !confirmedProposal
    && executionPlan.stages.some(({ toolRequest }) =>
      toolRequest.toolId === 'timeline.plan' || toolRequest.toolId === 'timeline.patch')
  if (shouldRetrieveCreativeKnowledge) {
    try {
      creativeKnowledgeRetrieval = await searchCreativeKnowledge({ query: input.prompt })
    } catch (error) {
      creativeKnowledgeRetrievalError = error instanceof Error ? error.message : String(error)
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
  }
  const revisionIntents = requestedTools.flatMap((request): DirectorTimelineRevisionIntent[] => {
    if (request.toolId !== 'timeline.patch') return []
    const confirmed = confirmedRevisionProposal?.revisionIntents.find((item) => item.callId === request.callId)
    const intent = confirmed ?? buildV2TimelineRevisionIntent({
      callId: request.callId,
      userRequest: input.prompt,
      arguments: request.arguments,
      baseSpec: persistedTimelineRevision?.spec,
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
        intent: routed.conversationIntent === 'execute' ? 'execute' : 'revise',
        skillRequests: executionPlan.selectedSkills,
        resolvedStateActionRefs,
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
  const awaitsPlanConfirmation = !confirmedProposal
    && !workspaceState.draftId
    && executionPlan.rejectedSkills.length === 0
    && executionPlan.rejectedTools.length === 0
    && executionPlan.stages.some((stage) => stage.toolRequest.toolId === 'timeline.plan')
  if (awaitsPlanConfirmation) {
    const planStage = executionPlan.stages.find((stage) => stage.toolRequest.toolId === 'timeline.plan')!
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      pendingTimelinePlanConfirmation: {
        confirmationId: planStage.toolRequest.callId,
        originalTurnRequestId: turnRequestId,
        originalRequest: input.prompt,
        skillRequests: executionPlan.selectedSkills,
        resolvedStateActionRefs,
        toolRequests: executionPlan.stages.map(({ toolRequest }) => ({
          ref: toolRequest.ref,
          toolId: toolRequest.toolId,
          skillId: toolRequest.skillId,
          arguments: toolRequest.arguments,
          requestedMode: toolRequest.requestedMode,
          dependsOn: toolRequest.dependsOn,
        })),
        creationSummary: creativeSummary({
          prompt: input.prompt,
          modelSummary: routed.result.creationSummary,
          config: effectiveCreativeConfig,
          requirements: workspaceState.confirmedRequirements,
        }),
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
  const executionPrompt = confirmedRevisionProposal?.revisionIntents[0]?.originalRequest
    ?? confirmedPlanProposal?.originalRequest
    ?? input.prompt
  const deliveryAuthorization = deliveryAuthorizationFromDirectorDecision({
    prompt: executionPrompt,
    intent: routed.conversationIntent,
    requestsDelivery: modelToolProposals.some((proposal) => proposal.toolId === 'timeline.render'),
  })
  const pendingDismissalAuthorization = pendingDismissalAuthorizationFromDirectorDecision({
    prompt: executionPrompt,
    intent: routed.conversationIntent,
    requestedCallIds: modelToolProposals
      .filter((proposal) => proposal.toolId === 'timeline.pending.dismiss')
      .flatMap((proposal) => typeof proposal.arguments.callId === 'string'
        ? [proposal.arguments.callId]
        : []),
    pendingRevisions: workspaceState.pendingTimelineRevisions ?? [],
  })
  const executionContext = confirmedProposal?.executionContext
  let dispatchContext = executionContext?.context ?? workspaceState.context
  let dispatchRuntime = executionContext?.runtime ?? effectiveRuntime
  const dispatchWorkspace = executionContext
    ? {
        ...workspaceState,
        context: executionContext.context,
        confirmedRequirements: executionContext.confirmedRequirements,
        ...(confirmedRevisionProposal
          ? { draftId: confirmedRevisionProposal.draftId, baseRevision: confirmedRevisionProposal.baseRevision }
          : {}),
        selectedItemId: executionContext.selectedItemId,
      }
    : workspaceState
  const revisionGroupRequests = requestedTools.filter((request) => request.toolId === 'timeline.patch')
  const eligibleRevisionGroupRequests = revisionGroupRequests.filter((request) =>
    !executionPlan.rejectedTools.some((item) => item.callId === request.callId)
    && executionPlan.stages.some((item) => item.toolRequest.callId === request.callId))
  const revisionGroupPartition = confirmedRevisionProposal && persistedTimelineRevision
    ? partitionV2TimelineRevisionGroups({
        baseSpec: persistedTimelineRevision.spec,
        items: eligibleRevisionGroupRequests.map((request) => ({
          ref: request.ref,
          callId: request.callId,
          scope: request.arguments.scope,
          instruction: request.arguments.instruction,
          sceneId: request.arguments.sceneId,
          overlayIds: request.arguments.overlayIds,
          transitionIds: request.arguments.transitionIds,
          requiredMaterialIds: request.arguments.requiredMaterialIds,
          useSampleReference: request.arguments.useSampleReference,
          resolvesPendingCallId: request.arguments.resolvesPendingCallId,
        })),
      })
    : { groups: [], invalid: [] }
  const revisionGroupByCallId = new Map<string, V2TimelineRevisionGroup>()
  for (const group of revisionGroupPartition.groups) {
    for (const item of group.items) revisionGroupByCallId.set(item.callId, group)
  }
  const invalidRevisionGroupByCallId = new Map<string, { callIds: string[]; message: string }>()
  for (const invalid of revisionGroupPartition.invalid) {
    for (const callId of invalid.callIds) invalidRevisionGroupByCallId.set(callId, invalid)
  }
  let executionRequests = requestedTools
  if (revisionGroupPartition.groups.length > 0) {
    const unitKeyByCallId = new Map(requestedTools.map((request) => [
      request.callId,
      revisionGroupByCallId.get(request.callId)?.items[0]?.callId ?? request.callId,
    ]))
    const requestByRef = new Map(requestedTools.map((request) => [request.ref, request]))
    const units = new Map<string, {
      requests: typeof requestedTools
      dependencies: Set<string>
      firstIndex: number
    }>()
    requestedTools.forEach((request, index) => {
      const key = unitKeyByCallId.get(request.callId)!
      const unit = units.get(key) ?? { requests: [], dependencies: new Set<string>(), firstIndex: index }
      unit.requests.push(request)
      units.set(key, unit)
    })
    for (const [key, unit] of units) {
      for (const request of unit.requests) {
        for (const ref of request.dependsOn) {
          const dependencyRequest = requestByRef.get(ref)
          const dependencyKey = dependencyRequest ? unitKeyByCallId.get(dependencyRequest.callId) : undefined
          if (dependencyKey && dependencyKey !== key) unit.dependencies.add(dependencyKey)
        }
      }
    }
    const completedUnits = new Set<string>()
    const orderedUnits: Array<{
      requests: typeof requestedTools
      dependencies: Set<string>
      firstIndex: number
    }> = []
    while (orderedUnits.length < units.size) {
      const next = [...units.entries()]
        .filter(([key, unit]) => !completedUnits.has(key)
          && [...unit.dependencies].every((dependency) => completedUnits.has(dependency)))
        .sort((left, right) => left[1].firstIndex - right[1].firstIndex)[0]
      if (!next) break
      completedUnits.add(next[0])
      orderedUnits.push(next[1])
    }
    if (orderedUnits.length === units.size) {
      executionRequests = orderedUnits.flatMap((unit) => unit.requests)
    } else {
      for (const group of revisionGroupPartition.groups) {
        const invalid = {
          callIds: group.items.map((item) => item.callId),
          message: 'The joint revision has cyclic external dependencies.',
        }
        for (const callId of invalid.callIds) {
          revisionGroupByCallId.delete(callId)
          invalidRevisionGroupByCallId.set(callId, invalid)
        }
      }
    }
  }
  const revisionGroupResults = new Map<string, V2AgentToolResult>()
  let latestTurnFailure: DirectorWorkspaceState['recentFailure'] | undefined
  const preResolvedDependencyRefs = new Set(confirmedProposal?.resolvedStateActionRefs ?? [])
  if (shouldExecute) {
    for (const request of executionRequests) {
      const rejected = executionPlan.rejectedTools.find((item) => item.callId === request.callId)
      const stage = executionPlan.stages.find((item) => item.toolRequest.callId === request.callId)
      const revisionGroup = revisionGroupByCallId.get(request.callId)
      const revisionGroupItem = revisionGroup?.items.find((item) => item.callId === request.callId)
      const revisionGroupPrimary = revisionGroup?.items[0]?.callId === request.callId
      const invalidRevisionGroup = invalidRevisionGroupByCallId.get(request.callId)
      const invalidRevisionGroupPrimary = invalidRevisionGroup?.callIds[0] === request.callId
      const groupRefs = new Set(revisionGroup?.items.map((item) => item.ref) ?? [])
      const dependencyRefs = revisionGroup
        ? [...new Set(revisionGroup.items.flatMap((item) => {
            const member = requestedTools.find((candidate) => candidate.callId === item.callId)
            return member?.dependsOn.filter((ref) => !groupRefs.has(ref)) ?? []
          }))]
        : request.dependsOn
      const failedDependencyRef = dependencyRefs.find((ref) =>
        !preResolvedDependencyRefs.has(ref)
        && actionReceipts.find((receipt) => receipt.ref === ref)?.status !== 'succeeded')
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
        creationSummary: request.toolId === 'timeline.plan'
          ? confirmedPlanProposal?.creationSummary ?? workspaceState.pendingTimelinePlanConfirmation?.creationSummary
          : undefined,
        creationConfirmationId: request.toolId === 'timeline.plan'
          ? confirmedPlanProposal?.confirmationId ?? workspaceState.pendingTimelinePlanConfirmation?.confirmationId
          : undefined,
      }
      if (awaitsRevisionConfirmation || awaitsPlanConfirmation) continue
      let result: V2AgentToolResult
      let didDispatch = false
      let internalDispatchError: { message: string; stack?: string } | undefined
      if (invalidUnconfirmedRevisionPlan) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'revision_confirmation',
          summary: '修改提案中有未通过校验的动作；为避免只改一部分，本轮没有开始执行。',
          recovery: '请基于当前草稿重新提出一组完整、可确认的修改。',
        }
      } else if (invalidRevisionGroup) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'revision_group',
          summary: '这组同镜头修改没有形成完整、可靠的联合修改，因此没有开始执行。',
          recovery: '请基于当前方案重新确认这组修改的目标对象。',
        }
      } else if (failedDependencyRef) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'dependency',
          summary: '前一步没有完成，因此这一步没有继续执行。',
        }
      } else if (rejected || !stage) {
        result = {
          callId: request.callId,
          toolId: request.toolId,
          ok: false,
          gate: 'registry',
          summary: rejected ? '本轮步骤存在重复、无效依赖或不受支持的执行方式，因此没有继续。' : '本轮没有找到可靠的执行方式。',
          recovery: '请重新理解本轮要求，并选择当前可用的处理方式。',
        }
      } else if (revisionGroupItem && !revisionGroupPrimary && revisionGroup) {
        const primaryResult = revisionGroupResults.get(revisionGroup.items[0]!.callId)
        result = primaryResult
          ? { ...primaryResult, callId: request.callId }
          : {
              callId: request.callId,
              toolId: request.toolId,
              ok: false,
              gate: 'revision_group',
              summary: '这组修改的前一步没有形成可靠结果，因此没有继续执行。',
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
            requestInstruction: revisionGroupPrimary
              ? undefined
              : typeof request.arguments?.instruction === 'string'
                ? request.arguments.instruction
                : undefined,
            revisionGroup: revisionGroupPrimary ? revisionGroup : undefined,
            userId,
            context: dispatchContext,
            runtime: dispatchRuntime,
            workspace: {
              ...dispatchWorkspace,
              context: dispatchContext,
              draftId: workspaceState.draftId,
              baseRevision: workspaceState.baseRevision,
            },
            authorization: request.toolId === 'timeline.pending.dismiss'
              ? pendingDismissalAuthorization
              : deliveryAuthorization,
            traceSessionId: id,
            recalledCreativeMemories: executionContext?.recalledCreativeMemories
              ?? creativeMemoryRetrieval.active.map((item) => item.memory.statement),
            recalledCreativeKnowledge: executionContext?.recalledCreativeKnowledge
              ?? creativeKnowledgeRetrieval.items.map((item) => item.knowledge.statement),
            sampleReferenceAuthorized: dependencyRefs.some((ref) =>
              requestedTools.some((item) => item.ref === ref && item.toolId === 'sample.analyze')),
            authorizedDraftComponentIds: dependencyRefs.flatMap((ref) => {
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
          if (!dispatchResult) throw new Error('处理结束后没有返回结果。')
          result = dispatchResult
        } catch (error) {
          internalDispatchError = error instanceof Error
            ? { message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
            : { message: String(error) }
          result = {
            callId: request.callId,
            toolId: request.toolId,
            ok: false,
            summary: '处理过程中遇到异常，本次没有应用任何修改。',
            recovery: '当前对话和方案保持不变；问题解决后可以从这里继续。',
          }
        }
      }
      if (revisionGroupPrimary) revisionGroupResults.set(request.callId, result)
      toolResults.push(result)
      if (!result.ok && !failedDependencyRef) {
        const diagnostic = internalDispatchError?.message
          .replace(/https?:\/\/\S+/giu, '[url]')
          .replace(/\s+/gu, ' ')
          .slice(0, 500)
        latestTurnFailure = {
          reason: diagnostic || result.summary,
          recovery: result.recovery,
        }
      }
      if (
        request.toolId === 'timeline.patch'
        && !result.ok
        && (!revisionGroupItem || revisionGroupPrimary)
        && (!invalidRevisionGroup || invalidRevisionGroupPrimary)
        && workspaceState.draftId
        && workspaceState.baseRevision
      ) {
        const marked = await timelineDrafts.markPendingRevision({
          draftId: workspaceState.draftId,
          userId,
          baseRevision: workspaceState.baseRevision,
          callId: request.callId,
          replacesCallId: revisionGroup?.resolvesPendingCallId
            ?? (typeof request.arguments.resolvesPendingCallId === 'string'
              ? request.arguments.resolvesPendingCallId
              : undefined),
          instruction: revisionGroupPrimary
            ? executionPrompt
            : typeof request.arguments.instruction === 'string'
            ? request.arguments.instruction
            : input.prompt,
        })
        if (marked) workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          pendingTimelineRevisions: marked.pendingTimelineRevisions,
        })
      }
      const receiptStatus: 'skipped' | 'succeeded' | 'failed' = failedDependencyRef
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
          internal_error: internalDispatchError ?? null,
        },
      })
      const facts = toolResultTimelineFacts(result)
      if (result.sampleUnderstanding && result.sampleSelection) {
        const understanding = result.sampleUnderstanding as V2SampleUnderstandingResult
        const sampleVideo = {
          ...result.sampleSelection,
          sampleUnderstanding: understanding,
          reference: summarizeDirectorReference(understanding),
        }
        const materials = dispatchContext.materials.filter(
          (material) => material.id !== result.sampleSelection!.id,
        )
        dispatchContext = { ...dispatchContext, sampleVideo, materials }
        dispatchRuntime = {
          ...dispatchRuntime,
          sampleUrl: result.sampleSelection.url,
          sampleName: result.sampleSelection.name,
          isSampleParsed: true,
        }
        workspaceState = applyDirectorWorkspacePatch(workspaceState, {
          context: { sampleVideo, materials },
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
        pendingTimelineRevisions: request.toolId === 'timeline.patch' || request.toolId === 'timeline.pending.dismiss'
          ? result.ok
            ? result.draft
              ? result.draft.pendingTimelineRevisions ?? workspaceState.pendingTimelineRevisions
              : workspaceState.pendingTimelineRevisions
            : workspaceState.pendingTimelineRevisions
          : workspaceState.pendingTimelineRevisions,
      })
      const revisionActualDiff = result.output?.revisionActualDiff
      const visibleResultSummary = userFacingExecutionText(result.summary)
      const revisionReceipt = revisionIntent
        ? {
            ...revisionIntent,
            status: receiptStatus,
            summary: visibleResultSummary,
            ...(revisionActualDiff && typeof revisionActualDiff === 'object'
              ? {
                  actualDiff: userFacingRevisionDiff(
                    revisionActualDiff as NonNullable<Extract<DirectorAgentStreamEvent, { type: 'tool_result' }>['revisionReceipt']>['actualDiff'],
                  ),
                }
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
        summary: visibleResultSummary,
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
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      recentFailure: latestTurnFailure ?? null,
    })
  }
  if (confirmedRevisionProposal) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      pendingTimelineRevisionConfirmation: null,
    })
  }
  if (confirmedPlanProposal) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, { pendingTimelinePlanConfirmation: null })
  }
  const shouldReportToolOutcome = dispatchedToolCount > 0
    || (toolResults.length > 0 && routed.conversationIntent !== 'chat' && routed.conversationIntent !== 'clarify')
  const toolConfirmation = shouldReportToolOutcome
    ? toolOutcomeConfirmation(toolResults, actionReceipts)
    : ''
  const modelAssistantMessage = awaitsPlanConfirmation
    ? proposalReply({
        userPrompt: input.prompt,
        modelMessage: routed.result.assistantMessage,
        kind: 'creation',
      })
    : awaitsRevisionConfirmation
    ? proposalReply({
        userPrompt: input.prompt,
        modelMessage: routed.result.assistantMessage,
        kind: 'revision',
      })
    : shouldReportToolOutcome
    ? toolConfirmation
    : routed.result.assistantMessage
  const creativeLearning = await creativeLearningPromise
  const preferenceOwnedRequirements = explicitPreferenceRequirementStatements(stateAction, creativeLearning)
  if (preferenceOwnedRequirements.size > 0) {
    const suppressedIds = new Set(requirementResult.changes.added
      .filter((item) => preferenceOwnedRequirements.has(item.statement))
      .map((item) => item.id))
    workspaceState = {
      ...workspaceState,
      confirmedRequirements: workspaceState.confirmedRequirements
        .filter((item) => !suppressedIds.has(item.id)),
    }
    requirementResult.changes.added = requirementResult.changes.added
      .filter((item) => !suppressedIds.has(item.id))
    const requirementChanged = requirementResult.changes.added.length > 0
      || requirementResult.changes.replaced.length > 0
      || requirementResult.changes.revoked.length > 0
      || requirementResult.changes.unchanged.length > 0
    if (!requirementChanged && stateAction) {
      const receiptIndex = actionReceipts.findIndex((receipt) => receipt.ref === stateAction.ref)
      if (receiptIndex >= 0) actionReceipts.splice(receiptIndex, 1)
    }
  }
  const shouldReportRequirement = Boolean(stateAction)
    && !requirementEvidenceFailure
    && actionReceipts.some((receipt) => receipt.ref === stateAction?.ref)
  const requirementMessage = !shouldReportRequirement
    ? ''
    : requirementResult.ok
      ? requirementConfirmation(requirementResult.changes)
      : '本轮要求变更未通过校验，因此没有保存这些要求。'
  const baseAssistantMessage = shouldReportRequirement
    ? [requirementMessage, modelAssistantMessage]
        .filter(Boolean)
        .map((message) => message.replace(/[。！!？?]+$/u, ''))
        .join('。')
    : modelAssistantMessage
  const seenDismissalOutcomes = new Set<string>()
  const userFacingActionReceipts = actionReceipts.filter((receipt) => {
    if (receipt.kind === 'requirements.update' && requirementEvidenceFailure) return false
    if (receipt.kind !== 'tool.call' || !receipt.callId) return true
    if (receipt.toolId === 'timeline.pending.dismiss') {
      const key = `${receipt.status}:${receipt.reason ?? ''}`
      if (seenDismissalOutcomes.has(key)) return false
      seenDismissalOutcomes.add(key)
    }
    const group = revisionGroupByCallId.get(receipt.callId)
    return !group || group.items[0]?.callId === receipt.callId
  })
  const finalReplyFacts = [...userFacingActionReceipts.map((receipt) => {
    const toolResult = receipt.kind === 'tool.call'
      ? toolResults.find((item) => item.callId === receipt.callId)
      : undefined
    const summary = receipt.kind === 'requirements.update'
      ? requirementResult.ok ? requirementMessage : '本轮创作要求没有保存，因为内容未通过校验。'
      : toolResult
          ? toolOutcomeConfirmation([toolResult], [receipt])
          : receipt.status === 'skipped'
            ? '这项处理没有继续，当前方案保持不变。'
            : '这项处理没有返回可确认的结果。'
    return {
      ref: receipt.ref,
      status: receipt.status,
      summary: userFacingExecutionText(summary),
    }
  })]
  const awaitsProposalConfirmation = awaitsRevisionConfirmation || awaitsPlanConfirmation
  const fallbackAssistantMessage = !awaitsProposalConfirmation && finalReplyFacts.length > 0
    ? finalReplyFacts.map((fact) => fact.summary)
        .map((message) => message.replace(/[。！!？?]+$/u, ''))
        .filter(Boolean)
        .join('。')
    : baseAssistantMessage
  let finalReply: DirectorFinalReplyResult = {
    message: fallbackAssistantMessage,
    source: 'fallback',
  }
  if (!awaitsProposalConfirmation && finalReplyFacts.length > 0) {
    try {
      finalReply = await (dependencies.composeFinalReply ?? composeDirectorFinalReply)({
        userPrompt: executionPrompt,
        replyDraft: routed.result.assistantMessage,
        facts: finalReplyFacts,
        previousResponseId: routed.responseId,
        fallbackMessage: fallbackAssistantMessage,
      })
    } catch (error) {
      finalReply = {
        message: fallbackAssistantMessage,
        source: 'fallback',
        validationError: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const assistantMessage = userFacingExecutionText(finalReply.message)
    || '这次结果已经整理完成，你可以继续告诉我下一步想怎么调整。'
  if (finalReply.responseId) {
    workspaceState = applyDirectorWorkspacePatch(workspaceState, {
      responseId: finalReply.responseId,
    })
  }
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
    router_called: !confirmedProposal,
    core_model_called: routed.modelCalled,
    planner_called: toolResults.some((result) => result.plannerInvoked),
    tool_called: dispatchedToolCount > 0,
    tool_call_count: dispatchedToolCount,
    source: routed.source,
    final_reply_source: finalReply.source,
    final_reply_validation_error: finalReply.validationError ?? null,
    final_reply_audit: finalReply.audit ?? null,
    intent: intentForWorkspace({ actionType: action.type, modelIntent: routed.conversationIntent }),
    action: action.type,
    previous_response_id: before.responseId ?? null,
    response_id: saved.state.responseId ?? null,
    response_continuity_disabled: Boolean(saved.state.responseContinuityDisabled),
    state_changed: stateDiff(before, saved.state),
    effective_config_changed:
      JSON.stringify(before.context.effectiveCreativeConfig) !==
      JSON.stringify(saved.state.context.effectiveCreativeConfig),
    requirement_changes: {
      ...traceRequirementChanges(requirementResult.changes),
      suppressed_as_explicit_user_preferences: [...preferenceOwnedRequirements],
    },
    creative_memory_retrieval: {
      active: creativeMemoryRetrieval.active,
      candidate: creativeMemoryRetrieval.candidate,
      audit: creativeMemoryRetrieval.audit,
      error: creativeMemoryRetrievalError ?? null,
    },
    creative_learning: creativeLearning,
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
