import { create } from 'zustand'

interface PlaybackState {
  isPlaying: boolean
  currentTime: number
  duration: number
  syncLock: boolean

  setPlaying: (isPlaying: boolean) => void
  togglePlay: () => void
  pause: () => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  seek: (time: number) => void
  setSyncLock: (locked: boolean) => void
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 15,
  syncLock: false,

  setPlaying: (isPlaying) => set({ isPlaying }),

  togglePlay: () => set({ isPlaying: !get().isPlaying }),

  pause: () => set({ isPlaying: false }),

  setCurrentTime: (currentTime) => set({ currentTime }),

  setDuration: (duration) => set({ duration }),

  seek: (time) => {
    const duration = get().duration
    const clamped = Math.max(0, Math.min(time, duration > 0 ? duration : time))
    set({ currentTime: clamped, syncLock: true })
  },

  setSyncLock: (syncLock) => set({ syncLock }),
}))
