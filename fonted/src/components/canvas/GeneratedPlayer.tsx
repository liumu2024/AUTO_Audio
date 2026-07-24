import { Play } from 'lucide-react'
import { forwardRef, useMemo } from 'react'

import { VideoPreviewFrame } from '@/components/canvas/VideoPreviewFrame'
import { env } from '@/config/env'
import { cn } from '@/lib/utils'
import type { TimelineMode } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

interface GeneratedPlayerProps {
  mode: TimelineMode
  onTimeUpdate: () => void
  onEnded: () => void
  onLoadedMetadata: (duration: number, source?: 'sample' | 'generated') => void
  onSeek: (time: number) => void
  onTogglePlay: () => void
}

/** V2 timeline preview and rendered output. */
export const GeneratedPlayer = forwardRef<HTMLVideoElement, GeneratedPlayerProps>(
  function GeneratedPlayer({ onTimeUpdate, onEnded, onLoadedMetadata, onSeek, onTogglePlay }, ref) {
    const currentTime = usePlaybackStore((state) => state.currentTime)
    const isPlaying = usePlaybackStore((state) => state.isPlaying)
    const preview = useV2TimelineStore((state) => state.preview)
    const result = useV2TimelineStore((state) => state.result)
    const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
    const selectClip = useV2TimelineStore((state) => state.selectClip)
    const outputUrl = result?.outputUrl ? `${env.apiBase}${result.outputUrl.startsWith('/') ? '' : '/'}${result.outputUrl}` : undefined
    const scenes = useMemo(() => preview?.review.scenes.slice().sort((a, b) => a.start_sec - b.start_sec) ?? [], [preview])
    const selectedId = selectedClipId?.replace(/^v2-(?:scene|overlay|transition)-/, '')
    const active = scenes.find((scene) => scene.id === selectedId) ?? scenes.find((scene) => currentTime >= scene.start_sec && currentTime < scene.start_sec + scene.duration_sec) ?? scenes[0]

    return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3"><h3 className="shrink-0 text-sm font-medium tracking-tight text-zinc-200">{outputUrl ? 'V2 渲染成片' : 'V2 Timeline 方案'}</h3><div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 shadow-lg shadow-black/25')}><div className="relative flex min-h-0 flex-1 flex-col p-4">{outputUrl ? <VideoPreviewFrame className="min-h-0 flex-1"><div className="relative h-full w-full"><video ref={ref} className="h-full w-full object-contain" src={outputUrl} preload="metadata" playsInline onTimeUpdate={onTimeUpdate} onEnded={onEnded} onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && onLoadedMetadata(event.currentTarget.duration, 'generated')} />{!isPlaying ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-900/40"><div className="flex h-16 w-16 items-center justify-center rounded-full border border-violet-500/30 bg-zinc-800/90"><Play className="h-7 w-7 fill-violet-300 text-violet-300" /></div></div> : null}<button type="button" className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0" onClick={onTogglePlay} aria-label={isPlaying ? '暂停' : '播放'} /></div></VideoPreviewFrame> : <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-zinc-950/80 p-4"><p className="text-sm text-zinc-300">{active?.description_zh ?? '选择下方时间线中的镜头，查看模型将要创作的内容。'}</p><div className="mt-4 space-y-2">{scenes.map((scene) => <button key={scene.id} type="button" className={cn('w-full rounded-md border px-3 py-2 text-left text-xs', active?.id === scene.id ? 'border-violet-400/70 bg-violet-500/10 text-violet-100' : 'border-zinc-800 bg-zinc-900/50 text-zinc-300')} onClick={() => { selectClip(`v2-scene-${scene.id}`); onSeek(scene.start_sec) }}><span className="font-medium">{scene.title_zh ?? scene.role_zh}</span><span className="ml-2 text-zinc-500">{scene.start_sec}s</span></button>)}</div></div>}</div><div className="shrink-0 border-t border-zinc-800/80 px-4 py-3 text-center text-[10px] text-zinc-600">{outputUrl ? '修改时间线后需重新渲染。' : '这是可审阅方案，尚未生成最终视频。'}</div></div></div>
  },
)
