import { RULER_HEIGHT } from '@/components/timeline/constants'

interface TimelineRulerProps {
  durationSec: number
  pixelsPerSecond: number
}

export function TimelineRuler({
  durationSec,
  pixelsPerSecond,
}: TimelineRulerProps) {
  const width = durationSec * pixelsPerSecond
  const ticks = Array.from({ length: durationSec + 1 }, (_, i) => i)

  return (
    <div
      className="relative shrink-0 border-b border-zinc-800 bg-zinc-900/80"
      style={{ height: RULER_HEIGHT, width }}
    >
      {ticks.map((sec) => (
        <div
          key={sec}
          className="absolute top-0 flex h-full flex-col justify-end border-l border-zinc-800/90"
          style={{ left: sec * pixelsPerSecond }}
        >
          <span className="mb-0.5 -translate-x-1/2 pl-0 font-mono text-[9px] text-zinc-500">
            {formatRulerLabel(sec)}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatRulerLabel(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`
  return `${s}s`
}
