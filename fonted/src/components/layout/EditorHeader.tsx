import { Clapperboard, FilePlus2, Save } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { env } from '@/config/env'
import {
  renderV2DirectorTimeline,
  saveV2DirectorTimelineDraft,
  v2MaterialsFromAttachments,
} from '@/services/director/v2DirectorTimeline'
import { startNewV2DraftWorkspace } from '@/services/director/v2DirectorDraftWorkspace'
import { rememberActiveDirectorWorkspaceSessionId } from '@/services/director/workspaceSessionLifecycle'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { useEditorStore } from '@/stores/editorStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

export function EditorHeader() {
  const projectName = useEditorStore((s) => s.projectName)
  const v2Spec = useV2TimelineStore((s) => s.spec)
  const v2HasLocalEdits = useV2TimelineStore((s) => s.hasLocalEdits)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const backendReady = useTaskStore((s) => s.backendReady)
  const isTaskRunning = useTaskStore((s) => s.isTaskRunning)
  const copilotLoading = useTaskStore((s) => s.copilotLoading)
  const isDirectorSending = useDirectorChatStore((s) => s.isSending)
  const isAnalyzing = useCreationStore((s) => s.isAnalyzing)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleNewDraft = () => {
    if (saving || exporting || isTaskRunning || copilotLoading || isDirectorSending || isAnalyzing) return
    if (v2HasLocalEdits && !window.confirm('当前草稿有未保存修改，仍要新建草稿吗？')) return
    rememberActiveDirectorWorkspaceSessionId(
      window.sessionStorage,
      `v2_director_${crypto.randomUUID()}`,
    )
    startNewV2DraftWorkspace()
  }

  const saveCurrentWork = async (): Promise<boolean> => {
    const taskStore = useTaskStore.getState()
    const v2Timeline = useV2TimelineStore.getState()
    if (!v2Timeline.spec) {
      taskStore.addLog('[编辑] 请先在对话中生成 V2 Timeline 方案。')
      return false
    }

    const draft = await saveV2DirectorTimelineDraft()
    taskStore.addLog(
      `[编辑] V2 Timeline 草稿已保存为 revision ${draft.revision}。导出会使用这个不可变 revision。`,
    )
    return true
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
      taskStore.addLog('[导出] 后端未就绪，请先启动 backend。')
      return
    }
    if (!useV2TimelineStore.getState().spec) {
      taskStore.addLog('[导出] 当前没有 V2 Timeline 方案，请先在左侧对话中生成方案。')
      return
    }

    setExporting(true)
    try {
      const saved = await saveCurrentWork()
      if (!saved) return
      const creation = useCreationStore.getState()
      await renderV2DirectorTimeline({
        taskId,
        prompt: creation.inputText || '导出当前 V2 Timeline 成片',
        sampleVideoUrl: creation.sampleUrl,
        sampleVideoName: creation.sampleName,
        aspectRatio: creation.aspectRatio,
        durationSec: creation.durationSec,
        materials: v2MaterialsFromAttachments(creation.attachments),
      })
    } catch (error) {
      taskStore.addLog(`[导出] 提交失败：${error instanceof Error ? error.message : String(error)}`)
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
                ? '保存当前 V2 草稿；导出会使用保存后的 revision'
                : '当前 V2 草稿已保存'
              : '请先生成 V2 Timeline 方案'
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
          title="渲染当前 V2 Timeline 成片"
        >
          {exporting ? '导出中' : '导出成片'}
        </Button>
      </div>
    </header>
  )
}
