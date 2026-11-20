import { create } from 'zustand';
import type { CueItem, SubtitleStyle } from '../types';
import { apiClient } from '../core/apiClient';

const MAX_HISTORY_STEPS = 50;

interface CueState {
  cues: CueItem[];
  selectedCueId: number | null;
  selectedCueIds: number[];
  searchQuery: string;
  filterNeedsReview: boolean;
  filterSpeedLevel: 'all' | 'fast' | 'dangerous';
  isSyncing: boolean;

  // Temporal Undo / Redo
  past: CueItem[][];
  future: CueItem[][];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Actions
  setCues: (cues: CueItem[], recordHistory?: boolean) => void;
  setSelectedCueId: (id: number | null) => void;
  setSelectedCueIds: (ids: number[]) => void;
  setSearchQuery: (query: string) => void;
  setFilterNeedsReview: (filter: boolean) => void;
  setFilterSpeedLevel: (level: 'all' | 'fast' | 'dangerous') => void;
  updateCue: (id: number, updates: Partial<CueItem>) => void;
  updateBatchCues: (updates: { id: number; patch: Partial<CueItem> }[]) => void;
  updateText: (id: number, text: { originalText?: string; translatedText?: string }) => void;
  updateSpeaker: (id: number, speakerId: string) => void;
  updateAudio: (
    id: number,
    audio: {
      audioFile: string;
      audioDuration: number;
      speed?: number;
      playbackRate?: number;
      status?: CueItem['status'];
      needsReview?: boolean;
    }
  ) => void;
  updateCueStyle: (id: number, stylePatch: Partial<SubtitleStyle>, recordHistory?: boolean) => void;
  syncSpeakerStyle: (speakerId: string, style: Partial<SubtitleStyle>) => void;
  syncAllStyles: (style: Partial<SubtitleStyle>) => void;
  splitCue: (id: number, splitTime: number, firstText?: string, secondText?: string) => void;
  mergeCues: (id1: number, id2: number) => void;
  deleteCue: (id: number) => void;
  deleteMultipleCues: (ids: number[]) => void;
  addCue: (cue: Omit<CueItem, 'id'>) => void;
  saveCuesToServer: (projectId: string) => Promise<boolean>;
}

export const useCueStore = create<CueState>((set, get) => ({
  cues: [],
  selectedCueId: null,
  selectedCueIds: [],
  searchQuery: '',
  filterNeedsReview: false,
  filterSpeedLevel: 'all',
  isSyncing: false,

  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  undo: () => {
    const { past, cues, future } = get();
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const newFuture = [cues, ...future].slice(0, MAX_HISTORY_STEPS);

    set({
      cues: previous,
      past: newPast,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { past, cues, future } = get();
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);

    set({
      cues: next,
      past: newPast,
      future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
    });
  },

  setCues: (cues, recordHistory = true) => {
    const safeCues = Array.isArray(cues) ? cues : [];
    if (!recordHistory) {
      set({ cues: safeCues, past: [], future: [], canUndo: false, canRedo: false });
      return;
    }
    const { cues: currentCues, past } = get();
    const newPast = [...past, currentCues].slice(-MAX_HISTORY_STEPS);
    set({
      cues: safeCues,
      past: newPast,
      future: [],
      canUndo: newPast.length > 0,
      canRedo: false,
    });
  },

  setSelectedCueId: (id) => set({ selectedCueId: id, selectedCueIds: id !== null ? [id] : [] }),
  setSelectedCueIds: (ids) => {
    const safeIds = Array.isArray(ids) ? ids : [];
    set({ selectedCueIds: safeIds, selectedCueId: safeIds.length > 0 ? safeIds[0] : null });
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterNeedsReview: (filter) => set({ filterNeedsReview: filter }),
  setFilterSpeedLevel: (filterSpeedLevel) => set({ filterSpeedLevel }),

  updateCue: (id, updates) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);

    set({
      cues: cues.map((cue) => {
        if (cue.id !== id) return cue;
        const updated = { ...cue, ...updates };
        if (updates.startTime !== undefined || updates.endTime !== undefined) {
          const start = updates.startTime ?? cue.startTime;
          const end = updates.endTime ?? cue.endTime;
          updated.duration = Math.max(0, +(end - start).toFixed(3));
        }
        return updated;
      }),
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  updateBatchCues: (updates) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    const updateMap = new Map(updates.map((u) => [u.id, u.patch]));

    set({
      cues: cues.map((cue) => {
        const patch = updateMap.get(cue.id);
        if (!patch) return cue;
        const updated = { ...cue, ...patch };
        if (patch.startTime !== undefined || patch.endTime !== undefined) {
          const start = patch.startTime ?? cue.startTime;
          const end = patch.endTime ?? cue.endTime;
          updated.duration = Math.max(0, +(end - start).toFixed(3));
        }
        return updated;
      }),
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  updateText: (id, text) => {
    get().updateCue(id, text);
  },

  updateSpeaker: (id, speakerId) => {
    get().updateCue(id, { speakerId });
  },

  updateAudio: (id, audio) => {
    get().updateCue(id, audio);
  },

  updateCueStyle: (id, stylePatch, recordHistory = true) => {
    const { cues, past } = get();
    const index = cues.findIndex((c) => c.id === id);
    if (index === -1) return;

    const currentStyle = cues[index].style || {};
    const newStyle = { ...currentStyle, ...stylePatch };

    const newPast = recordHistory ? [...past, cues].slice(-MAX_HISTORY_STEPS) : past;
    set({
      cues: cues.map((c) => (c.id === id ? { ...c, style: newStyle } : c)),
      past: newPast,
      future: recordHistory ? [] : get().future,
      canUndo: newPast.length > 0,
    });
  },

  syncSpeakerStyle: (speakerId, stylePatch) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    set({
      cues: cues.map((c) =>
        c.speakerId === speakerId
          ? { ...c, style: { ...(c.style || {}), ...stylePatch } }
          : c
      ),
      past: newPast,
      future: [],
      canUndo: true,
    });
  },

  syncAllStyles: (stylePatch) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    set({
      cues: cues.map((c) => ({
        ...c,
        style: { ...(c.style || {}), ...stylePatch },
      })),
      past: newPast,
      future: [],
      canUndo: true,
    });
  },

  splitCue: (id, splitTime, firstText, secondText) => {
    const { cues, past } = get();
    const index = cues.findIndex((c) => c.id === id);
    if (index === -1) return;

    const target = cues[index];
    if (splitTime <= target.startTime || splitTime >= target.endTime) return;

    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    const maxId = Math.max(0, ...cues.map((c) => c.id));

    const cue1: CueItem = {
      ...target,
      endTime: +splitTime.toFixed(3),
      duration: +(splitTime - target.startTime).toFixed(3),
      originalText: firstText ?? target.originalText,
      audioFile: undefined,
      audioDuration: undefined,
      status: 'pending',
    };

    const cue2: CueItem = {
      id: maxId + 1,
      startTime: +splitTime.toFixed(3),
      endTime: target.endTime,
      duration: +(target.endTime - splitTime).toFixed(3),
      originalText: secondText ?? '',
      speakerId: target.speakerId,
      status: 'pending',
      confidence: target.confidence,
    };

    const nextCues = [...cues.slice(0, index), cue1, cue2, ...cues.slice(index + 1)];

    set({
      cues: nextCues,
      selectedCueId: cue1.id,
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  mergeCues: (id1, id2) => {
    const { cues, past } = get();
    const cue1 = cues.find((c) => c.id === id1);
    const cue2 = cues.find((c) => c.id === id2);
    if (!cue1 || !cue2) return;

    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    const mergedCue: CueItem = {
      ...cue1,
      startTime: Math.min(cue1.startTime, cue2.startTime),
      endTime: Math.max(cue1.endTime, cue2.endTime),
      duration: +(Math.max(cue1.endTime, cue2.endTime) - Math.min(cue1.startTime, cue2.startTime)).toFixed(3),
      originalText: `${cue1.originalText} ${cue2.originalText}`.trim(),
      translatedText: [cue1.translatedText, cue2.translatedText].filter(Boolean).join(' ').trim(),
      audioFile: undefined,
      audioDuration: undefined,
      status: 'pending',
    };

    const nextCues = cues.filter((c) => c.id !== id1 && c.id !== id2);
    nextCues.push(mergedCue);
    nextCues.sort((a, b) => a.startTime - b.startTime);

    set({
      cues: nextCues,
      selectedCueId: mergedCue.id,
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  deleteCue: (id) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    set({
      cues: cues.filter((c) => c.id !== id),
      selectedCueId: null,
      selectedCueIds: [],
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  deleteMultipleCues: (ids) => {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return;
    const idSet = new Set(ids);
    const { cues, past } = get();
    const safeCues = Array.isArray(cues) ? cues : [];
    const newPast = [...past, safeCues].slice(-MAX_HISTORY_STEPS);
    set({
      cues: safeCues.filter((c) => !idSet.has(c.id)),
      selectedCueId: null,
      selectedCueIds: [],
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  addCue: (cue) => {
    const { cues, past } = get();
    const newPast = [...past, cues].slice(-MAX_HISTORY_STEPS);
    const maxId = Math.max(0, ...cues.map((c) => c.id));
    const newCue: CueItem = {
      ...cue,
      id: maxId + 1,
      duration: +(cue.endTime - cue.startTime).toFixed(3),
      status: cue.status ?? 'pending',
    };

    const nextCues = [...cues, newCue].sort((a, b) => a.startTime - b.startTime);

    set({
      cues: nextCues,
      selectedCueId: newCue.id,
      past: newPast,
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  saveCuesToServer: async (projectId) => {
    set({ isSyncing: true });
    try {
      const { cues } = get();
      await apiClient.post('/api/step1/update-cues', {
        projectId,
        cues: cues.map((c) => ({
          id: c.id,
          startTime: c.startTime,
          endTime: c.endTime,
          originalText: c.originalText,
          speakerId: c.speakerId,
          translatedText: c.translatedText || '',
        })),
      });
      return true;
    } catch (error) {
      console.error('Failed to sync cues to server:', error);
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },
}));
