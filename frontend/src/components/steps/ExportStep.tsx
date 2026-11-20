import React, { useState } from 'react'
import {
  Share2,
  RefreshCw,
  CheckCircle2,
  Film,
  Download,
  Volume2,
  Layers
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useCueStore } from '../../stores/cueStore'
import { useSSE } from '../../hooks/useSSE'
import { formatTime } from '../../lib/utils'

export const ExportStep: React.FC = () => {
  const project = useProjectStore((s) => s.project)
  const updateSettings = useProjectStore((s) => s.updateSettings)
  const setExportInfo = useProjectStore((s) => s.setExportInfo)

  const cues = useCueStore((s) => s.cues)

  const { isRunning, percent, stage, message, startStream, stopStream, error } = useSSE()

  // Local export settings
  const [autoDucking, setAutoDucking] = useState<boolean>(
    project?.settings.autoDucking ?? false
  )
  const [duckingVolume, setDuckingVolume] = useState<number>(
    project?.settings.duckingVolume ?? 0.15
  )
  const [sourceVolumeDb, setSourceVolumeDb] = useState<number>(
    project?.settings.sourceVolumeDb ?? -12.0
  )
  const [ttsVolumeDb, setTtsVolumeDb] = useState<number>(
    project?.settings.ttsVolumeDb ?? 0.0
  )
  const [exportSubtitleType, setExportSubtitleType] = useState<'soft' | 'hard'>(
    project?.settings.exportSubtitleType ?? 'soft'
  )
  const [videoCodec, setVideoCodec] = useState<string>(
    project?.settings.videoCodec ?? 'h264_nvenc'
  )
  const [resolution, setResolution] = useState<string>(
    project?.settings.resolution ?? 'original'
  )

  const handleStartExport = async () => {
    if (!project) return

    updateSettings({
      autoDucking,
      duckingVolume,
      sourceVolumeDb,
      ttsVolumeDb,
      exportSubtitleType,
      videoCodec,
      resolution
    })

    await startStream(
      '/api/step4/export',
      {
        projectId: project.projectId,
        autoDucking,
        duckingVolume,
        duckAttackMs: project.settings.duckAttackMs || 150,
        duckReleaseMs: project.settings.duckReleaseMs || 400,
        sourceVolumeDb,
        ttsVolumeDb,
        exportSubtitleType,
        resolution,
        videoCodec
      },
      {
        onComplete: (event) => {
          if (event.outputVideoPath) {
            setExportInfo({
              exportedFilePath: event.outputVideoPath,
              exportedAt: new Date().toISOString(),
              exportDurationSec: event.durationSec || project.videoInfo.duration,
              fileSizeBytes: event.fileSizeBytes
            })
          }
        }
      }
    )
  }

  const exportInfo = project?.exportInfo
  const hasAudioClips = cues.some((c) => !!c.audioFile)

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto p-4 select-none">
      <div className="max-w-3xl mx-auto w-full space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-indigo-400" />
              <span>Bước 4: Trộn Âm (Mixing), Ghép Sub & Xuất Video</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tự động điều chỉnh âm lượng nền (Audio Ducking) và xuất bản video lồng tiếng thành phẩm.
            </p>
          </div>

          {!hasAudioClips && (
            <div className="text-xs bg-amber-950/60 border border-amber-800/80 text-amber-300 px-3 py-1.5 rounded-lg">
              Chưa có clip thuyết minh nào từ Bước 3.
            </div>
          )}
        </div>

        {/* Setting Card: Audio Ducking & Volume Balancing */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-indigo-400" />
              Cân bằng Âm lượng & Tự động né tiếng (Audio Ducking)
            </span>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={autoDucking}
                onChange={(e) => setAutoDucking(e.target.checked)}
                className="rounded accent-indigo-500"
              />
              <span>Bật Audio Ducking</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Source Audio Volume */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Âm lượng Video Gốc / Nhạc nền:</span>
                <span className="font-mono text-indigo-300">{sourceVolumeDb} dB</span>
              </div>
              <input
                type="range"
                min={-30}
                max={0}
                step={0.5}
                value={sourceVolumeDb}
                onChange={(e) => setSourceVolumeDb(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Hạ âm lượng gốc để giọng đọc AI nổi bật rõ ràng (-12 dB khuyến nghị).
              </span>
            </div>

            {/* TTS Narration Volume */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Âm lượng Giọng đọc AI (TTS):</span>
                <span className="font-mono text-indigo-300">+{ttsVolumeDb} dB</span>
              </div>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.5}
                value={ttsVolumeDb}
                onChange={(e) => setTtsVolumeDb(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-[10px] text-slate-400 block">
                Tăng cường độ âm thanh cho bản thuyết minh (0 dB mặc định).
              </span>
            </div>
          </div>

          {autoDucking && (
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>Độ sâu Ducking khi có giọng đọc:</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={duckingVolume}
                  onChange={(e) => setDuckingVolume(parseFloat(e.target.value))}
                  className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                />
                <span className="font-mono text-slate-300">{Math.round(duckingVolume * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Setting Card: Subtitle & Video Encoding */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-400" />
            Định dạng Phụ đề & Mã hóa Video (FFmpeg)
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* Subtitle Type */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Kiểu phụ đề:</label>
              <select
                value={exportSubtitleType}
                onChange={(e) => setExportSubtitleType(e.target.value as 'soft' | 'hard')}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="soft">Phụ đề mềm (Softsub - Bật/tắt được)</option>
                <option value="hard">Nướng phụ đề cứng (Hardsub - Ghi đè vào hình ảnh)</option>
              </select>
            </div>

            {/* Video Codec */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Bộ giải mã (Codec):</label>
              <select
                value={videoCodec}
                onChange={(e) => setVideoCodec(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="h264_nvenc">NVIDIA NVENC H.264 (Cực nhanh trên GTX 1060)</option>
                <option value="libx264">CPU libx264 (Chuẩn phổ thông)</option>
                <option value="copy">Giữ nguyên luồng video (Chỉ thay Audio - Tức thì)</option>
              </select>
            </div>

            {/* Resolution */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Độ phân giải:</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="original">Gốc ({project?.videoInfo.width || 1920}x{project?.videoInfo.height || 1080})</option>
                <option value="1080p">Full HD 1080p</option>
                <option value="720p">HD 720p</option>
              </select>
            </div>
          </div>
        </div>

        {/* Export Button & Progress */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Tổng số câu thuyết minh sẵn sàng:{' '}
              <span className="font-semibold text-indigo-300 font-mono">
                {cues.filter((c) => !!c.audioFile).length} / {cues.length}
              </span>
            </div>

            {isRunning ? (
              <button
                onClick={stopStream}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition"
              >
                <span>Hủy tiến trình xuất</span>
              </button>
            ) : (
              <button
                onClick={handleStartExport}
                disabled={!project || cues.length === 0}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition cursor-pointer"
              >
                <Film className="w-4 h-4" />
                <span>Bắt đầu Xuất Video Hoàn Chỉnh</span>
              </button>
            )}
          </div>

          {/* SSE Progress Bar */}
          {isRunning && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {stage || 'Đang thực thi lệnh FFmpeg...'}
                </span>
                <span className="font-mono text-slate-300 font-bold">{percent}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {message && <p className="text-[11px] text-slate-400 truncate">{message}</p>}
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded text-rose-300 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Finished Video Preview Box */}
        {exportInfo?.exportedFilePath && (
          <div className="bg-emerald-950/30 border border-emerald-700/60 rounded-xl p-4 shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Xuất Video Thành Công!</span>
              </div>
              {exportInfo.exportedAt && (
                <span className="text-xs text-slate-400">
                  {new Date(exportInfo.exportedAt).toLocaleString()}
                </span>
              )}
            </div>

            <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded text-xs font-mono text-slate-300 break-all select-all">
              {exportInfo.exportedFilePath}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <div className="flex items-center gap-4">
                {exportInfo.fileSizeBytes && (
                  <span>
                    Dung lượng:{' '}
                    <strong className="text-slate-200">
                      {(exportInfo.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </strong>
                  </span>
                )}
                {exportInfo.exportDurationSec && (
                  <span>
                    Thời lượng:{' '}
                    <strong className="text-slate-200">
                      {formatTime(exportInfo.exportDurationSec)}
                    </strong>
                  </span>
                )}
              </div>

              <a
                href={`/api/media/stream?path=${encodeURIComponent(exportInfo.exportedFilePath)}`}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium shadow transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Video Thành Phẩm</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
