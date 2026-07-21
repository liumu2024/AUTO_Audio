import { Play } from 'lucide-react'
import { forwardRef } from 'react'

import { SemanticProgressBar } from '@/components/canvas/SemanticProgressBar'
import { VideoPreviewFrame } from '@/components/canvas/VideoPreviewFrame'
import { cn } from '@/lib/utils'
import { usePlaybackStore } from '@/stores/playbackStore'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'

interface SamplePlayerProps {
  project: MigrationProtocolV12
  onTimeUpdate: () => void
  onEnded: () => void
  onLoadedMetadata: (duration: number, source?: 'sample' | 'generated') => void
  onSeek: (time: number) => void
  onTogglePlay: () => void
}

export const SamplePlayer = forwardRef<HTMLVideoElement, SamplePlayerProps>(
  function SamplePlayer(
    { project, onTimeUpdate, onEnded, onLoadedMetadata, onSeek, onTogglePlay },
    ref,
  ) {
    const currentTime = usePlaybackStore((s) => s.currentTime)
    const duration = usePlaybackStore((s) => s.duration)
    const isPlaying = usePlaybackStore((s) => s.isPlaying)

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <h3 className="shrink-0 text-sm font-medium tracking-tight text-zinc-200">
          样例原片分析
        </h3>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl',
            'border border-zinc-800 bg-zinc-900/50 shadow-lg shadow-black/25',
          )}
        >
          <div className="relative flex min-h-0 flex-1 flex-col p-4">
            <VideoPreviewFrame className="min-h-0 flex-1">
              <div className="relative h-full w-full">
                <video
                  ref={ref}
                  className="h-full w-full object-contain"
                  src={project.source_video.url}
                  preload="metadata"
                  playsInline
                  onTimeUpdate={onTimeUpdate}
                  onEnded={onEnded}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration
                    if (Number.isFinite(d)) onLoadedMetadata(d, 'sample')
                  }}
                />

                {!isPlaying && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-900/40">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-800/90 shadow-md">
                      <Play className="h-7 w-7 fill-zinc-200 text-zinc-200" />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePlay()
                  }}
                  aria-label={isPlaying ? '暂停' : '播放'}
                />
              </div>
            </VideoPreviewFrame>
          </div>

          <SemanticProgressBar
            anchors={project.semantic_anchors}
            currentTime={currentTime}
            duration={duration}
            onSeek={onSeek}
          />
        </div>
      </div>
    )
  },
)
