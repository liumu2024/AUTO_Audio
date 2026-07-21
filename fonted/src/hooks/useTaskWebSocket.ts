import { useCallback, useEffect, useRef } from 'react'

import { buildWsUrl, env } from '@/config/env'
import * as api from '@/lib/api'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'

const GENERATION_POLL_MS = 2000
const GENERATION_POLL_MAX = 90

async function refreshPipelineAfterGeneration(
  taskId: string,
  addLog: (message: string) => void,
): Promise<void> {
  for (let i = 0; i < GENERATION_POLL_MAX; i++) {
    try {
      const task = await api.getTask(taskId)
      addLog(`[Generation] Task status: ${task.taskStatus}`)

      if (task.taskStatus === 'COMPLETED' && task.finalVideoUrl) {
        const bundle = await api.getTaskPipeline(taskId)
        usePipelineStore.getState().hydrate(bundle)
        addLog(`[Generation] Final video ready: ${task.finalVideoUrl}`)
        return
      }

      if (task.taskStatus === 'FAILED') {
        useTaskStore
          .getState()
          .setFailed('[Generation] Task failed. Check generator.worker logs.')
        return
      }

      if (task.taskStatus === 'CANCELLED' || task.taskStatus === 'CANCELLING') {
        useTaskStore.getState().setCancelled()
        addLog('[Generation] Task cancelled.')
        return
      }
    } catch (e) {
      addLog(
        `[Generation] Pipeline refresh failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
      return
    }

    await new Promise((r) => setTimeout(r, GENERATION_POLL_MS))
  }

  addLog('[Generation] Timed out waiting for finalVideoUrl.')
}

const MOCK_STAGES = [
  { p: 10, stage: 'Parsing prompt', log: 'Extracting creative intent...' },
  { p: 30, stage: 'Matching anchors', log: 'Rebuilding Hook and CTA scenes...' },
  { p: 60, stage: 'Filling gaps', log: 'Generating missing visual sections...' },
  { p: 90, stage: 'Rendering', log: 'Compositing timeline...' },
  { p: 100, stage: 'Completed', log: 'Video generation completed.' },
] as const

export function useTaskWebSocket() {
  const taskId = useTaskStore((s) => s.activeTaskId)
  const backendReady = useTaskStore((s) => s.backendReady)
  const setConnected = useTaskStore((s) => s.setConnected)
  const setProgress = useTaskStore((s) => s.setProgress)
  const setStage = useTaskStore((s) => s.setStage)
  const addLog = useTaskStore((s) => s.addLog)
  const updateProgress = useTaskStore((s) => s.updateProgress)
  const setComplete = useTaskStore((s) => s.setComplete)
  const setFailed = useTaskStore((s) => s.setFailed)
  const setCopilotLoading = useTaskStore((s) => s.setCopilotLoading)
  const startTask = useTaskStore((s) => s.startTask)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (env.useBackend) return
    setConnected(true)
    console.info('[useTaskWebSocket] mock mode')
    return () => setConnected(false)
  }, [setConnected])

  useEffect(() => {
    if (env.useBackend || !taskId) return

    let currentProgress = 0
    addLog(`[Mock] Task ${taskId}`)

    const interval = setInterval(() => {
      currentProgress += 5
      const currentStage = MOCK_STAGES.find(
        (s) => currentProgress >= s.p && currentProgress < s.p + 10,
      )
      if (currentStage) {
        setStage(currentStage.stage)
        addLog(currentStage.log)
      }
      setProgress(currentProgress)
      if (currentProgress >= 100) {
        clearInterval(interval)
        setComplete(true)
      }
    }, 500)

    return () => clearInterval(interval)
  }, [taskId, addLog, setProgress, setStage, setComplete])

  useEffect(() => {
    if (!env.useBackend || !taskId || !backendReady) return

    const url = buildWsUrl(taskId)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog(`WS connected: ${url}`)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          event?: string
          progress?: number
          stage?: string
          log?: string
        }
        if (data.event === 'task:progress') {
          const progress = data.progress ?? 0
          const stage = data.stage ?? ''
          const logLine =
            data.log ?? (stage ? `[${stage}] ${progress}%` : `[Progress] ${progress}%`)
          updateProgress(progress, stage, logLine)

          if (stage === 'Cancelled') {
            useTaskStore.getState().setCancelled()
            return
          }

          if (stage === 'Failed') {
            setFailed(data.log ?? '任务失败，请检查 worker 日志。')
            return
          }

          if (progress >= 100) {
            setComplete(true)
            if (stage !== 'Analysis complete') {
              void refreshPipelineAfterGeneration(taskId, addLog)
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => addLog('WS connection error. Is backend running?')

    return () => {
      ws.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [
    taskId,
    backendReady,
    setConnected,
    updateProgress,
    setComplete,
    setFailed,
    addLog,
  ])

  const submitTask = useCallback(
    async (prompt: string) => {
      if (env.useBackend) {
        if (!backendReady || !taskId) {
          addLog('Backend is not ready. Check PostgreSQL, Redis, and workers.')
          return
        }
        setCopilotLoading(true)
        try {
          const renderPlan = useRenderPlanStore.getState().plan
          const shouldSubmitLocalPlan = useRenderPlanStore.getState().isDirty
          addLog(
            shouldSubmitLocalPlan && renderPlan
              ? `[Copilot] Submit generation prompt length=${prompt.length}; RenderPlan revision=${renderPlan.plan_revision ?? 1}`
              : `[Copilot] Submit generation prompt length=${prompt.length}; reuse persisted backend RenderPlan`,
          )
          await api.submitCopilotTask(
            taskId,
            prompt,
            shouldSubmitLocalPlan ? renderPlan ?? undefined : undefined,
          )
          if (shouldSubmitLocalPlan && renderPlan) {
            useRenderPlanStore.getState().markSaved()
          }
          addLog('[Copilot] Queued generator.worker.')
          startTask(prompt, taskId)
        } catch (e) {
          addLog(`Submit failed: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
          setCopilotLoading(false)
        }
        return
      }

      setCopilotLoading(true)
      await new Promise((r) => setTimeout(r, 200))
      startTask(prompt)
      setCopilotLoading(false)
    },
    [backendReady, taskId, setCopilotLoading, startTask, addLog],
  )

  return { submitTask }
}
