import { SlidersHorizontal } from 'lucide-react'

import { v2SampleShotIdFromClipId } from '@/lib/v2-sample-ui'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

function Detail({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null
  return <section><p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p><div className="space-y-1 text-xs leading-relaxed text-zinc-300">{values.map((value) => <p key={value}>{value}</p>)}</div></section>
}

function overlaps(startSec: number, endSec: number, range: { start_sec: number; end_sec: number }) {
  return range.start_sec < endSec && range.end_sec > startSec
}

/** Read-only V2 sample evidence. Shot selection never controls future plan structure. */
export function V2SamplePropertyInspector() {
  const session = useV2TimelineStore((state) => state.sampleSession)
  const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
  const shotId = v2SampleShotIdFromClipId(selectedClipId)
  const shot = session?.understanding.shot_evidence.find((item) => item.id === shotId)
  const content = shot && session
    ? session.understanding.content_observations.filter((item) => item.evidence_ranges.some((range) => overlaps(shot.start_sec, shot.end_sec, range)))
    : []
  const methods = shot && session
    ? session.understanding.method_observations.filter((item) => item.evidence_ranges.some((range) => overlaps(shot.start_sec, shot.end_sec, range)))
    : []

  return <aside className="flex h-full min-h-0 w-full flex-col border-l border-zinc-800 bg-zinc-950 shadow-[-12px_0_32px_-12px_rgba(0,0,0,0.45)]"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-5 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-violet-300" /><div><h2 className="text-sm font-semibold text-zinc-100">样例解析详情</h2><p className="mt-0.5 text-[10px] text-zinc-500">内容证据与可迁移方法分开显示</p></div></div>{!session ? <p className="text-xs text-zinc-500">尚未解析样例视频。</p> : !shot ? <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-400"><p>{session.understanding.summary}</p><Detail label="可迁移创作知识" values={session.understanding.transferable_knowledge.map((item) => `${item.statement}（适用：${item.applicability}）`)} /></div> : <div className="space-y-4"><section className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-3"><p className="text-sm font-semibold text-violet-100">{shot.description || shot.boundary}</p><p className="mt-1 font-mono text-[10px] text-violet-200/70">{shot.start_sec.toFixed(2)}s – {shot.end_sec.toFixed(2)}s</p></section><Detail label="画面中发生了什么" values={content.map((item) => item.statement)} /><Detail label="如何表现、为何此时表现" values={methods.map((item) => `${item.expression}；目的：${item.purpose}；时机：${item.timing_rationale}`)} /><Detail label="可迁移创作知识" values={session.understanding.transferable_knowledge.filter((item) => item.evidence_method_ids.some((id) => methods.some((method) => method.id === id))).map((item) => `${item.statement}（适用：${item.applicability}）`)} /></div>}</div></aside>
}
