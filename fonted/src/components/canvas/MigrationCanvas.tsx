import { useCallback, useRef } from 'react'

import { EditorEmptyState } from '@/components/canvas/EditorEmptyState'
import { GeneratedPlayer } from '@/components/canvas/GeneratedPlayer'
import { V2SamplePlayer } from '@/components/canvas/V2SamplePlayer'
import { useSyncedPlayback } from '@/hooks/useSyncedPlayback'
import { useEditorStore } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

/** V2 canvas: sample understanding and timeline preview have no V1 projection. */
export function MigrationCanvas() {
  const sampleSession = useV2TimelineStore((state) => state.sampleSession)
  const hasV2Preview = useV2TimelineStore((state) => Boolean(state.preview || state.result))
  const timelineMode = useEditorStore((state) => state.timelineMode)
  const sampleRef = useRef<HTMLVideoElement>(null)
  const generatedRef = useRef<HTMLVideoElement>(null)
  const setDuration = usePlaybackStore((state) => state.setDuration)
  const { handleTimeUpdate, handleEnded, seekTo, togglePlayPause } = useSyncedPlayback(sampleRef, generatedRef)
  const handleLoadedMetadata = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) setDuration(duration)
  }, [setDuration])

  if (timelineMode === 'sample' && sampleSession) {
    return <div className="flex h-full min-h-0 w-full p-4"><V2SamplePlayer ref={sampleRef} session={sampleSession} onTimeUpdate={() => handleTimeUpdate('sample')} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} onSeek={seekTo} onTogglePlay={togglePlayPause} /></div>
  }
  if (!hasV2Preview) return <EditorEmptyState />
  return <div className="flex h-full min-h-0 w-full p-4"><GeneratedPlayer ref={generatedRef} mode={timelineMode} onTimeUpdate={() => handleTimeUpdate('generated')} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} onSeek={seekTo} onTogglePlay={togglePlayPause} /></div>
}
