import React, { useRef, useEffect, useState, useMemo } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize2,
  Subtitles,
  Film,
  Mic
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { usePlayerStore } from '../stores/playerStore'
import { useCueStore } from '../stores/cueStore'
import { formatTime } from '../lib/utils'

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentPlayingCueIdRef = useRef<number | null>(null)

  const project = useProjectStore((s) => s.project)
  const cues = useCueStore((s) => s.cues)

  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const seekTarget = usePlayerStore((s) => s.seekTarget)

  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime)
  const setDuration = usePlayerStore((s) => s.setDuration)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const setIsMuted = usePlayerStore((s) => s.setIsMuted)
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate)
  const clearSeekTarget = usePlayerStore((s) => s.clearSeekTarget)
  const togglePlay = usePlayerStore((s) => s.togglePlay)

  const [showSubtitles, setShowSubtitles] = useState(true)
  const [subtitleMode, setSubtitleMode] = useState<'both' | 'target' | 'source'>('both')
  const [useExportedVideo, setUseExportedVideo] = useState(false)
  const [audioTrackMode, setAudioTrackMode] = useState<'original' | 'dubbed'>('original')

  // Check if project has synthesized audio clips
  const hasDubbedClips = useMemo(() => {
    return cues.some((c) => !!c.audioFile)
  }, [cues])

  // Determine media stream URL
  const videoPath = useMemo(() => {
    if (useExportedVideo && project?.exportInfo?.exportedFilePath) {
      return project.exportInfo.exportedFilePath
    }
    return project?.videoInfo?.filePath || ''
  }, [useExportedVideo, project?.exportInfo?.exportedFilePath, project?.videoInfo?.filePath])

  const streamUrl = useMemo(() => {
    if (!videoPath) return ''
    return `/api/media/stream?path=${encodeURIComponent(videoPath)}`
  }, [videoPath])

  // Seeking triggered from outside (e.g. clicking a cue in table)
  useEffect(() => {
    if (seekTarget !== null && videoRef.current) {
      videoRef.current.currentTime = seekTarget
      clearSeekTarget()
    }
  }, [seekTarget, clearSeekTarget])

  // Sync play/pause state
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying && video.paused) {
      video.play().catch(() => setIsPlaying(false))
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }
  }, [isPlaying, setIsPlaying])

  // Sync volume / mute / playbackRate
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (audioTrackMode !== 'dubbed' || currentPlayingCueIdRef.current === null) {
      video.volume = isMuted ? 0 : volume
    }
    video.muted = isMuted
    video.playbackRate = playbackRate
  }, [volume, isMuted, playbackRate, audioTrackMode])

  // Find currently active cue
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null
    return cues.find((c) => currentTime >= c.startTime && currentTime <= c.endTime) || null
  }, [cues, currentTime])

  // Real-time Dubbing Voice Sync while playing video
  useEffect(() => {
    if (audioTrackMode !== 'dubbed' || useExportedVideo) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
      currentPlayingCueIdRef.current = null
      if (videoRef.current && !isMuted) {
        videoRef.current.volume = volume
      }
      return
    }

    if (!isPlaying) {
      if (previewAudioRef.current && !previewAudioRef.current.paused) {
        previewAudioRef.current.pause()
      }
      return
    }

    // When there is an active cue with synthesized audio
    if (activeCue && activeCue.audioFile) {
      if (currentPlayingCueIdRef.current !== activeCue.id) {
        currentPlayingCueIdRef.current = activeCue.id

        // Duck video original sound to 15%
        if (videoRef.current) {
          videoRef.current.volume = isMuted ? 0 : volume * 0.15
        }

        const audioUrl = activeCue.audioFile.startsWith('/api')
          ? activeCue.audioFile
          : `/api/media/stream?path=${encodeURIComponent(activeCue.audioFile)}`

        const targetRate = Math.max(0.5, Math.min(5.0, activeCue.playbackRate || 1.0))
        const audio = new Audio(audioUrl)
        audio.defaultPlaybackRate = targetRate
        audio.playbackRate = targetRate
        audio.onloadedmetadata = () => {
          audio.playbackRate = targetRate
        }
        audio.oncanplay = () => {
          audio.playbackRate = targetRate
        }
        previewAudioRef.current = audio

        // Synchronize offset if user played into the middle of the cue
        const cueOffset = Math.max(0, (currentTime - activeCue.startTime) * targetRate)
        if (cueOffset > 0.05) {
          audio.currentTime = cueOffset
        }

        audio.play().catch(() => {})

        audio.onended = () => {
          currentPlayingCueIdRef.current = null
          if (videoRef.current && !isMuted) {
            videoRef.current.volume = volume
          }
        }
      }
    } else {
      // Outside cue: chỉ dừng âm thanh khi đã ra khỏi vùng đệm hoặc sang phân đoạn khác
      if (currentPlayingCueIdRef.current !== null && previewAudioRef.current) {
        const lastCue = cues.find((c) => c.id === currentPlayingCueIdRef.current)
        const allowedGrace = 0.35
        if (!lastCue || currentTime > (lastCue.placedEndTime || lastCue.endTime) + allowedGrace || currentTime < lastCue.startTime - 0.2) {
          currentPlayingCueIdRef.current = null
          previewAudioRef.current.pause()
          previewAudioRef.current = null
          if (videoRef.current && !isMuted) {
            videoRef.current.volume = volume
          }
        }
      }
    }
  }, [activeCue, audioTrackMode, useExportedVideo, isPlaying, currentTime, volume, isMuted])

  // Stop preview audio when unmounting
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
    }
  }, [])

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || project?.videoInfo?.duration || 0)
    }
  }

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value)
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
    // Stop current voice preview on seek so it re-syncs
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
      currentPlayingCueIdRef.current = null
    }
  }

  const skipSeconds = (sec: number) => {
    if (videoRef.current) {
      const nextTime = Math.min(Math.max(0, videoRef.current.currentTime + sec), duration)
      videoRef.current.currentTime = nextTime
      setCurrentTime(nextTime)
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
      currentPlayingCueIdRef.current = null
    }
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      containerRef.current.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-slate-950 border-r border-slate-800 overflow-hidden relative"
    >
      {/* Top Video Preview Header */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800/80 px-3 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="font-medium text-slate-300 truncate">
            {useExportedVideo ? 'Thành Phẩm (Exported)' : 'Video Gốc'}
          </span>
          {project?.videoInfo && (
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {project.videoInfo.width}x{project.videoInfo.height}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Audio Track Switcher: Original vs AI Dubbed */}
          {!useExportedVideo && hasDubbedClips && (
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setAudioTrackMode('original')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition flex items-center gap-1 ${
                  audioTrackMode === 'original'
                    ? 'bg-slate-800 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Nghe âm thanh gốc của video"
              >
                <Volume2 className="w-3 h-3" />
                <span>Tiếng gốc</span>
              </button>
              <button
                type="button"
                onClick={() => setAudioTrackMode('dubbed')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition flex items-center gap-1 ${
                  audioTrackMode === 'dubbed'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-indigo-300'
                }`}
                title="Bật nghe lồng tiếng AI theo thời gian thực"
              >
                <Mic className="w-3 h-3" />
                <span>Lồng tiếng AI</span>
              </button>
            </div>
          )}

          {project?.exportInfo?.exportedFilePath && (
            <button
              onClick={() => setUseExportedVideo(!useExportedVideo)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 hover:bg-emerald-900/60 transition font-medium"
            >
              {useExportedVideo ? 'Xem Video Gốc' : 'Xem Thành Phẩm MP4'}
            </button>
          )}
        </div>
      </div>

      {/* Main Video Screen with Subtitle Overlay */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-[220px]">
        {streamUrl ? (
          <video
            ref={videoRef}
            src={streamUrl}
            className="w-full h-full object-contain cursor-pointer"
            onClick={togglePlay}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            playsInline
          />
        ) : (
          <div className="text-center p-6 text-slate-500">
            <Film className="w-12 h-12 mx-auto mb-2 opacity-30 text-indigo-400" />
            <p className="text-sm">Chưa có video được tải</p>
            <p className="text-xs text-slate-600 mt-1">Nhấn &apos;Mở / Tạo Dự án&apos; ở góc trên để nạp video</p>
          </div>
        )}

        {/* Dynamic Subtitle Overlay */}
        {showSubtitles && activeCue && (
          <div className="absolute bottom-6 left-4 right-4 text-center pointer-events-none select-none z-10 transition-all">
            <div className="inline-block bg-black/85 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10 shadow-2xl max-w-[90%]">
              {/* Speaker Tag if available */}
              {activeCue.speakerId && (
                <div className="text-[11px] text-indigo-300 font-semibold mb-0.5">
                  {activeCue.speakerId}
                </div>
              )}

              {/* Target / Vietnamese translation */}
              {(subtitleMode === 'both' || subtitleMode === 'target') && activeCue.translatedText && (
                <p className="text-white font-medium text-sm md:text-base leading-snug drop-shadow-md">
                  {activeCue.translatedText}
                </p>
              )}

              {/* Source original text */}
              {(subtitleMode === 'both' || subtitleMode === 'source') && (
                <p className="text-amber-200/90 text-xs md:text-sm mt-0.5 drop-shadow">
                  {activeCue.originalText}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="bg-slate-900 border-t border-slate-800 p-3 flex flex-col gap-2 shrink-0 select-none">
        {/* Progress Slider */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400 min-w-[50px]">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.01}
            value={currentTime}
            onChange={handleSeekChange}
            className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition"
          />
          <span className="text-[11px] font-mono text-slate-500 min-w-[50px] text-right">
            {formatTime(duration)}
          </span>
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between pt-1">
          {/* Left Buttons: Play, Skip */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => skipSeconds(-5)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              title="Lùi 5 giây"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow transition"
              title={isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-0.5" />}
            </button>

            <button
              onClick={() => skipSeconds(5)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              title="Tua tới 5 giây"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume control */}
            <div className="flex items-center gap-1 ml-2 group">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value))
                  if (isMuted) setIsMuted(false)
                }}
                className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 transition"
              />
            </div>
          </div>

          {/* Right Buttons: Subtitle mode, Playback Speed, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Subtitle toggle */}
            <div className="flex items-center bg-slate-800 rounded p-0.5 text-xs">
              <button
                onClick={() => setShowSubtitles(!showSubtitles)}
                className={`p-1 rounded transition ${
                  showSubtitles ? 'text-indigo-400 bg-slate-700' : 'text-slate-400'
                }`}
                title="Bật/Tắt phụ đề overlay"
              >
                <Subtitles className="w-3.5 h-3.5" />
              </button>
              {showSubtitles && (
                <button
                  onClick={() => {
                    const modes: ('both' | 'target' | 'source')[] = ['both', 'target', 'source']
                    const next = modes[(modes.indexOf(subtitleMode) + 1) % modes.length]
                    setSubtitleMode(next)
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:text-white"
                  title="Chuyển chế độ phụ đề: Song ngữ / Dịch / Gốc"
                >
                  {subtitleMode === 'both' ? 'Song ngữ' : subtitleMode === 'target' ? 'Dịch' : 'Gốc'}
                </button>
              )}
            </div>

            {/* Playback rate */}
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              className="bg-slate-800 text-slate-300 text-xs rounded px-1.5 py-1 border border-slate-700 focus:outline-none focus:border-indigo-500"
              title="Tốc độ phát"
            >
              <option value={0.5}>0.5x</option>
              <option value={0.75}>0.75x</option>
              <option value={1}>1.0x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2.0x</option>
            </select>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              title="Toàn màn hình"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
