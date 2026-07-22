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
import { usePipelineStore } from '@/stores/pipelineStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'
import { useTimelineStore } from '@/stores/timelineStore'
import type { DirectorAction, DirectorActionType } from '@shared/types/director-action'
import type { DirectorSessionState, RenderPlanDiff } from '@shared/types/director-state'

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
          understanding: contextStore.context.sampleVideo?.understanding,
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
    useRenderPlanStore.getState().setAspectRatio(action.slots.aspectRatio)
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
  return type === 'REVISE_RENDER_PLAN'
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
        : event.source === 'rule_fallback'
          ? '安全兜底'
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

function buildConversationSummary() {
  const bundle = usePipelineStore.getState().bundle
  const plan = useRenderPlanStore.getState().plan
  const outline = bundle?.outline ?? []
  const outlineText = outline
    .slice(0, 8)
    .map((item, index) => {
      const name = item.title || item.id || `段落${index + 1}`
      const time =
        typeof item.start_sec === 'number' && typeof item.end_sec === 'number'
          ? `${item.start_sec.toFixed(1)}-${item.end_sec.toFixed(1)}s`
          : ''
      return `${index + 1}. ${name}${time ? ` (${time})` : ''}`
    })
    .join('；')

  const renderText = plan
    ? `当前已有 RenderPlan：${plan.scenes.length} 个场景，画幅 ${plan.canvas.ratio}，时长 ${plan.duration_sec}s。`
    : '当前还没有生成 RenderPlan。'

  return [outlineText ? `样例拆解大纲：${outlineText}` : '', renderText]
    .filter(Boolean)
    .join('\n')
}

function currentRenderPlanDiff(): RenderPlanDiff | undefined {
  const renderPlanState = useRenderPlanStore.getState()
  const plan = renderPlanState.plan
  if (!plan || !renderPlanState.lastChangeSummary) return undefined
  const timelineState = useTimelineStore.getState()
  const selectedClipId = timelineState.selectedClipId
  const selectedClip = selectedClipId
    ? timelineState.project.clips.find((clip) => clip.id === selectedClipId)
    : undefined
  return {
    revision: plan.plan_revision ?? 1,
    summary: renderPlanState.lastChangeSummary,
    at: new Date().toISOString(),
    clipId: selectedClipId ?? undefined,
    sceneId: selectedClip?.anchor_id,
  }
}

function syncDirectorStateFromUI(input: {
  sampleUrl: string
  isSampleParsed: boolean
  attachments: InputAttachment[]
  activeTaskId?: string | null
}): DirectorSessionState {
  const renderPlanState = useRenderPlanStore.getState()
  const timelineState = useTimelineStore.getState()
  const selectedClipId = timelineState.selectedClipId
  const selectedClip = selectedClipId
    ? timelineState.project.clips.find((clip) => clip.id === selectedClipId)
    : undefined
  const previous = useDirectorContextStore.getState().context.directorState
  const next = syncDirectorSessionSnapshot(previous, {
    taskId: input.activeTaskId,
    sampleUrl: input.sampleUrl,
    isSampleParsed: input.isSampleParsed,
    hasVisualMaterial: input.attachments.some(
      (item) => item.type === 'video' || item.type === 'image',
    ),
    materialCount: input.attachments.length,
    renderPlan: renderPlanState.plan,
    renderPlanStatus: renderPlanState.syncStatus,
    selectedClipId,
    selectedSceneId: selectedClip?.anchor_id,
    lastChangeSummary: renderPlanState.lastChangeSummary,
    renderedRevision: previous?.renderedRevision,
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
  const sampleUrl = useCreationStore((s) => s.sampleUrl)
  const sampleName = useCreationStore((s) => s.sampleName)
  const attachments = useCreationStore((s) => s.attachments)
  const aspectRatio = useCreationStore((s) => s.aspectRatio)
  const durationSec = useCreationStore((s) => s.durationSec)
  const styleIntensity = useCreationStore((s) => s.styleIntensity)
  const isSampleParsed = useCreationStore((s) => s.isSampleParsed)
  const setInputText = useCreationStore((s) => s.setInputText)
  const setAnalyzing = useCreationStore((s) => s.setAnalyzing)

  const isSending = useDirectorChatStore((s) => s.isSending)
  const addUserMessage = useDirectorChatStore((s) => s.addUserMessage)
  const addAssistantMessage = useDirectorChatStore((s) => s.addAssistantMessage)
  const addProgressMessage = useDirectorChatStore((s) => s.addProgressMessage)
  const addThoughtMessage = useDirectorChatStore((s) => s.addThoughtMessage)
  const updateMessage = useDirectorChatStore((s) => s.updateMessage)
  const pushOutlineResult = useDirectorChatStore((s) => s.pushOutlineResult)
  const pushGenerationResult = useDirectorChatStore((s) => s.pushGenerationResult)
  const pushError = useDirectorChatStore((s) => s.pushError)
  const setSending = useDirectorChatStore((s) => s.setSending)

  const hasPipeline = usePipelineStore((s) => Boolean(s.bundle))
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const isAnalyzing = useCreationStore((s) => s.isAnalyzing)
  const busy = isSending || isAnalyzing

  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const executorRef = useRef(createDirectorActionExecutor())
  const abortRef = useRef<AbortController | null>(null)
  const streamCancelRef = useRef(false)

  const recordActionCompleted = (
    outcome: Parameters<typeof recordDirectorActionCompleted>[0]['outcome'],
  ) => {
    const plan = useRenderPlanStore.getState().plan
    useDirectorContextStore.getState().updateDirectorState((state) =>
      recordDirectorActionCompleted({
        state,
        outcome,
        currentRevision: plan?.plan_revision,
        diff: currentRenderPlanDiff(),
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

    for (const file of Array.from(files)) {
      const type = attachmentTypeFromMime(file.type)
      if (!type) continue
      const material = useMaterialLibraryStore.getState().addFromFile(file)

      if (type === 'video' && !store.isSampleParsed && !store.sampleUrl) {
        useMaterialLibraryStore.getState().updateMaterial(material.id, {
          tags: [...material.tags, 'sample_reference'],
        })
        store.setSampleUrl(material.url, file.name)
        continue
      }

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
  }) => {
    const { actionPlan, prompt, sampleVideoUrl, sampleVideoName, materials } =
      input

    recordActionRunning()

    if (isMessageOnlyAction(actionPlan.type)) {
      recordActionCompleted({
        phase: 'message',
        action: actionPlan.type,
        message: actionPlan.message,
        userFacingOnly: true,
      })
      addAssistantMessage({ content: actionPlan.message })
      return
    }

    if (isRevisionOnlyAction(actionPlan.type)) {
      const outcome = await runDirectorAction({
        action: actionPlan,
        executor: executorRef.current,
        context: {
          prompt,
          sampleVideoUrl,
          sampleVideoName,
          aspectRatio: actionPlan.slots.aspectRatio ?? aspectRatio,
          durationSec: actionPlan.slots.durationSec ?? durationSec,
          styleIntensity: actionPlan.slots.styleIntensity ?? styleIntensity,
          materials: materialPayload(materials),
          activeTaskId,
          renderPlan: useRenderPlanStore.getState().plan ?? undefined,
        },
      })
      recordActionCompleted(outcome)
      addAssistantMessage({ content: outcome.message })
      return
    }

    setAnalyzing(actionPlan.type === 'ANALYZE_SAMPLE')
    const progressId = addProgressMessage(actionPlan.message)

    try {
      const outcome = await runDirectorAction({
        action: actionPlan,
        executor: executorRef.current,
        context: {
          prompt,
          sampleVideoUrl,
          sampleVideoName,
          aspectRatio: actionPlan.slots.aspectRatio ?? aspectRatio,
          durationSec: actionPlan.slots.durationSec ?? durationSec,
          styleIntensity: actionPlan.slots.styleIntensity ?? styleIntensity,
          materials: materialPayload(materials),
          activeTaskId,
          renderPlan: useRenderPlanStore.getState().plan ?? undefined,
        },
      })
      recordActionCompleted(outcome)

      if (actionPlan.type === 'ANALYZE_SAMPLE') {
        const outline = usePipelineStore.getState().bundle?.outline ?? []
        updateMessage(progressId, {
          content:
            '我把样例拆完了，先把它当成一张风格和节奏地图放在右侧。你可以让我继续讲它的镜头、转场或节奏，也可以补素材后再往成片方案走。',
          status: 'done',
        })
        if (outline.length) {
          pushOutlineResult(
            outline,
            `我整理出了 ${outline.length} 个结构段，下面这张卡片是它的节奏地图。它只作为参考；真正出片还需要用你补充的素材来填画面。`,
          )
        } else {
          addAssistantMessage({
            content: outcome.message,
            kind: 'error',
            status: 'error',
          })
        }
      } else if (actionPlan.type === 'GENERATE_RENDER_PLAN') {
        updateMessage(progressId, {
          content: outcome.message,
          kind: 'progress',
          status: 'done',
        })
        addAssistantMessage({
          content:
            '方案已经放到右侧了。你可以直接告诉我哪一段要更快、更慢、换素材或改字幕；确认满意后再让我渲染。',
        })
      } else if (actionPlan.type === 'RENDER_VIDEO') {
        updateMessage(progressId, {
          content: outcome.message,
          kind: 'progress',
          status: 'done',
        })
        pushGenerationResult(
          '视频已经出来了，先看整体节奏和转场是否顺。如果有哪一段不对，直接按时间点或片段编号告诉我，我继续改。',
        )
      } else {
        updateMessage(progressId, {
          content: outcome.message,
          status: 'done',
        })
        addAssistantMessage({ content: outcome.message })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      recordActionFailed(actionPlan.type, msg)
      updateMessage(progressId, {
        content: msg,
        kind: 'error',
        status: 'error',
      })
      pushError(msg, currentRecoverySuggestions())
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSend = async (text: string) => {
    const prompt = text.trim()
    let effectiveSampleUrl = sampleUrl
    let effectiveSampleName = sampleName
    const pendingAttachments = [...attachments]

    if (!effectiveSampleUrl.trim()) {
      const videoIdx = pendingAttachments.findIndex((a) => a.type === 'video')
      if (videoIdx >= 0) {
        const video = pendingAttachments.splice(videoIdx, 1)[0]!
        useCreationStore.getState().setSampleUrl(video.url, video.name)
        useCreationStore.getState().removeAttachment(video.id)
        effectiveSampleUrl = video.url
        effectiveSampleName = video.name
      }
    }

    syncDirectorContext({
      sampleUrl: effectiveSampleUrl,
      sampleName: effectiveSampleName,
      attachments: pendingAttachments,
    })
    const directorState = syncDirectorStateFromUI({
      sampleUrl: effectiveSampleUrl,
      isSampleParsed,
      attachments: pendingAttachments,
      activeTaskId,
    })

    const directorContext = buildDirectorContextFromUI({
      sampleUrl: effectiveSampleUrl,
      sampleName: effectiveSampleName,
      attachments: pendingAttachments,
      aspectRatio,
      durationSec,
      styleIntensity,
      isSampleParsed,
      existing: useDirectorContextStore.getState().context,
    })
    directorContext.currentRenderPlan =
      useRenderPlanStore.getState().plan ?? directorContext.currentRenderPlan
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
        (isSampleParsed
          ? '继续编辑当前生成方案'
          : '解析样例视频，识别导演结构和可复用风格'),
      attachments: [
        ...(effectiveSampleUrl
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
        ...pendingAttachments,
      ],
    })
    setInputText(prompt)

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
            isSampleParsed,
            hasPipeline,
            activeTaskId,
            hasVisualMaterial: pendingAttachments.some(
              (item) => item.type === 'video' || item.type === 'image',
            ),
            materialCount: pendingAttachments.length,
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
        addAssistantMessage({ content: directMessage })
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
        materials: pendingAttachments,
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
        addAssistantMessage({ content: '导演分析已中止' })
        return
      }
      const msg = e instanceof Error ? e.message : String(e)
      const failedAction = actionPlan as DirectorAction | null
      recordActionFailed(failedAction?.type, msg)
      pushError(msg, currentRecoverySuggestions())
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
      setSending(false)
    }
  }

  const handleCancelDirectorStream = () => {
    if (!abortRef.current) return
    streamCancelRef.current = true
    abortRef.current.abort()
    addAssistantMessage({ content: '导演分析已中止' })
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
              未解析前首个视频作为样例，其余文件作为创作素材。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
