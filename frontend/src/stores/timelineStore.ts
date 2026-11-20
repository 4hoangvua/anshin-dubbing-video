import { create } from 'zustand';
import type { TimelineTool, TrackConfig, VideoClipSegment } from '../types';

interface TimelineState {
  zoom: number; // Pixels per second (min: 1, max: 500, default: 80)
  scrollLeft: number; // Horizontal scroll offset in pixels
  viewportWidth: number; // Visible container width in pixels
  activeTool: TimelineTool;
  snappingEnabled: boolean;
  snapTolerancePx: number;
  tracks: TrackConfig[];
  selectedElement: { type: 'cue' | 'video' | 'audio'; id: number | string } | null;
  videoClips: VideoClipSegment[];
  activeRightTab: 'cues' | 'properties';

  // Actions
  setZoom: (zoom: number) => void;
  setScrollLeft: (scrollLeft: number) => void;
  setViewportWidth: (width: number) => void;
  setActiveTool: (tool: TimelineTool) => void;
  setSnappingEnabled: (enabled: boolean) => void;
  setSelectedElement: (element: { type: 'cue' | 'video' | 'audio'; id: number | string } | null) => void;
  setVideoClips: (clips: VideoClipSegment[]) => void;
  splitVideoClip: (splitTime: number) => void;
  trimVideoClip: (clipId: string, side: 'left' | 'right', newTime: number) => void;
  setActiveRightTab: (tab: 'cues' | 'properties') => void;
  toggleTrackVisibility: (trackId: TrackConfig['id']) => void;
  setTrackHeight: (trackId: TrackConfig['id'], height: number) => void;
  setTrackMuted: (trackId: TrackConfig['id'], muted: boolean) => void;
  setTrackVolume: (trackId: TrackConfig['id'], volume: number) => void;

  // Coordinate Conversion Helpers
  timeToPixel: (timeSec: number) => number;
  pixelToTime: (pixelX: number) => number;
  getVisibleTimeRange: () => [number, number]; // [startTimeSec, endTimeSec]
}

const DEFAULT_TRACKS: TrackConfig[] = [
  { id: 'cues', name: 'Subtitles & Cues', height: 48, visible: true, locked: false, muted: false, volume: 1.0 },
  { id: 'video', name: 'Video Preview', height: 52, visible: true, locked: false, muted: false, volume: 1.0 },
  { id: 'tts-audio', name: 'AI Narration', height: 48, visible: true, locked: false, muted: false, volume: 1.0 },
];

export const useTimelineStore = create<TimelineState>((set, get) => ({
  zoom: 80,
  scrollLeft: 0,
  viewportWidth: 1200,
  activeTool: 'select',
  snappingEnabled: true,
  snapTolerancePx: 8,
  tracks: DEFAULT_TRACKS,
  selectedElement: null,
  videoClips: [],
  activeRightTab: 'cues',

  setZoom: (zoom) => {
    const clampedZoom = Math.max(1, Math.min(500, zoom));
    set({ zoom: clampedZoom });
  },

  setScrollLeft: (scrollLeft) => {
    set({ scrollLeft: Math.max(0, scrollLeft) });
  },

  setViewportWidth: (viewportWidth) => {
    set({ viewportWidth: Math.max(100, viewportWidth) });
  },

  setActiveTool: (activeTool) => set({ activeTool }),

  setSnappingEnabled: (snappingEnabled) => set({ snappingEnabled }),

  setSelectedElement: (selectedElement) => set({ selectedElement }),

  setVideoClips: (videoClips) => set({ videoClips: Array.isArray(videoClips) ? videoClips : [] }),

  splitVideoClip: (splitTime) => {
    const rawClips = get().videoClips;
    const videoClips = Array.isArray(rawClips) ? rawClips : [];
    if (videoClips.length === 0) return;

    const targetIdx = videoClips.findIndex(
      (c) => splitTime > c.startTime && splitTime < c.startTime + c.duration
    );
    if (targetIdx === -1) return;

    const clip = videoClips[targetIdx];
    const leftDuration = splitTime - clip.startTime;
    const rightDuration = clip.duration - leftDuration;

    const clip1: VideoClipSegment = {
      ...clip,
      duration: +leftDuration.toFixed(3),
      trimEnd: +(clip.trimEnd + rightDuration).toFixed(3),
    };

    const clip2: VideoClipSegment = {
      id: `${clip.id}_split_${Date.now()}`,
      startTime: +splitTime.toFixed(3),
      duration: +rightDuration.toFixed(3),
      trimStart: +(clip.trimStart + leftDuration).toFixed(3),
      trimEnd: clip.trimEnd,
      volume: clip.volume,
      muted: clip.muted,
    };

    const nextClips = [...videoClips];
    nextClips.splice(targetIdx, 1, clip1, clip2);
    set({ videoClips: nextClips });
  },

  trimVideoClip: (clipId, side, newTime) => {
    const { videoClips } = get();
    const clip = videoClips.find((c) => c.id === clipId);
    if (!clip) return;

    if (side === 'left') {
      if (newTime >= clip.startTime + clip.duration - 0.2) return;
      const delta = newTime - clip.startTime;
      set({
        videoClips: videoClips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                startTime: +newTime.toFixed(3),
                duration: +(c.duration - delta).toFixed(3),
                trimStart: +(c.trimStart + delta).toFixed(3),
              }
            : c
        ),
      });
    } else {
      if (newTime <= clip.startTime + 0.2) return;
      const newDuration = newTime - clip.startTime;
      const delta = clip.duration - newDuration;
      set({
        videoClips: videoClips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                duration: +newDuration.toFixed(3),
                trimEnd: +(c.trimEnd + delta).toFixed(3),
              }
            : c
        ),
      });
    }
  },

  setActiveRightTab: (activeRightTab) => set({ activeRightTab }),

  toggleTrackVisibility: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, visible: !t.visible } : t)),
    }));
  },

  setTrackHeight: (trackId, height) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, height: Math.max(24, height) } : t)),
    }));
  },

  setTrackMuted: (trackId, muted) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
    }));
  },

  setTrackVolume: (trackId, volume) => {
    const clamped = Math.max(0, Math.min(2.0, volume));
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, volume: clamped } : t)),
    }));
  },

  timeToPixel: (timeSec) => {
    return timeSec * get().zoom;
  },

  pixelToTime: (pixelX) => {
    return Math.max(0, pixelX / get().zoom);
  },

  getVisibleTimeRange: () => {
    const { scrollLeft, viewportWidth, zoom } = get();
    const startSec = Math.max(0, scrollLeft / zoom);
    const endSec = (scrollLeft + viewportWidth) / zoom;
    return [startSec, endSec];
  },
}));
