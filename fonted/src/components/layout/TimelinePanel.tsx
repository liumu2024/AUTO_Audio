import { EditableTimeline } from '@/components/timeline/EditableTimeline'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'
import { useEditorStore, type TimelineMode } from '@/stores/editorStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

const TABS: Array<{ id: TimelineMode; label: string; hint: string }> = [
  {
    id: 'sample',
    label: '样例解析',
    hint: '查看样例的镜头切分、文字线索和节奏依据',
  },
  {
    id: 'generation',
    label: '方案编辑',
    hint: '按画面 / 文字 / 转场 / 音频查看并调整当前方案',
  },
]

export function TimelinePanel() {
  const mode = useEditorStore((s) => s.timelineMode)
  const setMode = useEditorStore((s) => s.setTimelineMode)
  const hasV2Sample = useV2TimelineStore((s) => Boolean(s.sampleSession))
  const hasSampleAnalysis = hasV2Sample
  const tabs = TABS.filter((tab) => tab.id !== 'sample' || hasSampleAnalysis)
  const current = tabs.find((tab) => tab.id === mode) ?? TABS[1]!

  useEffect(() => {
    if (!hasSampleAnalysis && mode === 'sample') {
      setMode('generation')
    }
  }, [hasSampleAnalysis, mode, setMode])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-t border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {tabs.map((tab) => {
            const disabled = false
            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(tab.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                  mode === tab.id
                    ? 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-500/30'
                    : disabled
                      ? 'cursor-not-allowed text-zinc-700'
                      : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
                )}
                title={
                  disabled
                    ? '请先在对话中生成 V2 Timeline 方案'
                    : tab.hint
                }
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <span className="text-[10px] text-zinc-600">{current.hint}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditableTimeline mode={mode} />
      </div>
    </section>
  )
}
