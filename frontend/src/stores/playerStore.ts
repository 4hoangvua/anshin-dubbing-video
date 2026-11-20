import { create } from 'zustand';

interface PlayerState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  activeCueText: string;
  seekTarget: number | null;

  // Actions
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (isMuted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setActiveCueText: (text: string) => void;
  seekTo: (time: number) => void;
  clearSeekTarget: () => void;
  togglePlay: () => void;
}

/**
 * 60Hz High-frequency Player Store
 * ⚠️ QUY TẮC HIỆU NĂNG:
 * - TUYỆT ĐỐI KHÔNG subscribe `currentTime` trong component cha hoặc VirtualCueTable.
 * - Chỉ sử dụng transient subscription `usePlayerStore.subscribe` hoặc requestAnimationFrame
 *   để vẽ Playhead Canvas hoặc cập nhật trực tiếp `ref.textContent`.
 */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 1,
  isMuted: false,
  playbackRate: 1,
  activeCueText: '',
  seekTarget: null,

  setCurrentTime: (currentTime) => {
    if (typeof currentTime === 'number' && Number.isFinite(currentTime)) {
      set({ currentTime: Math.max(0, currentTime) });
    }
  },
  setDuration: (duration) => {
    if (typeof duration === 'number' && Number.isFinite(duration)) {
      set({ duration: Math.max(0, duration) });
    }
  },
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setActiveCueText: (activeCueText) => set({ activeCueText }),

  seekTo: (time) => {
    if (typeof time === 'number' && Number.isFinite(time)) {
      set({ seekTarget: Math.max(0, time) });
    } else {
      set({ seekTarget: null });
    }
  },

  clearSeekTarget: () => set({ seekTarget: null }),

  togglePlay: () => {
    set({ isPlaying: !get().isPlaying });
  },
}));
