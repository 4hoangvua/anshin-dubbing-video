import { create } from 'zustand'
import type { Project, DubbingSettings, SpeakerProfile, ExportInfo, HealthStatus } from '../types'
import { useCueStore } from './cueStore'

interface ProjectState {
  project: Project | null
  activeStep: number
  backendConnected: boolean
  gpuInfo: HealthStatus['system'] | null
  isLoading: boolean
  isSaving: boolean
  lastSavedAt: string | null
  error: string | null

  // Actions
  setProject: (project: Project | null) => void
  setActiveStep: (step: number) => void
  setBackendConnected: (connected: boolean) => void
  setGpuInfo: (info: HealthStatus['system'] | null) => void
  updateSettings: (settings: Partial<DubbingSettings>) => void
  addSpeaker: (speaker: SpeakerProfile) => void
  updateSpeaker: (speakerId: string, updates: Partial<SpeakerProfile>) => void
  removeSpeaker: (speakerId: string) => void
  setExportInfo: (info: ExportInfo) => void
  loadProject: (projectId: string) => Promise<boolean>
  saveProject: () => Promise<boolean>
  checkHealth: () => Promise<boolean>
}

export const DEFAULT_SETTINGS: DubbingSettings = {
  sourceLang: 'zh',
  targetLang: 'vi',
  recognitionMode: 'asr',
  asrModel: 'small',
  translationGenre: 'tech_tutorial',
  translationPersona: 'neutral',
  voiceEngine: 'vieneu',
  defaultVoiceId: 'Mai Anh',
  autoMatchDuration: true,
  borrowGap: true,
  maxGapBorrowRatio: 0.85,
  maxBorrowSeconds: 3.5,
  autoDucking: true,
  duckingVolume: 0.15,
  duckAttackMs: 150,
  duckReleaseMs: 400,
  sourceVolumeDb: -12.0,
  ttsVolumeDb: 0.0,
  exportSubtitleType: 'soft',
  videoCodec: 'h264_nvenc',
  resolution: 'original'
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  activeStep: 1,
  backendConnected: false,
  gpuInfo: null,
  isLoading: false,
  isSaving: false,
  lastSavedAt: null,
  error: null,

  setProject: (project) => {
    set({
      project,
      activeStep: project?.currentStep || 1
    })
    if (project?.cues && Array.isArray(project.cues)) {
      useCueStore.getState().setCues(project.cues)
    }
  },

  setActiveStep: (step) => {
    const { project, saveProject } = get()
    set({ activeStep: step })
    if (project) {
      set({ project: { ...project, currentStep: step } })
      // Auto-save ngầm khi chuyển bước để bảo vệ 100% dữ liệu
      saveProject().catch((e) => console.warn('Auto-save failed:', e))
    }
  },

  setBackendConnected: (backendConnected) => set({ backendConnected }),
  setGpuInfo: (gpuInfo) => set({ gpuInfo }),

  updateSettings: (newSettings) => {
    const { project } = get()
    if (!project) return
    const updatedSettings = { ...project.settings, ...newSettings }
    set({
      project: {
        ...project,
        settings: updatedSettings,
        updatedAt: new Date().toISOString()
      }
    })
  },

  addSpeaker: (speaker) => {
    const { project } = get()
    if (!project) return
    set({
      project: {
        ...project,
        speakers: [...project.speakers, speaker],
        updatedAt: new Date().toISOString()
      }
    })
  },

  updateSpeaker: (speakerId, updates) => {
    const { project } = get()
    if (!project) return
    const updatedSpeakers = project.speakers.map((s) =>
      s.id === speakerId ? { ...s, ...updates } : s
    )
    set({
      project: {
        ...project,
        speakers: updatedSpeakers,
        updatedAt: new Date().toISOString()
      }
    })
  },

  removeSpeaker: (speakerId) => {
    const { project } = get()
    if (!project) return
    set({
      project: {
        ...project,
        speakers: project.speakers.filter((s) => s.id !== speakerId),
        updatedAt: new Date().toISOString()
      }
    })
  },

  setExportInfo: (exportInfo) => {
    const { project } = get()
    if (!project) return
    set({
      project: {
        ...project,
        exportInfo,
        updatedAt: new Date().toISOString()
      }
    })
  },

  checkHealth: async () => {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data: HealthStatus = await res.json()
        set({
          backendConnected: true,
          gpuInfo: data.system
        })
        return true
      }
      set({ backendConnected: false })
      return false
    } catch {
      set({ backendConnected: false })
      return false
    }
  },

  loadProject: async (projectId: string) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(`/api/project/load?projectId=${encodeURIComponent(projectId)}`)
      if (!res.ok) {
        throw new Error(`Tải dự án thất bại: HTTP ${res.status}`)
      }
      const data: Project = await res.json()
      set({
        project: data,
        activeStep: data.currentStep || 1,
        isLoading: false
      })
      if (data.cues && Array.isArray(data.cues)) {
        useCueStore.getState().setCues(data.cues)
      }
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi không xác định khi tải dự án'
      set({ error: msg, isLoading: false })
      return false
    }
  },

  saveProject: async () => {
    const { project } = get()
    if (!project) return false
    set({ isSaving: true })
    try {
      // Luôn đồng bộ danh sách cues mới nhất từ cueStore (nơi lưu các cập nhật dịch thuật, timing...)
      const currentCues = useCueStore.getState().cues
      const projectToSave = {
        ...project,
        cues: currentCues.length > 0 ? currentCues : project.cues
      }
      set({ project: projectToSave })

      const res = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectToSave.projectId,
          project: projectToSave
        })
      })
      if (!res.ok) {
        throw new Error(`Lưu dự án thất bại: HTTP ${res.status}`)
      }
      const data = await res.json()
      set({
        isSaving: false,
        lastSavedAt: data.updatedAt || new Date().toISOString()
      })
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi không xác định khi lưu dự án'
      set({ error: msg, isSaving: false })
      return false
    }
  }
}))
