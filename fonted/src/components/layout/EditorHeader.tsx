import { Clapperboard, FilePlus2, Save } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { env } from '@/config/env'
import {
  getV2TimelineDraftReadiness,
  type V2TimelineDraftDto,
  type V2TimelineDraftReadinessDto,
} from '@/lib/api'
import {
  renderV2DirectorTimeline,
  saveV2DirectorTimelineDraft,
} from '@/services/director/v2DirectorTimeline'
import { startNewV2DraftWorkspace } from '@/services/director/v2DirectorDraftWorkspace'
import { replaceActiveDirectorWorkspaceSession } from '@/services/director/workspaceSessionLifecycle'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { useEditorStore } from '@/stores/editorStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

export function EditorHeader() {
  const projectName = useEditorStore((s) => s.projectName)
  const v2Spec = useV2TimelineStore((s) => s.spec)
  const v2HasLocalEdits = useV2TimelineStore((s) => s.hasLocalEdits)
  const renderedOutputUrl = useV2TimelineStore((s) => s.renderedOutputUrl)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const backendReady = useTaskStore((s) => s.backendReady)
  const isTaskRunning = useTaskStore((s) => s.isTaskRunning)
  const copilotLoading = useTaskStore((s) => s.copilotLoading)
  const isDirectorSending = useDirectorChatStore((s) => s.isSending)
  const isAnalyzing = useCreationStore((s) => s.isAnalyzing)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [preflight, setPreflight] = useState<V2TimelineDraftReadinessDto | null>(null)

  const handleNewDraft = () => {
    if (saving || exporting || isTaskRunning || copilotLoading || isDirectorSending || isAnalyzing) return
    if (v2HasLocalEdits && !window.confirm('当前草稿有未保存修改，仍要新建草稿吗？')) return
    replaceActiveDirectorWorkspaceSession({
      sessionStorage: window.sessionStorage,
      createId: () => `v2_director_${crypto.randomUUID()}`,
    })
    startNewV2DraftWorkspace()
  }

  const saveCurrentWork = async (): Promise<V2TimelineDraftDto | null> => {
    const taskStore = useTaskStore.getState()
    const v2Timeline = useV2TimelineStore.getState()
    if (!v2Timeline.spec) {
      taskStore.addLog('[编辑] 请先在对话中生成视频方案。')
      return null
    }

    const draft = await saveV2DirectorTimelineDraft()
    taskStore.addLog('[编辑] 当前方案已保存，导出时会使用刚保存的内容。')
    return draft
  }

  const handleSave = async () => {
    if (saving || exporting) return
    setSaving(true)
    try {
      await saveCurrentWork()
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    if (saving || exporting) return
    const taskStore = useTaskStore.getState()
    const taskId = useTaskStore.getState().activeTaskId
    if (!taskId) {
      taskStore.addLog('[导出] 导出失败：当前没有活跃任务。')
      return
    }
    if (!env.useBackend || !backendReady) {
      taskStore.addLog('[导出] 视频处理服务暂未就绪，请稍后重试。')
      return
    }
    if (!useV2TimelineStore.getState().spec) {
      taskStore.addLog('[导出] 当前还没有视频方案，请先在左侧对话中生成方案。')
      return
    }

    setExporting(true)
    try {
      const current = useV2TimelineStore.getState()
      const confirmed = preflight?.status === 'ready'
        && preflight.draftId === current.draftId
        && preflight.revision === current.draftRevision
        && !current.hasLocalEdits
        && current.pendingTimelineRevisions.length === 0
      if (!confirmed) {
        const saved = await saveCurrentWork()
        if (!saved) return
        const readiness = await getV2TimelineDraftReadiness(saved.draftId, saved.revision)
        setPreflight(readiness)
        if (readiness.status === 'blocked') {
          taskStore.addLog(`[导出检查] ${readiness.missing.map((item) => item.description).join('；')}`)
        } else {
          taskStore.addLog(`[导出检查] 当前方案可以导出；有 ${readiness.generationJobCount} 个镜头需要准备，不能复用时才会重新生成。请再次确认导出。`)
        }
        return
      }
      const confirmedReadiness = await getV2TimelineDraftReadiness(
        preflight!.draftId,
        preflight!.revision,
      )
      if (confirmedReadiness.status === 'blocked') {
        setPreflight(confirmedReadiness)
        taskStore.addLog(`[导出检查] 状态已变化：${confirmedReadiness.missing.map((item) => item.description).join('；')}`)
        return
      }
      const creation = useCreationStore.getState()
      const latest = useV2TimelineStore.getState()
      if (
        latest.draftId !== preflight!.draftId
        || latest.draftRevision !== preflight!.revision
        || latest.hasLocalEdits
      ) {
        setPreflight(null)
        taskStore.addLog('[导出检查] 当前方案已变化，请重新确认导出。')
        return
      }
      await renderV2DirectorTimeline({
        prompt: creation.inputText || '导出当前视频成片',
      }, { draftId: preflight!.draftId, revision: preflight!.revision })
      setPreflight(null)
    } catch (error) {
      taskStore.addLog('[导出] 当前成片没有开始生成，请检查方案提示后重试。')
    } finally {
      setExporting(false)
    }
  }

  const saveDisabled =
    saving || exporting || !v2Spec
  const exportDisabled =
    saving || exporting || isTaskRunning || copilotLoading || !activeTaskId || !v2Spec
  const newDraftDisabled =
    saving || exporting || isTaskRunning || copilotLoading || isDirectorSending || isAnalyzing

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600/20 text-violet-400">
          <Clapperboard className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-zinc-100">
          AI Video Studio
        </span>
      </div>

      <div className="absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate px-4 text-center">
        <h1 className="truncate text-sm font-medium text-zinc-300">
          {projectName}
        </h1>
        {v2Spec ? (
          <p className="text-[10px] text-zinc-500">
            {v2HasLocalEdits
              ? '未保存修改'
              : renderedOutputUrl
                ? '当前方案已生成成片'
                : '当前方案已保存'}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={newDraftDisabled}
          onClick={handleNewDraft}
          title="保留历史草稿并开始新的创作"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          新建草稿
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={saveDisabled}
          onClick={() => void handleSave()}
          title={
            v2Spec
              ? v2HasLocalEdits
                ? '保存当前方案；导出会使用保存后的内容'
                : '当前方案已保存'
              : '请先生成视频方案'
          }
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中' : '保存草稿'}
        </Button>
        <Button
          variant="highlight"
          size="sm"
          type="button"
          disabled={exportDisabled}
          onClick={() => void handleExport()}
          title="导出当前视频成片"
        >
          {exporting ? '检查中' : preflight?.status === 'ready' ? '确认导出' : '导出成片'}
        </Button>
      </div>
      {preflight ? (
        <aside className="absolute right-4 top-16 z-50 w-96 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-zinc-100">导出前检查</strong>
            <button type="button" className="text-xs text-zinc-400" onClick={() => setPreflight(null)}>关闭</button>
          </div>
          {preflight.status === 'ready' ? (
            <p className="mt-2 text-xs leading-5 text-emerald-300">
              当前方案可以导出；有 {preflight.generationJobCount} 个镜头需要准备，不能复用时才会重新生成。再次点击“确认导出”才会开始。
            </p>
          ) : (
            <div className="mt-2 space-y-2 text-xs leading-5 text-amber-300">
              {preflight.missing.map((item) => <p key={`${item.code}:${item.description}`}>{item.description}</p>)}
              {preflight.alternatives.length ? <p className="text-zinc-400">下一步：{preflight.alternatives.join('；')}</p> : null}
            </div>
          )}
        </aside>
      ) : null}
    </header>
  )
}
