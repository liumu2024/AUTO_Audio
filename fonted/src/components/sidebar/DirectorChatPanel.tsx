import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ChatInput } from '@/components/sidebar/ChatInput'
import { DirectorChatThread } from '@/components/sidebar/DirectorChatThread'
import {
  cancelV2TimelineDraftRun,
  streamDirectorChat,
  getDirectorWorkspaceSession,
  getV2TimelineDraft,
  type V2TimelineDraftRunResult,
} from '@/lib/api'
import type { DirectorAgentStreamEvent } from '@shared/types/director-stream'
import {
  buildDirectorContextFromUI,
  buildDirectorSampleVideoFromUI,
} from '@/services/director/directorDecisionContext'
import { ingestAttachmentFiles } from '@/services/director/attachmentUploads'
import { activateV2DraftWorkspace } from '@/services/director/v2DirectorDraftWorkspace'
import {
  browserWorkspaceSessionId,
  rememberActiveDirectorWorkspaceSessionId,
  restoreWorkspaceDraft,
} from '@/services/director/workspaceSessionLifecycle'
import { useCreationStore, type InputAttachment } from '@/stores/creationStore'
import {
  findDirectorConfirmationMessage,
  useDirectorChatStore,
  type DirectorChatMessage,
} from '@/stores/directorChatStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { DirectorTimelineSnapshot } from '@shared/types/director-state'
import type { DirectorContext } from '@shared/types/director-context'

function attachmentMaterialId(attachment: InputAttachment): string {
  return attachment.materialId ?? attachment.id.replace(/^att_/, '')
}

function syncDirectorContext(input: {
  sampleUrl: string
  sampleName?: string
  attachments: InputAttachment[]
}) {
  const contextStore = useDirectorContextStore.getState()
  contextStore.setSampleVideo(buildDirectorSampleVideoFromUI({
    sampleUrl: input.sampleUrl,
    sampleName: input.sampleName,
    existing: contextStore.context.sampleVideo,
  }))
  contextStore.setMaterials(
    input.attachments.map((att) => ({
      id: attachmentMaterialId(att),
      type: att.type,
      url: att.url,
      name: att.name,
      tags: att.tags ?? [],
    })),
  )
}

function applyDirectorWorkspaceContext(
  context: DirectorContext,
  acknowledgeLocalChanges = false,
  pendingTimelineRevisions: Array<{ instruction: string; callId: string; baseRevision: number }> = [],
) {
  useDirectorContextStore.getState().replaceContext(context)
  useV2TimelineStore.getState().selectClip(context.currentTimeline?.selectedClipId ?? null)
  useV2TimelineStore.getState().setPendingTimelineRevisions(pendingTimelineRevisions)
  useCreationStore.getState().acceptServerMaterials(context.materials, acknowledgeLocalChanges)
  const sample = context.sampleVideo
  useCreationStore.getState().acceptServerSample(sample?.url
    ? {
      id: sample.id,
      url: sample.url,
      name: sample.name,
      parsed: sample.sampleUnderstanding?.source === 'llm',
    }
    : undefined, acknowledgeLocalChanges)
}

function shouldShowThoughtSurface(event: DirectorAgentStreamEvent) {
  // Surface routing is diagnostic-only. It is not a user-visible workflow.
  return event.type === 'surface' && event.mode === 'repair'
}

function isTimelineDraftRunResult(value: unknown): value is V2TimelineDraftRunResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<V2TimelineDraftRunResult>
  return typeof result.draftId === 'string'
    && typeof result.draftRevision === 'number'
    && typeof result.renderRunId === 'string'
    && typeof result.outputPath === 'string'
    && typeof result.traceDir === 'string'
    && Boolean(result.resolvedSpec)
}

function eventThought(event: DirectorAgentStreamEvent): string | null {
  if (event.type === 'thought') return `${event.title}：${event.content}`
  if (event.type === 'intent') {
    const label = {
      chat: '继续讨论',
      create: '创建方案',
      revise: '修改方案',
      execute: '导出成片',
      clarify: '补充信息',
    }[event.intent] ?? '处理当前请求'
    return `正在按“${label}”理解你的要求。`
  }
  if (event.type === 'slot_update') {
    return event.missingSlots.length
      ? '还有完成当前请求所需的信息没有确认。'
      : `已核对当前画幅、风格和素材状态。`
  }
  if (event.type === 'constraint_resolution') {
    const conflicts = event.config.conflicts
    if (!conflicts.length) {
      return `当前方案将采用 ${event.config.aspectRatio} 画幅。`
    }
    return `检测到创作设置不一致，已按你在界面中确认的设置处理。`
  }
  if (event.type === 'error') return `分析失败：${event.message}`
  return null
}

function currentV2TimelineSnapshot(): DirectorTimelineSnapshot | undefined {
  const v2 = useV2TimelineStore.getState()
  if (!v2.spec) return undefined

  const selectedSceneId = v2.selectedClipId?.replace(/^v2-(?:scene|overlay|transition)-/, '')
  const renderMatchesDraft =
    !v2.hasLocalEdits &&
    v2.result?.draftRevision != null &&
    v2.result.draftRevision === v2.draftRevision

  return {
    kind: 'v2_timeline',
    status: v2.hasLocalEdits
      ? 'dirty'
      : renderMatchesDraft
        ? 'rendered'
        : v2.draftId
          ? 'saved'
          : 'draft',
    draftId: v2.draftId ?? undefined,
    currentRevision: v2.draftRevision ?? undefined,
    savedRevision: v2.draftId ? v2.draftRevision ?? undefined : undefined,
    renderedRevision: renderMatchesDraft ? v2.result?.draftRevision : undefined,
    lastRunId: v2.result?.renderRunId,
    selectedClipId: v2.selectedClipId ?? undefined,
    selectedSceneId,
  }
}

function restoreInputTrayAfterWorkspaceConflict(input: {
  prompt: string
  attachments: InputAttachment[]
  sample?: { url: string; name: string }
}) {
  const creation = useCreationStore.getState()
  creation.setInputText(input.prompt)
  for (const attachment of input.attachments) creation.addAttachment(attachment)
  if (input.sample?.url) creation.setSampleUrl(input.sample.url, input.sample.name)
}

export function DirectorChatPanel() {
  const clearInputTray = useCreationStore((s) => s.clearInputTray)

  const isSending = useDirectorChatStore((s) => s.isSending)
  const addUserMessage = useDirectorChatStore((s) => s.addUserMessage)
  const addAssistantMessage = useDirectorChatStore((s) => s.addAssistantMessage)
  const addProgressMessage = useDirectorChatStore((s) => s.addProgressMessage)
  const addThoughtMessage = useDirectorChatStore((s) => s.addThoughtMessage)
  const updateMessage = useDirectorChatStore((s) => s.updateMessage)
  const setSending = useDirectorChatStore((s) => s.setSending)

  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const isAnalyzing = useCreationStore((s) => s.isAnalyzing)
  const busy = isSending || isAnalyzing

  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const streamCancelRef = useRef(false)
  const workspaceRevisionsRef = useRef(new Map<string, number>())
  const activeProgressMessageIdRef = useRef<string | null>(null)
  const activeRenderRunIdRef = useRef<string | null>(null)
  const revisionMessageIdsRef = useRef(new Map<string, string>())
  const creationMessageIdRef = useRef<string | null>(null)
  const setRevisionDecisionMessages = (
    confirmationId: string,
    status: NonNullable<DirectorChatMessage['revisionDecisionStatus']>,
    content: string,
    options: { clearRefs?: boolean; unresolvedOnly?: boolean } = {},
  ) => {
    const messages = useDirectorChatStore.getState().messages
      .filter((message) => (
        message.revisionConfirmationId === confirmationId
        && (!options.unresolvedOnly || !message.revisionReceipt)
      ))
    for (const message of messages) {
      updateMessage(message.id, { revisionDecisionStatus: status, content })
      if (options.clearRefs && message.revisionIntent) {
        revisionMessageIdsRef.current.delete(message.revisionIntent.callId)
      }
    }
  }
  useEffect(() => {
    const workspaceSessionId = browserWorkspaceSessionId()
    void getDirectorWorkspaceSession(workspaceSessionId)
      .then(async (session) => {
        if (!session) return
        if (browserWorkspaceSessionId() !== workspaceSessionId) return
        workspaceRevisionsRef.current.set(workspaceSessionId, session.state.stateRevision)
        applyDirectorWorkspaceContext(
          session.state.context,
          false,
          session.state.pendingTimelineRevisions ?? [],
        )
        for (const intent of session.state.pendingTimelineRevisionConfirmation?.revisionIntents ?? []) {
          if (revisionMessageIdsRef.current.has(intent.callId)) continue
          const confirmationId = session.state.pendingTimelineRevisionConfirmation!.confirmationId
          const existing = findDirectorConfirmationMessage(
            useDirectorChatStore.getState().messages,
            { kind: 'revision', confirmationId, callId: intent.callId },
          )
          const messageId = existing?.id ?? addAssistantMessage({
            content: '已恢复一项尚未执行的修改提案，请核对后确认。',
            kind: 'revision',
            status: 'done',
          })
          revisionMessageIdsRef.current.set(intent.callId, messageId)
          updateMessage(messageId, {
            revisionIntent: intent,
            revisionConfirmationId: confirmationId,
            revisionDecisionStatus: 'pending',
          })
        }
        if (session.state.pendingTimelinePlanConfirmation) {
          const confirmationId = session.state.pendingTimelinePlanConfirmation.confirmationId
          const existing = findDirectorConfirmationMessage(
            useDirectorChatStore.getState().messages,
            { kind: 'creation', confirmationId },
          )
          const messageId = existing?.id ?? addAssistantMessage({
            content: '已恢复一份尚未执行的创作摘要，请核对后确认。',
            kind: 'text',
            status: 'done',
          })
          creationMessageIdRef.current = messageId
          updateMessage(messageId, {
            creationSummary: session.state.pendingTimelinePlanConfirmation.creationSummary,
            creationConfirmationId: confirmationId,
            creationDecisionStatus: 'pending',
          })
        }
        await restoreWorkspaceDraft({
          workspace: session.state,
          loadDraft: async (draftId) => (await getV2TimelineDraft(draftId)).draft,
          openDraft: (draft) => {
            if (browserWorkspaceSessionId() === workspaceSessionId) {
              activateV2DraftWorkspace(draft)
            }
          },
        })
      })
      .catch(() => {
        // A missing/unavailable session must not block a new V2 discussion.
      })
  }, [addAssistantMessage, updateMessage])

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current += 1
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setDragOver(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragOver(false)
    ingestAttachmentFiles(e.dataTransfer.files)
  }

  const handleSend = async (
    text: string,
    timelineRevisionDecision?: { confirmationId: string; action: 'confirm' | 'reject' },
    timelinePlanDecision?: { confirmationId: string; action: 'confirm' | 'reject' },
  ) => {
    let revisionDecisionCommitted = false
    let creationDecisionCommitted = false
    activeRenderRunIdRef.current = null
    const hasDecision = Boolean(timelineRevisionDecision || timelinePlanDecision)
    const creationSnapshot = useCreationStore.getState()
    if (!hasDecision && creationSnapshot.attachmentUploads.length > 0) return
    const prompt = text.trim()
    const pendingAttachmentIdsSnapshot = hasDecision
      ? []
      : [...creationSnapshot.pendingAttachmentIds]
    const contextMaterialsAuthoritative = hasDecision
      ? false
      : creationSnapshot.materialsSnapshotAuthoritative
    const contextSampleAuthoritative = hasDecision
      ? false
      : creationSnapshot.sampleSnapshotAuthoritative
    const showSampleInInputTraySnapshot = creationSnapshot.showSampleInInputTray
    if (!hasDecision) clearInputTray()
    const effectiveSampleUrl = creationSnapshot.sampleUrl
    const effectiveSampleName = creationSnapshot.sampleName
    const contextAttachments = [...creationSnapshot.attachments]
    const currentAspectRatio = creationSnapshot.aspectRatio
    const currentAspectRatioExplicit = creationSnapshot.aspectRatioExplicit
    const currentDurationSec = creationSnapshot.durationSec
    const currentStyleIntensity = creationSnapshot.styleIntensity
    const currentStyleIntensityExplicit = creationSnapshot.styleIntensityExplicit
    const currentIsSampleParsed = creationSnapshot.isSampleParsed

    const messageAttachments = contextAttachments.filter((item) =>
      pendingAttachmentIdsSnapshot.includes(item.id),
    )

    syncDirectorContext({
      sampleUrl: effectiveSampleUrl,
      sampleName: effectiveSampleName,
      attachments: contextAttachments,
    })
    const v2State = useV2TimelineStore.getState()

    const directorContext = buildDirectorContextFromUI({
      sampleUrl: effectiveSampleUrl,
      sampleName: effectiveSampleName,
      attachments: contextAttachments,
      aspectRatio: currentAspectRatio,
      durationSec: currentDurationSec,
      styleIntensity: currentStyleIntensity,
      explicitUiControls: {
        aspectRatio: currentAspectRatioExplicit ? currentAspectRatio : undefined,
        styleIntensity: currentStyleIntensityExplicit ? currentStyleIntensity : undefined,
      },
      isSampleParsed: currentIsSampleParsed,
      existing: useDirectorContextStore.getState().context,
    })
    // Workspace kind, rather than spec presence, decides which state source is
    // allowed into the director prompt.
    const v2Timeline = currentV2TimelineSnapshot()
    directorContext.currentTimeline = v2Timeline
      ? {
          ...v2Timeline,
          sceneCount: v2State.spec?.scenes.length,
        }
      : undefined
    addUserMessage({
      content:
        prompt ||
        (currentIsSampleParsed
          ? '继续编辑当前生成方案'
          : effectiveSampleUrl
            ? '解析样例视频，识别导演结构和可复用风格'
            : '根据当前创作意图和附件生成一版时间线方案'),
      attachments: [
        ...(!hasDecision && effectiveSampleUrl && showSampleInInputTraySnapshot
          ? [
              {
                id: 'sample_video',
                name: effectiveSampleName || '样例视频（风格参考）',
                type: 'video' as const,
                url: effectiveSampleUrl,
                source: 'upload' as const,
              },
            ]
          : []),
        ...messageAttachments,
      ],
    })
    const thinkingId = addProgressMessage('我在理解你的意思，整理创作意图、可选参考和当前时间线...')
    activeProgressMessageIdRef.current = thinkingId

    setSending(true)
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    streamCancelRef.current = false

    let directMessage: string | null = null
    let streamErrorMessage: string | null = null
    let streamErrorCode: 'workspace_changed' | null = null
    let workspaceRefreshPromise: Promise<void> | null = null
    const debugThoughts: string[] = []
    const requestWorkspaceSessionId = browserWorkspaceSessionId()
    const turnRequestId = crypto.randomUUID()
    const workspaceStateRevision = workspaceRevisionsRef.current.get(requestWorkspaceSessionId) ?? 0

    try {
      await streamDirectorChat(
        {
          prompt,
          ...(messageAttachments.length
            ? {
                currentTurnMaterialIds: messageAttachments.map((item) =>
                  item.materialId ?? item.id.replace(/^att_/, ''),
                ),
              }
            : {}),
          contextMaterialsAuthoritative,
          contextSampleAuthoritative,
          turnRequestId,
          workspaceStateRevision,
          workspaceSessionId: requestWorkspaceSessionId,
          timelineRevisionDecision,
          timelinePlanDecision,
          context: directorContext,
          runtime: {
            backendEnabled: true,
            sampleUrl: effectiveSampleUrl,
            sampleName: effectiveSampleName,
            isSampleParsed: currentIsSampleParsed,
            activeTaskId: v2State.taskId ?? activeTaskId,
            hasV2Timeline: Boolean(v2State.spec?.scenes.length),
            v2TaskId: v2State.taskId,
            v2SceneCount: v2State.spec?.scenes.length,
            v2TraceDir: v2State.traceDir,
            hasVisualMaterial: contextAttachments.some(
              (item) => item.type === 'video' || item.type === 'image',
            ),
            materialCount: contextAttachments.length,
            sampleCandidates: contextAttachments
              .filter((item) => item.type === 'video')
              .map((item) => ({
                id: attachmentMaterialId(item),
                url: item.url,
                name: item.name,
              })),
          },
        },
        (event) => {
          if (browserWorkspaceSessionId() !== requestWorkspaceSessionId) return
          if (event.type === 'surface') {
            if (shouldShowThoughtSurface(event)) {
              debugThoughts.push('正在重新核对你的要求。')
            }
            return
          }

          const thought = eventThought(event)
          if (thought) debugThoughts.push(thought)
           if (event.type === 'skill_selected') debugThoughts.push('正在准备完成这项请求所需的能力。')
           if (event.type === 'skill_loaded') {
             debugThoughts.push('所需能力已经准备好。')
           }
          if (event.type === 'tool_proposed') {
            debugThoughts.push('已经整理好本轮需要处理的步骤。')
            if (event.revisionIntent) {
              const existingMessageId = revisionMessageIdsRef.current.get(event.callId)
                ?? (event.revisionConfirmationId
                  ? findDirectorConfirmationMessage(
                      useDirectorChatStore.getState().messages,
                      {
                        kind: 'revision',
                        confirmationId: event.revisionConfirmationId,
                        callId: event.callId,
                      },
                    )?.id
                  : undefined)
              const messageId = existingMessageId ?? addAssistantMessage({
                content: '我已根据你的要求整理好这次修改，确认后再应用到当前方案。',
                kind: 'revision',
                status: 'done',
              })
              revisionMessageIdsRef.current.set(event.callId, messageId)
              updateMessage(messageId, {
                revisionIntent: event.revisionIntent,
                revisionConfirmationId: event.revisionConfirmationId,
                revisionDecisionStatus: timelineRevisionDecision?.action === 'confirm'
                  ? 'confirming'
                  : timelineRevisionDecision?.action === 'reject' ? 'rejecting' : 'pending',
              })
            }
            if (event.creationSummary && event.creationConfirmationId) {
              let messageId = creationMessageIdRef.current
              if (messageId) {
                const previous = useDirectorChatStore.getState().messages.find((item) => item.id === messageId)
                if (previous?.creationConfirmationId !== event.creationConfirmationId) {
                  updateMessage(messageId, {
                    creationDecisionStatus: 'failed',
                    content: '这份摘要已由新的创作要求替代。',
                  })
                  messageId = null
                }
              }
              messageId ??= findDirectorConfirmationMessage(
                useDirectorChatStore.getState().messages,
                { kind: 'creation', confirmationId: event.creationConfirmationId },
              )?.id ?? null
              messageId ??= addAssistantMessage({
                content: '创作摘要已整理，尚未开始生成方案。',
                kind: 'text',
                status: 'done',
              })
              creationMessageIdRef.current = messageId
              updateMessage(messageId, {
                creationSummary: event.creationSummary,
                creationConfirmationId: event.creationConfirmationId,
                creationDecisionStatus: timelinePlanDecision?.action === 'confirm'
                  ? 'confirming'
                  : timelinePlanDecision?.action === 'reject' ? 'rejecting' : 'pending',
              })
            }
          }
          if (event.type === 'tool_started') {
            debugThoughts.push('正在处理你的请求。')
            if (event.toolId === 'timeline.render') {
              useTaskStore.getState().startTask(prompt, event.callId)
            }
          }
          if (event.type === 'tool_progress') {
            if (event.renderRunId) activeRenderRunIdRef.current = event.renderRunId
            const elapsedLabel = event.elapsedMs == null
              ? ''
              : ` · 总用时 ${(event.elapsedMs / 1000).toFixed(1)} 秒`
            useTaskStore.getState().updateProgress(
              event.progress,
              `${event.message}${elapsedLabel}`,
              `${event.message}${elapsedLabel}`,
            )
          }
          if (event.type === 'tool_result') {
            if (event.toolId === 'timeline.plan' && timelinePlanDecision?.action === 'confirm') {
              creationDecisionCommitted = true
              const messageId = creationMessageIdRef.current
              if (messageId) updateMessage(messageId, {
                creationDecisionStatus: event.ok ? 'confirmed' : 'failed',
                content: event.ok ? '创作摘要' : '方案未能生成，可调整摘要后重试。',
              })
            }
            if (event.revisionReceipt) {
              const revisionMessageId = revisionMessageIdsRef.current.get(event.callId)
              if (revisionMessageId) {
                updateMessage(revisionMessageId, {
                  content: '本次修改记录',
                  revisionIntent: undefined,
                  revisionReceipt: event.revisionReceipt,
                  revisionDecisionStatus: undefined,
                  status: event.ok ? 'done' : 'error',
                })
              }
            }
            if (event.toolId === 'timeline.render') {
              if (event.ok && isTimelineDraftRunResult(event.result)) {
                useV2TimelineStore.getState().setResult(event.result)
                useTaskStore.getState().completeTask()
              }
              else useTaskStore.getState().setFailed(event.summary)
            }
            if (event.ok && event.draft) {
              activateV2DraftWorkspace(event.draft)
              debugThoughts.push('最新方案已同步到编辑区。')
            }
            debugThoughts.push(event.ok ? '这一步已经处理完成。' : '这一步没有完成，具体原因会在回复中说明。')
          }
          if (event.type === 'assistant_reply') directMessage = event.message
          if (event.type === 'error') {
            streamErrorMessage = event.message
            streamErrorCode = event.code ?? null
          }
          if (event.type === 'workspace_session') {
            if (event.turnRequestId !== turnRequestId) return
            const currentRevision = workspaceRevisionsRef.current.get(event.workspaceSessionId) ?? 0
            if (event.stateRevision < currentRevision) return
            workspaceRevisionsRef.current.set(event.workspaceSessionId, event.stateRevision)
            rememberActiveDirectorWorkspaceSessionId(
              window.sessionStorage,
              event.workspaceSessionId,
            )
            applyDirectorWorkspaceContext(
              event.state.context,
              true,
              event.state.pendingTimelineRevisions ?? [],
            )
            if (streamErrorCode === 'workspace_changed' && event.state.draftId) {
              workspaceRefreshPromise = getV2TimelineDraft(event.state.draftId)
                .then(({ draft }) => {
                  if (browserWorkspaceSessionId() !== requestWorkspaceSessionId) return
                  activateV2DraftWorkspace(draft)
                })
                .catch(() => {
                  streamErrorMessage = '当前方案已发生变化，但最新内容暂时无法加载。你的输入已经保留，请稍后重试。'
                })
            }
            if (
              timelineRevisionDecision
              && !revisionDecisionCommitted
              && event.state.pendingTimelineRevisionConfirmation?.confirmationId !== timelineRevisionDecision.confirmationId
            ) {
              revisionDecisionCommitted = true
              setRevisionDecisionMessages(
                timelineRevisionDecision.confirmationId,
                timelineRevisionDecision.action === 'reject' ? 'rejected' : 'failed',
                timelineRevisionDecision.action === 'reject'
                  ? '修改提案已取消。'
                  : '修改提案已失效，请基于当前方案重新提出修改。',
                {
                  clearRefs: true,
                  unresolvedOnly: timelineRevisionDecision.action === 'confirm',
                },
              )
            }
            if (
              timelinePlanDecision
              && !creationDecisionCommitted
              && event.state.pendingTimelinePlanConfirmation?.confirmationId !== timelinePlanDecision.confirmationId
            ) {
              creationDecisionCommitted = true
              const messageId = creationMessageIdRef.current
              if (messageId) updateMessage(messageId, {
                creationDecisionStatus: timelinePlanDecision.action === 'reject' ? 'rejected' : 'failed',
                content: timelinePlanDecision.action === 'reject' ? '已取消生成方案。' : '这份创作摘要已失效。',
              })
            }
            debugThoughts.push('本轮对话状态已经同步。')
          }
        },
        abort.signal,
      )
      if (workspaceRefreshPromise) await workspaceRefreshPromise

      if (timelineRevisionDecision?.action === 'reject' && !revisionDecisionCommitted) {
        setRevisionDecisionMessages(
          timelineRevisionDecision.confirmationId,
          'pending',
          '取消提案未被服务端确认，原提案仍待确认。',
        )
      }
      if (timelineRevisionDecision?.action === 'confirm' && !revisionDecisionCommitted) {
        setRevisionDecisionMessages(
          timelineRevisionDecision.confirmationId,
          'pending',
          '确认未被服务端确认，原提案仍待确认。',
          { unresolvedOnly: true },
        )
      }
      if (timelinePlanDecision && !creationDecisionCommitted) {
        const messageId = creationMessageIdRef.current
        if (messageId) updateMessage(messageId, {
          creationDecisionStatus: 'pending',
          content: '这次操作未被服务端确认，创作摘要仍待确认。',
        })
      }

      if (streamErrorMessage) {
        if (streamErrorCode === 'workspace_changed' && !timelineRevisionDecision) {
          restoreInputTrayAfterWorkspaceConflict({
            prompt,
            attachments: messageAttachments,
            sample: showSampleInInputTraySnapshot && effectiveSampleUrl
              ? { url: effectiveSampleUrl, name: effectiveSampleName }
              : undefined,
          })
        }
        updateMessage(thinkingId, {
          content: streamErrorMessage,
          kind: 'error',
          status: 'error',
        })
        return
      }

      if (directMessage) {
        updateMessage(thinkingId, {
          content: directMessage,
          kind: 'text',
          status: 'done',
        })
        if (debugThoughts.length) {
          addThoughtMessage({
            content: '处理过程',
            thoughts: debugThoughts,
            status: 'done',
          })
        }
        return
      }
    } catch (e) {
      if (streamCancelRef.current) {
        return
      }
      console.error('[DirectorChatPanel] request failed', e)
      const msg = '这轮处理暂时没有完成。你的输入和当前方案都已保留，可以稍后重试。'
      if (timelineRevisionDecision?.action === 'reject' && !revisionDecisionCommitted) {
        setRevisionDecisionMessages(
          timelineRevisionDecision.confirmationId,
          'pending',
          '取消提案失败，原提案仍待确认。',
        )
      }
      if (timelineRevisionDecision?.action === 'confirm' && !revisionDecisionCommitted) {
        setRevisionDecisionMessages(
          timelineRevisionDecision.confirmationId,
          'pending',
          '确认失败，原提案仍待确认。',
          { unresolvedOnly: true },
        )
      }
      updateMessage(thinkingId, {
        content: msg,
        kind: 'error',
        status: 'error',
      })
      if (debugThoughts.length) {
        addThoughtMessage({
          content: '处理过程',
          thoughts: debugThoughts,
          status: 'done',
        })
      }
    } finally {
      abortRef.current = null
      streamCancelRef.current = false
      if (activeProgressMessageIdRef.current === thinkingId) {
        activeProgressMessageIdRef.current = null
      }
      setSending(false)
    }
  }

  const handleRevisionDecision = (decision: { confirmationId: string; action: 'confirm' | 'reject' }) => {
    setRevisionDecisionMessages(
      decision.confirmationId,
      decision.action === 'confirm' ? 'confirming' : 'rejecting',
      decision.action === 'confirm' ? '正在执行已确认的修改。' : '正在取消修改提案。',
    )
    void handleSend(
      decision.action === 'confirm' ? '确认执行已解析的修改提案。' : '取消已解析的修改提案。',
      decision,
    )
  }

  const handleCreationDecision = (decision: { confirmationId: string; action: 'confirm' | 'reject' }) => {
    const messageId = creationMessageIdRef.current
    if (messageId) updateMessage(messageId, {
      creationDecisionStatus: decision.action === 'confirm' ? 'confirming' : 'rejecting',
      content: decision.action === 'confirm' ? '正在生成方案。' : '正在取消生成。',
    })
    void handleSend(
      decision.action === 'confirm' ? '确认这份创作摘要并生成方案。' : '暂不按这份创作摘要生成方案。',
      undefined,
      decision,
    )
  }

  const handleCancelDirectorStream = () => {
    if (!abortRef.current) return
    streamCancelRef.current = true
    abortRef.current.abort()
    const progressId = activeProgressMessageIdRef.current
    const renderRunId = activeRenderRunIdRef.current
    const draftId = useV2TimelineStore.getState().draftId
    if (renderRunId && draftId) {
      void cancelV2TimelineDraftRun({ draftId, renderRunId }).then((result) => {
        const content = result.cancelled
          ? '成片任务已经取消。'
          : '已停止等待；当前生成任务仍在继续，稍后可重新打开方案查看状态。'
        if (progressId) updateMessage(progressId, { content, kind: 'text', status: 'done' })
        else addAssistantMessage({ content })
      }).catch(() => {
        if (progressId) updateMessage(progressId, {
          content: '已停止等待；取消状态暂时无法确认，当前任务可能仍在继续。', kind: 'text', status: 'done',
        })
      })
      setSending(false)
      return
    }
    if (progressId) {
      updateMessage(progressId, {
        content: '已停止等待本轮结果。当前处理可能仍在继续；重新打开当前方案可以同步已经保存的结果。',
        kind: 'text',
        status: 'done',
      })
    } else {
      addAssistantMessage({ content: '已停止等待本轮结果。当前处理可能仍在继续；重新打开当前方案可以同步已经保存的结果。' })
    }
    setSending(false)
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <DirectorChatThread
        onRevisionDecision={handleRevisionDecision}
        onCreationDecision={handleCreationDecision}
      />
      <ChatInput
        disabled={busy}
        busyLabel={isSending ? '停止等待' : '后台处理中'}
        onCancel={isSending ? handleCancelDirectorStream : undefined}
        onSend={handleSend}
      />

      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/75 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-violet-500/40 bg-violet-500/10 px-8 py-6 shadow-lg shadow-violet-950/30">
            <Upload className="h-8 w-8 text-violet-300" />
            <p className="text-sm font-medium text-violet-100">
              松手上传到 AI 导演助理
            </p>
            <p className="text-[11px] text-violet-300/70">
              文件默认作为创作素材；明确要求解析或复刻时，才会把视频作为样例。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
