import * as api from '@/lib/api'
import { filenameFromUrl } from '@/lib/session'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useTaskStore } from '@/stores/taskStore'

/** 从服务端加载任务并 hydrate 编辑器上下文 */
export async function restoreTaskContext(taskId: string): Promise<boolean> {
  const { setActiveTaskId, setBackendReady, setBootstrapError, addLog } =
    useTaskStore.getState()

  try {
    const task = await api.getTask(taskId)
    const bundle = await api.getTaskPipeline(taskId)
    if (!bundle) return false

    usePipelineStore.getState().hydrate(bundle)
    setActiveTaskId(taskId)
    setBackendReady(true)
    setBootstrapError(null)

    useCreationStore.getState().restoreFromServer({
      sampleUrl: task.sampleVideoUrl,
      sampleName: filenameFromUrl(task.sampleVideoUrl),
      inputText: task.globalPrompt ?? '',
      isSampleParsed: bundle.structure.semantic_anchors.length > 0,
    })

    useDirectorChatStore.getState().restoreSession({
      sampleName: filenameFromUrl(task.sampleVideoUrl),
      globalPrompt: task.globalPrompt ?? undefined,
      outline: bundle.outline,
    })

    addLog(`[工作台] 已恢复任务 ${taskId}`)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    addLog(`[工作台] 恢复失败: ${msg}`)
    return false
  }
}
