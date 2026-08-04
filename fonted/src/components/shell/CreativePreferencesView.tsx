import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  createCreativeMemory,
  deleteCreativeMemory,
  listCreativeMemories,
  searchCreativeMemories,
  updateCreativeMemory,
  type CreativeMemoryDto,
  type CreativeMemorySearchResult,
} from '@/lib/api'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

type ScopeFilter = 'all' | CreativeMemoryDto['scopeType']
type StatusFilter = 'all' | CreativeMemoryDto['status']

export function CreativePreferencesView() {
  const draftId = useV2TimelineStore((state) => state.draftId)
  const [memories, setMemories] = useState<CreativeMemoryDto[]>([])
  const [createScope, setCreateScope] = useState<CreativeMemoryDto['scopeType']>('user')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [statement, setStatement] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<CreativeMemorySearchResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const result = await listCreativeMemories({
        draftId: draftId ?? undefined,
        scopeType: scope === 'all' ? undefined : scope,
        status: status === 'all' ? undefined : status,
      })
      setMemories(result.memories)
      setSearchResult(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [draftId, scope, status])

  useEffect(() => { void refresh() }, [refresh])

  const mutate = async (work: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await work()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const runSearch = async () => {
    const query = searchQuery.trim()
    if (!query) return
    setSaving(true)
    try {
      setError('')
      const result = await searchCreativeMemories({
        draftId: draftId ?? undefined,
        query,
      })
      setSearchResult(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const displayItems = searchResult
    ? [
        ...searchResult.active.map((item) => ({ memory: item.memory, score: item.score, matchedTerms: item.matchedTerms })),
        ...searchResult.candidate.map((item) => ({ memory: item.memory, score: item.score, matchedTerms: item.matchedTerms })),
      ]
    : memories.map((memory) => ({ memory, score: undefined, matchedTerms: [] as string[] }))

  return (
    <section className="h-full overflow-y-auto bg-zinc-950 px-8 py-7 text-zinc-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-400">Creative memory</p>
          <h1 className="mt-2 text-2xl font-semibold">创作偏好</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            查看 Agent 从以往创作中沉淀的偏好。当前输入和当前草稿要求始终拥有更高优先级。
          </p>
        </header>

        <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 md:grid-cols-[160px_1fr_auto]">
          <select
            aria-label="新增偏好作用域"
            value={createScope === 'draft' && draftId ? 'draft' : 'user'}
            onChange={(event) => setCreateScope(event.target.value as CreativeMemoryDto['scopeType'])}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
          >
            <option value="user">通用偏好</option>
            <option value="draft" disabled={!draftId}>当前草稿</option>
          </select>
          <input
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            placeholder="手动补充一条明确的创作偏好"
            maxLength={500}
            className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-violet-500"
          />
          <Button
            size="sm"
            disabled={saving || !statement.trim() || (createScope === 'draft' && !draftId)}
            onClick={() => void mutate(async () => {
              await createCreativeMemory({
                scopeType: createScope,
                draftId: createScope === 'draft' ? draftId ?? undefined : undefined,
                statement,
              })
              setStatement('')
            })}
          >
            添加
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            aria-label="偏好作用域筛选"
            value={scope}
            onChange={(event) => setScope(event.target.value as ScopeFilter)}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm"
          >
            <option value="all">全部作用域</option>
            <option value="user">通用偏好</option>
            <option value="draft" disabled={!draftId}>当前草稿</option>
          </select>
          <select
            aria-label="偏好状态筛选"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="active">已生效</option>
            <option value="candidate">待观察</option>
            <option value="revoked">已撤销</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }}
            placeholder="搜索创作偏好（按命中词召回）"
            className="h-9 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm outline-none focus:border-violet-500"
          />
          <Button size="sm" disabled={saving || !searchQuery.trim()} onClick={() => void runSearch()}>搜索</Button>
          {searchResult && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void refresh()}>返回全部</Button>
          )}
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}

        <div className="space-y-3">
          {displayItems.map(({ memory, score, matchedTerms }) => (
            <article key={memory.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded bg-zinc-800 px-2 py-1">{memory.scopeType === 'user' ? '通用' : '当前草稿'}</span>
                    <span className="rounded bg-zinc-800 px-2 py-1">{memory.status === 'active' ? '已生效' : memory.status === 'candidate' ? '待观察' : '已撤销'}</span>
                    <span className="rounded bg-zinc-800 px-2 py-1">{memory.origin === 'explicit' ? '用户明确' : 'Agent 推断'}</span>
                  </div>
                  <p className="break-words text-sm leading-6">{memory.statement}</p>
                  {matchedTerms.length > 0 && score !== undefined && (
                    <p className="mt-2 text-xs text-violet-300">
                      命中：{matchedTerms.join('、')}（分数 {score.toFixed(3)}）
                    </p>
                  )}
                  {memory.sourceExcerpt && <p className="mt-2 text-xs text-zinc-500">来源：{memory.sourceExcerpt}</p>}
                  <p className="mt-2 text-xs text-zinc-600">更新于 {new Date(memory.updatedAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {memory.status === 'candidate' && (
                    <Button size="sm" variant="secondary" disabled={saving} onClick={() => void mutate(() => updateCreativeMemory({ id: memory.id, status: 'active' }))}>采纳</Button>
                  )}
                  {memory.status === 'active' && (
                    <Button size="sm" variant="secondary" disabled={saving} onClick={() => void mutate(() => updateCreativeMemory({ id: memory.id, status: 'revoked' }))}>撤销</Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      const next = window.prompt('修改创作偏好', memory.statement)?.trim()
                      if (next && next !== memory.statement) void mutate(() => updateCreativeMemory({ id: memory.id, statement: next }))
                    }}
                  >编辑</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      if (window.confirm('永久删除这条创作偏好？')) void mutate(() => deleteCreativeMemory(memory.id))
                    }}
                  >删除</Button>
                </div>
              </div>
            </article>
          ))}
          {!displayItems.length && !error && (
            <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">当前筛选下还没有创作偏好。</p>
          )}
        </div>
      </div>
    </section>
  )
}
