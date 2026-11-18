import { create } from 'zustand'
import type { CueItem } from '../types'

interface CueState {
  cues: CueItem[]
  selectedCueId: number | null
  searchQuery: string
  filterNeedsReview: boolean
  isSyncing: boolean

  // Actions
  setCues: (cues: CueItem[]) => void
  setSelectedCueId: (id: number | null) => void
  setSearchQuery: (query: string) => void
  setFilterNeedsReview: (filter: boolean) => void
  updateCue: (id: number, updates: Partial<CueItem>) => void
  updateText: (id: number, text: { originalText?: string; translatedText?: string }) => void
  updateSpeaker: (id: number, speakerId: string) => void
  updateAudio: (
    id: number,
    audio: {
      audioFile: string
      audioDuration: number
      speed?: number
      playbackRate?: number
      status?: CueItem['status']
      needsReview?: boolean
    }
  ) => void
  splitCue: (id: number, splitTime: number, firstText?: string, secondText?: string) => void
  mergeCues: (id1: number, id2: number) => void
  deleteCue: (id: number) => void
  addCue: (cue: Omit<CueItem, 'id'>) => void
  saveCuesToServer: (projectId: string) => Promise<boolean>
}

export const useCueStore = create<CueState>((set, get) => ({
  cues: [],
  selectedCueId: null,
  searchQuery: '',
  filterNeedsReview: false,
  isSyncing: false,

  setCues: (cues) => set({ cues }),

  setSelectedCueId: (id) => set({ selectedCueId: id }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setFilterNeedsReview: (filter) => set({ filterNeedsReview: filter }),

  updateCue: (id, updates) => {
    set((state) => ({
      cues: state.cues.map((cue) => {
        if (cue.id !== id) return cue
        const updated = { ...cue, ...updates }
        if (updates.startTime !== undefined || updates.endTime !== undefined) {
          const start = updates.startTime ?? cue.startTime
          const end = updates.endTime ?? cue.endTime
          updated.duration = Math.max(0, +(end - start).toFixed(3))
        }
        return updated
      })
    }))
  },

  updateText: (id, text) => {
    get().updateCue(id, text)
  },

  updateSpeaker: (id, speakerId) => {
    get().updateCue(id, { speakerId })
  },

  updateAudio: (id, audio) => {
    get().updateCue(id, audio)
  },

  splitCue: (id, splitTime, firstText, secondText) => {
    const { cues } = get()
    const index = cues.findIndex((c) => c.id === id)
    if (index === -1) return

    const target = cues[index]
    if (splitTime <= target.startTime || splitTime >= target.endTime) {
      // Default to midpoint if invalid split time
      splitTime = target.startTime + (target.endTime - target.startTime) / 2
    }

    const firstCue: CueItem = {
      ...target,
      endTime: +splitTime.toFixed(3),
      duration: +(splitTime - target.startTime).toFixed(3),
      originalText: firstText !== undefined ? firstText : target.originalText,
      audioFile: undefined,
      audioDuration: undefined,
      status: 'pending'
    }

    const nextId = Math.max(0, ...cues.map((c) => c.id)) + 1
    const secondCue: CueItem = {
      id: nextId,
      startTime: +splitTime.toFixed(3),
      endTime: target.endTime,
      duration: +(target.endTime - splitTime).toFixed(3),
      originalText: secondText !== undefined ? secondText : '',
      translatedText: '',
      speakerId: target.speakerId,
      confidence: target.confidence,
      isContinuation: true,
      audioFile: undefined,
      audioDuration: undefined,
      status: 'pending'
    }

    const updated = [...cues]
    updated.splice(index, 1, firstCue, secondCue)
    set({ cues: updated, selectedCueId: firstCue.id })
  },

  mergeCues: (id1, id2) => {
    const { cues } = get()
    const cue1 = cues.find((c) => c.id === id1)
    const cue2 = cues.find((c) => c.id === id2)
    if (!cue1 || !cue2) return

    const startTime = Math.min(cue1.startTime, cue2.startTime)
    const endTime = Math.max(cue1.endTime, cue2.endTime)
    const mergedOriginal = `${cue1.originalText} ${cue2.originalText}`.trim()
    const mergedTranslated = cue1.translatedText && cue2.translatedText
      ? `${cue1.translatedText} ${cue2.translatedText}`.trim()
      : (cue1.translatedText || cue2.translatedText || '')

    const mergedCue: CueItem = {
      id: cue1.id,
      startTime,
      endTime,
      duration: +(endTime - startTime).toFixed(3),
      originalText: mergedOriginal,
      translatedText: mergedTranslated,
      speakerId: cue1.speakerId,
      confidence: Math.min(cue1.confidence ?? 1, cue2.confidence ?? 1),
      isContinuation: false,
      audioFile: undefined,
      audioDuration: undefined,
      status: 'pending'
    }

    const updated = cues
      .filter((c) => c.id !== id2)
      .map((c) => (c.id === id1 ? mergedCue : c))
      .sort((a, b) => a.startTime - b.startTime)

    set({ cues: updated, selectedCueId: mergedCue.id })
  },

  deleteCue: (id) => {
    set((state) => ({
      cues: state.cues.filter((c) => c.id !== id),
      selectedCueId: state.selectedCueId === id ? null : state.selectedCueId
    }))
  },

  addCue: (cueData) => {
    const { cues } = get()
    const nextId = Math.max(0, ...cues.map((c) => c.id)) + 1
    const newCue: CueItem = {
      ...cueData,
      id: nextId,
      duration: +(cueData.endTime - cueData.startTime).toFixed(3)
    }
    const updated = [...cues, newCue].sort((a, b) => a.startTime - b.startTime)
    set({ cues: updated, selectedCueId: nextId })
  },

  saveCuesToServer: async (projectId: string) => {
    const { cues } = get()
    set({ isSyncing: true })
    try {
      const res = await fetch('/api/step1/update-cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          cues: cues.map((c) => ({
            id: c.id,
            startTime: c.startTime,
            endTime: c.endTime,
            originalText: c.originalText,
            translatedText: c.translatedText,
            speakerId: c.speakerId
          }))
        })
      })
      set({ isSyncing: false })
      return res.ok
    } catch {
      set({ isSyncing: false })
      return false
    }
  }
}))
