import React, { useState, useEffect, useMemo } from 'react'
import {
  Sparkles,
  Play,
  Scissors,
  GitMerge,
  Trash2,
  RefreshCw,
  Sliders,
  Check,
  Download,
  Loader2
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useCueStore } from '../../stores/cueStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useModelStore } from '../../stores/modelStore'
import { useSSE } from '../../hooks/useSSE'
import { VirtualCueTable } from '../virtual/VirtualCueTable'
import { formatTime } from '../../lib/utils'
import type { CueItem } from '../../types'

export const RecognitionStep: React.FC = () => {
  const project = useProjectStore((s) => s.project)
  const updateSettings = useProjectStore((s) => s.updateSettings)

  const cues = useCueStore((s) => s.cues)
  const setCues = useCueStore((s) => s.setCues)
  const updateCue = useCueStore((s) => s.updateCue)
  const updateSpeaker = useCueStore((s) => s.updateSpeaker)
  const deleteCue = useCueStore((s) => s.deleteCue)
  const splitCue = useCueStore((s) => s.splitCue)
  const mergeCues = useCueStore((s) => s.mergeCues)
  const isSyncing = useCueStore((s) => s.isSyncing)
  const saveCuesToServer = useCueStore((s) => s.saveCuesToServer)

  const seekTo = usePlayerStore((s) => s.seekTo)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)

  const models = useModelStore((s) => s.models)
  const recommendedIds = useModelStore((s) => s.recommended)
  const downloadingModelId = useModelStore((s) => s.downloadingModelId)
  const downloads = useModelStore((s) => s.downloads)
  const downloadModel = useModelStore((s) => s.downloadModel)

  const asrModels = useMemo(() => models.filter((m) => m.category === 'asr'), [models])

  const { isRunning, percent, stage, message, startStream, stopStream, error } = useSSE()

  // Local settings for Step 1
  const [mode, setMode] = useState<'asr' | 'ocr'>(project?.settings.recognitionMode || 'asr')
  const [model, setModel] = useState<string>(project?.settings.asrModel || 'small')
  const [lang, setLang] = useState<string>(project?.settings.sourceLang || 'zh')
  const [vad, setVad] = useState<boolean>(true)
  const [showConfig, setShowConfig] = useState<boolean>(false)

  // Tự động chọn model ASR đã tải sẵn
  useEffect(() => {
    if (asrModels.length > 0) {
      const isCurDown = asrModels.some((m) => (m.id === `whisper-${model}` || m.id === model) && m.is_downloaded)
      if (!isCurDown) {
        const firstDown = asrModels.find((m) => m.is_downloaded)
        if (firstDown) {
          const nextModel = firstDown.id.replace('whisper-', '')
          if (nextModel !== model) setModel(nextModel)
        } else if (recommendedIds.asrModel) {
          const nextModel = recommendedIds.asrModel.replace('whisper-', '')
          if (nextModel !== model) setModel(nextModel)
        }
      }
    }
  }, [asrModels, recommendedIds.asrModel, model])

  const currentAsrModel = asrModels.find((m) => m.id === `whisper-${model}` || m.id === model)
  const isSelectedDownloaded = currentAsrModel?.is_downloaded ?? false
  const isSelectedDownloading = currentAsrModel ? downloadingModelId === currentAsrModel.id : false
  const selectedProgress = currentAsrModel ? downloads[currentAsrModel.id] : undefined

  // Split modal state
  const [splitTargetCue, setSplitTargetCue] = useState<CueItem | null>(null)
  const [splitTime, setSplitTime] = useState<number>(0)
  const [splitText1, setSplitText1] = useState<string>('')
  const [splitText2, setSplitText2] = useState<string>('')

  const handleStartRecognition = async () => {
    if (!project) return

    updateSettings({
      recognitionMode: mode,
      asrModel: model,
      sourceLang: lang
    })

    await startStream(
      '/api/step1/recognize',
      {
        projectId: project.projectId,
        mode,
        model,
        lang,
        vad,
        smartSplit: true,
        maxPause: 0.4,
        maxDuration: 5.0
      },
      {
        onComplete: (event) => {
          if (event.cues && Array.isArray(event.cues)) {
            setCues(event.cues)
            const curProj = useProjectStore.getState().project
            if (curProj) {
              useProjectStore.setState({
                project: {
                  ...curProj,
                  cues: event.cues,
                  updatedAt: new Date().toISOString()
                }
              })
            }
          }
        }
      }
    )
  }

  const handlePlayCue = (cue: CueItem) => {
    seekTo(cue.startTime)
    setIsPlaying(true)
  }

  const openSplitModal = (cue: CueItem) => {
    setSplitTargetCue(cue)
    const mid = +(cue.startTime + (cue.endTime - cue.startTime) / 2).toFixed(2)
    setSplitTime(mid)
    const words = cue.originalText.split(' ')
    const midWord = Math.floor(words.length / 2)
    setSplitText1(words.slice(0, midWord).join(' '))
    setSplitText2(words.slice(midWord).join(' '))
  }

  const handleConfirmSplit = () => {
    if (!splitTargetCue) return
    splitCue(splitTargetCue.id, splitTime, splitText1, splitText2)
    setSplitTargetCue(null)
  }

  const handleSaveCues = async () => {
    if (!project) return
    await saveCuesToServer(project.projectId)
  }

  // Row renderer for VirtualCueTable
  const renderCueRow = (cue: CueItem, index: number) => {
    const nextCue = cues[index + 1]

    return (
      <div className="flex items-start gap-2 p-2.5 border-b border-slate-800/80 hover:bg-slate-900/60 transition group text-xs text-slate-200">
        {/* Index */}
        <div className="w-8 pt-1 text-center font-mono text-slate-400 shrink-0">
          #{cue.id}
        </div>

        {/* Timestamp & Duration */}
        <div className="w-28 shrink-0 flex flex-col gap-1 pt-0.5">
          <div className="flex items-center gap-1 font-mono text-[11px] text-slate-300">
            <span>{formatTime(cue.startTime)}</span>
            <span className="text-slate-400">➔</span>
            <span>{formatTime(cue.endTime)}</span>
          </div>
          <span className="text-[10px] text-indigo-400/80 font-mono">
            {cue.duration?.toFixed(2) ?? (cue.endTime - cue.startTime).toFixed(2)}s
          </span>
        </div>

        {/* Speaker Picker */}
        <div className="w-28 shrink-0 pt-0.5">
          <select
            value={cue.speakerId || 'SPEAKER_00'}
            onChange={(e) => updateSpeaker(cue.id, e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            {project?.speakers && project.speakers.length > 0 ? (
              project.speakers.map((spk) => (
                <option key={spk.id} value={spk.id}>
                  {spk.name || spk.id}
                </option>
              ))
            ) : (
              <option value="SPEAKER_00">SPEAKER_00</option>
            )}
          </select>
        </div>

        {/* Original Text Input */}
        <div className="flex-1 min-w-0">
          <textarea
            value={cue.originalText}
            rows={2}
            onChange={(e) => updateCue(cue.id, { originalText: e.target.value })}
            placeholder="Nội dung câu nhận diện..."
            className="w-full bg-slate-900/90 hover:bg-slate-900 focus:bg-slate-950 border border-slate-700/80 focus:border-indigo-500 rounded p-1.5 text-xs text-slate-100 resize-none transition focus:outline-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 pt-1">
          <button
            onClick={() => handlePlayCue(cue)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition"
            title="Nghe câu này trên Video"
          >
            <Play className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => openSplitModal(cue)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition"
            title="Tách câu"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>

          {nextCue && (
            <button
              onClick={() => mergeCues(cue.id, nextCue.id)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition"
              title="Gộp với câu tiếp theo"
            >
              <GitMerge className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => deleteCue(cue.id)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
            title="Xóa câu"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Step 1 Control Toolbar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          {/* Left: Mode and Language */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-800 rounded p-0.5 text-xs">
              <button
                onClick={() => setMode('asr')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  mode === 'asr' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Faster-Whisper (ASR)
              </button>
              <button
                onClick={() => setMode('ocr')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  mode === 'ocr' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nhận diện OCR
              </button>
            </div>

            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="zh">Tiếng Trung (zh)</option>
              <option value="en">Tiếng Anh (en)</option>
              <option value="ja">Tiếng Nhật (ja)</option>
              <option value="ko">Tiếng Hàn (ko)</option>
              <option value="vi">Tiếng Việt (vi)</option>
            </select>

            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
                showConfig
                  ? 'bg-slate-800 text-indigo-400 border-indigo-500/50'
                  : 'bg-slate-850 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Cấu hình nâng cao"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {cues.length > 0 && (
              <button
                onClick={handleSaveCues}
                disabled={isSyncing}
                className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isSyncing ? 'Đang lưu...' : 'Lưu Cues'}</span>
              </button>
            )}

            {isRunning ? (
              <button
                onClick={stopStream}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow transition cursor-pointer"
              >
                <span>Dừng nhận diện</span>
              </button>
            ) : isSelectedDownloading ? (
              <div className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-950/80 border border-indigo-700/60 rounded text-xs text-indigo-300 font-semibold shadow">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Đang tải {selectedProgress?.percent || 0}% ({selectedProgress?.downloadedMb || 0} MB)...</span>
              </div>
            ) : mode === 'asr' && !isSelectedDownloaded && currentAsrModel ? (
              <button
                onClick={() => downloadModel(currentAsrModel.id)}
                disabled={!!downloadingModelId}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-amber-600/30 transition cursor-pointer"
                title="Mô hình này chưa có trên máy. Bấm vào đây để tải trực tiếp 1-click!"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {downloadingModelId ? 'Đang có model khác tải...' : `Tải Whisper ${model.toUpperCase()} (${currentAsrModel.size_mb} MB)`}
                </span>
              </button>
            ) : (
              <button
                onClick={handleStartRecognition}
                disabled={!project}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Bắt đầu nhận diện</span>
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Config */}
        {showConfig && (
          <div className="pt-2 border-t border-slate-800/80 flex items-center gap-4 text-xs text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Model:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200"
              >
                {asrModels.length > 0 ? (
                  asrModels.map((m) => {
                    const shortCode = m.id.replace('whisper-', '')
                    const isRec = recommendedIds.asrModel === m.id
                    return (
                      <option key={m.id} value={shortCode}>
                        {m.is_downloaded ? '🟢 [Sẵn sàng]' : '☁️ [Chưa tải]'} {m.name} {isRec ? '⭐ Khuyên dùng' : ''} {!m.is_downloaded ? `(${m.size_mb} MB)` : ''}
                      </option>
                    )
                  })
                ) : (
                  <>
                    <option value="tiny">tiny (nhanh nhất)</option>
                    <option value="small">small (tối ưu)</option>
                    <option value="medium">medium</option>
                  </>
                )}
              </select>
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={vad}
                onChange={(e) => setVad(e.target.checked)}
                className="rounded accent-indigo-500"
              />
              <span>Bật Silero VAD (Lọc khoảng lặng)</span>
            </label>
          </div>
        )}

        {/* SSE Progress Bar */}
        {isRunning && (
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {stage || 'Đang xử lý...'}
              </span>
              <span className="font-mono text-slate-300">{percent}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            {message && <p className="text-[11px] text-slate-400 truncate">{message}</p>}
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="p-2 bg-rose-950/60 border border-rose-800 rounded text-rose-300 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Virtualized Cues Table */}
      <VirtualCueTable
        items={cues}
        estimateSize={74}
        header={
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="w-8 text-center">#</span>
            <span className="w-28">Thời gian</span>
            <span className="w-28">Người nói</span>
            <span className="flex-1">Câu gốc ({cues.length} câu)</span>
            <span className="w-24 text-right pr-2">Thao tác</span>
          </div>
        }
        renderRow={renderCueRow}
        emptyMessage="Chưa có câu thoại nào. Nhấn 'Bắt đầu nhận diện' để trích xuất phụ đề từ video."
      />

      {/* Split Cue Dialog */}
      {splitTargetCue && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl text-slate-200">
            <div className="flex items-center gap-2 mb-3 text-amber-400 font-semibold text-sm">
              <Scissors className="w-4 h-4" />
              <span>Tách câu #{splitTargetCue.id}</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">
                  Mốc thời gian chia tách (giây):
                </label>
                <input
                  type="number"
                  step="0.05"
                  min={splitTargetCue.startTime}
                  max={splitTargetCue.endTime}
                  value={splitTime}
                  onChange={(e) => setSplitTime(parseFloat(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
                />
                <span className="text-[11px] text-slate-400">
                  Từ {formatTime(splitTargetCue.startTime)} đến {formatTime(splitTargetCue.endTime)}
                </span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Đoạn 1:</label>
                <textarea
                  value={splitText1}
                  rows={2}
                  onChange={(e) => setSplitText1(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Đoạn 2:</label>
                <textarea
                  value={splitText2}
                  rows={2}
                  onChange={(e) => setSplitText2(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSplitTargetCue(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmSplit}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold"
              >
                Xác nhận tách
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
