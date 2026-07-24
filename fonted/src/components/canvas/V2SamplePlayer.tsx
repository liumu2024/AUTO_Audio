import { Play } from 'lucide-react'
import { forwardRef } from 'react'

import { V2SampleProgressBar } from '@/components/canvas/V2SampleProgressBar'
import { VideoPreviewFrame } from '@/components/canvas/VideoPreviewFrame'
import { cn } from '@/lib/utils'
import { buildV2SampleProgressSegments, type V2SampleSession } from '@/lib/v2-sample-ui'
import { usePlaybackStore } from '@/stores/playbackStore'

interface V2SamplePlayerProps {
  session: V2SampleSession
  onTimeUpdate: () => void
  onEnded: () => void
  onLoadedMetadata: (duration: number) => void
  onSeek: (time: number) => void
  onTogglePlay: () => void
}

export const V2SamplePlayer = forwardRef<HTMLVideoElement, V2SamplePlayerProps>(
  function V2SamplePlayer({ session, onTimeUpdate, onEnded, onLoadedMetadata, onSeek, onTogglePlay }, ref) {
    const currentTime = usePlaybackStore((state) => state.currentTime)
    const duration = usePlaybackStore((state) => state.duration)
    const isPlaying = usePlaybackStore((state) => state.isPlaying)
    const segments = buildV2SampleProgressSegments(session.understanding)

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <h3 className="shrink-0 text-sm font-medium tracking-tight text-zinc-200">样例原片解析</h3>
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl', 'border border-zinc-800 bg-zinc-900/50 shadow-lg shadow-black/25')}>
          <div className="relative flex min-h-0 flex-1 flex-col p-4">
            <VideoPreviewFrame className="min-h-0 flex-1">
              <div className="relative h-full w-full">
                <video ref={ref} className="h-full w-full object-contain" src={session.reference.playbackUrl} preload="metadata" playsInline onTimeUpdate={onTimeUpdate} onEnded={onEnded} onLoadedMetadata={(event) => {
                  const value = event.currentTarget.duration
                  if (Number.isFinite(value)) onLoadedMetadata(value)
                }} />
                {!isPlaying ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-900/40"><div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-800/90 shadow-md"><Play className="h-7 w-7 fill-zinc-200 text-zinc-200" /></div></div> : null}
                <button type="button" className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0" onClick={(event) => { event.stopPropagation(); onTogglePlay() }} aria-label={isPlaying ? '暂停' : '播放'} />
              </div>
            </VideoPreviewFrame>
          </div>
          <V2SampleProgressBar segments={segments} currentTime={currentTime} duration={duration} onSeek={onSeek} />
        </div>
      </div>
    )
  },
)
