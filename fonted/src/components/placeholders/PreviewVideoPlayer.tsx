import { Sparkles } from 'lucide-react'

export function PreviewVideoPlayer() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">新成片预览</span>
        <span className="flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
          <Sparkles className="h-3 w-3" />
          AI 生成
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-950 p-4">
        <div className="flex aspect-video w-full max-w-full flex-col items-center justify-center gap-2 rounded-md border border-violet-500/30 bg-gradient-to-br from-zinc-900 to-zinc-950">
          <Sparkles className="h-8 w-8 text-violet-400/80" />
          <p className="text-xs text-zinc-500">预览将在映射完成后显示</p>
        </div>
      </div>
    </div>
  )
}
