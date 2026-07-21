import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/stores/timelineStore'

export function TimelinePropertiesPanel() {
  const selectedClipId = useTimelineStore((s) => s.selectedClipId)
  const project = useTimelineStore((s) => s.project)
  const selectClip = useTimelineStore((s) => s.selectClip)
  const updateClipField = useTimelineStore((s) => s.updateClipField)

  const clip = project.clips.find((c) => c.id === selectedClipId)

  if (!clip) return null

  const showVisualPrompt =
    clip.track_id === 'video' || clip.visual_generation_prompt != null

  return (
    <aside
      className={cn(
        'flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.5)]',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-zinc-200">
            片段属性
          </h3>
          <p className="truncate text-[10px] text-zinc-500">{clip.label}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => selectClip(null)}
          aria-label="关闭属性面板"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
            <dt className="text-zinc-500">轨道</dt>
            <dd className="font-medium text-zinc-300">{clip.track_id}</dd>
            <dt className="text-zinc-500">入点</dt>
            <dd className="font-mono text-zinc-300">{clip.start_sec.toFixed(1)}s</dd>
            <dt className="text-zinc-500">出点</dt>
            <dd className="font-mono text-zinc-300">{clip.end_sec.toFixed(1)}s</dd>
            {clip.anchor_id && (
              <>
                <dt className="text-zinc-500">锚点</dt>
                <dd className="truncate font-mono text-zinc-400">
                  {clip.anchor_id}
                </dd>
              </>
            )}
          </dl>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">
            content_rewrite_instruction
            <span className="ml-1 font-normal text-zinc-600">（文案）</span>
          </span>
          <textarea
            className="min-h-[88px] w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            value={clip.content_rewrite_instruction ?? ''}
            placeholder="输入改写指令或花字文案…"
            onChange={(e) =>
              updateClipField(
                clip.id,
                'content_rewrite_instruction',
                e.target.value,
              )
            }
          />
        </label>

        {showVisualPrompt && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">
              visual_generation_prompt
              <span className="ml-1 font-normal text-zinc-600">（提示词）</span>
            </span>
            <textarea
              className="min-h-[88px] w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              value={clip.visual_generation_prompt ?? ''}
              placeholder="文生视频 / 画面生成提示词…"
              onChange={(e) =>
                updateClipField(
                  clip.id,
                  'visual_generation_prompt',
                  e.target.value,
                )
              }
            />
          </label>
        )}
      </div>
    </aside>
  )
}
