import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  deleteCreativeKnowledge,
  listCreativeKnowledge,
  searchCreativeKnowledge,
  updateCreativeKnowledge,
  type CreativeKnowledgeDto,
  type CreativeKnowledgeSearchResult,
} from '@/lib/api'

type StatusFilter = 'all' | CreativeKnowledgeDto['status']

export function CreativeKnowledgePanel() {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [records, setRecords] = useState<CreativeKnowledgeDto[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<CreativeKnowledgeSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setRecords((await listCreativeKnowledge(status === 'all' ? undefined : status)).knowledge)
      setSearch(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [status])

  useEffect(() => { void refresh() }, [refresh])

  const mutate = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const runSearch = async () => {
    if (!query.trim()) return
    setBusy(true)
    try {
      setError('')
      setSearch(await searchCreativeKnowledge(query.trim()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const visible = search?.items.map((item) => item.knowledge) ?? records

  return (
    <section className="mt-10 space-y-4 border-t border-zinc-800 pt-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-400">Creative knowledge</p>
        <h2 className="mt-2 text-xl font-semibold">通用创作方法</h2>
        <p className="mt-2 text-sm text-zinc-400">来自样例证据的方法候选与用户个人偏好分开管理；只有已采纳的方法会参与规划。</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm">
          <option value="all">全部状态</option><option value="active">已采纳</option><option value="candidate">待审核</option><option value="revoked">已撤销</option>
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索通用创作方法" className="h-9 min-w-64 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm" />
        <Button size="sm" disabled={busy || !query.trim()} onClick={() => void runSearch()}>搜索</Button>
        {search && <Button size="sm" variant="ghost" onClick={() => void refresh()}>返回全部</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="space-y-3">
        {visible.map((knowledge) => <article key={knowledge.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-3"><div>
            <div className="mb-2 flex gap-2 text-[11px]"><span className="rounded bg-zinc-800 px-2 py-1">{knowledge.status === 'active' ? '已采纳' : knowledge.status === 'candidate' ? '待审核' : '已撤销'}</span></div>
            <p className="text-sm leading-6">{knowledge.statement}</p>
            <p className="mt-1 text-xs text-zinc-400">适用：{knowledge.applicability}</p>
            <p className="mt-2 text-xs text-zinc-600">来源：{knowledge.sources.map((source) => source.sampleName ?? source.taskId).join('、')}</p>
          </div><div className="flex gap-2">
            {knowledge.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(() => updateCreativeKnowledge({ id: knowledge.id, status: 'active' }))}>采纳</Button>}
            {knowledge.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(() => updateCreativeKnowledge({ id: knowledge.id, status: 'revoked' }))}>撤销</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm('永久删除这条通用创作方法？')) void mutate(() => deleteCreativeKnowledge(knowledge.id)) }}>删除</Button>
          </div></div>
        </article>)}
        {!visible.length && !error && <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">暂无通用创作方法。</p>}
      </div>
    </section>
  )
}
