import { create } from 'zustand';
import type { ModelItem, HardwareInfo, HardwareRecommendation, ModelRecommendationsResponse, ModelStatusResponse } from '../types';
import { apiClient } from '../core/apiClient';
import { streamSSE } from '../core/sseClient';

export interface DownloadProgress {
  modelId: string;
  percent: number;
  downloadedMb: number;
  totalMb: number;
  isDownloading: boolean;
  error?: string;
}

interface ModelState {
  models: ModelItem[];
  hardware: HardwareInfo | null;
  recommended: HardwareRecommendation;
  isLoading: boolean;
  downloadingModelId: string | null;
  downloads: Record<string, DownloadProgress>;

  // Actions
  fetchModels: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<boolean>;
  isDownloaded: (modelId: string) => boolean;
  isDownloading: (modelId: string) => boolean;
  getModel: (modelId: string) => ModelItem | undefined;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  hardware: null,
  recommended: {},
  isLoading: false,
  downloadingModelId: null,
  downloads: {},

  fetchModels: async () => {
    set({ isLoading: true });
    try {
      const data = await apiClient.get<ModelStatusResponse>('/api/models/status');
      set({
        models: data.models || [],
        hardware: data.hardware || null,
      });

      const recData = await apiClient.get<ModelRecommendationsResponse>('/api/models/recommendations');
      set({
        recommended: recData.recommended || {},
        hardware: recData.hardware || get().hardware,
      });
    } catch (err) {
      console.warn('Không thể nạp danh mục model:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  downloadModel: async (modelId: string) => {
    const { downloadingModelId } = get();
    // Chặn tải đồng thời (Single-Download Queue Lock)
    if (downloadingModelId) {
      return false;
    }

    set({
      downloadingModelId: modelId,
      downloads: {
        ...get().downloads,
        [modelId]: {
          modelId,
          percent: 0,
          downloadedMb: 0,
          totalMb: 0,
          isDownloading: true,
        },
      },
    });

    try {
      return await new Promise<boolean>((resolve) => {
        streamSSE(
          '/api/models/download',
          { modelId },
          {
            onProgress: (data) => {
              const dMb = (data as unknown as Record<string, number>).downloadedMb ?? 0;
              const tMb = (data as unknown as Record<string, number>).totalMb ?? 0;
              set((state) => ({
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    modelId,
                    percent: data.percent ?? 0,
                    downloadedMb: dMb,
                    totalMb: tMb,
                    isDownloading: true,
                  },
                },
              }));
            },
            onComplete: () => {
              set((state) => ({
                downloadingModelId: null,
                models: state.models.map((m) => (m.id === modelId ? { ...m, is_downloaded: true } : m)),
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    ...state.downloads[modelId],
                    percent: 100,
                    isDownloading: false,
                  },
                },
              }));
              get().fetchModels();
              resolve(true);
            },
            onError: (err) => {
              set((state) => ({
                downloadingModelId: null,
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    ...state.downloads[modelId],
                    isDownloading: false,
                    error: err.message || 'Lỗi tải mô hình.',
                  },
                },
              }));
              resolve(false);
            },
          }
        ).catch(() => {
          set((state) => ({
            downloadingModelId: null,
            downloads: {
              ...state.downloads,
              [modelId]: {
                ...state.downloads[modelId],
                isDownloading: false,
                error: 'Mất kết nối tải mô hình.',
              },
            },
          }));
          resolve(false);
        });
      });
    } catch {
      set({ downloadingModelId: null });
      return false;
    }
  },

  isDownloaded: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId);
    return model ? model.is_downloaded : false;
  },

  isDownloading: (modelId: string) => {
    return get().downloadingModelId === modelId;
  },

  getModel: (modelId: string) => {
    return get().models.find((m) => m.id === modelId);
  },
}));
