import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Radio,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import * as api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useTaskStore } from '@/stores/taskStore'

export function ProgressOverlay() {
  const isTaskRunning = useTaskStore((s) => s.isTaskRunning)
  const isCancelling = useTaskStore((s) => s.isCancelling)
  const isTaskPanelVisible = useTaskStore((s) => s.isTaskPanelVisible)
  const isComplete = useTaskStore((s) => s.isComplete)
  const isFailed = useTaskStore((s) => s.isFailed)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const progress = useTaskStore((s) => s.progress)
  const stage = useTaskStore((s) => s.stage)
  const logs = useTaskStore((s) => s.logs)
  const lastPrompt = useTaskStore((s) => s.lastPrompt)
  const setCancelling = useTaskStore((s) => s.setCancelling)
  const setCancelled = useTaskStore((s) => s.setCancelled)
  const dismissTaskPanel = useTaskStore((s) => s.dismissTaskPanel)
  const addLog = useTaskStore((s) => s.addLog)
  const [expanded, setExpanded] = useState(true)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [expanded, logs.length])

  if (!isTaskPanelVisible) return null

  const isTerminal = !isTaskRunning && !isCancelling

  const handleCancel = async () => {
    if (!activeTaskId || isCancelling || isTerminal) return
    setCancelling(true)
    addLog('[Task] 正在请求中止任务...')
    try {
      await api.cancelTask(activeTaskId)
      setCancelled()
    } catch (error) {
      setCancelling(false)
      addLog(
        `[Task] 中止失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const StatusIcon = isFailed
    ? AlertCircle
    : isComplete
      ? CheckCircle2
      : Loader2

  return (
    <section
      className="pointer-events-none fixed bottom-5 right-5 z-[100] w-[420px] max-w-[calc(100vw-2.5rem)]"
      aria-label="后台任务中心"
    >
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8),0_0_80px_-40px_rgba(139,92,246,0.4)] backdrop-blur-md">
        <div className="border-b border-zinc-800/80 px-4 py-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1',
                isFailed
                  ? 'bg-red-500/15 ring-red-500/30'
                  : isComplete
                    ? 'bg-emerald-500/15 ring-emerald-500/30'
                    : 'bg-violet-500/15 ring-violet-500/30',
              )}
            >
              <StatusIcon
                className={cn(
                  'h-4 w-4',
                  !isTerminal && 'animate-spin',
                  isFailed
                    ? 'text-red-400'
                    : isComplete
                      ? 'text-emerald-400'
                      : 'text-violet-400',
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-zinc-50">
                  AI 后台任务
                </h2>
                {!isTerminal ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5">
                    <Radio className="h-2.5 w-2.5 animate-pulse text-emerald-400" />
                    <span className="font-mono text-[9px] text-emerald-400">
                      LIVE
                    </span>
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  'mt-0.5 truncate text-xs',
                  isFailed
                    ? 'text-red-300'
                    : isComplete
                      ? 'text-emerald-300'
                      : 'text-violet-300/90',
                )}
              >
                {isCancelling ? '正在中止...' : stage || '准备中...'}
              </p>
              {lastPrompt ? (
                <p className="mt-1 line-clamp-1 text-[11px] text-zinc-500">
                  {lastPrompt}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? '收起任务详情' : '展开任务详情'}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
            {isTerminal ? (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
                onClick={dismissTaskPanel}
                aria-label="关闭任务中心"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-3">
            <div className="mb-1 flex justify-between font-mono text-[10px] text-zinc-500">
              <span>进度</span>
              <span className="text-violet-300">{Math.round(progress)}%</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
                  isFailed
                    ? 'bg-red-500'
                    : isCancelling
                      ? 'bg-zinc-500'
                      : isComplete
                        ? 'bg-emerald-500'
                        : 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-400',
                )}
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          </div>
        </div>

        {expanded ? (
          <div className="flex max-h-64 flex-col bg-zinc-900/50">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/50 px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                实时日志 · task:progress
              </span>
              {!isTerminal ? (
                <button
                  type="button"
                  disabled={!activeTaskId || isCancelling}
                  onClick={() => void handleCancel()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {isCancelling ? '中止中' : '中止'}
                </button>
              ) : null}
            </div>
            <div className="min-h-[96px] flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
              {logs.map((entry) => (
                <div key={entry.id} className="flex gap-2 py-0.5 text-zinc-400">
                  <span className="shrink-0 tabular-nums text-zinc-600">
                    {formatLogTime(entry.timestamp)}
                  </span>
                  <span className="text-zinc-300">{entry.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function formatLogTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
