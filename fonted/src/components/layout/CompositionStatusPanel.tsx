import type { SceneCompositionStatus } from '@/types/render-plan'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  auto_repaired: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  missing_capability: 'bg-red-500/10 text-red-300 border-red-500/20',
  invalid: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  pending: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
}

export function CompositionStatusPanel({
  status,
}: {
  status: SceneCompositionStatus | undefined
}) {
  if (!status) return null

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          效果组合状态
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
            STATUS_STYLES[status.status] ?? STATUS_STYLES.pending,
          )}
        >
          {status.status_label}
        </span>
      </div>

      <div className="space-y-1 text-xs text-zinc-300">
        <div>
          <span className="text-zinc-500">视觉意图：</span>
          {status.intent_label}
        </div>
        <div>
          <span className="text-zinc-500">配方：</span>
          {status.recipe_id}
        </div>
      </div>

      {status.layers.length ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            已使用层
          </div>
          {status.layers.map((layer) => (
            <div
              key={`${layer.plugin_id}-${layer.preset}`}
              className="rounded-md border border-zinc-800/80 bg-zinc-900/70 px-2.5 py-2 text-[11px] text-zinc-300"
            >
              <div className="font-medium text-zinc-100">{layer.label}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {layer.plugin_id} · {layer.preset}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {status.missing?.length ? (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-200">
          <div className="font-medium">缺失</div>
          <div className="mt-1 text-amber-100/90">{status.missing.join('、')}</div>
        </div>
      ) : null}

      {status.repairs?.length ? (
        <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2.5 py-2 text-[11px] text-sky-200">
          <div className="font-medium">修复</div>
          <div className="mt-1 text-sky-100/90">{status.repairs.join('；')}</div>
        </div>
      ) : null}

      {status.missing_capabilities?.length ? (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[11px] text-red-200">
          <div className="font-medium">缺失能力</div>
          <div className="mt-1 text-red-100/90">{status.missing_capabilities.join('、')}</div>
          {status.suggestions?.length ? (
            <div className="mt-1 text-red-100/70">建议：{status.suggestions.join(' / ')}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
