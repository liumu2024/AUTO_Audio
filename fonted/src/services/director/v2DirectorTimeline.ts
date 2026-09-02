import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'

import * as api from '@/lib/api'
import { useEditorStore } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

export interface V2DirectorTimelineInput {
  prompt: string
}

function syncV2TimelineWorkspace(input: {
  spec: RemotionTimelineSpecV1
}) {
  // V2 preview/run has a single source of truth: useV2TimelineStore.spec.
  // This only aligns shared playback/editor chrome and must not write V1 stores.
  usePlaybackStore.getState().setDuration(input.spec.canvas.duration_sec)
}

export async function saveV2DirectorTimelineDraft(): Promise<api.V2TimelineDraftDto> {
  const current = useV2TimelineStore.getState()
  if (!current.draftId || !current.draftRevision || !current.spec) {
    throw new Error('当前没有可保存的视频方案。')
  }
  if (!current.hasLocalEdits) {
    return {
      draftId: current.draftId,
      revision: current.draftRevision,
      spec: current.spec,
      traceDir: current.traceDir ?? undefined,
      createdAt: '',
      updatedAt: '',
    }
  }
  const saved = await api.saveV2TimelineDraft({
    draftId: current.draftId,
    baseRevision: current.draftRevision,
    spec: current.spec,
  })
  useV2TimelineStore.getState().setPersistedDraft(saved.draft)
  return saved.draft
}

export async function renderV2DirectorTimeline(
  input: V2DirectorTimelineInput,
  confirmedDraft?: { draftId: string; revision: number },
): Promise<api.V2TimelineDraftRunResult> {
  useEditorStore.getState().enterV2Workspace()
  if (confirmedDraft) {
    const confirmedState = useV2TimelineStore.getState()
    if (
      confirmedState.draftId !== confirmedDraft.draftId
      || confirmedState.draftRevision !== confirmedDraft.revision
      || confirmedState.hasLocalEdits
    ) throw new Error('当前方案在确认后发生了变化，请重新进行导出检查。')
  } else if (useV2TimelineStore.getState().hasLocalEdits) {
    await saveV2DirectorTimelineDraft()
  }
  const current = useV2TimelineStore.getState()
  if (!current.draftId || !current.draftRevision || !current.spec) {
    throw new Error('请先生成并保存视频方案。')
  }
  if (confirmedDraft && (
    current.draftId !== confirmedDraft.draftId
    || current.draftRevision !== confirmedDraft.revision
  )) throw new Error('当前草稿版本与已确认版本不一致。')
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || '导出视频成片', current.draftId)
  taskStore.updateProgress(10, '准备导出', '正在准备当前方案和素材。')
  taskStore.updateProgress(30, '准备画面素材', '正在复用已有镜头，并补充确实需要重新生成的内容。')
  try {
    const result = await api.runV2TimelineDraft({
      draftId: current.draftId,
      revision: current.draftRevision,
    })
    useV2TimelineStore.getState().setResult(result)
    syncV2TimelineWorkspace({ spec: current.spec })
    taskStore.updateProgress(
      100,
      '视频成片已导出',
      '成片已经更新到预览区。',
    )
    taskStore.setBackendReady(true)
    taskStore.setComplete(true)
    return result
  } catch (error) {
    taskStore.setFailed(error instanceof Error ? error.message : String(error))
    throw error
  }
}
