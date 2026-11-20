import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Film } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useCueStore } from '../../stores/cueStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitleSelectionOverlay } from './SubtitleSelectionOverlay';
import { VideoControls } from './VideoControls';
import { RoiSelectorOverlay } from './RoiSelectorOverlay';

export const VideoPlayer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentPlayingCueIdRef = useRef<number | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const project = useProjectStore((s) => s.project);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const seekTarget = usePlayerStore((s) => s.seekTarget);

  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const clearSeekTarget = usePlayerStore((s) => s.clearSeekTarget);

  const [audioTrackMode] = useState<'original' | 'dubbed'>('dubbed');
  const [subtitleMode] = useState<'both' | 'target' | 'source'>('both');

  const videoPath = project?.videoInfo?.filePath || '';
  const isOcrMode = project?.settings?.recognitionMode === 'ocr';
  const activeStep = useProjectStore((s) => s.activeStep);

  const tracks = useTimelineStore((s) => s.tracks);
  const videoTrack = tracks.find((t) => t.id === 'video');
  const isVideoTrackMuted = videoTrack?.muted ?? false;
  const videoTrackVolume = videoTrack?.volume ?? 1.0;
  const isVideoTrackVisible = videoTrack?.visible ?? true;

  const audioTrack = tracks.find((t) => t.id === 'tts-audio');
  const isNarrationMuted = audioTrack?.muted ?? false;
  const narrationVolume = audioTrack?.volume ?? 1.0;
  const isNarrationVisible = audioTrack?.visible ?? true;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const streamUrl = useMemo(() => {
    if (!videoPath) return '';
    return `/api/media/stream?path=${encodeURIComponent(videoPath)}`;
  }, [videoPath]);

  // Handle seekTarget triggers from cues or timeline
  useEffect(() => {
    if (seekTarget !== null) {
      if (typeof seekTarget === 'number' && Number.isFinite(seekTarget) && videoRef.current) {
        const safeTarget = Math.max(0, seekTarget);
        try {
          videoRef.current.currentTime = safeTarget;
        } catch (err) {
          console.warn('Cannot set video currentTime:', err);
        }
        // Đồng bộ tức thời trạng thái thời gian về Player Store để Playhead và Subtitle cập nhật ngay cả khi tạm dừng
        setCurrentTime(safeTarget);
      }
      clearSeekTarget();
    }
  }, [seekTarget, clearSeekTarget, setCurrentTime]);

  // Play / Pause sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && video.paused) {
      video.play().catch(() => setIsPlaying(false));
    } else if (!isPlaying && !video.paused) {
      video.pause();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      currentPlayingCueIdRef.current = null;
    }
  }, [isPlaying, setIsPlaying]);

  // Volume & Playback Rate sync (with Timeline Video Track Volume/Mute)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const effectiveMuted = isMuted || isVideoTrackMuted;
    const effectiveVolume = Math.max(0, Math.min(1, volume * videoTrackVolume));
    if (audioTrackMode !== 'dubbed' || currentPlayingCueIdRef.current === null) {
      video.volume = effectiveMuted ? 0 : effectiveVolume;
    }
    video.muted = effectiveMuted;
    video.playbackRate = playbackRate;
  }, [volume, isMuted, isVideoTrackMuted, videoTrackVolume, playbackRate, audioTrackMode]);

  // Phản hồi tức thì khi tắt/bật âm hoặc chỉnh volume của track giọng thuyết minh (AI Narration)
  useEffect(() => {
    if (previewAudioRef.current) {
      const effectiveNarrationMuted = isNarrationMuted || !isNarrationVisible;
      previewAudioRef.current.muted = effectiveNarrationMuted;
      previewAudioRef.current.volume = effectiveNarrationMuted ? 0 : Math.max(0, Math.min(1, narrationVolume));
    }
  }, [isNarrationMuted, narrationVolume, isNarrationVisible]);

  // Keyboard shortcut Space to toggle play, Escape to deselect active element
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        usePlayerStore.getState().togglePlay();
      } else if (e.key === 'Escape') {
        useCueStore.getState().setSelectedCueId(null);
        useTimelineStore.getState().setSelectedElement(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Timeupdate handler (Fast 60Hz push)
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    if (Number.isFinite(time)) {
      setCurrentTime(time);
    }

    // Audio Ducking & Narration Preview Sync: CHỈ phát khi video đang thực sự chạy (isPlaying === true)
    const isCurrentlyPlaying = usePlayerStore.getState().isPlaying;
    if (isCurrentlyPlaying && audioTrackMode === 'dubbed' && Number.isFinite(time)) {
      const activeCue = cues.find((c) => time >= c.startTime && time <= c.endTime);

      if (activeCue && activeCue.audioFile) {
        if (currentPlayingCueIdRef.current !== activeCue.id) {
          currentPlayingCueIdRef.current = activeCue.id;

          // Audio Ducking (chỉ hạ BGM khi người dùng bật autoDucking)
          const isDucking = project?.settings?.autoDucking ?? false;
          const duckFactor = isDucking ? (project?.settings?.duckingVolume ?? 0.15) : 1.0;
          if (!isMuted && !isVideoTrackMuted) {
            video.volume = Math.max(0, Math.min(1, volume * videoTrackVolume * duckFactor));
          }

          const audioUrl = activeCue.audioFile.startsWith('/api')
            ? activeCue.audioFile
            : `/api/media/stream?path=${encodeURIComponent(activeCue.audioFile)}`;

          // File WAV trên đĩa đã được render và co dãn đúng thời lượng mục tiêu,
          // do đó thẻ Audio luôn phát ở tốc độ 1.0 để tránh bị tăng tốc kép (double-acceleration)
          const audio = new Audio(audioUrl);
          audio.playbackRate = 1.0;
          const effectiveNarrationMuted = isNarrationMuted || !isNarrationVisible;
          audio.muted = effectiveNarrationMuted;
          audio.volume = effectiveNarrationMuted ? 0 : Math.max(0, Math.min(1, narrationVolume));
          previewAudioRef.current = audio;

          // Offset if jumped into middle
          const safeStart = Number.isFinite(activeCue.startTime) ? activeCue.startTime : 0;
          const offset = Math.max(0, time - safeStart);
          if (Number.isFinite(offset) && offset > 0.05) {
            try {
              audio.currentTime = offset;
            } catch (err) {
              console.warn('Cannot set audio currentTime:', err);
            }
          }

          audio.play().catch(() => {});

          audio.onended = () => {
            currentPlayingCueIdRef.current = null;
            if (!isMuted && !isVideoTrackMuted) {
              video.volume = Math.max(0, Math.min(1, volume * videoTrackVolume));
            }
          };
        }
      } else {
        if (currentPlayingCueIdRef.current !== null) {
          const currentCue = cues.find((c) => c.id === currentPlayingCueIdRef.current);
          if (!currentCue || time > (currentCue.placedEndTime || currentCue.endTime) + 0.3 || time < currentCue.startTime - 0.2) {
            currentPlayingCueIdRef.current = null;
            if (previewAudioRef.current) {
              previewAudioRef.current.pause();
              previewAudioRef.current = null;
            }
            if (!isMuted && !isVideoTrackMuted) {
              video.volume = Math.max(0, Math.min(1, volume * videoTrackVolume));
            }
          }
        }
      }
    } else if (!isCurrentlyPlaying) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      currentPlayingCueIdRef.current = null;
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
        setDuration(dur);
        const rawClips = useTimelineStore.getState().videoClips;
        const curClips = Array.isArray(rawClips) ? rawClips : [];
        if (curClips.length === 0 || (curClips.length === 1 && curClips[0].duration <= 0)) {
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
        }
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#000000',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Video Screen */}
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          // If clicked inside the subtitle interactive bounding box or OCR handle, don't deselect
          if (target.closest('[data-subtitle-box="true"]') || target.closest('[data-ocr-handle="true"]')) {
            return;
          }
          useCueStore.getState().setSelectedCueId(null);
          useTimelineStore.getState().setSelectedElement(null);
        }}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
        }}
      >
        {streamUrl ? (
          <video
            ref={videoRef}
            src={streamUrl}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              opacity: isVideoTrackVisible ? 1 : 0,
              transition: 'opacity 0.15s ease',
            }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              gap: '8px',
            }}
          >
            <Film size={36} style={{ opacity: 0.3 }} />
            <span>Chưa chọn tệp video cho dự án</span>
          </div>
        )}

        {/* OCR Region Selection Overlay */}
        {activeStep === 1 && isOcrMode && (
          <RoiSelectorOverlay
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            visible={true}
          />
        )}

        {/* Subtitle Real-time Overlay */}
        <SubtitleOverlay mode={subtitleMode} />

        {/* Subtitle Interactive Selection & Dragging Overlay */}
        <SubtitleSelectionOverlay containerSize={containerSize} mode={subtitleMode} />
      </div>

      {/* Video Custom Controls */}
      <VideoControls />
    </div>
  );
};
