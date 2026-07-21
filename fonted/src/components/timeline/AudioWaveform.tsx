import type { WaveformSample } from '@/lib/render-effect-ui'

/** Draws the audio evidence waveform from backend-extracted RMS/onset buckets. */
export function AudioWaveform({ samples = [] }: { samples?: WaveformSample[] }) {
  const fallback = [
    0.3, 0.5, 0.8, 0.6, 0.9, 0.4, 0.7, 1, 0.5, 0.8, 0.6, 0.9, 0.4, 0.7,
    0.5, 0.8, 0.6, 0.4, 0.7, 0.9,
  ]
  const bars = samples.length ? samples.map((item) => item.value) : fallback

  return (
    <div
      className="pointer-events-none absolute inset-x-1 bottom-1 top-5 flex items-end gap-px opacity-40"
      aria-hidden
    >
      {bars.map((value, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-violet-200/80"
          style={{ height: `${Math.max(8, value * 100)}%` }}
        />
      ))}
    </div>
  )
}
