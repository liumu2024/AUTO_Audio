import { useCallback, useRef } from 'react'

import { EditorEmptyState } from '@/components/canvas/EditorEmptyState'
import { GeneratedPlayer } from '@/components/canvas/GeneratedPlayer'
import { V2SamplePlayer } from '@/components/canvas/V2SamplePlayer'
import { useSyncedPlayback } from '@/hooks/useSyncedPlayback'
import { resolveV2CanvasSurface } from '@/services/director/v2DirectorDraftWorkspace'
import { useEditorStore } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

/** V2 canvas: sample understanding and timeline preview have no V1 projection. */
export function MigrationCanvas() {
  const sampleSession = useV2TimelineStore((state) => state.sampleSession)
  const spec = useV2TimelineStore((state) => state.spec)
  const result = useV2TimelineStore((state) => state.result)
  const timelineMode = useEditorStore((state) => state.timelineMode)
  const sampleRef = useRef<HTMLVideoElement>(null)
  const generatedRef = useRef<HTMLVideoElement>(null)
  const setDuration = usePlaybackStore((state) => state.setDuration)
  const { handleTimeUpdate, handleEnded, seekTo, togglePlayPause } = useSyncedPlayback(sampleRef, generatedRef)
  const handleLoadedMetadata = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setDuration(duration)
  }, [setDuration])

  const surface = resolveV2CanvasSurface({
    timelineMode,
    hasSample: Boolean(sampleSession),
    hasSpec: Boolean(spec?.scenes.length),
    hasRenderedOutput: Boolean(result?.outputUrl),
  })
  if (surface === 'sample_analysis' && sampleSession) {
    return <div className="flex h-full min-h-0 w-full p-4"><V2SamplePlayer ref={sampleRef} session={sampleSession} onTimeUpdate={() => handleTimeUpdate('sample')} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} onSeek={seekTo} onTogglePlay={togglePlayPause} /></div>
  }
  if (surface === 'empty') return <EditorEmptyState />
  return <div className="flex h-full min-h-0 w-full p-4"><GeneratedPlayer ref={generatedRef} mode={timelineMode} onTimeUpdate={() => handleTimeUpdate('generated')} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} onSeek={seekTo} onTogglePlay={togglePlayPause} /></div>
}
