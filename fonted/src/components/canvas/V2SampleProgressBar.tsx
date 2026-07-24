import { useCallback, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { V2TimedSegment } from '@/lib/v2-sample-ui'

interface V2SampleProgressBarProps {
  segments: V2TimedSegment[]
  currentTime: number
  duration: number
  onSeek: (time: number) => void
}

export function V2SampleProgressBar({
  segments,
  currentTime,
  duration,
  onSeek,
}: V2SampleProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const active = useMemo(
    () => segments.find((segment) => currentTime >= segment.startSec && currentTime < segment.endSec),
    [currentTime, segments],
  )
  const seekFromClientX = useCallback((clientX: number) => {
    const node = trackRef.current
    if (!node || duration <= 0) return
    const rect = node.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration)))
  }, [duration, onSeek])

  return (
    <div className="shrink-0 space-y-2 px-3 pb-3 pt-2">
      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-zinc-500">
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        {active ? <span className="truncate font-semibold text-violet-200">{active.label}</span> : null}
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        className={cn('relative h-3 cursor-pointer overflow-hidden rounded-full bg-zinc-800 touch-none', dragging && 'ring-1 ring-violet-500/50')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          seekFromClientX(event.clientX)
        }}
        onPointerMove={(event) => dragging && seekFromClientX(event.clientX)}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 0.5))
          if (event.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 0.5))
        }}
      >
        {segments.map((segment, index) => {
          const left = duration > 0 ? (segment.startSec / duration) * 100 : 0
          const width = duration > 0 ? ((segment.endSec - segment.startSec) / duration) * 100 : 0
          return <div key={segment.id} className={cn('pointer-events-none absolute top-0 h-full opacity-70', active?.id === segment.id && 'opacity-100 ring-1 ring-inset ring-white/30')} style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, backgroundColor: `hsl(${(index * 57 + 266) % 360} 72% 60%)` }} title={segment.label} />
        })}
        <div className="pointer-events-none absolute top-0 z-10 h-full w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
