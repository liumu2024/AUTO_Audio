import { Film, Music2, Sparkles, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { TimelineRuler } from '@/components/timeline/TimelineRuler'
import { TimelineTrackRow } from '@/components/timeline/TimelineTrackRow'
import { PIXELS_PER_SECOND, RULER_HEIGHT, TRACK_HEADER_WIDTH, TRACK_HEIGHT } from '@/components/timeline/constants'
import { buildV2SampleTimelineProject } from '@/lib/v2-sample-ui'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

const TRACK_ICONS = { video: Film, overlay: Type, audio: Music2, effect: Sparkles } as const

/** Read-only sample-analysis timeline derived directly from V2 understanding segments. */
export function V2SampleTimeline() {
  const session = useV2TimelineStore((state) => state.sampleSession)
  const selectClip = useV2TimelineStore((state) => state.selectClip)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const project = useMemo(
    () => session ? buildV2SampleTimelineProject(session.understanding) : null,
    [session],
  )

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const update = () => setViewportWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (!project) return null
  const pixelsPerSecond = project.duration_sec > 0 ? Math.max(PIXELS_PER_SECOND, viewportWidth / project.duration_sec) : PIXELS_PER_SECOND
  const timelineWidth = Math.max(project.duration_sec * pixelsPerSecond, viewportWidth)
  const headersHeight = RULER_HEIGHT + project.tracks.length * TRACK_HEIGHT

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60" style={{ width: TRACK_HEADER_WIDTH }}>
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900" style={{ height: RULER_HEIGHT }} />
        {project.tracks.map((track) => {
          const Icon = TRACK_ICONS[track.id]
          return <div key={track.id} className="flex items-center gap-2 border-b border-zinc-800/80 px-3" style={{ height: TRACK_HEIGHT }}><Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" /><div className="min-w-0"><p className="truncate text-[11px] font-medium text-zinc-300">{track.label}</p><p className="truncate text-[9px] text-zinc-600">{track.sublabel}</p></div></div>
        })}
      </div>
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" onClick={() => selectClip(null)}>
        <div className="relative" style={{ width: timelineWidth, minHeight: headersHeight }}>
          <TimelineRuler durationSec={project.duration_sec} pixelsPerSecond={pixelsPerSecond} />
          {project.tracks.map((track) => <TimelineTrackRow key={track.id} track={track} clips={project.clips} durationSec={project.duration_sec} pixelsPerSecond={pixelsPerSecond} />)}
        </div>
      </div>
    </div>
  )
}
