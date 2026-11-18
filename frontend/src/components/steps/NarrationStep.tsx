import React, { useState, useEffect, useRef } from 'react'
import {
  Mic,
  RefreshCw,
  Play,
  Pause,
  AlertTriangle,
  Users,
  CheckCircle2,
  Share2,
  Sparkles,
  Clock,
  ShieldCheck,
  X
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useCueStore } from '../../stores/cueStore'
import { useSSE } from '../../hooks/useSSE'
import { VirtualCueTable } from '../virtual/VirtualCueTable'
import { formatTime } from '../../lib/utils'
import type { CueItem } from '../../types'

export interface VoiceOption {
  id: string
  name: string
  region: 'Bắc' | 'Trung' | 'Nam'
  gender: 'female' | 'male'
  style: string
  description?: string
}

// Danh sách 18 giọng đọc bản địa VieNeu-TTS v3 Turbo chuẩn NCKH
const PRESET_VOICES: VoiceOption[] = [
  // Miền Bắc
  { id: 'Mai Anh', name: 'Mai Anh (Nữ Bắc · Phát thanh viên, truyền cảm)', region: 'Bắc', gender: 'female', style: 'Tin tức / Diễn thuyết', description: 'Giọng chuẩn tin tức miền Bắc (Mặc định)' },
  { id: 'Minh Đức', name: 'Minh Đức (Nam Bắc · Trầm ấm, chuyên nghiệp)', region: 'Bắc', gender: 'male', style: 'Tin tức / Diễn thuyết', description: 'Giọng nam tin tức, thuyết minh tài liệu' },
  { id: 'Trúc Ly', name: 'Trúc Ly (Nữ Bắc · Tự nhiên, thanh thoát)', region: 'Bắc', gender: 'female', style: 'Tự nhiên / Đời thường', description: 'Giọng nữ đời thường trong trẻo' },
  { id: 'Đoan Trang', name: 'Đoan Trang (Nữ Bắc · Dịu dàng, nhẹ nhàng)', region: 'Bắc', gender: 'female', style: 'Tự nhiên / Nhẹ nhàng', description: 'Giọng nữ nhẹ nhàng, êm ái' },
  { id: 'Thanh Bình', name: 'Thanh Bình (Nam Bắc · Kể chuyện sâu lắng)', region: 'Bắc', gender: 'male', style: 'Kể chuyện / Review', description: 'Giọng nam review, kể chuyện' },
  { id: 'Quỳnh Anh', name: 'Quỳnh Anh (Nữ Bắc · Đọc truyện cảm xúc)', region: 'Bắc', gender: 'female', style: 'Đọc truyện / Cảm xúc', description: 'Giọng nữ đọc truyện tình cảm' },
  { id: 'Ngọc Huyền', name: 'Ngọc Huyền (Nữ Bắc · Trẻ trung, năng động)', region: 'Bắc', gender: 'female', style: 'Tự nhiên', description: 'Giọng nữ trẻ trung' },

  // Miền Trung
  { id: 'Quang Sơn', name: 'Quang Sơn (Nam Trung · Mộc mạc, gần gũi)', region: 'Trung', gender: 'male', style: 'Tự nhiên / Đời thường', description: 'Giọng nam miền Trung ấm áp' },
  { id: 'Ngọc Trân', name: 'Ngọc Trân (Nữ Trung · Dịu dàng, đằm thắm)', region: 'Trung', gender: 'female', style: 'Tự nhiên / Dịu dàng', description: 'Giọng nữ miền Trung tình cảm' },

  // Miền Nam
  { id: 'Thái Sơn', name: 'Thái Sơn (Nam Nam · Hào sảng, truyền cảm)', region: 'Nam', gender: 'male', style: 'Kể chuyện / Truyền cảm', description: 'Giọng nam miền Nam lôi cuốn' },
  { id: 'Xuân Vĩnh', name: 'Xuân Vĩnh (Nam Nam · Hóm hỉnh, đời thường)', region: 'Nam', gender: 'male', style: 'Tự nhiên / Đời thường', description: 'Giọng nam đời thường miền Nam' },
  { id: 'Thục Đoan', name: 'Thục Đoan (Nữ Nam · Kể chuyện ấm áp)', region: 'Nam', gender: 'female', style: 'Kể chuyện', description: 'Giọng nữ kể chuyện miền Nam' },
  { id: 'Minh Triết', name: 'Minh Triết (Nam Nam · Phóng sự, tin tức)', region: 'Nam', gender: 'male', style: 'Tin tức / Phóng sự', description: 'Giọng nam tin tức chuẩn miền Nam' },
  { id: 'Thùy Dung', name: 'Thùy Dung (Nữ Nam · Phát thanh viên)', region: 'Nam', gender: 'female', style: 'Tin tức', description: 'Giọng nữ phát thanh viên miền Nam' },
  { id: 'Mỹ Duyên', name: 'Mỹ Duyên (Nữ Nam · Ngọt ngào, dịu dàng)', region: 'Nam', gender: 'female', style: 'Đọc truyện / Ngọt ngào', description: 'Giọng nữ đọc truyện miền Nam' },
  { id: 'Đức Trí', name: 'Đức Trí (Nam Nam · Đọc truyện lôi cuốn)', region: 'Nam', gender: 'male', style: 'Đọc truyện', description: 'Giọng nam đọc truyện miền Nam' },
  { id: 'Kim Thanh', name: 'Kim Thanh (Nữ Nam · Đọc truyện giàu cảm xúc)', region: 'Nam', gender: 'female', style: 'Đọc truyện', description: 'Giọng nữ truyền cảm miền Nam' },
  { id: 'Adam', name: 'Adam (Nam Nam · Hiện đại, tự nhiên)', region: 'Nam', gender: 'male', style: 'Tự nhiên / Hiện đại', description: 'Giọng nam hiện đại, podcast' },
]

export const NarrationStep: React.FC = () => {
  const project = useProjectStore((s) => s.project)
  const updateSettings = useProjectStore((s) => s.updateSettings)
  const updateSpeaker = useProjectStore((s) => s.updateSpeaker)
  const saveProject = useProjectStore((s) => s.saveProject)
  const setActiveStep = useProjectStore((s) => s.setActiveStep)

  const cues = useCueStore((s) => s.cues)
  const setCues = useCueStore((s) => s.setCues)
  const updateAudio = useCueStore((s) => s.updateAudio)

  const synthesizedCount = cues.filter((c) => !!c.audioFile).length

  const { isRunning, percent, stage, message, startStream, stopStream, error } = useSSE()

  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(PRESET_VOICES)

  // Local settings
  const [autoMatchDuration, setAutoMatchDuration] = useState<boolean>(
    project?.settings.autoMatchDuration ?? true
  )
  const [borrowGap, setBorrowGap] = useState<boolean>(
    project?.settings.borrowGap ?? true
  )
  const [showSpeakerConfig, setShowSpeakerConfig] = useState<boolean>(true)

  // Action states for 3 Buttons
  const [isSyncingSubtitles, setIsSyncingSubtitles] = useState(false)
  const [syncBannerMessage, setSyncBannerMessage] = useState<string | null>(null)
  const [showOffsetModal, setShowOffsetModal] = useState(false)
  const [leadOffsetDraft, setLeadOffsetDraft] = useState<number>(0.0)
  const [tailOffsetDraft, setTailOffsetDraft] = useState<number>(0.0)

  // Fetch dynamic voice list from backend
  useEffect(() => {
    fetch('/api/tts/voices')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.voices) && data.voices.length > 0) {
          setAvailableVoices(data.voices)
        }
      })
      .catch(() => {})
  }, [])

  // Sync Subtitles Handler (Button 2)
  const handleSyncSubtitles = async () => {
    if (!project) return
    setIsSyncingSubtitles(true)
    setSyncBannerMessage(null)
    try {
      const res = await fetch('/api/step3/sync-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.projectId })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCues(data.cues)
      setSyncBannerMessage(`✓ ${data.message}`)
      setTimeout(() => setSyncBannerMessage(null), 5000)
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setIsSyncingSubtitles(false)
    }
  }

  // Timing Offset Handler (Button 3)
  const handleApplyOffset = async () => {
    if (!project) return
    try {
      const res = await fetch('/api/step3/timing-offset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.projectId,
          leadOffsetSeconds: leadOffsetDraft,
          tailOffsetSeconds: tailOffsetDraft,
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCues(data.cues)
      setShowOffsetModal(false)
      setSyncBannerMessage('✓ Đã áp dụng bù trễ thời gian thành công cho toàn bộ phụ đề!')
      setTimeout(() => setSyncBannerMessage(null), 4000)
    } catch (err: unknown) {
      console.error(err)
    }
  }

  // Single cue synthesis & preview state
  const [singleSynthesizingId, setSingleSynthesizingId] = useState<number | null>(null)
  const [playingCueAudioId, setPlayingCueAudioId] = useState<number | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)

  const handleStartSynthesizeAll = async () => {
    if (!project) return

    updateSettings({
      autoMatchDuration,
      borrowGap
    })

    // Lưu trạng thái mới nhất lên backend trước khi khởi chạy stream
    await saveProject()

    const primaryVoice = project.speakers?.[0]?.voiceId || project.settings.defaultVoiceId || 'Mai Anh'
    const primarySpeed = project.speakers?.[0]?.speed || 1.0

    await startStream(
      '/api/step3/synthesize',
      {
        projectId: project.projectId,
        voiceId: primaryVoice,
        device: 'cpu',
        autoMatchDuration,
        borrowGap,
        speed: primarySpeed,
        speakers: project.speakers
      },
      {
        onProgress: (event) => {
          if (event.cueId && event.audioUrl) {
            updateAudio(event.cueId, {
              audioFile: event.audioUrl,
              audioDuration: event.clipDuration || 0,
              speed: primarySpeed,
              status: 'ready'
            })
          }
        },
        onComplete: (event) => {
          if (event.cues && Array.isArray(event.cues)) {
            event.cues.forEach((c) => {
              updateAudio(c.id, {
                audioFile: c.audioFile || '',
                audioDuration: c.audioDuration || 0,
                speed: c.speed || primarySpeed,
                playbackRate: c.playbackRate || 1.0,
                status: c.status || 'ready',
                needsReview: c.needsReview
              })
            })
          }
        }
      }
    )
  }

  const handleSynthesizeSingle = async (cue: CueItem) => {
    if (!project) return
    setSingleSynthesizingId(cue.id)

    // Find speaker voice & speed
    const speaker = project.speakers.find((s) => s.id === cue.speakerId)
    const voiceId = speaker?.voiceId || project.settings.defaultVoiceId || 'Mai Anh'
    const speed = speaker?.speed || 1.0

    try {
      const res = await fetch('/api/step3/synthesize-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.projectId,
          cueId: cue.id,
          text: cue.translatedText || cue.originalText,
          voiceId,
          speed
        })
      })

      if (!res.ok) {
        throw new Error(`Tạo audio câu thất bại: HTTP ${res.status}`)
      }

      const data = await res.json()
      updateAudio(cue.id, {
        audioFile: data.audioFile,
        audioDuration: data.audioDuration,
        speed: speed,
        playbackRate: 1.0,
        status: 'ready'
      })
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setSingleSynthesizingId(null)
    }
  }

  const handlePlayAudioClip = (cue: CueItem) => {
    if (!cue.audioFile) return

    // Stop current playing
    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current = null
    }

    if (playingCueAudioId === cue.id) {
      setPlayingCueAudioId(null)
      return
    }

    const audioUrl = cue.audioFile.startsWith('/api')
      ? cue.audioFile
      : `/api/media/stream?path=${encodeURIComponent(cue.audioFile)}`

    const audio = new Audio(audioUrl)
    audioElementRef.current = audio
    setPlayingCueAudioId(cue.id)

    audio.onended = () => {
      setPlayingCueAudioId(null)
      audioElementRef.current = null
    }

    audio.onerror = () => {
      setPlayingCueAudioId(null)
      audioElementRef.current = null
    }

    audio.play().catch(() => {
      setPlayingCueAudioId(null)
      audioElementRef.current = null
    })
  }

  const renderCueRow = (cue: CueItem) => {
    const isSingleLoading = singleSynthesizingId === cue.id
    const isPlayingThisAudio = playingCueAudioId === cue.id
    const targetDuration = cue.duration ?? +(cue.endTime - cue.startTime).toFixed(2)
    const audioDur = cue.audioDuration ?? 0
    const hasAudio = !!cue.audioFile
    const isMaxSpeedClamped = hasAudio && ((cue.playbackRate && cue.playbackRate >= 5.0) || cue.needsReview)
    const isOverflow = hasAudio && audioDur > targetDuration * 5.0

    return (
      <div className="flex items-center gap-2 p-2.5 border-b border-slate-800/80 hover:bg-slate-900/60 transition group text-xs text-slate-200">
        {/* Index & Timestamps */}
        <div className="w-24 shrink-0">
          <div className="flex items-center gap-1 font-mono font-semibold text-slate-400">
            <span>#{cue.id}</span>
            {hasAudio && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" title="Đã có âm thanh" />
            )}
            {cue.isCollisionShifted && (
              <span
                className="text-[10px] text-sky-400 bg-sky-950/80 px-1 rounded border border-sky-800/60 inline-flex items-center"
                title={`Đã tự dời thời điểm phát sang ${formatTime(cue.placedStartTime ?? cue.startTime)} để tránh đè giọng câu trước!`}
              >
                <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> Dời
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            {formatTime(cue.placedStartTime ?? cue.startTime)}
          </div>
          <div className="text-[10px] text-slate-400">
            Dài: <span className="text-slate-300 font-mono">{targetDuration.toFixed(2)}s</span>
          </div>
        </div>

        {/* Translated Text Column */}
        <div className="flex-1 min-w-0 pr-2">
          <p className="text-indigo-100 font-medium leading-relaxed truncate" title={cue.translatedText || cue.originalText}>
            {cue.translatedText || cue.originalText}
          </p>
          <p className="text-[11px] text-slate-400 truncate mt-0.5" title={cue.originalText}>
            {cue.originalText}
          </p>
        </div>

        {/* Audio Duration comparison */}
        <div className="w-24 shrink-0 text-[11px] font-mono">
          {hasAudio ? (
            <div>
              <span className={isMaxSpeedClamped ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                {audioDur.toFixed(2)}s
              </span>
              {cue.speed && cue.speed !== 1.0 && (
                <span className="text-[10px] block text-indigo-400 font-medium" title="Tốc độ đọc giọng VieNeu AI">
                  🎤 {cue.speed.toFixed(2)}x
                </span>
              )}
              {cue.playbackRate && cue.playbackRate !== 1.0 && (
                <span className={`text-[10px] block ${isMaxSpeedClamped ? 'text-amber-300 font-semibold' : 'text-slate-400'}`} title="Hệ số co dãn timeline để khớp thời lượng video">
                  ⏱️ x{cue.playbackRate.toFixed(2)} {isMaxSpeedClamped ? '(Tối đa)' : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 italic">Chưa tạo</span>
          )}
        </div>

        {/* Warning Indicator */}
        <div className="w-6 shrink-0 text-center">
          {isMaxSpeedClamped ? (
            <span title="Tốc độ câu này đã đạt trần tối đa 5.0x. Nên rút gọn câu nếu muốn đọc thong thả hơn.">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" />
            </span>
          ) : isOverflow ? (
            <span title="Âm thanh dài hơn thời lượng video. Cần bật Speed Match hoặc Borrow Gap.">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mx-auto" />
            </span>
          ) : null}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasAudio && (
            <button
              onClick={() => handlePlayAudioClip(cue)}
              className={`p-1.5 rounded transition ${
                isPlayingThisAudio
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-emerald-400'
              }`}
              title={isPlayingThisAudio ? 'Dừng phát' : 'Nghe thử câu thuyết minh này'}
            >
              {isPlayingThisAudio ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={() => handleSynthesizeSingle(cue)}
            disabled={isSingleLoading}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 transition disabled:opacity-50"
            title="Tạo lại giọng đọc câu này"
          >
            <Mic className={`w-3.5 h-3.5 ${isSingleLoading ? 'animate-pulse text-amber-400' : ''}`} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Step 3 Control Toolbar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          {/* Left switches: Speed match & Borrow gap */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoMatchDuration}
                onChange={(e) => setAutoMatchDuration(e.target.checked)}
                className="rounded accent-indigo-500"
              />
              <span title="Tự động co dãn tốc độ đọc (Rubber Banding) để khớp tuyệt đối thời lượng gốc">
                Speed Match (Khớp độ dài)
              </span>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={borrowGap}
                onChange={(e) => setBorrowGap(e.target.checked)}
                className="rounded accent-indigo-500"
              />
              <span title="Mượn khoảng lặng giữa 2 câu để giọng đọc tự nhiên, không bị nói dồn dập">
                Borrow Gap (Mượn khoảng lặng)
              </span>
            </label>

            <button
              onClick={() => setShowSpeakerConfig(!showSpeakerConfig)}
              className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
                showSpeakerConfig
                  ? 'bg-slate-800 text-indigo-400 border-indigo-500/50'
                  : 'bg-slate-850 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Đổi giọng đọc cho từng nhân vật"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Gán Giọng Nói</span>
            </button>
          </div>

          {/* Right Actions: 3 Buttons (Chuẩn Lemyloi) */}
          <div className="flex items-center gap-2">
            {/* Button 3: Bù thời gian (Offset) */}
            <button
              onClick={() => setShowOffsetModal(true)}
              disabled={!project || cues.length === 0}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-40 text-slate-300 rounded text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition"
              title="Căn chỉnh bù trễ (lead/tail offset) cho các câu thoại"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Bù thời gian</span>
            </button>

            {/* Button 2: Đồng bộ Phụ đề theo Giọng đọc (Timeline Locking) */}
            <button
              onClick={handleSyncSubtitles}
              disabled={!project || cues.length === 0 || synthesizedCount === 0 || isSyncingSubtitles}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-40 text-indigo-300 rounded text-xs font-medium flex items-center gap-1.5 border border-indigo-500/30 transition"
              title="Khóa mốc thời gian phụ đề theo vị trí giọng đọc thực tế đã chống đè"
            >
              <Sparkles className={`w-3.5 h-3.5 text-indigo-400 ${isSyncingSubtitles ? 'animate-spin' : ''}`} />
              <span>{isSyncingSubtitles ? 'Đang đồng bộ...' : 'Đồng bộ Phụ đề'}</span>
            </button>

            {/* Button 1: Tạo giọng toàn bộ (VieNeu-TTS) */}
            {isRunning ? (
              <button
                onClick={stopStream}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow transition"
              >
                <span>Dừng sinh giọng</span>
              </button>
            ) : (
              <button
                onClick={handleStartSynthesizeAll}
                disabled={!project || cues.length === 0}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition"
                title="Tạo giọng VieNeu-TTS toàn bộ và tự động sắp xếp timeline chống đè tiếng"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Tạo giọng toàn bộ (VieNeu-TTS)</span>
              </button>
            )}
          </div>
        </div>

        {/* Speaker Voice Assign Box */}
        {showSpeakerConfig && project?.speakers && (
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Gán Giọng đọc Bản địa & Tốc độ theo Nhân vật (18 Giọng VieNeu-TTS v3 Turbo)</span>
              </span>
              <span className="text-[11px] text-indigo-400/90 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/40">
                ⚡ Tốc độ tự động co dãn linh hoạt không giới hạn (đã bỏ trần 2.0x)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {project.speakers.map((spk) => (
                <div key={spk.id} className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between gap-3 hover:border-slate-700 transition">
                  <div className="min-w-0">
                    <span className="font-semibold text-indigo-300 block truncate">
                      {spk.name || spk.id}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Mã: {spk.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={spk.voiceId || 'Mai Anh'}
                      onChange={async (e) => {
                        const newVoice = e.target.value
                        updateSpeaker(spk.id, { voiceId: newVoice })
                        await saveProject()
                      }}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[210px] truncate"
                    >
                      <optgroup label="🌟 Miền Bắc (Tin tức, Kể chuyện, Tự nhiên)">
                        {availableVoices
                          .filter((v) => v.region === 'Bắc')
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="🌴 Miền Trung (Mộc mạc, Tình cảm)">
                        {availableVoices
                          .filter((v) => v.region === 'Trung')
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="☀️ Miền Nam (Truyền cảm, Hóm hỉnh, Phóng sự)">
                        {availableVoices
                          .filter((v) => v.region === 'Nam')
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                      </optgroup>
                    </select>

                    <div className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0">
                      <span>Tốc độ:</span>
                      <select
                        value={spk.speed || 1.0}
                        onChange={async (e) => {
                          const newSpeed = parseFloat(e.target.value)
                          updateSpeaker(spk.id, { speed: newSpeed })
                          await saveProject()
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1.5 text-xs text-slate-200"
                      >
                        <option value={0.85}>0.85x (Chậm)</option>
                        <option value={0.90}>0.90x</option>
                        <option value={0.95}>0.95x</option>
                        <option value={1.0}>1.0x (Tự nhiên)</option>
                        <option value={1.05}>1.05x</option>
                        <option value={1.15}>1.15x</option>
                        <option value={1.25}>1.25x</option>
                        <option value={1.35}>1.35x</option>
                        <option value={1.50}>1.50x</option>
                        <option value={1.75}>1.75x</option>
                        <option value={2.00}>2.0x</option>
                        <option value={2.25}>2.25x</option>
                        <option value={2.50}>2.5x</option>
                        <option value={3.00}>3.0x</option>
                        <option value={4.00}>4.0x</option>
                        <option value={5.00}>5.0x (Tối đa)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SSE Progress Bar */}
        {isRunning && (
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {stage || 'Đang tổng hợp giọng nói VieNeu-TTS...'}
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
          <div className="p-2 bg-rose-950/60 border border-rose-800 rounded text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Sync Success / Offset Notification Banner */}
        {syncBannerMessage && (
          <div className="p-2.5 bg-indigo-950/60 border border-indigo-700/70 rounded-xl text-xs text-indigo-200 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{syncBannerMessage}</span>
            </span>
            <button
              onClick={() => setSyncBannerMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Quick Nav Banner when Cues are Synthesized */}
        {synthesizedCount > 0 && !isRunning && (
          <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex items-center justify-between text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Đã tạo giọng đọc cho <strong>{synthesizedCount}/{cues.length}</strong> câu thoại.
                Bạn có thể bật <strong>"🎙️ Lồng tiếng AI"</strong> ở Video Player (bên trái) để nghe thử ngay!
              </span>
            </div>
            <button
              onClick={() => setActiveStep(4)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center gap-1 transition shadow shrink-0 cursor-pointer"
            >
              <span>Sang Bước 4: Xuất Video</span>
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Virtualized Cues Table */}
      <VirtualCueTable
        items={cues}
        estimateSize={72}
        header={
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="w-24"># & Mốc phát</span>
            <span className="flex-1">Câu dịch & Thuyết minh</span>
            <span className="w-24">Độ dài Audio</span>
            <span className="w-6 text-center">!</span>
            <span className="w-20 text-right pr-2">Nghe / Tạo</span>
          </div>
        }
        renderRow={renderCueRow}
        emptyMessage="Chưa có câu thoại nào. Vui lòng hoàn thành Bước 2 (Dịch thuật) trước."
      />

      {/* Offset Modal (Button 3 Pop-up) */}
      {showOffsetModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-4 shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-semibold text-slate-100 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span>Bù thời gian đọc (Cue Timing Offset)</span>
              </h3>
              <button
                onClick={() => setShowOffsetModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Dịch chuyển mốc thời gian bắt đầu hoặc kết thúc của toàn bộ phụ đề để khớp nhịp đọc và hình ảnh tự nhiên hơn (hỗ trợ số âm hoặc dương).
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-300 block mb-1">
                  Bù trước câu (Lead Offset - giây):
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={leadOffsetDraft}
                  onChange={(e) => setLeadOffsetDraft(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="Ví dụ: -0.1 hoặc 0.2"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Ví dụ: -0.15s sẽ phát sớm hơn 0.15 giây trước câu gốc
                </span>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">
                  Bù sau câu (Tail Offset - giây):
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={tailOffsetDraft}
                  onChange={(e) => setTailOffsetDraft(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="Ví dụ: 0.1 hoặc -0.1"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Ví dụ: 0.2s sẽ kéo dài thêm khoảng chờ sau câu
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowOffsetModal(false)}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleApplyOffset}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold transition shadow"
              >
                Áp dụng bù thời gian
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
