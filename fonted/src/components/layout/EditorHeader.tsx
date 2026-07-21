import { Clapperboard, Save } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { env } from '@/config/env'
import * as api from '@/lib/api'
import { runPipelineGeneration } from '@/services/pipeline/runGeneration'
import { useEditorStore } from '@/stores/editorStore'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePropertyEditorStore } from '@/stores/propertyEditorStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'

export function EditorHeader() {
  const projectName = useEditorStore((s) => s.projectName)
  const timelineMode = useEditorStore((s) => s.timelineMode)
  const renderPlan = useRenderPlanStore((s) => s.plan)
  const renderPlanDirty = useRenderPlanStore((s) => s.isDirty)
  const renderPlanSyncStatus = useRenderPlanStore((s) => s.syncStatus)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const backendReady = useTaskStore((s) => s.backendReady)
  const isTaskRunning = useTaskStore((s) => s.isTaskRunning)
  const copilotLoading = useTaskStore((s) => s.copilotLoading)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const saveCurrentWork = async (): Promise<boolean> => {
    const taskStore = useTaskStore.getState()
    const propertyStore = usePropertyEditorStore.getState()
    if (propertyStore.isDirty) {
      propertyStore.save()
    }

    if (!env.useBackend) {
      useRenderPlanStore.getState().markSaved()
      taskStore.addLog('[编辑] 已保存到本地状态。')
      return true
    }

    const taskId = useTaskStore.getState().activeTaskId
    if (!taskId) {
      taskStore.addLog('[编辑] 保存失败：当前没有活跃任务。')
      return false
    }

    if (useEditorStore.getState().timelineMode === 'generation') {
      const currentRenderPlan = useRenderPlanStore.getState().plan
      if (!currentRenderPlan) {
        taskStore.addLog('[编辑] 保存失败：当前没有可保存的 RenderPlan。')
        return false
      }

      useRenderPlanStore.getState().markSaving()
      try {
        const changeSummary = useRenderPlanStore.getState().lastChangeSummary ?? ''
        const { renderPlan: savedRenderPlan } = await api.patchTaskRenderPlan(
          taskId,
          currentRenderPlan,
        )
        useRenderPlanStore.getState().setPlan(savedRenderPlan)
        taskStore.addLog(
          `[编辑] RenderPlan revision ${savedRenderPlan.plan_revision ?? currentRenderPlan.plan_revision ?? 1} 已同步到后端。${changeSummary}`,
        )
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        useRenderPlanStore.getState().markSyncFailed(message)
        taskStore.addLog(`[编辑] RenderPlan 保存失败：${message}`)
        return false
      }
    }

    try {
      const project = useMigrationProjectStore.getState().project
      await api.patchTaskStructure(taskId, project)
      taskStore.addLog('[编辑] 样例结构已同步到后端。')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      taskStore.addLog(`[编辑] 样例结构保存失败：${message}`)
      return false
    }
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
      taskStore.addLog('[导出] 后端未就绪，请先启动后端、Redis、PostgreSQL 和 generator.worker。')
      return
    }
    if (!useRenderPlanStore.getState().plan) {
      taskStore.addLog('[导出] 当前没有 RenderPlan，请先完成样例解析并进入生成编辑。')
      return
    }

    setExporting(true)
    try {
      const saved = await saveCurrentWork()
      if (!saved) return
      await runPipelineGeneration(taskId, '导出成片')
    } catch (error) {
      taskStore.addLog(`[导出] 提交失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExporting(false)
    }
  }

  const saveDisabled =
    saving ||
    exporting ||
    renderPlanSyncStatus === 'syncing' ||
    (env.useBackend && !activeTaskId) ||
    (timelineMode === 'generation' && !renderPlan)
  const exportDisabled =
    saving || exporting || isTaskRunning || copilotLoading || !activeTaskId || !renderPlan

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
          disabled={saveDisabled}
          onClick={() => void handleSave()}
          title={renderPlanDirty ? '保存当前 RenderPlan' : '同步当前编辑'}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中' : '保存'}
        </Button>
        <Button
          variant="highlight"
          size="sm"
          type="button"
          disabled={exportDisabled}
          onClick={() => void handleExport()}
          title="保存当前 RenderPlan 并提交生成成片"
        >
          {exporting ? '导出中' : '导出成片'}
        </Button>
      </div>
    </header>
  )
}
