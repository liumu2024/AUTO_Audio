import { useCallback, useRef } from 'react'

import { EditorEmptyState } from '@/components/canvas/EditorEmptyState'
import { GeneratedPlayer } from '@/components/canvas/GeneratedPlayer'
import { SamplePlayer } from '@/components/canvas/SamplePlayer'
import { useSyncedPlayback } from '@/hooks/useSyncedPlayback'
import { useEditorStore } from '@/stores/editorStore'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { usePlaybackStore } from '@/stores/playbackStore'

export function MigrationCanvas() {
  const project = useMigrationProjectStore((s) => s.project)
  const hasPipeline = usePipelineStore((s) => Boolean(s.bundle))
  const timelineMode = useEditorStore((s) => s.timelineMode)
  const sampleRef = useRef<HTMLVideoElement>(null)
  const generatedRef = useRef<HTMLVideoElement>(null)
  const mediaDurationRef = useRef({ sample: 0, generated: 0 })
  const setDuration = usePlaybackStore((s) => s.setDuration)

  const { handleTimeUpdate, handleEnded, seekTo, togglePlayPause } =
    useSyncedPlayback(sampleRef, generatedRef)

  /** 以 <video> 真实时长为准，不用理解 metadata（常偏大） */
  const handleLoadedMetadata = useCallback(
    (duration: number, source: 'sample' | 'generated') => {
      if (!Number.isFinite(duration) || duration <= 0) return
      mediaDurationRef.current[source] = duration
      if (source === 'sample') {
        setDuration(duration)
        return
      }
      const sampleDur = mediaDurationRef.current.sample
      if (sampleDur > 0) {
        setDuration(Math.min(sampleDur, duration))
      } else {
        setDuration(duration)
      }
    },
    [setDuration],
  )

  if (!hasPipeline || !project.source_video.url) {
    return <EditorEmptyState />
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section className="grid h-full min-h-0 w-full grid-cols-2 grid-rows-1 gap-6 p-4 [&>*]:min-h-0">
        <SamplePlayer
          ref={sampleRef}
          project={project}
          onTimeUpdate={() => handleTimeUpdate('sample')}
          onEnded={handleEnded}
          onLoadedMetadata={(d) => handleLoadedMetadata(d, 'sample')}
          onSeek={seekTo}
          onTogglePlay={togglePlayPause}
        />
        <GeneratedPlayer
          ref={generatedRef}
          mode={timelineMode}
          project={project}
          onTimeUpdate={() => handleTimeUpdate('generated')}
          onEnded={handleEnded}
          onLoadedMetadata={(d) => handleLoadedMetadata(d, 'generated')}
          onSeek={seekTo}
          onTogglePlay={togglePlayPause}
        />
      </section>
    </div>
  )
}
