import { Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { ChatInput } from '@/components/sidebar/ChatInput'
import { DirectorChatThread } from '@/components/sidebar/DirectorChatThread'
import {
  streamDirectorChat,
  type DirectorAgentStreamEvent,
} from '@/lib/api'
import {
  recordDirectorActionCompleted,
  recordDirectorActionFailed,
  recordDirectorActionPlanned,
  recordDirectorActionRunning,
  summarizeDirectorSessionState,
  syncDirectorSessionSnapshot,
} from '@shared/lib/director-state-machine'
import { buildDirectorContextFromUI } from '@/services/director/directorDecisionContext'
import {
  createDirectorActionExecutor,
  runDirectorAction,
} from '@/services/director/directorActionExecutor'
import { useCreationStore, type InputAttachment } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { DirectorAction, DirectorActionType } from '@shared/types/director-action'
import type {
  DirectorSessionState,
  DirectorTimelineSnapshot,
} from '@shared/types/director-state'

function attachmentTypeFromMime(mime: string): InputAttachment['type'] | null {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  return null
}

function attachmentMaterialId(attachment: InputAttachment): string {
  return attachment.materialId ?? attachment.id.replace(/^att_/, '')
}

function materialPayload(attachments: InputAttachment[]) {
  return attachments.map((att) => ({
    id: attachmentMaterialId(att),
    name: att.name,
    type: att.type,
    url: att.url,
    tags: att.tags,
  }))
}

function selectedSampleAttachment(
  action: DirectorAction,
  attachments: InputAttachment[],
): InputAttachment | undefined {
  const selectedId = action.slots.sampleMaterialId
  if (!selectedId) return undefined
  return attachments.find(
    (attachment) =>
      attachment.type === 'video' && attachmentMaterialId(attachment) === selectedId,
  )
}

function syncDirectorContext(input: {
  sampleUrl: string
  sampleName?: string
  attachments: InputAttachment[]
}) {
  const contextStore = useDirectorContextStore.getState()
  contextStore.setSampleVideo(
    input.sampleUrl
      ? {
          id: 'sample_video',
          url: input.sampleUrl,
          name: input.sampleName,
          styleRecipe: contextStore.context.sampleVideo?.styleRecipe,
          reference: contextStore.context.sampleVideo?.reference,
        }
      : undefined,
  )
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

function applyActionContext(action: DirectorAction) {
  const contextStore = useDirectorContextStore.getState()
  contextStore.applyIntentResult(action.result)
  contextStore.patchSlots(action.slots)
  contextStore.setUserIntent(action.intent)
  if (action.slots.aspectRatio) {
    useCreationStore.getState().setAspectRatio(action.slots.aspectRatio)
  }
  if (action.slots.durationSec) {
    useCreationStore.getState().setDurationSec(action.slots.durationSec)
  }
  if (action.slots.styleIntensity) {
    useCreationStore.getState().setStyleIntensity(action.slots.styleIntensity)
  }
}

function isMessageOnlyAction(type: DirectorActionType): boolean {
  return type === 'ASK_USER' || type === 'REQUEST_PLUGIN'
}

function isRevisionOnlyAction(type: DirectorActionType): boolean {
  return type === 'REVISE_TIMELINE'
}

function shouldShowThoughtSurface(event: DirectorAgentStreamEvent) {
  if (event.type !== 'surface') return false
  return event.shouldRunIntentRouter || event.mode === 'repair'
}

function eventThought(event: DirectorAgentStreamEvent): string | null {
  if (event.type === 'thought') return `${event.title}：${event.content}`
  if (event.type === 'intent') {
    const source =
      event.source === 'llm'
        ? 'LLM Router'
        : event.source === 'llm_unstructured_safe_reply'
          ? '模型自由回复'
          : event.source === 'context_fallback'
            ? '上下文保留'
            : 'Router'
    return `意图识别：${event.intent}，置信度 ${Math.round(
      event.confidence * 100,
    )}%，内容类型 ${event.contentDomain}，来源 ${source}。`
  }
  if (event.type === 'slot_update') {
    return event.missingSlots.length
      ? `条件检查：还缺 ${event.missingSlots.join(', ')}。`
      : `条件检查：画幅 ${event.slots.aspectRatio}，风格强度 ${event.slots.styleIntensity}，素材状态 ${event.slots.materialStatus}。`
  }
  if (event.type === 'action_plan') return `动作计划：${event.action.type}。`
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
        `Sample understanding: ${sample.summary_zh}`,
        `Story: ${sample.story_zh}`,
        `Atmosphere: ${sample.atmosphere_zh}`,
        `Editing: ${sample.editing_zh}`,
        `Rhythm: ${sample.rhythm_zh}`,
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
  const setInputText = useCreationStore((s) => s.setInputText)
  const setAnalyzing = useCreationStore((s) => s.setAnalyzing)
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
  const executorRef = useRef(createDirectorActionExecutor())
  const abortRef = useRef<AbortController | null>(null)
  const streamCancelRef = useRef(false)
  const activeProgressMessageIdRef = useRef<string | null>(null)

  const recordActionCompleted = (
    outcome: Parameters<typeof recordDirectorActionCompleted>[0]['outcome'],
  ) => {
    const timeline = currentV2TimelineSnapshot()
    useDirectorContextStore.getState().updateDirectorState((state) =>
      recordDirectorActionCompleted({
        state,
        outcome,
        timeline,
      }),
    )
  }

  const recordActionRunning = () => {
    useDirectorContextStore.getState().updateDirectorState((state) =>
      recordDirectorActionRunning({ state }),
    )
  }

  const recordActionFailed = (actionType: DirectorActionType | undefined, error: string) => {
    useDirectorContextStore.getState().updateDirectorState((state) =>
      recordDirectorActionFailed({ state, actionType, error }),
    )
  }

  const ingestDroppedFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const store = useCreationStore.getState()

    void (async () => {
      for (const file of Array.from(files)) {
        const type = attachmentTypeFromMime(file.type)
        if (!type) continue
        const material = await useMaterialLibraryStore.getState().addFromFileWithHash(file)

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

  const executeAction = async (input: {
    actionPlan: DirectorAction
    prompt: string
    sampleVideoUrl: string
    sampleVideoName?: string
    materials: InputAttachment[]
    conversationSummary?: string
    progressMessageId?: string
  }) => {
    let { actionPlan, prompt, sampleVideoUrl, sampleVideoName, materials, conversationSummary } =
      input

    // A newly uploaded video remains a creation material unless the director
    // explicitly selected it through the structured candidate id. This happens
    // after model routing, never through a client-side wording heuristic.
    const selectedSample =
      !sampleVideoUrl && actionPlan.type === 'ANALYZE_SAMPLE'
        ? selectedSampleAttachment(actionPlan, materials)
        : undefined
    if (selectedSample) {
      sampleVideoUrl = selectedSample.url
      sampleVideoName = selectedSample.name
      materials = materials.filter((item) => item.id !== selectedSample.id)
      const creation = useCreationStore.getState()
      creation.setSampleUrl(selectedSample.url, selectedSample.name)
      creation.removeAttachment(selectedSample.id)
      creation.setSampleParsed(false)
      syncDirectorContext({
        sampleUrl: sampleVideoUrl,
        sampleName: sampleVideoName,
        attachments: materials,
      })
    }

    recordActionRunning()

    if (isMessageOnlyAction(actionPlan.type)) {
      recordActionCompleted({
        phase: 'message',
        action: actionPlan.type,
        message: actionPlan.message,
        userFacingOnly: true,
      })
      if (input.progressMessageId) {
        updateMessage(input.progressMessageId, {
          content: actionPlan.message,
          kind: 'text',
          status: 'done',
        })
      } else {
        addAssistantMessage({ content: actionPlan.message })
      }
      return
    }

    if (isRevisionOnlyAction(actionPlan.type)) {
      const creation = useCreationStore.getState()
      const outcome = await runDirectorAction({
        action: actionPlan,
        executor: executorRef.current,
        context: {
          prompt,
          sampleVideoUrl,
          sampleVideoName,
          aspectRatio: actionPlan.slots.aspectRatio ?? creation.aspectRatio,
          durationSec: actionPlan.slots.durationSec ?? creation.durationSec,
          styleIntensity: actionPlan.slots.styleIntensity ?? creation.styleIntensity,
          materials: materialPayload(materials),
          conversationSummary,
          activeTaskId: useV2TimelineStore.getState().taskId ?? activeTaskId,
          execution: {
            effect: actionPlan.payload?.executionEffect,
            authorizationEvidence: actionPlan.payload?.authorizationEvidence,
          },
        },
      })
      recordActionCompleted(outcome)
      if (input.progressMessageId) {
        updateMessage(input.progressMessageId, {
          content: actionPlan.message,
          kind: 'progress',
          status: 'done',
        })
      } else {
        addAssistantMessage({ content: actionPlan.message })
      }
      return
    }

    setAnalyzing(actionPlan.type === 'ANALYZE_SAMPLE')
    const progressId = input.progressMessageId ?? addProgressMessage(actionPlan.message)
    updateMessage(progressId, {
      content: actionPlan.message,
      kind: 'progress',
      status: 'streaming',
    })

    try {
      const creation = useCreationStore.getState()
      const outcome = await runDirectorAction({
        action: actionPlan,
        executor: executorRef.current,
        context: {
          prompt,
          sampleVideoUrl,
          sampleVideoName,
          aspectRatio: actionPlan.slots.aspectRatio ?? creation.aspectRatio,
          durationSec: actionPlan.slots.durationSec ?? creation.durationSec,
          styleIntensity: actionPlan.slots.styleIntensity ?? creation.styleIntensity,
          materials: materialPayload(materials),
          conversationSummary,
          activeTaskId: useV2TimelineStore.getState().taskId ?? activeTaskId,
          execution: {
            effect: actionPlan.payload?.executionEffect,
            authorizationEvidence: actionPlan.payload?.authorizationEvidence,
          },
        },
      })
      recordActionCompleted(outcome)

      // The director's natural-language response remains the conversation.
      // Execution status belongs to the progress state and the V2 workbench,
      // rather than being replaced by a second, fixed assistant script.
      updateMessage(progressId, {
        content: actionPlan.message,
        kind: 'progress',
        status: 'done',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      recordActionFailed(actionPlan.type, msg)
      updateMessage(progressId, {
        content: msg,
        kind: 'error',
        status: 'error',
        recoverySuggestions: currentRecoverySuggestions(),
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSend = async (text: string) => {
    const creationSnapshot = useCreationStore.getState()
    const prompt = text.trim()
    const pendingAttachmentIdsSnapshot = [...creationSnapshot.pendingAttachmentIds]
    const showSampleInInputTraySnapshot = creationSnapshot.showSampleInInputTray
    clearInputTray()
    const effectiveSampleUrl = creationSnapshot.sampleUrl
    const effectiveSampleName = creationSnapshot.sampleName
    const contextAttachments = [...creationSnapshot.attachments]
    const currentAspectRatio = creationSnapshot.aspectRatio
    const currentDurationSec = creationSnapshot.durationSec
    const currentStyleIntensity = creationSnapshot.styleIntensity
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
    setInputText(prompt)
    const thinkingId = addProgressMessage('我在理解你的意思，整理创作意图、可选参考和当前时间线...')
    activeProgressMessageIdRef.current = thinkingId

    setSending(true)
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    streamCancelRef.current = false

    let actionPlan: DirectorAction | null = null
    let directMessage: string | null = null
    const debugThoughts: string[] = []

    try {
      await streamDirectorChat(
        {
          prompt,
          context: directorContext,
          runtime: {
            backendEnabled: true,
            sampleUrl: effectiveSampleUrl,
            sampleName: effectiveSampleName,
            isSampleParsed: currentIsSampleParsed,
            hasPipeline: Boolean(v2State.spec),
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
          if (event.type === 'action_plan') actionPlan = event.action
          if (event.type === 'state_update') {
            useDirectorContextStore.getState().setDirectorState(event.state)
          }
          if (event.type === 'done') {
            if (event.action) actionPlan = event.action
            if (event.message) directMessage = event.message
          }
        },
        abort.signal,
      )

      if (directMessage && !actionPlan) {
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
      if (!actionPlan) throw new Error('导演 Agent 没有返回下一步动作。')

      useDirectorContextStore.getState().updateDirectorState((state) =>
        recordDirectorActionPlanned({ state, action: actionPlan!, prompt }),
      )
      debugThoughts.push(
        `状态机：${summarizeDirectorSessionState(
          useDirectorContextStore.getState().context.directorState,
        )}`,
      )
      applyActionContext(actionPlan)
      await executeAction({
        actionPlan,
        prompt,
        sampleVideoUrl: effectiveSampleUrl,
        sampleVideoName: effectiveSampleName,
        materials: contextAttachments,
        conversationSummary: directorContext.conversationSummary,
        progressMessageId: thinkingId,
      })
      if (debugThoughts.length) {
        addThoughtMessage({
          content: '技术详情',
          thoughts: debugThoughts,
          status: 'done',
        })
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
      const failedAction = actionPlan as DirectorAction | null
      recordActionFailed(failedAction?.type, msg)
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
