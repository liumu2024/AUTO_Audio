import { EditableTimeline } from '@/components/timeline/EditableTimeline'

export function TimelinePanel() {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-t border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-3 py-1.5">
        <span className="text-[11px] font-medium text-violet-100">方案编辑</span>
        <span className="text-[10px] text-zinc-600">按画面 / 文字 / 转场 / 音频查看并调整当前方案</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditableTimeline />
      </div>
    </section>
  )
}
