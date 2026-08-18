import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  createCreativeKnowledge,
  deleteCreativeKnowledge,
  listCreativeKnowledge,
  searchCreativeKnowledge,
  updateCreativeKnowledge,
  type CreativeKnowledgeDto,
  type CreativeKnowledgeSearchResult,
} from '@/lib/api'

type StatusFilter = 'all' | CreativeKnowledgeDto['status']

export function CreativeKnowledgePanel() {
  const [status, setStatus] = useState<StatusFilter>('active')
  const [records, setRecords] = useState<CreativeKnowledgeDto[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [statement, setStatement] = useState('')
  const [applicability, setApplicability] = useState('')
  const [adminTokenInput, setAdminTokenInput] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [editing, setEditing] = useState<CreativeKnowledgeDto | null>(null)
  const [search, setSearch] = useState<CreativeKnowledgeSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const page = await listCreativeKnowledge({
        status: status === 'all' ? undefined : status,
        offset,
        limit: 50,
        adminToken: adminToken.trim() || undefined,
      })
      setRecords(page.knowledge)
      setTotal(page.total)
      setSearch(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [adminToken, offset, status])

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
      setSearch(await searchCreativeKnowledge(query.trim(), {
        status: status === 'all' ? undefined : status,
        adminToken: adminToken || undefined,
      }))
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
        <select value={status} onChange={(event) => {
          setStatus(event.target.value as StatusFilter)
          setOffset(0)
        }} className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm">
          {adminToken && <option value="all">全部状态</option>}
          <option value="active">已采纳</option>
          <option value="candidate">{adminToken ? '全部待审核' : '我提交的待审核'}</option>
          {adminToken && <option value="revoked">已撤销</option>}
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索通用创作方法" className="h-9 min-w-64 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm" />
        <Button size="sm" disabled={busy || !query.trim()} onClick={() => void runSearch()}>搜索</Button>
        {search && <Button size="sm" variant="ghost" onClick={() => void refresh()}>返回全部</Button>}
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <label className="text-xs text-zinc-400" htmlFor="creative-knowledge-admin-token">
          管理员凭证仅保存在当前页面内存中；未填写时只能查看已采纳方法并管理自己提交的候选。
        </label>
        <input
          id="creative-knowledge-admin-token"
          type="password"
          value={adminTokenInput}
          onChange={(event) => setAdminTokenInput(event.target.value)}
          placeholder="需要审核、撤销或管理全局知识时填写"
          className="mt-2 h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
        />
        <div className="mt-2 flex justify-end gap-2">
          {adminToken && <Button size="sm" variant="ghost" onClick={() => {
            setAdminToken('')
            setAdminTokenInput('')
            setStatus('active')
            setOffset(0)
          }}>退出管理</Button>}
          <Button size="sm" disabled={!adminTokenInput.trim() || adminTokenInput.trim() === adminToken} onClick={() => {
            setAdminToken(adminTokenInput.trim())
            setOffset(0)
          }}>进入管理</Button>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-2">
        <input value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="新增一条可迁移创作方法" maxLength={500} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        <input value={applicability} onChange={(event) => setApplicability(event.target.value)} placeholder="适用条件" maxLength={500} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        <p className="text-xs text-zinc-500 md:col-span-1">手动新增的方法先进入待审核状态，采纳后才参与正式规划。</p>
        <Button
          size="sm"
          disabled={busy || !statement.trim() || !applicability.trim()}
          onClick={() => void mutate(async () => {
            await createCreativeKnowledge({ statement: statement.trim(), applicability: applicability.trim() })
            setStatement('')
            setApplicability('')
            setStatus('candidate')
            setOffset(0)
          })}
        >新增待审核方法</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="space-y-3">
        {visible.map((knowledge) => <article key={knowledge.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-3"><div>
            <div className="mb-2 flex gap-2 text-[11px]"><span className="rounded bg-zinc-800 px-2 py-1">{knowledge.status === 'active' ? '已采纳' : knowledge.status === 'candidate' ? '待审核' : '已撤销'}</span></div>
            <p className="text-sm leading-6">{knowledge.statement}</p>
            <p className="mt-1 text-xs text-zinc-400">适用：{knowledge.applicability}</p>
            <p className="mt-2 text-xs text-zinc-600">来源：{knowledge.sources.map((source) => source.type === 'sample'
              ? source.sampleName ?? source.taskId
              : source.type === 'catalog' || source.type === 'manual'
                ? source.sourceTitle
                : source.type === 'review'
                  ? `审核记录 ${source.reviewerId}`
                  : '管理端修改，待重新审核').join('、')}</p>
          </div><div className="flex gap-2">
            {adminToken && knowledge.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(() => updateCreativeKnowledge({ id: knowledge.id, status: 'active', adminToken }))}>采纳</Button>}
            {adminToken && knowledge.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(() => updateCreativeKnowledge({ id: knowledge.id, status: 'revoked', adminToken }))}>撤销</Button>}
            {(adminToken || knowledge.status === 'candidate') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(knowledge)}>编辑</Button>}
            {(adminToken || knowledge.status === 'candidate') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm('永久删除这条通用创作方法？')) void mutate(() => deleteCreativeKnowledge({ id: knowledge.id, adminToken: adminToken || undefined })) }}>删除</Button>}
          </div></div>
        </article>)}
        {!visible.length && !error && <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">暂无通用创作方法。</p>}
      </div>
      {!search && total > 50 && <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>共 {total} 条，第 {offset + 1}–{Math.min(offset + records.length, total)} 条</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</Button>
          <Button size="sm" variant="ghost" disabled={busy || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>下一页</Button>
        </div>
      </div>}
      {editing && <div className="space-y-3 rounded-xl border border-cyan-900 bg-zinc-900 p-4">
        <input value={editing.statement} onChange={(event) => setEditing({ ...editing, statement: event.target.value })} maxLength={500} className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        <input value={editing.applicability} onChange={(event) => setEditing({ ...editing, applicability: event.target.value })} maxLength={500} className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
          <Button size="sm" disabled={busy || !editing.statement.trim() || !editing.applicability.trim()} onClick={() => void mutate(async () => {
            await updateCreativeKnowledge({
              id: editing.id,
              statement: editing.statement.trim(),
              applicability: editing.applicability.trim(),
              adminToken: adminToken || undefined,
            })
            setEditing(null)
          })}>保存</Button>
        </div>
      </div>}
    </section>
  )
}
