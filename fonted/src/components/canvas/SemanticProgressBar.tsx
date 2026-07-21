import { useCallback, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  findActiveAnchor,
  getAnchorColor,
  getAnchorEnd,
  getAnchorId,
  getAnchorLabel,
  getAnchorStart,
  type SemanticAnchor,
} from '@/types/migration-protocol'

interface ResolvedSegment {
  anchor: SemanticAnchor
  start: number
  end: number
}

interface SemanticProgressBarProps {
  anchors: SemanticAnchor[]
  currentTime: number
  duration: number
  onSeek: (time: number) => void
}

function resolveSegments(
  anchors: SemanticAnchor[],
  duration: number,
): ResolvedSegment[] {
  if (!anchors.length || duration <= 0) return []

  const allZero = anchors.every((a) => getAnchorEnd(a) <= getAnchorStart(a))
  if (!allZero) {
    return anchors.map((anchor) => ({
      anchor,
      start: getAnchorStart(anchor),
      end: Math.max(getAnchorEnd(anchor), getAnchorStart(anchor) + 0.01),
    }))
  }

  const slice = duration / anchors.length
  return anchors.map((anchor, index) => ({
    anchor,
    start: index * slice,
    end: index === anchors.length - 1 ? duration : (index + 1) * slice,
  }))
}

export function SemanticProgressBar({
  anchors,
  currentTime,
  duration,
  onSeek,
}: SemanticProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const segments = useMemo(
    () => resolveSegments(anchors, duration),
    [anchors, duration],
  )

  const active = useMemo(() => {
    const hit = segments.find(
      (s) => currentTime >= s.start && currentTime < s.end,
    )
    return hit?.anchor ?? findActiveAnchor(anchors, currentTime)
  }, [segments, anchors, currentTime])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || duration <= 0) return
      const rect = el.getBoundingClientRect()
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      )
      onSeek(ratio * duration)
    },
    [duration, onSeek],
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    seekFromClientX(e.clientX)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    seekFromClientX(e.clientX)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragging(false)
  }

  return (
    <div className="shrink-0 space-y-2 px-3 pb-3 pt-2">
      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-zinc-500">
        <span>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        {active && (
          <span className="flex items-center gap-1.5 truncate">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getAnchorColor(active) }}
            />
            <span
              className="truncate font-semibold uppercase tracking-wide"
              style={{ color: getAnchorColor(active) }}
            >
              {getAnchorLabel(active)}
            </span>
          </span>
        )}
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        className={cn(
          'relative h-3 cursor-pointer overflow-hidden rounded-full bg-zinc-800 touch-none',
          dragging && 'ring-1 ring-violet-500/50',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 0.5))
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 0.5))
        }}
      >
        {segments.map(({ anchor, start, end }) => {
          const left = duration > 0 ? (start / duration) * 100 : 0
          const width = duration > 0 ? ((end - start) / duration) * 100 : 0
          const isActive = active?.anchor_id === anchor.anchor_id
          return (
            <div
              key={getAnchorId(anchor)}
              className={cn(
                'pointer-events-none absolute top-0 h-full opacity-70',
                isActive && 'opacity-100 ring-1 ring-inset ring-white/30',
              )}
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 0.5)}%`,
                backgroundColor: getAnchorColor(anchor),
              }}
              title={getAnchorLabel(anchor)}
            />
          )
        })}
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
          style={{ left: `${progress}%` }}
        />
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
