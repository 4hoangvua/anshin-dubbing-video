import { create } from 'zustand';
import type { Project, DubbingSettings, SpeakerProfile, ExportInfo, HealthStatus } from '../types';
import { apiClient } from '../core/apiClient';
import { useCueStore } from './cueStore';
import { useTimelineStore } from './timelineStore';
import { usePlayerStore } from './playerStore';

interface ProjectState {
  project: Project | null;
  activeStep: 1 | 2 | 3 | 4;
  backendConnected: boolean;
  gpuInfo: HealthStatus['system'] | null;
  isLoading: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  error: string | null;

  // Actions
  setProject: (project: Project | null) => void;
  setActiveStep: (step: 1 | 2 | 3 | 4) => void;
  setBackendConnected: (connected: boolean) => void;
  setGpuInfo: (info: HealthStatus['system'] | null) => void;
  updateSettings: (settings: Partial<DubbingSettings>) => void;
  addSpeaker: (speaker: SpeakerProfile) => void;
  updateSpeaker: (speakerId: string, updates: Partial<SpeakerProfile>) => void;
  removeSpeaker: (speakerId: string) => void;
  setExportInfo: (info: ExportInfo) => void;
  loadProject: (projectId: string) => Promise<boolean>;
  saveProject: () => Promise<boolean>;
  checkHealth: () => Promise<boolean>;
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
  autoDucking: false,
  duckingVolume: 0.15,
  duckAttackMs: 150,
  duckReleaseMs: 400,
  sourceVolumeDb: -12.0,
  ttsVolumeDb: 0.0,
  exportSubtitleType: 'soft',
  videoCodec: 'h264_nvenc',
  resolution: 'original',
};

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
    set({ project });
    if (project?.cues) {
      useCueStore.getState().setCues(project.cues, false);
    }
    // Deselect any previous active element
    useCueStore.getState().setSelectedCueId(null);
    useTimelineStore.getState().setSelectedElement(null);

    const dur = project?.videoInfo?.duration || 0;
    if (dur > 0) {
      usePlayerStore.getState().setDuration(dur);
      useTimelineStore.getState().setVideoClips([
        {
          id: 'video_clip_0',
          startTime: 0,
          duration: dur,
          trimStart: 0,
          trimEnd: 0,
          volume: 1.0,
          muted: false,
        },
      ]);
    } else {
      useTimelineStore.getState().setVideoClips([]);
    }
  },

  setActiveStep: (activeStep) => set({ activeStep }),
  setBackendConnected: (backendConnected) => set({ backendConnected }),
  setGpuInfo: (gpuInfo) => set({ gpuInfo }),

  updateSettings: (newSettings) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        settings: { ...project.settings, ...newSettings },
      },
    });
  },

  addSpeaker: (speaker) => {
    const { project } = get();
    if (!project) return;
    if (project.speakers.some((s) => s.id === speaker.id)) return;
    set({
      project: {
        ...project,
        speakers: [...project.speakers, speaker],
      },
    });
  },

  updateSpeaker: (speakerId, updates) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        speakers: project.speakers.map((s) => (s.id === speakerId ? { ...s, ...updates } : s)),
      },
    });
  },

  removeSpeaker: (speakerId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        speakers: project.speakers.filter((s) => s.id !== speakerId),
      },
    });
  },

  setExportInfo: (exportInfo) => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, exportInfo },
    });
  },

  loadProject: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiClient.get<Project>(`/api/project/load?projectId=${encodeURIComponent(projectId.trim())}`);
      get().setProject(data);
      set({ activeStep: (data.currentStep as 1 | 2 | 3 | 4) || 1 });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể tải dự án';
      set({ error: message });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  saveProject: async () => {
    const { project } = get();
    if (!project) return false;

    set({ isSaving: true, error: null });
    try {
      const currentCues = useCueStore.getState().cues;
      const payload: Project = {
        ...project,
        cues: currentCues,
        updatedAt: new Date().toISOString(),
      };

      const res = await apiClient.post<{ success: boolean; updatedAt: string }>('/api/project/save', {
        projectId: project.projectId,
        project: payload,
      });

      if (res.success) {
        set({
          project: payload,
          lastSavedAt: res.updatedAt || new Date().toISOString(),
        });
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi khi lưu dự án';
      set({ error: message });
      return false;
    } finally {
      set({ isSaving: false });
    }
  },

  checkHealth: async () => {
    try {
      const data = await apiClient.get<HealthStatus>('/api/health');
      set({
        backendConnected: true,
        gpuInfo: data.system || null,
      });
      return true;
    } catch {
      set({ backendConnected: false, gpuInfo: null });
      return false;
    }
  },
}));
