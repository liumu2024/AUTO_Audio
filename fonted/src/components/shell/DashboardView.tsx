import { Eye, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { env } from '@/config/env'
import * as api from '@/lib/api'
import type { TaskListItemDto } from '@/lib/api'
import { cn } from '@/lib/utils'
import { restoreTaskContext } from '@/services/pipeline/restoreTask'
import { useAppShellStore } from '@/stores/appShellStore'
import { useTaskStore } from '@/stores/taskStore'

const STATUS_LABEL: Record<string, string> = {
  QUEUED: '排队中',
  ANALYZING: '解析中',
  WAITING_USER_EDIT: '待编辑',
  GENERATING: '生成中',
  COMPLETED: '已完成',
  FAILED: '失败',
}

function statusTone(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
    case 'FAILED':
      return 'bg-red-500/15 text-red-400 ring-red-500/30'
    case 'GENERATING':
    case 'ANALYZING':
      return 'bg-violet-500/15 text-violet-300 ring-violet-500/30'
    default:
      return 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30'
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DashboardView() {
  const [tasks, setTasks] = useState<TaskListItemDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<TaskListItemDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TaskListItemDto | null>(null)
  const setActiveView = useAppShellStore((s) => s.setActiveView)
  const addLog = useTaskStore((s) => s.addLog)

  const loadTasks = useCallback(async () => {
    if (!env.useBackend) {
      setError('请开启 VITE_USE_BACKEND=true')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { tasks: list } = await api.listTasks()
      setTasks(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const openTask = async (task: TaskListItemDto) => {
    if (!task.hasStructure) {
      addLog(`[工作台] 任务 ${task.id} 暂无解析结果`)
      setActiveView('editor')
      return
    }
    setOpeningId(task.id)
    const ok = await restoreTaskContext(task.id)
    setOpeningId(null)
    if (ok) setActiveView('editor')
  }

  const deleteTask = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    if (viewing?.id === id) setViewing(null)
    setTasks((items) => items.filter((task) => task.id !== id))
    try {
      await api.deleteTask(id)
      addLog(`[工作台] 已删除任务 ${id}`)
    } catch (e) {
      addLog(`[工作台] 删除失败: ${e instanceof Error ? e.message : String(e)}`)
      void loadTasks()
    }
  }

  return (
    <div className="scroll-area-y flex h-full min-h-0 flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-8 py-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">历史工作台</h1>
          <p className="mt-1 text-sm text-zinc-500">
            查看历史解析/生成任务，可打开继续编辑，也可以删除无用任务。
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadTasks()}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </header>

      <div className="flex-1 px-8 py-6">
        {loading && <p className="text-sm text-zinc-500">加载任务列表...</p>}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => void loadTasks()}>
              重试
            </button>
          </div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-16 text-center">
            <p className="text-sm text-zinc-400">暂无历史任务</p>
            <p className="mt-2 text-xs text-zinc-600">
              去“创作”上传样例并完成解析后，任务会出现在这里。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tasks.map((task) => (
            <article
              key={task.id}
              className={cn(
                'group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 text-left transition-all',
                'hover:border-violet-500/40 hover:bg-zinc-900 hover:shadow-lg hover:shadow-violet-950/20',
                openingId === task.id && 'opacity-60',
              )}
            >
              <button
                type="button"
                className="relative aspect-video w-full overflow-hidden bg-zinc-950"
                onClick={() => setViewing(task)}
              >
                {task.previewUrl ? (
                  <video
                    src={task.previewUrl}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-3xl opacity-40">
                    AI
                  </div>
                )}
                <span
                  className={cn(
                    'absolute right-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                    statusTone(task.taskStatus),
                  )}
                >
                  {STATUS_LABEL[task.taskStatus] ?? task.taskStatus}
                </span>
              </button>

              <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-200">
                    {task.title}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">
                    {task.id}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {formatDate(task.createdAt)}
                  </p>
                </div>

                <div className="mt-auto grid grid-cols-3 gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(task)}>
                    <Eye className="h-3.5 w-3.5" />
                    查看
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={openingId === task.id}
                    onClick={() => void openTask(task)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    打开
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => setDeleteTarget(task)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg bg-black">
                {viewing.previewUrl ? (
                  <video src={viewing.previewUrl} className="aspect-video w-full" controls />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-zinc-600">
                    暂无预览
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
                <div>
                  <dt className="text-zinc-600">状态</dt>
                  <dd>{STATUS_LABEL[viewing.taskStatus] ?? viewing.taskStatus}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">创建时间</dt>
                  <dd>{formatDate(viewing.createdAt)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-zinc-600">任务 ID</dt>
                  <dd className="break-all font-mono">{viewing.id}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-zinc-600">样例视频</dt>
                  <dd className="break-all font-mono">{viewing.sampleVideoUrl}</dd>
                </div>
                {viewing.finalVideoUrl && (
                  <div className="col-span-2">
                    <dt className="text-zinc-600">成片地址</dt>
                    <dd className="break-all font-mono">{viewing.finalVideoUrl}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setViewing(null)}>
              关闭
            </Button>
            {viewing && (
              <Button type="button" variant="primary" onClick={() => void openTask(viewing)}>
                打开编辑
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除任务</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            确定删除「{deleteTarget?.title}」？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="primary" className="bg-red-600 hover:bg-red-500" onClick={() => void deleteTask()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
