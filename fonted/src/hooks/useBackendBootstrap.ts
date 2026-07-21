import { useEffect } from 'react'

import { env } from '@/config/env'
import * as api from '@/lib/api'
import {
  ANALYSIS_MAX_POLLS,
  ANALYSIS_POLL_MS,
  isAnalysisStructureReady,
} from '@/services/pipeline/analysisPolling'
import { restoreTaskContext } from '@/services/pipeline/restoreTask'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useTaskStore } from '@/stores/taskStore'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'

/**
 * 本机联调：启动时创建分析任务，轮询 structureJson 灌入画布
 */
export function useBackendBootstrap() {
  const setBackendReady = useTaskStore((s) => s.setBackendReady)
  const setBootstrapError = useTaskStore((s) => s.setBootstrapError)
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId)
  const addLog = useTaskStore((s) => s.addLog)
  const setProject = useMigrationProjectStore((s) => s.setProject)
  const setDuration = usePlaybackStore((s) => s.setDuration)

  useEffect(() => {
    if (!env.useBackend) return

    let cancelled = false

    async function bootstrap() {
      try {
        await api.healthCheck()
        addLog(`[联调] 后端健康检查 OK (${env.apiBase})`)

        const { taskId } = await api.createAnalyzeTask(env.sampleVideoUrl)
        if (cancelled) return

        setActiveTaskId(taskId)
        addLog(`[联调] 已创建分析任务 ${taskId}，等待 worker…`)

        for (let i = 0; i < ANALYSIS_MAX_POLLS; i++) {
          if (cancelled) return
          await new Promise((r) => setTimeout(r, ANALYSIS_POLL_MS))

          const task = await api.getTask(taskId)
          addLog(`[联调] 任务状态: ${task.taskStatus}`)

          if (isAnalysisStructureReady(task)) {
            const json = task.structureJson as MigrationProtocolV12
            setProject(json)
            const dur =
              json.source_video?.duration > 0
                ? json.source_video.duration
                : json.metadata.duration_sec
            setDuration(dur)
            setBackendReady(true)
            addLog('[联调] structureJson 已加载到画布')
            return
          }

          if (task.taskStatus === 'FAILED') {
            throw new Error('分析任务失败')
          }
        }

        addLog('[联调] 轮询超时，尝试恢复任务…')
        const restored = await restoreTaskContext(taskId)
        if (restored) {
          setBackendReady(true)
          addLog('[联调] 已从服务端恢复 structureJson')
          return
        }

        throw new Error(
          '等待 structureJson 超时，请确认已运行 npm run worker:analyzer',
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setBootstrapError(msg)
        addLog(`[联调] 启动失败: ${msg}`)
        console.error('[useBackendBootstrap]', e)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [
    setBackendReady,
    setBootstrapError,
    setActiveTaskId,
    addLog,
    setProject,
    setDuration,
  ])
}
