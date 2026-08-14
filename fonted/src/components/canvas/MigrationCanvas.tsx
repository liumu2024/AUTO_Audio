import { useCallback, useRef } from 'react'

import { EditorEmptyState } from '@/components/canvas/EditorEmptyState'
import { GeneratedPlayer } from '@/components/canvas/GeneratedPlayer'
import { useSyncedPlayback } from '@/hooks/useSyncedPlayback'
import { resolveV2CanvasSurface } from '@/services/director/v2DirectorDraftWorkspace'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

/** V2 canvas: editable plan or rendered output, both sourced from the V2 store. */
export function MigrationCanvas() {
  const spec = useV2TimelineStore((state) => state.spec)
  const renderedOutputUrl = useV2TimelineStore((state) => state.renderedOutputUrl)
  const generatedRef = useRef<HTMLVideoElement>(null)
  const setDuration = usePlaybackStore((state) => state.setDuration)
  const { handleTimeUpdate, handleEnded, seekTo, togglePlayPause } = useSyncedPlayback(generatedRef)
  const handleLoadedMetadata = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setDuration(duration)
  }, [setDuration])

  const surface = resolveV2CanvasSurface({
    hasSpec: Boolean(spec?.scenes.length),
    hasRenderedOutput: Boolean(renderedOutputUrl),
  })
  if (surface === 'empty') return <EditorEmptyState />
  return <div className="flex h-full min-h-0 w-full p-4"><GeneratedPlayer ref={generatedRef} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} onSeek={seekTo} onTogglePlay={togglePlayPause} /></div>
}
