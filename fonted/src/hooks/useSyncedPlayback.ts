import { useCallback, useEffect, type RefObject } from 'react'

import { usePlaybackStore } from '@/stores/playbackStore'

const END_EPSILON = 0.08

function isNearEnd(time: number, duration: number): boolean {
  return duration > 0 && time >= duration - END_EPSILON
}

/** 将成片 video 与 Zustand 播放状态同步。 */
export function useSyncedPlayback(videoRef: RefObject<HTMLVideoElement | null>) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const syncLock = usePlaybackStore((s) => s.syncLock)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)
  const setSyncLock = usePlaybackStore((s) => s.setSyncLock)
  const storeSeek = usePlaybackStore((s) => s.seek)

  const finishAtEnd = useCallback(() => {
    const video = videoRef.current
    const duration = usePlaybackStore.getState().duration
    const endTime = video && Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(duration, video.duration)
      : duration
    setPlaying(false)
    setSyncLock(true)
    setCurrentTime(endTime)
    if (video) {
      video.pause()
      const target = Math.max(0, endTime - 0.001)
      if (Math.abs(video.currentTime - target) > 0.02) {
        video.currentTime = target
      }
    }
    requestAnimationFrame(() => setSyncLock(false))
  }, [videoRef, setPlaying, setSyncLock, setCurrentTime])

  const applyTime = useCallback(
    (time: number) => {
      const duration = usePlaybackStore.getState().duration
      const clamped =
        duration > 0 ? Math.max(0, Math.min(time, duration)) : time
      const video = videoRef.current
      if (video && Number.isFinite(clamped) && Math.abs(video.currentTime - clamped) > 0.02) {
        video.currentTime = clamped
      }
    },
    [videoRef],
  )

  const handleTimeUpdate = useCallback(() => {
    if (usePlaybackStore.getState().syncLock) return
    const video = videoRef.current
    if (!video) return

    const duration = usePlaybackStore.getState().duration
    const time = video.currentTime

    if (isNearEnd(time, duration)) {
      finishAtEnd()
      return
    }
    setCurrentTime(time)
  }, [videoRef, setCurrentTime, finishAtEnd])

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
    const video = videoRef.current
    if (!video?.src) return

    if (next && state.duration > 0 && state.currentTime >= state.duration - END_EPSILON) {
      storeSeek(0)
      applyTime(0)
    }

    setPlaying(next)

    if (next) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [videoRef, setPlaying, storeSeek, applyTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video?.src) return

    if (isPlaying) {
      const { currentTime, duration } = usePlaybackStore.getState()
      if (duration > 0 && currentTime >= duration - END_EPSILON) {
        setPlaying(false)
        return
      }
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [isPlaying, videoRef, setPlaying])

  useEffect(() => {
    if (!syncLock) return
    applyTime(currentTime)
    const id = requestAnimationFrame(() => setSyncLock(false))
    return () => cancelAnimationFrame(id)
  }, [syncLock, currentTime, applyTime, setSyncLock])

  useEffect(() => {
    const video = videoRef.current
    video?.addEventListener('ended', handleEnded)
    return () => {
      video?.removeEventListener('ended', handleEnded)
    }
  }, [videoRef, handleEnded])

  return { handleTimeUpdate, handleEnded, seekTo, togglePlayPause, applyTime }
}
