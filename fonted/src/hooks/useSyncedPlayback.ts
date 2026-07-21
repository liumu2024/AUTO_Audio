import { useCallback, useEffect, type RefObject } from 'react'

import { hasGeneratedVideo } from '@/components/canvas/GeneratedPlayer'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePlaybackStore } from '@/stores/playbackStore'

const DRIFT_THRESHOLD = 0.12
const END_EPSILON = 0.08

function getVideos(
  sampleRef: RefObject<HTMLVideoElement | null>,
  generatedRef: RefObject<HTMLVideoElement | null>,
  includeGenerated: boolean,
): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = []
  const sample = sampleRef.current
  const generated = generatedRef.current
  if (sample?.src) out.push(sample)
  if (includeGenerated && generated?.src) out.push(generated)
  return out
}

function isNearEnd(time: number, duration: number): boolean {
  return duration > 0 && time >= duration - END_EPSILON
}

/**
 * 将左右 video 与 Zustand 播放状态同步；仅样例有片源时也可正常播放。
 */
export function useSyncedPlayback(
  sampleRef: RefObject<HTMLVideoElement | null>,
  generatedRef: RefObject<HTMLVideoElement | null>,
) {
  const project = useMigrationProjectStore((s) => s.project)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const syncLock = usePlaybackStore((s) => s.syncLock)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)
  const setSyncLock = usePlaybackStore((s) => s.setSyncLock)
  const storeSeek = usePlaybackStore((s) => s.seek)

  const includeGenerated = hasGeneratedVideo(project)

  const finishAtEnd = useCallback(() => {
      const videos = getVideos(sampleRef, generatedRef, includeGenerated)
      let endTime = usePlaybackStore.getState().duration
      for (const el of videos) {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          endTime = Math.min(endTime, el.duration)
        }
      }

      setPlaying(false)
      setSyncLock(true)
      setCurrentTime(endTime)
      for (const el of videos) {
        el.pause()
        const target = Math.max(0, endTime - 0.001)
        if (Math.abs(el.currentTime - target) > 0.02) {
          el.currentTime = target
        }
      }
      requestAnimationFrame(() => setSyncLock(false))
    },
    [
      sampleRef,
      generatedRef,
      includeGenerated,
      setPlaying,
      setSyncLock,
      setCurrentTime,
    ],
  )

  const applyTime = useCallback(
    (time: number) => {
      const duration = usePlaybackStore.getState().duration
      const clamped =
        duration > 0 ? Math.max(0, Math.min(time, duration)) : time
      for (const el of getVideos(sampleRef, generatedRef, includeGenerated)) {
        if (Number.isFinite(clamped) && Math.abs(el.currentTime - clamped) > 0.02) {
          el.currentTime = clamped
        }
      }
    },
    [sampleRef, generatedRef, includeGenerated],
  )

  const syncOtherVideo = useCallback(
    (source: 'sample' | 'generated', time: number) => {
      const duration = usePlaybackStore.getState().duration
      if (isNearEnd(time, duration)) return

      const other =
        source === 'sample' ? generatedRef.current : sampleRef.current
      if (
        other?.src &&
        includeGenerated &&
        Math.abs(other.currentTime - time) > DRIFT_THRESHOLD
      ) {
        setSyncLock(true)
        other.currentTime = time
        requestAnimationFrame(() => setSyncLock(false))
      }
    },
    [sampleRef, generatedRef, includeGenerated, setSyncLock],
  )

  const handleTimeUpdate = useCallback(
    (source: 'sample' | 'generated') => {
      if (usePlaybackStore.getState().syncLock) return
      const video =
        source === 'sample' ? sampleRef.current : generatedRef.current
      if (!video) return

      const duration = usePlaybackStore.getState().duration
      const time = video.currentTime

      if (isNearEnd(time, duration)) {
        finishAtEnd()
        return
      }

      setCurrentTime(time)
      if (includeGenerated) syncOtherVideo(source, time)
    },
    [
      sampleRef,
      generatedRef,
      includeGenerated,
      setCurrentTime,
      syncOtherVideo,
      finishAtEnd,
    ],
  )

  const handleEnded = useCallback(() => {
    finishAtEnd()
  }, [finishAtEnd])

  const seekTo = useCallback(
    (time: number) => {
      storeSeek(time)
      const t = usePlaybackStore.getState().currentTime
      applyTime(t)
    },
    [storeSeek, applyTime],
  )

  const togglePlayPause = useCallback(() => {
    const state = usePlaybackStore.getState()
    const next = !state.isPlaying
    const videos = getVideos(sampleRef, generatedRef, includeGenerated)
    if (videos.length === 0) return

    if (next && state.duration > 0 && state.currentTime >= state.duration - END_EPSILON) {
      storeSeek(0)
      applyTime(0)
    }

    setPlaying(next)

    if (next) {
      void Promise.all(videos.map((v) => v.play().catch(() => undefined)))
    } else {
      for (const v of videos) v.pause()
    }
  }, [sampleRef, generatedRef, includeGenerated, setPlaying, storeSeek, applyTime])

  useEffect(() => {
    const videos = getVideos(sampleRef, generatedRef, includeGenerated)
    if (videos.length === 0) return

    if (isPlaying) {
      const { currentTime, duration } = usePlaybackStore.getState()
      if (duration > 0 && currentTime >= duration - END_EPSILON) {
        setPlaying(false)
        return
      }
      void Promise.all(videos.map((v) => v.play().catch(() => undefined)))
    } else {
      for (const v of videos) v.pause()
    }
  }, [isPlaying, sampleRef, generatedRef, includeGenerated, setPlaying])

  useEffect(() => {
    if (!syncLock) return
    applyTime(currentTime)
    const id = requestAnimationFrame(() => setSyncLock(false))
    return () => cancelAnimationFrame(id)
  }, [syncLock, currentTime, applyTime, setSyncLock])

  useEffect(() => {
    const sample = sampleRef.current
    const generated = generatedRef.current
    sample?.addEventListener('ended', handleEnded)
    generated?.addEventListener('ended', handleEnded)
    return () => {
      sample?.removeEventListener('ended', handleEnded)
      generated?.removeEventListener('ended', handleEnded)
    }
  }, [sampleRef, generatedRef, includeGenerated, handleEnded])

  return { handleTimeUpdate, handleEnded, seekTo, togglePlayPause, applyTime }
}
