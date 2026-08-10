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
import { cn } from '@/lib/utils'
import { useAppShellStore } from '@/stores/appShellStore'
import { useEditorStore } from '@/stores/editorStore'
import { useTaskStore } from '@/stores/taskStore'
import {
  activateV2DraftWorkspace,
  startNewV2DraftWorkspace,
} from '@/services/director/v2DirectorDraftWorkspace'
import { replaceActiveDirectorWorkspaceSession } from '@/services/director/workspaceSessionLifecycle'
import { mapV2TimelineDraftHistoryCard } from '@shared/lib/v2-timeline-draft-history'
import type { V2TimelineDraftHistoryDto } from '@/lib/api'

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  running: '渲染中',
  completed: '已渲染',
  failed: '渲染失败',
}

function statusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
    case 'failed':
      return 'bg-red-500/15 text-red-400 ring-red-500/30'
    case 'running':
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
  const [drafts, setDrafts] = useState<V2TimelineDraftHistoryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<V2TimelineDraftHistoryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<V2TimelineDraftHistoryDto | null>(null)
  const setActiveView = useAppShellStore((s) => s.setActiveView)
  const addLog = useTaskStore((s) => s.addLog)

  const loadDrafts = useCallback(async () => {
    if (!env.useBackend) {
      setError('请开启 VITE_USE_BACKEND=true')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { drafts: list } = await api.listV2TimelineDrafts()
      setDrafts(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDrafts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])

  const openDraft = async (draft: V2TimelineDraftHistoryDto) => {
    setOpeningId(draft.draftId)
    try {
      const { draft: persisted } = await api.getV2TimelineDraft(draft.draftId)
      const card = mapV2TimelineDraftHistoryCard(persisted)
      replaceActiveDirectorWorkspaceSession({
        sessionStorage: window.sessionStorage,
        createId: () => `v2_director_${crypto.randomUUID()}`,
      })
      startNewV2DraftWorkspace()
      activateV2DraftWorkspace(persisted)
      useEditorStore.getState().enterV2Workspace()
      useEditorStore.getState().setProjectName(card.title)
      addLog(`[V2 工作台] 已打开草稿 ${persisted.draftId}，revision ${persisted.revision}。`)
      setActiveView('editor')
    } catch (error) {
      addLog(`[V2 工作台] 打开草稿失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOpeningId(null)
    }
  }

  const deleteDraft = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.draftId
    setDeleteTarget(null)
    if (viewing?.draftId === id) setViewing(null)
    setDrafts((items) => items.filter((draft) => draft.draftId !== id))
    try {
      await api.deleteV2TimelineDraft(id)
      addLog(`[V2 工作台] 已删除草稿 ${id}`)
    } catch (e) {
      addLog(`[V2 工作台] 删除失败: ${e instanceof Error ? e.message : String(e)}`)
      void loadDrafts()
    }
  }

  return (
    <div className="scroll-area-y flex h-full min-h-0 flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-8 py-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">历史工作台</h1>
          <p className="mt-1 text-sm text-zinc-500">
            查看历史 V2 时间线草稿，可打开继续编辑或删除。
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadDrafts()}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </header>

      <div className="flex-1 px-8 py-6">
        {loading && <p className="text-sm text-zinc-500">加载 V2 草稿...</p>}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => void loadDrafts()}>
              重试
            </button>
          </div>
        )}
        {!loading && !error && drafts.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-16 text-center">
            <p className="text-sm text-zinc-400">暂无历史 V2 草稿</p>
            <p className="mt-2 text-xs text-zinc-600">
              去“创作”生成 V2 时间线方案后，草稿会出现在这里。旧项目已下线，不能在此打开。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {drafts.map((draft) => {
            const card = mapV2TimelineDraftHistoryCard(draft)
            return (
            <article
              key={card.id}
              className={cn(
                'group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 text-left transition-all',
                'hover:border-violet-500/40 hover:bg-zinc-900 hover:shadow-lg hover:shadow-violet-950/20',
                openingId === card.id && 'opacity-60',
              )}
            >
              <button
                type="button"
                className="relative aspect-video w-full overflow-hidden bg-zinc-950"
                onClick={() => setViewing(draft)}
              >
                {card.previewUrl ? (
                  <video
                    src={card.previewUrl.startsWith('http') ? card.previewUrl : `${env.apiBase}${card.previewUrl}`}
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
                    statusTone(card.status),
                  )}
                >
                  {STATUS_LABEL[card.status] ?? card.status}
                </span>
              </button>

              <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-200">
                    {card.title}
                  </p>
                  {card.summary ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                      {card.summary}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1 text-[9px] text-zinc-500">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5">{card.modeLabel}</span>
                    {card.aspectRatio ? <span className="rounded bg-zinc-800 px-1.5 py-0.5">{card.aspectRatio}</span> : null}
                    {card.durationSec ? <span className="rounded bg-zinc-800 px-1.5 py-0.5">{card.durationSec}s</span> : null}
                    {card.sceneCount != null ? <span className="rounded bg-zinc-800 px-1.5 py-0.5">{card.sceneCount} 镜头</span> : null}
                    {card.visibleTextCount != null ? <span className="rounded bg-zinc-800 px-1.5 py-0.5">{card.visibleTextCount} 段文字</span> : null}
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">
                    {card.id}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {formatDate(card.updatedAt)}
                  </p>
                </div>

                <div className="mt-auto grid grid-cols-3 gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(draft)}>
                    <Eye className="h-3.5 w-3.5" />
                    查看
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={openingId === card.id}
                    onClick={() => void openDraft(draft)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    打开
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => setDeleteTarget(draft)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            </article>
            )
          })}
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {viewing ? mapV2TimelineDraftHistoryCard(viewing).title : ''}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg bg-black">
                {mapV2TimelineDraftHistoryCard(viewing).previewUrl ? (
                  <video
                    src={
                      mapV2TimelineDraftHistoryCard(viewing).previewUrl!.startsWith('http')
                        ? mapV2TimelineDraftHistoryCard(viewing).previewUrl
                        : `${env.apiBase}${mapV2TimelineDraftHistoryCard(viewing).previewUrl}`
                    }
                    className="aspect-video w-full"
                    controls
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-zinc-600">
                    暂无预览
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
                <div>
                  <dt className="text-zinc-600">状态</dt>
                  <dd>{STATUS_LABEL[mapV2TimelineDraftHistoryCard(viewing).status]}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">创建时间</dt>
                  <dd>{formatDate(viewing.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">画幅 / 时长</dt>
                  <dd>
                    {mapV2TimelineDraftHistoryCard(viewing).aspectRatio ?? '未记录'} /{' '}
                    {mapV2TimelineDraftHistoryCard(viewing).durationSec ?? '未记录'}s
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-600">镜头 / 可见文字</dt>
                  <dd>
                    {mapV2TimelineDraftHistoryCard(viewing).sceneCount ?? 0} /{' '}
                    {mapV2TimelineDraftHistoryCard(viewing).visibleTextCount ?? 0}
                  </dd>
                </div>
                {mapV2TimelineDraftHistoryCard(viewing).summary ? (
                  <div className="col-span-2">
                    <dt className="text-zinc-600">方案摘要</dt>
                    <dd className="mt-1 leading-relaxed text-zinc-300">
                      {mapV2TimelineDraftHistoryCard(viewing).summary}
                    </dd>
                  </div>
                ) : null}
                <div className="col-span-2">
                  <dt className="text-zinc-600">V2 草稿 ID</dt>
                  <dd className="break-all font-mono">{viewing.draftId}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-zinc-600">创建路径 / 当前 revision</dt>
                  <dd className="break-all font-mono">
                    {viewing.creationMode} / {viewing.revision}
                  </dd>
                </div>
                {viewing.latestRun && (
                  <div className="col-span-2">
                    <dt className="text-zinc-600">最近运行</dt>
                    <dd className="break-all font-mono">
                      {viewing.latestRun.status} / revision {viewing.latestRun.sourceRevision}
                    </dd>
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
              <Button type="button" variant="primary" onClick={() => void openDraft(viewing)}>
                打开编辑
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
          <DialogTitle>删除 V2 草稿</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            确定删除「{deleteTarget ? mapV2TimelineDraftHistoryCard(deleteTarget).title : ''}」？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="primary" className="bg-red-600 hover:bg-red-500" onClick={() => void deleteDraft()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
