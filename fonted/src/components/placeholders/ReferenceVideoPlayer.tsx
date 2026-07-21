import { Play } from 'lucide-react'

export function ReferenceVideoPlayer() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">样例原片</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          参考
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-950 p-4">
        <div className="flex aspect-video w-full max-w-full items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/80">
          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700"
            aria-label="播放样例原片"
          >
            <Play className="h-6 w-6 fill-current pl-0.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
