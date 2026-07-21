import { Loader2, Send, Sparkles } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useTaskStore } from '@/stores/taskStore'

interface AICopilotInputProps {
  onSubmit: (prompt: string) => void | Promise<void>
}

export function AICopilotInput({ onSubmit }: AICopilotInputProps) {
  const [value, setValue] = useState('')
  const copilotLoading = useTaskStore((s) => s.copilotLoading)
  const isTaskRunning = useTaskStore((s) => s.isTaskRunning)
  const isConnected = useTaskStore((s) => s.isConnected)
  const setCopilotLoading = useTaskStore((s) => s.setCopilotLoading)
  const addLog = useTaskStore((s) => s.addLog)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || copilotLoading) return
    if (isTaskRunning) {
      addLog('[Director] 当前已有后台任务，请先在任务中心中止或等待完成。')
      return
    }

    setCopilotLoading(true)
    try {
      await onSubmit(trimmed)
      setValue('')
    } finally {
      if (!useTaskStore.getState().isTaskRunning) {
        setCopilotLoading(false)
      }
    }
  }, [value, copilotLoading, isTaskRunning, onSubmit, setCopilotLoading, addLog])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div
      className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2"
      role="search"
      aria-label="AI 全局指令"
    >
      <div
        className={cn(
          'pointer-events-auto flex w-[600px] items-center gap-3 rounded-xl px-4 py-3',
          'border border-purple-500/50 bg-zinc-900/80 shadow-[0_0_15px_rgba(168,85,247,0.2)]',
          'backdrop-blur-md transition-shadow',
          'focus-within:border-purple-400/70 focus-within:shadow-[0_0_24px_rgba(168,85,247,0.35)]',
          copilotLoading && 'border-purple-400/60',
        )}
      >
        <Sparkles
          className={cn(
            'h-5 w-5 shrink-0 text-purple-400',
            'animate-[sparkle_1.8s_ease-in-out_infinite]',
            copilotLoading && 'text-violet-300',
          )}
          aria-hidden
        />

        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={copilotLoading}
          placeholder="输入全局指令，例如：按样例节奏生成、不要字幕、渲染成片..."
          className="min-w-0 flex-1 bg-transparent text-sm leading-normal text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button
          type="button"
          disabled={!value.trim() || copilotLoading}
          onClick={() => void handleSubmit()}
          aria-label="发送指令"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all',
            'bg-purple-600 text-white hover:bg-purple-500 hover:shadow-[0_0_12px_rgba(168,85,247,0.45)]',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none',
          )}
        >
          {copilotLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>

      {isConnected && (
        <p className="pointer-events-none mt-1.5 text-center font-mono text-[9px] text-emerald-500/70">
          WS 已连接
        </p>
      )}
    </div>
  )
}
