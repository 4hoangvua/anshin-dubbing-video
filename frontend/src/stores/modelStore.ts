import { create } from 'zustand'
import type { ModelItem, HardwareInfo } from '../types'

export interface DownloadProgress {
  modelId: string
  percent: number
  downloadedMb: number
  totalMb: number
  isDownloading: boolean
  error?: string
}

interface ModelState {
  models: ModelItem[]
  hardware: HardwareInfo | null
  recommended: {
    tier?: string
    asrModel?: string
    mtModel?: string
    ttsModel?: string
  }
  isLoading: boolean
  downloadingModelId: string | null
  downloads: Record<string, DownloadProgress>

  // Actions
  fetchModels: () => Promise<void>
  downloadModel: (modelId: string) => Promise<boolean>
  isDownloaded: (modelId: string) => boolean
  isDownloading: (modelId: string) => boolean
  getModel: (modelId: string) => ModelItem | undefined
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  hardware: null,
  recommended: {},
  isLoading: false,
  downloadingModelId: null,
  downloads: {},

  fetchModels: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/models/status')
      if (res.ok) {
        const data = await res.json()
        set({
          models: data.models || [],
          hardware: data.hardware || null
        })
      }

      const recRes = await fetch('/api/models/recommendations')
      if (recRes.ok) {
        const recData = await recRes.json()
        set({
          recommended: recData.recommended || {},
          hardware: recData.hardware || get().hardware
        })
      }
    } catch (err) {
      console.warn('Lỗi khi tải thông tin model:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  downloadModel: async (modelId: string): Promise<boolean> => {
    const { downloadingModelId } = get()
    if (downloadingModelId && downloadingModelId !== modelId) {
      const activeModel = get().models.find((m) => m.id === downloadingModelId)
      alert(
        `Hệ thống đang tải mô hình "${activeModel?.name || downloadingModelId}". Vui lòng chờ tải xong trước khi tải mô hình tiếp theo!`
      )
      return false
    }

    set((state) => ({
      downloadingModelId: modelId,
      downloads: {
        ...state.downloads,
        [modelId]: {
          modelId,
          percent: 0,
          downloadedMb: 0,
          totalMb: 0,
          isDownloading: true
        }
      }
    }))

    try {
      const response = await fetch('/api/models/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({ modelId })
      })

      if (!response.ok) {
        throw new Error(`Lỗi máy chủ (${response.status})`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Trình duyệt không hỗ trợ đọc Stream')

      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          if (!block.trim()) continue
          const lines = block.split('\n')
          let eventType = 'message'
          let rawData = ''

          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.replace('event:', '').trim()
            if (line.startsWith('data:')) rawData = line.replace('data:', '').trim()
          }

          if (!rawData) continue

          try {
            const data = JSON.parse(rawData)
            if (eventType === 'progress') {
              set((state) => ({
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    modelId,
                    percent: data.percent ?? 0,
                    downloadedMb: data.downloadedMb ?? 0,
                    totalMb: data.totalMb ?? 0,
                    isDownloading: true
                  }
                }
              }))
            } else if (eventType === 'complete') {
              set((state) => ({
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    ...state.downloads[modelId],
                    percent: 100,
                    isDownloading: false
                  }
                }
              }))
              // Refresh lại models từ backend để cập nhật is_downloaded: true
              await get().fetchModels()
              return true
            } else if (eventType === 'error') {
              const errMsg = data.message || 'Lỗi khi tải model'
              set((state) => ({
                downloads: {
                  ...state.downloads,
                  [modelId]: {
                    ...state.downloads[modelId],
                    isDownloading: false,
                    error: errMsg
                  }
                }
              }))
              alert(errMsg)
              return false
            }
          } catch {
            // bỏ qua chunk lỗi parse
          }
        }
      }

      // Sau khi đọc hết stream
      await get().fetchModels()
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối khi tải model'
      set((state) => ({
        downloads: {
          ...state.downloads,
          [modelId]: {
            ...state.downloads[modelId],
            isDownloading: false,
            error: msg
          }
        }
      }))
      alert(msg)
      return false
    } finally {
      set({ downloadingModelId: null })
    }
  },

  isDownloaded: (modelId: string): boolean => {
    const { models } = get()
    // Hỗ trợ kiểm tra theo ID chính xác hoặc alias
    const model = models.find((m) => m.id === modelId)
    return !!model?.is_downloaded
  },

  isDownloading: (modelId: string): boolean => {
    const { downloads } = get()
    return !!downloads[modelId]?.isDownloading
  },

  getModel: (modelId: string): ModelItem | undefined => {
    return get().models.find((m) => m.id === modelId)
  }
}))
