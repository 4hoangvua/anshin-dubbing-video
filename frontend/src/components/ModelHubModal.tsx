import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Download,
  CheckCircle2,
  Cpu,
  HardDrive,
  Sparkles,
  Languages,
  Mic,
  AlertCircle,
  RefreshCw,
  Loader2,
  Layers,
  Zap
} from 'lucide-react'
import type { ModelItem, HardwareInfo } from '../types'

interface ModelHubModalProps {
  isOpen: boolean
  onClose: () => void
}

interface DownloadProgress {
  modelId: string
  percent: number
  downloadedMb: number
  totalMb: number
  isDownloading: boolean
  error?: string
}

export const ModelHubModal: React.FC<ModelHubModalProps> = ({ isOpen, onClose }) => {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [models, setModels] = useState<ModelItem[]>([])
  const [recommendedIds, setRecommendedIds] = useState<{ [key: string]: string }>({})
  const [isLoading, setIsLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'asr' | 'mt' | 'tts'>('all')

  // Quản lý tiến trình tải theo từng modelId
  const [downloads, setDownloads] = useState<{ [modelId: string]: DownloadProgress }>({})

  // Fetch trạng thái model từ backend
  const fetchStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/models/status')
      if (res.ok) {
        const data = await res.json()
        setHardware(data.hardware)
        setModels(data.models || [])
      }

      const recRes = await fetch('/api/models/recommendations')
      if (recRes.ok) {
        const recData = await recRes.json()
        setRecommendedIds(recData.recommended || {})
      }
    } catch (err) {
      console.warn('Lỗi khi tải danh sách model:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchStatus()
    }
  }, [isOpen, fetchStatus])

  // Tải model 1-Click qua SSE Stream
  const handleDownload = async (modelId: string) => {
    setDownloads((prev) => ({
      ...prev,
      [modelId]: {
        modelId,
        percent: 0,
        downloadedMb: 0,
        totalMb: 0,
        isDownloading: true
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
        throw new Error(`Lỗi máy chủ: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Không thể đọc luồng dữ liệu')

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
            if (line.startsWith('event:')) {
              eventType = line.replace('event:', '').trim()
            } else if (line.startsWith('data:')) {
              rawData = line.replace('data:', '').trim()
            }
          }

          if (!rawData) continue

          try {
            const parsed = JSON.parse(rawData)

            if (eventType === 'progress') {
              setDownloads((prev) => ({
                ...prev,
                [modelId]: {
                  modelId,
                  percent: parsed.percent || 0,
                  downloadedMb: parsed.downloadedMb || 0,
                  totalMb: parsed.totalMb || 0,
                  isDownloading: true
                }
              }))
            } else if (eventType === 'complete') {
              setDownloads((prev) => ({
                ...prev,
                [modelId]: {
                  modelId,
                  percent: 100,
                  downloadedMb: parsed.totalMb || 0,
                  totalMb: parsed.totalMb || 0,
                  isDownloading: false
                }
              }))
              // Cập nhật lại trạng thái sau khi tải xong
              fetchStatus()
            } else if (eventType === 'error') {
              setDownloads((prev) => ({
                ...prev,
                [modelId]: {
                  ...prev[modelId],
                  isDownloading: false,
                  error: parsed.message || 'Lỗi tải tệp'
                }
              }))
            }
          } catch (e) {
            console.warn('Lỗi parse SSE:', e)
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối'
      setDownloads((prev) => ({
        ...prev,
        [modelId]: {
          ...prev[modelId],
          isDownloading: false,
          error: msg
        }
      }))
    }
  }

  if (!isOpen) return null

  // Lọc model theo category
  const filteredModels = models.filter((m) =>
    selectedCategory === 'all' ? true : m.category === selectedCategory
  )

  const downloadedCount = models.filter((m) => m.is_downloaded).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Trung tâm Quản lý & Tải Mô hình AI
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                  Zero-Config
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tự động tối ưu theo phần cứng máy tính • Tải 1-Click lưu trực tiếp vào thư mục models/
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchStatus}
              disabled={isLoading}
              title="Làm mới trạng thái"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hardware Status Banner */}
        <div className="bg-slate-950/40 border-b border-slate-800/80 px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-slate-300">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span className="text-slate-400">Thiết bị:</span>
              <span className="font-semibold text-slate-200">
                {hardware?.device_name || 'Đang quét...'}
              </span>
            </div>

            {hardware?.cuda_available && (
              <div className="flex items-center gap-2 text-slate-300">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-slate-400">VRAM:</span>
                <span className="font-semibold text-amber-300">
                  {hardware.free_vram_mb} MB rảnh / {hardware.total_vram_mb} MB
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 text-slate-300">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">RAM:</span>
              <span className="font-semibold text-slate-200">{hardware?.total_ram_gb || 0} GB</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Đã cài đặt:</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              {downloadedCount} / {models.length} Model
            </span>
          </div>
        </div>

        {/* Category Filters */}
        <div className="px-6 py-2.5 border-b border-slate-800/60 bg-slate-900/50 flex items-center gap-2 text-xs">
          <span className="text-slate-400 mr-1 font-medium">Nhóm:</span>
          {(
            [
              { id: 'all', label: 'Tất cả', icon: Layers },
              { id: 'asr', label: '1. Nhận diện (ASR)', icon: Sparkles },
              { id: 'mt', label: '2. Dịch thuật (Hy-MT2)', icon: Languages },
              { id: 'tts', label: '3. Lồng tiếng (VieNeu)', icon: Mic }
            ] as const
          ).map((cat) => {
            const Icon = cat.icon
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  selectedCategory === cat.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cat.label}
              </button>
            )
          })}
        </div>

        {/* Model List Cards */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {isLoading && models.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <span>Đang kiểm tra tình trạng model trong máy...</span>
            </div>
          ) : (
            filteredModels.map((m) => {
              const dlState = downloads[m.id]
              const isDownloading = dlState?.isDownloading
              const isRecommended =
                recommendedIds.asrModel === m.id ||
                recommendedIds.mtModel === m.id ||
                recommendedIds.ttsModel === m.id

              return (
                <div
                  key={m.id}
                  className={`p-4 rounded-xl border transition-all ${
                    m.is_downloaded
                      ? 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                      : isRecommended
                      ? 'bg-indigo-950/15 border-indigo-500/40 shadow-sm'
                      : 'bg-slate-950/20 border-slate-800/60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white truncate">{m.name}</span>

                        {isRecommended && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-indigo-400" />
                            Khuyên dùng cho máy bạn
                          </span>
                        )}

                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 font-mono">
                          {m.size_mb >= 1000 ? `${(m.size_mb / 1024).toFixed(2)} GB` : `${m.size_mb} MB`}
                        </span>

                        <span className="text-[11px] text-slate-400">
                          Yêu cầu ~{m.vram_required_mb} MB VRAM
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{m.description}</p>
                    </div>

                    {/* Action Button */}
                    <div className="flex items-center gap-2 shrink-0">
                      {m.is_downloaded ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-emerald-400 text-xs font-medium">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Đã sẵn sàng</span>
                        </div>
                      ) : isDownloading ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/60 border border-indigo-700/50 text-indigo-300 text-xs font-medium">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                          <span>Đang tải {dlState.percent}%</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDownload(m.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition active:scale-95"
                        >
                          <Download className="w-4 h-4" />
                          <span>Tải về 1-Click</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar khi đang tải */}
                  {isDownloading && (
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                        <span className="text-indigo-300 flex items-center gap-1.5 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Đang tải trực tiếp từ HuggingFace...
                        </span>
                        <span>
                          {dlState.downloadedMb} MB / {dlState.totalMb || m.size_mb} MB ({dlState.percent}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                          style={{ width: `${dlState.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error Notification */}
                  {dlState?.error && (
                    <div className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{dlState.error}</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Mô hình được lưu trữ ngoại tuyến tại thư mục: <code className="text-slate-300 font-mono">dubbing-video/models/</code></span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-medium"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
