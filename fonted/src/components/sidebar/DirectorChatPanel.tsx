import { Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatInput } from '@/components/sidebar/ChatInput'
import { DirectorChatThread } from '@/components/sidebar/DirectorChatThread'
import {
  streamDirectorChat,
  getDirectorWorkspaceSession,
  getV2TimelineDraft,
  type V2TimelineDraftRunResult,
} from '@/lib/api'
import type { DirectorAgentStreamEvent } from '@shared/types/director-stream'
import {
  summarizeDirectorSessionState,
  syncDirectorSessionSnapshot,
} from '@shared/lib/director-state-machine'
import {
  buildDirectorContextFromUI,
  buildDirectorSampleVideoFromUI,
} from '@/services/director/directorDecisionContext'
import { activateV2DraftWorkspace } from '@/services/director/v2DirectorDraftWorkspace'
import {
  browserWorkspaceSessionId,
  rememberActiveDirectorWorkspaceSessionId,
  restoreWorkspaceDraft,
} from '@/services/director/workspaceSessionLifecycle'
import { useCreationStore, type InputAttachment } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type {
  DirectorSessionState,
  DirectorTimelineSnapshot,
} from '@shared/types/director-state'
import type { DirectorContext } from '@shared/types/director-context'

function attachmentTypeFromMime(mime: string): InputAttachment['type'] | null {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  return null
}

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

function applyDirectorWorkspaceContext(context: DirectorContext, acknowledgeLocalChanges = false) {
  useDirectorContextStore.getState().replaceContext(context)
  useV2TimelineStore.getState().selectClip(context.currentTimeline?.selectedClipId ?? null)
  useCreationStore.getState().acceptServerMaterials(context.materials, acknowledgeLocalChanges)
  const sample = context.sampleVideo
  useCreationStore.getState().acceptServerSample(sample?.url
    ? {
      id: sample.id,
      url: sample.url,
      name: sample.name,
      parsed: Boolean(sample.reference || sample.sampleUnderstanding),
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
    const source =
      event.source === 'llm'
        ? '导演模型'
        : event.source === 'llm_unstructured_safe_reply'
          ? '模型自由回复（未执行）'
          : event.source === 'context_fallback'
            ? '保留上下文的降级回复'
            : '导演服务'
    return `本轮理解：${event.intent}；${source}。`
  }
  if (event.type === 'slot_update') {
    return event.missingSlots.length
      ? `条件检查：还缺 ${event.missingSlots.join(', ')}。`
      : `条件检查：画幅 ${event.slots.aspectRatio}，风格强度 ${event.slots.styleIntensity}，素材状态 ${event.slots.materialStatus}。`
  }
  if (event.type === 'constraint_resolution') {
    const conflicts = event.config.conflicts
    if (!conflicts.length) {
      return `条件检查：最终采用画幅 ${event.config.aspectRatio}（${event.config.sources.aspectRatio ?? 'default'}）。`
    }
    return `条件冲突：${conflicts
      .map((item) => `${item.field} 的 UI 值 ${item.uiValue} 覆盖模型理解 ${item.modelValue}`)
      .join('；')}；最终采用 ${event.config.aspectRatio}。`
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

function buildV2ConversationSummary() {
  const v2 = useV2TimelineStore.getState()
  if (!v2.spec && !v2.sampleSession) return ''
  const sample = v2.sampleSession?.understanding
  const sampleText = sample
    ? [
        `Sample understanding: ${sample.summary}`,
        `Transferable methods: ${sample.method_observations.map((item) => `${item.expression} (${item.purpose})`).join('; ')}`,
        `Transferable knowledge: ${sample.transferable_knowledge.map((item) => item.statement).join('; ')}`,
      ].join('\n')
    : ''
  const timelineText = v2.spec
    ? [
        `Current V2 timeline draft: ${v2.spec.scenes.length} scenes, ${v2.spec.canvas.width}x${v2.spec.canvas.height}, ${v2.spec.canvas.duration_sec}s.`,
        v2.preview?.traceDir ? `Latest preview trace: ${v2.preview.traceDir}` : '',
        v2.result?.traceDir ? `Latest render trace: ${v2.result.traceDir}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''
  return [sampleText, timelineText].filter(Boolean).join('\n')
}

function buildConversationSummary() {
  return buildV2ConversationSummary()
}

function syncDirectorStateFromUI(input: {
  sampleUrl: string
  isSampleParsed: boolean
  attachments: InputAttachment[]
  activeTaskId?: string | null
}): DirectorSessionState {
  const v2Timeline = currentV2TimelineSnapshot()
  const previous = useDirectorContextStore.getState().context.directorState
  const next = syncDirectorSessionSnapshot(previous, {
    taskId: input.activeTaskId,
    sampleUrl: input.sampleUrl,
    isSampleParsed: input.isSampleParsed,
    hasVisualMaterial: input.attachments.some(
      (item) => item.type === 'video' || item.type === 'image',
    ),
    materialCount: input.attachments.length,
    timeline: v2Timeline,
  })
  useDirectorContextStore.getState().setDirectorState(next)
  return next
}

function currentRecoverySuggestions() {
  return useDirectorContextStore
    .getState()
    .context.directorState?.lastError?.suggestions.map((suggestion) => ({
      label: suggestion.label,
      prompt: suggestion.action.message,
    }))
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
  useEffect(() => {
    const workspaceSessionId = browserWorkspaceSessionId()
    void getDirectorWorkspaceSession(workspaceSessionId)
      .then(async (session) => {
        if (!session) return
        if (browserWorkspaceSessionId() !== workspaceSessionId) return
        applyDirectorWorkspaceContext(session.state.context)
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
  }, [])
  const activeProgressMessageIdRef = useRef<string | null>(null)

  const ingestDroppedFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const store = useCreationStore.getState()

    void (async () => {
      const uploadWorkspaceSessionId = browserWorkspaceSessionId()
      for (const file of Array.from(files)) {
        const type = attachmentTypeFromMime(file.type)
        if (!type) continue
        const material = await useMaterialLibraryStore.getState().addFromFileWithHash(file)
        if (browserWorkspaceSessionId() !== uploadWorkspaceSessionId) continue

        store.addAttachment({
          id: `att_${material.id}`,
          name: material.name,
          type,
          url: material.url,
          source: 'upload',
          materialId: material.id,
          tags: material.tags,
        })
      }
    })()
  }, [])

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
    ingestDroppedFiles(e.dataTransfer.files)
  }

  const handleSend = async (text: string) => {
    const creationSnapshot = useCreationStore.getState()
    const prompt = text.trim()
    const pendingAttachmentIdsSnapshot = [...creationSnapshot.pendingAttachmentIds]
    const contextMaterialsAuthoritative = creationSnapshot.materialsSnapshotAuthoritative
    const contextSampleAuthoritative = creationSnapshot.sampleSnapshotAuthoritative
    const showSampleInInputTraySnapshot = creationSnapshot.showSampleInInputTray
    clearInputTray()
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
    const directorState = syncDirectorStateFromUI({
      sampleUrl: effectiveSampleUrl,
      isSampleParsed: currentIsSampleParsed,
      attachments: contextAttachments,
      activeTaskId: useV2TimelineStore.getState().taskId ?? activeTaskId,
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
    directorContext.directorState = directorState
    directorContext.conversationSummary = [
      buildConversationSummary(),
      summarizeDirectorSessionState(directorState),
    ]
      .filter(Boolean)
      .join('\n')

    addUserMessage({
      content:
        prompt ||
        (currentIsSampleParsed
          ? '继续编辑当前生成方案'
          : effectiveSampleUrl
            ? '解析样例视频，识别导演结构和可复用风格'
            : '根据当前创作意图和附件生成一版时间线方案'),
      attachments: [
        ...(effectiveSampleUrl && showSampleInInputTraySnapshot
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
    const debugThoughts: string[] = []
    const requestWorkspaceSessionId = browserWorkspaceSessionId()

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
          turnRequestId: crypto.randomUUID(),
          workspaceSessionId: requestWorkspaceSessionId,
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
              debugThoughts.push(
                `对话模式：${event.mode}，置信度 ${Math.round(
                  event.confidence * 100,
                )}%。`,
              )
            }
            return
          }

          const thought = eventThought(event)
          if (thought) debugThoughts.push(thought)
           if (event.type === 'skill_selected') debugThoughts.push(`已选择创作能力：${event.skillId}。`)
           if (event.type === 'skill_loaded') {
             debugThoughts.push(
               `${event.dependency ? '已加载依赖说明' : '已加载能力说明'}：${event.skillId} v${event.version}。`,
             )
           }
          if (event.type === 'tool_proposed') {
            debugThoughts.push(
              event.modeNormalized
                ? `后端已提案：${event.toolId}；调用范围由 ${event.requestedMode} 归一为 ${event.effectiveMode}。`
                : `后端已提案：${event.toolId}（${event.effectiveMode}）。`,
            )
          }
          if (event.type === 'tool_started') {
            debugThoughts.push(`后端正在执行：${event.toolId}。`)
            if (event.toolId === 'timeline.render') {
              useTaskStore.getState().startTask(prompt, event.callId)
            }
          }
          if (event.type === 'tool_progress') {
            const elapsedLabel = event.elapsedMs == null
              ? ''
              : ` · 总用时 ${(event.elapsedMs / 1000).toFixed(1)} 秒`
            useTaskStore.getState().updateProgress(
              event.progress,
              `${event.message}${elapsedLabel}`,
              `[${event.phase}] ${event.message}${elapsedLabel}`,
            )
          }
          if (event.type === 'tool_result') {
            if (event.toolId === 'timeline.render') {
              if (event.ok && isTimelineDraftRunResult(event.result)) {
                useV2TimelineStore.getState().setResult(event.result, prompt)
                useTaskStore.getState().completeTask()
              }
              else useTaskStore.getState().setFailed(event.summary)
            }
            if (event.ok && event.draft) {
              activateV2DraftWorkspace(event.draft)
              debugThoughts.push(`已同步 V2 草稿 v${event.draft.revision} 到时间线工作区。`)
            }
            debugThoughts.push(event.ok ? `后端结果：${event.summary}` : `后端未完成：${event.summary}`)
          }
          if (event.type === 'assistant_reply') directMessage = event.message
          if (event.type === 'state_update') {
            useDirectorContextStore.getState().setDirectorState(event.state)
          }
          if (event.type === 'workspace_session') {
            rememberActiveDirectorWorkspaceSessionId(
              window.sessionStorage,
              event.workspaceSessionId,
            )
            applyDirectorWorkspaceContext(event.state.context, true)
            debugThoughts.push(
              `V2 会话已同步；本轮${event.modelCalled ? '已调用导演模型' : '使用上下文降级'}。`,
            )
          }
        },
        abort.signal,
      )

      if (directMessage) {
        updateMessage(thinkingId, {
          content: directMessage,
          kind: 'text',
          status: 'done',
        })
        if (debugThoughts.length) {
          addThoughtMessage({
            content: '技术详情',
            thoughts: debugThoughts,
            status: 'done',
          })
        }
        return
      }
    } catch (e) {
      if (streamCancelRef.current) {
        updateMessage(thinkingId, {
          content: '导演分析已中止',
          kind: 'text',
          status: 'done',
        })
        return
      }
      const msg = e instanceof Error ? e.message : String(e)
      updateMessage(thinkingId, {
        content: msg,
        kind: 'error',
        status: 'error',
        recoverySuggestions: currentRecoverySuggestions(),
      })
      if (debugThoughts.length) {
        addThoughtMessage({
          content: '技术详情',
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

  const handleCancelDirectorStream = () => {
    if (!abortRef.current) return
    streamCancelRef.current = true
    abortRef.current.abort()
    const progressId = activeProgressMessageIdRef.current
    if (progressId) {
      updateMessage(progressId, {
        content: '导演分析已中止',
        kind: 'text',
        status: 'done',
      })
    } else {
      addAssistantMessage({ content: '导演分析已中止' })
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
      <DirectorChatThread />
      <ChatInput
        disabled={busy}
        busyLabel={isSending ? '中止导演分析' : '后台处理中'}
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
