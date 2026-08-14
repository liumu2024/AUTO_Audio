import { create } from 'zustand'

import { saveTaskId } from '@/lib/session'

export interface TaskLogEntry {
  id: string
  message: string
  timestamp: number
}

interface TaskState {
  isConnected: boolean
  isTaskRunning: boolean
  isCancelling: boolean
  isTaskPanelVisible: boolean
  copilotLoading: boolean
  activeTaskId: string | null
  backendReady: boolean
  bootstrapError: string | null
  progress: number
  stage: string
  logs: TaskLogEntry[]
  lastPrompt: string | null
  isComplete: boolean
  isFailed: boolean

  setConnected: (connected: boolean) => void
  setCopilotLoading: (loading: boolean) => void
  setCancelling: (cancelling: boolean) => void
  setActiveTaskId: (taskId: string | null) => void
  setBackendReady: (ready: boolean) => void
  setBootstrapError: (message: string | null) => void
  startTask: (prompt: string, taskId?: string) => string
  setProgress: (progress: number) => void
  setStage: (stage: string) => void
  addLog: (message: string) => void
  updateProgress: (progress: number, stage: string, log?: string) => void
  setComplete: (complete?: boolean) => void
  setCancelled: () => void
  setFailed: (message?: string) => void
  completeTask: () => void
  dismissTaskPanel: () => void
  resetTask: () => void
}

let logCounter = 0

function appendLog(message: string): TaskLogEntry {
  logCounter += 1
  return {
    id: `log-${logCounter}`,
    message,
    timestamp: Date.now(),
  }
}

export const useTaskStore = create<TaskState>((set, get) => ({
  isConnected: false,
  isTaskRunning: false,
  isCancelling: false,
  isTaskPanelVisible: false,
  copilotLoading: false,
  activeTaskId: null,
  backendReady: false,
  bootstrapError: null,
  progress: 0,
  stage: '',
  logs: [],
  lastPrompt: null,
  isComplete: false,
  isFailed: false,

  setConnected: (isConnected) => set({ isConnected }),

  setCopilotLoading: (copilotLoading) => set({ copilotLoading }),

  setCancelling: (isCancelling) => set({ isCancelling }),

  setActiveTaskId: (activeTaskId) => {
    saveTaskId(activeTaskId)
    set({ activeTaskId })
  },

  setBackendReady: (backendReady) => set({ backendReady }),

  setBootstrapError: (bootstrapError) => set({ bootstrapError }),

  startTask: (prompt, taskId) => {
    const id = taskId ?? `task_${Date.now()}`
    set({
      activeTaskId: id,
      isTaskRunning: true,
      isCancelling: false,
      isTaskPanelVisible: true,
      copilotLoading: false,
      isComplete: false,
      isFailed: false,
      progress: 0,
      stage: '任务已提交，等待调度...',
      logs: [appendLog(`[Director] 收到指令: "${prompt}"`)],
      lastPrompt: prompt,
    })
    return id
  },

  setProgress: (progress) => set({ progress }),

  setStage: (stage) => set({ stage }),

  addLog: (message) =>
    set((state) => ({
      isTaskPanelVisible: true,
      logs: [...state.logs, appendLog(message)],
    })),

  updateProgress: (progress, stage, log) =>
    set((state) => ({
      isTaskPanelVisible: true,
      progress,
      stage,
      logs: log ? [...state.logs, appendLog(log)] : state.logs,
    })),

  setComplete: (complete = true) =>
    set({
      isComplete: complete,
      isFailed: false,
      isTaskRunning: !complete,
      isCancelling: false,
      isTaskPanelVisible: true,
      copilotLoading: false,
      progress: complete ? 100 : get().progress,
      stage: complete ? '完成' : get().stage,
    }),

  setCancelled: () =>
    set((state) => ({
      isTaskRunning: false,
      isCancelling: false,
      isTaskPanelVisible: true,
      copilotLoading: false,
      isComplete: false,
      isFailed: false,
      progress: 100,
      stage: '已中止',
      logs: [...state.logs, appendLog('[Task] 用户已中止任务。')],
    })),

  setFailed: (message = '任务没有完成，请根据提示重试。') =>
    set((state) => ({
      isTaskRunning: false,
      isCancelling: false,
      isTaskPanelVisible: true,
      copilotLoading: false,
      isComplete: false,
      isFailed: true,
      progress: 100,
      stage: '失败',
      logs: [...state.logs, appendLog(`[Task] ${message}`)],
    })),

  completeTask: () =>
    set({
      isTaskRunning: false,
      isCancelling: false,
      isTaskPanelVisible: true,
      copilotLoading: false,
      isComplete: true,
      isFailed: false,
      progress: 100,
      stage: '渲染完成',
    }),

  dismissTaskPanel: () =>
    set({
      isTaskPanelVisible: false,
    }),

  resetTask: () =>
    set({
      isTaskRunning: false,
      isCancelling: false,
      isTaskPanelVisible: false,
      copilotLoading: false,
      activeTaskId: null,
      progress: 0,
      stage: '',
      logs: [],
      isComplete: false,
      isFailed: false,
    }),
}))
