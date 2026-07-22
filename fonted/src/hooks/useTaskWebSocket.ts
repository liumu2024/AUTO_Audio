import { useEffect, useRef } from 'react'

import { buildWsUrl, env } from '@/config/env'
import { useTaskStore } from '@/stores/taskStore'

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
    if (!env.useBackend || !taskId || !backendReady || taskId.startsWith('v2_')) return

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

          if (progress >= 100) setComplete(true)
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
}
