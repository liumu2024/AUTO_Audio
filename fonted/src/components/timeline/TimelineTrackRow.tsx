import { TimelineClipBlock } from '@/components/timeline/TimelineClipBlock'
import { TRACK_HEIGHT } from '@/components/timeline/constants'
import type { TimelineClip, TimelineTrack } from '@/types/timeline'

interface TimelineTrackRowProps {
  track: TimelineTrack
  clips: TimelineClip[]
  durationSec: number
  pixelsPerSecond: number
}

export function TimelineTrackRow({
  track,
  clips,
  durationSec,
  pixelsPerSecond,
}: TimelineTrackRowProps) {
  const width = durationSec * pixelsPerSecond
  const trackClips = clips.filter((c) => c.track_id === track.id)

  return (
    <div
      className="relative border-b border-zinc-800/80 bg-zinc-950/40"
      style={{ height: TRACK_HEIGHT, width }}
    >
      {trackClips.map((clip) => (
        <TimelineClipBlock
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
        />
      ))}
    </div>
  )
}
