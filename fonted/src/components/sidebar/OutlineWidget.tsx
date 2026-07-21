import { Clock, ListTree, Sparkles } from 'lucide-react'

import { formatOutlineDuration } from '@shared/lib/pipeline-builder'
import { creativeRoleLabel } from '@/lib/director-labels'
import { effectLabel } from '@/lib/render-effect-ui'
import { cn } from '@/lib/utils'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import type { OutlineSegment } from '@/types/pipeline'

interface OutlineWidgetProps {
  outline: OutlineSegment[]
  className?: string
}

export function OutlineWidget({ outline, className }: OutlineWidgetProps) {
  const renderPlan = useRenderPlanStore((s) => s.plan)
  if (!outline.length) return null

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-violet-500/25',
        'bg-gradient-to-br from-zinc-900/95 via-zinc-900/80 to-violet-950/30',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.35)]',
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl" />
      <div className="relative border-b border-violet-500/15 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/25">
            <Sparkles className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-100">结构拆解大纲</p>
            <p className="text-[10px] text-zinc-500">
              {outline.length} 个语义锚点 · AI 导演助理生成
            </p>
          </div>
        </div>
      </div>

      <ul className="relative max-h-[280px] scroll-area-y space-y-1.5 p-2.5">
        {outline.map((item, index) => {
          const scene = renderPlan?.scenes.find(
            (candidate) =>
              candidate.source_anchor_id === item.anchor_id ||
              candidate.source_anchor_id === item.id,
          )
          return (
            <li
              key={item.id}
              className="group flex items-start gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2 transition-colors hover:border-violet-500/20 hover:bg-zinc-900/60"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800/90 text-[10px] font-semibold text-violet-300/90">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <ListTree className="h-3 w-3 shrink-0 text-violet-400/80" />
                  <span className="truncate text-xs font-medium text-zinc-200">
                    {item.title}
                  </span>
                  <span className="ml-auto shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">
                    {creativeRoleLabel(item.creative_role ?? item.marketing_role)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <Clock className="h-3 w-3" />
                  {formatOutlineDuration(item.start_sec, item.end_sec)}
                </div>
                {scene?.effect_layers?.length ? (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-violet-300/80">
                    <Sparkles className="h-3 w-3" />
                    <span className="truncate">
                      {scene.effect_layers
                        .map(
                          (layer) =>
                            `${layer.plugin_id} (${layer.layerKind})`,
                        )
                        .join(' · ')}
                    </span>
                  </div>
                ) : scene?.effects ? (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-violet-300/80">
                    <Sparkles className="h-3 w-3" />
                    <span className="truncate">
                      Remotion: {effectLabel(scene.effects.preset)}
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
