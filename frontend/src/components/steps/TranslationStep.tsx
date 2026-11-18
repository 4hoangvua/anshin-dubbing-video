import React, { useState } from 'react'
import {
  Languages,
  RefreshCw,
  Sparkles,
  Play,
  Sliders,
  Users,
  Check,
  AlertCircle,
  Layers
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useCueStore } from '../../stores/cueStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useSSE } from '../../hooks/useSSE'
import { VirtualCueTable } from '../virtual/VirtualCueTable'
import { ModelHubModal } from '../ModelHubModal'
import { formatTime } from '../../lib/utils'
import type { CueItem } from '../../types'

export const TranslationStep: React.FC = () => {
  const project = useProjectStore((s) => s.project)
  const updateSettings = useProjectStore((s) => s.updateSettings)
  const updateSpeaker = useProjectStore((s) => s.updateSpeaker)

  const cues = useCueStore((s) => s.cues)
  const updateCue = useCueStore((s) => s.updateCue)
  const saveCuesToServer = useCueStore((s) => s.saveCuesToServer)

  const seekTo = usePlayerStore((s) => s.seekTo)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)

  const { isRunning, percent, stage, message, startStream, stopStream, error } = useSSE()

  // Local settings
  const [mtEngine, setMtEngine] = useState<string>('hy-mt2-1.8b-q8')
  const [genre, setGenre] = useState<string>(project?.settings.translationGenre || 'tech_tutorial')
  const [persona, setPersona] = useState<string>(project?.settings.translationPersona || 'neutral')
  const [tgtLang, setTgtLang] = useState<string>(project?.settings.targetLang || 'vi')
  const [stylePrompt, setStylePrompt] = useState<string>('')
  const [showConfig, setShowConfig] = useState<boolean>(false)
  const [showPronouns, setShowPronouns] = useState<boolean>(false)
  const [showModelHub, setShowModelHub] = useState<boolean>(false)

  // Single cue translation state
  const [singleTranslatingId, setSingleTranslatingId] = useState<number | null>(null)
  const [customInstructionModalCue, setCustomInstructionModalCue] = useState<CueItem | null>(null)
  const [customInstruction, setCustomInstruction] = useState<string>('')

  const handleStartTranslateAll = async () => {
    if (!project) return

    updateSettings({
      translationGenre: genre,
      translationPersona: persona,
      targetLang: tgtLang
    })

    await startStream(
      '/api/step2/translate',
      {
        projectId: project.projectId,
        genre,
        persona,
        srcLang: project.settings.sourceLang || 'zh',
        tgtLang,
        reconstruct: true,
        stylePrompt,
        modelEngine: mtEngine
      },
      {
        onComplete: (event) => {
          if (event.cues && Array.isArray(event.cues)) {
            // Merge translated text and recommendations into current cues
            event.cues.forEach((resCue) => {
              updateCue(resCue.id, {
                translatedText: resCue.translatedText,
                isContinuation: resCue.isContinuation,
                recommendedTtsSpeedRate: resCue.recommendedTtsSpeedRate
              })
            })
          }
        }
      }
    )
  }

  const handleTranslateSingle = async (cue: CueItem, instruction?: string) => {
    if (!project) return
    setSingleTranslatingId(cue.id)

    try {
      const res = await fetch('/api/step2/translate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.projectId,
          cueId: cue.id,
          sourceText: cue.originalText,
          targetLang: tgtLang,
          persona,
          customInstruction: instruction || undefined,
          modelEngine: mtEngine
        })
      })

      if (!res.ok) {
        throw new Error(`Dịch câu thất bại: HTTP ${res.status}`)
      }

      const data = await res.json()
      updateCue(cue.id, {
        translatedText: data.translatedText,
        recommendedTtsSpeedRate: data.recommendedSpeedRate
      })
      setCustomInstructionModalCue(null)
      setCustomInstruction('')
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setSingleTranslatingId(null)
    }
  }

  const renderCueRow = (cue: CueItem) => {
    const isSingleLoading = singleTranslatingId === cue.id

    return (
      <div className="flex items-start gap-2 p-2.5 border-b border-slate-800/80 hover:bg-slate-900/60 transition group text-xs text-slate-200">
        {/* Index & Timestamps */}
        <div className="w-20 shrink-0 pt-0.5">
          <div className="flex items-center gap-1">
            <span className="font-mono text-slate-400 font-semibold">#{cue.id}</span>
            {cue.speakerId && (
              <span className="text-[10px] bg-slate-800 text-indigo-300 px-1 py-0.2 rounded truncate">
                {cue.speakerId}
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            {formatTime(cue.startTime)} - {formatTime(cue.endTime)}
          </div>
          {cue.recommendedTtsSpeedRate && (
            <span className="text-[10px] text-emerald-400 font-mono" title="Tốc độ đọc khuyến nghị">
              {cue.recommendedTtsSpeedRate}x speed
            </span>
          )}
        </div>

        {/* Source Column */}
        <div className="flex-1 bg-slate-950/70 border border-slate-800/80 rounded p-2 text-slate-300 select-text leading-relaxed">
          <p>{cue.originalText}</p>
        </div>

        {/* Arrow divider */}
        <div className="pt-2 text-slate-600 shrink-0">➔</div>

        {/* Target Translation Column (Editable) */}
        <div className="flex-1 relative">
          <textarea
            value={cue.translatedText || ''}
            rows={2}
            onChange={(e) => updateCue(cue.id, { translatedText: e.target.value })}
            placeholder="Nội dung bản dịch tiếng Việt..."
            className="w-full bg-slate-900 hover:bg-slate-900/80 focus:bg-slate-950 border border-slate-700/80 focus:border-indigo-500 rounded p-2 text-xs text-indigo-100 placeholder-slate-600 resize-none transition focus:outline-none leading-relaxed"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0 pt-1">
          <button
            onClick={() => {
              seekTo(cue.startTime)
              setIsPlaying(true)
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition"
            title="Nghe câu gốc trên video"
          >
            <Play className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setCustomInstructionModalCue(cue)}
            disabled={isSingleLoading}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition disabled:opacity-50"
            title="Dịch lại câu này với yêu cầu riêng"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isSingleLoading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Control Toolbar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          {/* Left: Model Engine, Genre, Persona, Target Lang, Pronouns */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">Mô hình:</span>
              <select
                value={mtEngine}
                onChange={(e) => setMtEngine(e.target.value)}
                className="bg-slate-800 border border-indigo-500/40 rounded px-2 py-1 text-xs text-indigo-300 font-semibold focus:outline-none focus:border-indigo-500 shadow-sm"
              >
                <option value="hy-mt2-1.8b-q8">🎯 Hy-MT2 1.8B (Q8_0 - Mặc định)</option>
                <option value="hy-mt2-1.8b-q4">⚡ Hy-MT2 1.8B (Q4_K_M)</option>
                <option value="hy-mt2-1.8b-q125">🪶 Hy-MT2 1.8B (Q1.25 - 440MB)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">Thể loại:</span>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="tech_tutorial">Hướng dẫn công nghệ (Tech Tutorial)</option>
                <option value="news">Thời sự / Bản tin (News)</option>
                <option value="vlog">Vlog đời sống</option>
                <option value="movie">Phim ảnh / Kịch bản</option>
                <option value="educational">Bài giảng học thuật</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">Văn phong:</span>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="neutral">Trung tính (Neutral)</option>
                <option value="formal">Trang trọng (Formal)</option>
                <option value="informal">Thân mật / Gần gũi</option>
                <option value="enthusiastic">Nhiệt huyết / Hào hứng</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">Đích:</span>
              <select
                value={tgtLang}
                onChange={(e) => setTgtLang(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="vi">Tiếng Việt (vi)</option>
                <option value="en">English (en)</option>
                <option value="zh">Tiếng Trung (zh)</option>
              </select>
            </div>

            <button
              onClick={() => setShowPronouns(!showPronouns)}
              className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
                showPronouns
                  ? 'bg-slate-800 text-indigo-400 border-indigo-500/50'
                  : 'bg-slate-850 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Cấu hình đại từ xưng hô theo Speaker"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Xưng hô</span>
            </button>

            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
                showConfig
                  ? 'bg-slate-800 text-indigo-400 border-indigo-500/50'
                  : 'bg-slate-850 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Tùy chỉnh Prompt bổ sung"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {cues.length > 0 && (
              <button
                onClick={() => project && saveCuesToServer(project.projectId)}
                className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Lưu Bản Dịch</span>
              </button>
            )}

            {isRunning ? (
              <button
                onClick={stopStream}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow transition"
              >
                <span>Dừng dịch</span>
              </button>
            ) : (
              <button
                onClick={handleStartTranslateAll}
                disabled={!project || cues.length === 0}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>Dịch toàn bộ (Hy-MT2 1.8B)</span>
              </button>
            )}
          </div>
        </div>

        {/* Speaker Pronoun Setting Box */}
        {showPronouns && project?.speakers && (
          <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-xs space-y-2">
            <span className="font-semibold text-slate-300 block">Cấu hình xưng hô cho từng Người nói:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {project.speakers.map((spk) => (
                <div key={spk.id} className="p-2 bg-slate-900 border border-slate-800 rounded flex flex-col gap-1.5">
                  <span className="font-medium text-indigo-300">{spk.name || spk.id}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 w-16">Xưng:</span>
                    <input
                      type="text"
                      value={spk.selfPronoun || 'tôi'}
                      onChange={(e) => updateSpeaker(spk.id, { selfPronoun: e.target.value })}
                      placeholder="tôi / mình"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 w-16">Gọi khán giả:</span>
                    <input
                      type="text"
                      value={spk.addressPronoun || 'các bạn'}
                      onChange={(e) => updateSpeaker(spk.id, { addressPronoun: e.target.value })}
                      placeholder="các bạn / quý vị"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Style Prompt Box */}
        {showConfig && (
          <div className="pt-2 border-t border-slate-800 text-xs">
            <label className="block text-slate-400 mb-1">
              Chỉ dẫn phong cách dịch bổ sung (Style Prompt):
            </label>
            <input
              type="text"
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="Ví dụ: Giữ nguyên các thuật ngữ tiếng Anh: API, Endpoint, Model, Thread..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        {/* SSE Progress Bar */}
        {isRunning && (
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {stage || 'Đang dịch thuật ngữ cảnh...'}
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

        {error && (
          <div className="p-3 bg-rose-950/70 border border-rose-700/80 rounded-xl text-xs text-rose-200 flex items-start justify-between gap-3 shadow-lg animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-rose-300 block mb-0.5">Không thể khởi chạy dịch thuật:</span>
                <span className="text-rose-200/90 leading-relaxed">{error}</span>
              </div>
            </div>
            <button
              onClick={() => setShowModelHub(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 shadow transition active:scale-95"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Mở Model Hub</span>
            </button>
          </div>
        )}
      </div>

      {/* Virtualized Cues Table */}
      <VirtualCueTable
        items={cues}
        estimateSize={80}
        header={
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="w-20"># & Thời gian</span>
            <span className="flex-1">Câu gốc</span>
            <span className="w-4 text-center"></span>
            <span className="flex-1">Bản dịch tiếng Việt</span>
            <span className="w-12 text-right pr-2">Thao tác</span>
          </div>
        }
        renderRow={renderCueRow}
        emptyMessage="Chưa có câu thoại nào để dịch. Vui lòng hoàn thành Bước 1 (Nhận diện) trước."
      />

      {/* Modal: Translate Single Cue with custom instruction */}
      {customInstructionModalCue && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl text-slate-200">
            <div className="flex items-center gap-2 mb-3 text-indigo-400 font-semibold text-sm">
              <Sparkles className="w-4 h-4" />
              <span>Dịch lại câu #{customInstructionModalCue.id}</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Câu gốc:</label>
                <div className="p-2 bg-slate-950 border border-slate-800 rounded text-slate-300">
                  {customInstructionModalCue.originalText}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Yêu cầu điều chỉnh dịch:</label>
                <textarea
                  value={customInstruction}
                  rows={3}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  placeholder="Ví dụ: Dịch ngắn gọn hơn để vừa thời gian đọc; dịch hài hước hơn; xưng 'thầy - các em'..."
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCustomInstructionModalCue(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() =>
                  handleTranslateSingle(customInstructionModalCue, customInstruction)
                }
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow"
              >
                Dịch lại ngay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zero-Config Model Hub Modal */}
      <ModelHubModal
        isOpen={showModelHub}
        onClose={() => setShowModelHub(false)}
      />
    </div>
  )
}
