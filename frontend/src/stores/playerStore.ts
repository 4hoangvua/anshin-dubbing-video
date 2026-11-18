import { create } from 'zustand'

interface PlayerState {
  currentTime: number
  duration: number
  isPlaying: boolean
  volume: number
  isMuted: boolean
  playbackRate: number
  activeCueText: string
  seekTarget: number | null

  // Actions
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setIsPlaying: (isPlaying: boolean) => void
  setVolume: (volume: number) => void
  setIsMuted: (isMuted: boolean) => void
  setPlaybackRate: (rate: number) => void
  setActiveCueText: (text: string) => void
  seekTo: (time: number) => void
  clearSeekTarget: () => void
  togglePlay: () => void
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 1,
  isMuted: false,
  playbackRate: 1,
  activeCueText: '',
  seekTarget: null,

  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setActiveCueText: (activeCueText) => set({ activeCueText }),

  seekTo: (time) => {
    set({ seekTarget: Math.max(0, time) })
  },

  clearSeekTarget: () => set({ seekTarget: null }),

  togglePlay: () => {
    set({ isPlaying: !get().isPlaying })
  }
}))
