import React, { useState, useRef, useEffect } from 'react';
import {
  GripVertical,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Type,
  Video as VideoIcon,
  Music,
} from 'lucide-react';
import { useTimelineStore } from '../../stores/timelineStore';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';
import type { TrackConfig } from '../../types';

interface TrackVolumePopoverProps {
  track: TrackConfig;
  onClose: () => void;
  position: { top: number; left: number };
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const TrackVolumePopover: React.FC<TrackVolumePopoverProps> = ({
  track,
  onClose,
  position,
  onMouseEnter,
  onMouseLeave,
}) => {
  const setTrackVolume = useTimelineStore((s) => s.setTrackVolume);
  const setTrackMuted = useTimelineStore((s) => s.setTrackMuted);
  const tracks = useTimelineStore((s) => s.tracks);
  const liveTrack = tracks.find((t) => t.id === track.id) || track;
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const currentVolume = liveTrack.volume ?? 1.0;
  const isMuted = liveTrack.muted ?? false;
  const volumePercent = Math.round(currentVolume * 100);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: '210px',
        backgroundColor: '#181b22',
        border: '1px solid #334155',
        borderRadius: '6px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        padding: '10px 12px',
        zIndex: 9999,
        fontSize: '12px',
        color: '#e2e8f0',
        userSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8' }}>
          {liveTrack.id === 'video' ? 'Âm lượng Video gốc' : 'Âm lượng Lồng tiếng'}
        </span>
        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: isMuted ? '#ef4444' : '#38bdf8' }}>
          {isMuted ? 'Đang tắt âm' : `${volumePercent}%`}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={isMuted ? 0 : volumePercent}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setTrackVolume(liveTrack.id, val / 100);
            if (isMuted && val > 0) setTrackMuted(liveTrack.id, false);
          }}
          style={{
            flex: 1,
            height: '4px',
            accentColor: '#38bdf8',
            cursor: 'pointer',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          onClick={() => {
            setTrackVolume(liveTrack.id, 1.0);
            setTrackMuted(liveTrack.id, false);
          }}
          style={{
            flex: 1,
            height: '24px',
            fontSize: '10px',
            backgroundColor: '#262d3d',
            border: '1px solid #3b4252',
            color: '#cbd5e1',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Mặc định (100%)
        </button>

        <button
          type="button"
          onClick={() => setTrackMuted(liveTrack.id, !isMuted)}
          style={{
            height: '24px',
            padding: '0 8px',
            fontSize: '10px',
            backgroundColor: isMuted ? '#ef4444' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {isMuted ? 'Bật âm' : 'Tắt âm'}
        </button>
      </div>
    </div>
  );
};

export const TrackHeaderSidebar: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const toggleTrackVisibility = useTimelineStore((s) => s.toggleTrackVisibility);
  const setTrackMuted = useTimelineStore((s) => s.setTrackMuted);
  const project = useProjectStore((s) => s.project);

  const [activePopover, setActivePopover] = useState<{
    track: TrackConfig;
    position: { top: number; left: number };
  } | null>(null);

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cuesTrack = tracks.find((t) => t.id === 'cues') || tracks[0];
  const videoTrack = tracks.find((t) => t.id === 'video') || tracks[1];
  const audioTrack = tracks.find((t) => t.id === 'tts-audio') || tracks[2];

  const speakerName = project?.speakers?.[0]?.name || 'Spe...';

  const handleVolumeMouseEnter = (e: React.MouseEvent<HTMLElement>, track: TrackConfig) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setActivePopover({
      track,
      position: { top: rect.top - 10, left: rect.right + 8 },
    });
  };

  const handleVolumeMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setActivePopover(null);
    }, 250);
  };

  const handlePopoverMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setActivePopover(null);
    }, 250);
  };

  const handleToggleMute = (e: React.MouseEvent, trackId: TrackConfig['id']) => {
    e.stopPropagation();
    const tr = tracks.find((t) => t.id === trackId);
    if (tr) {
      setTrackMuted(trackId, !tr.muted);
    }
  };

  return (
    <div
      style={{
        width: '112px',
        flexShrink: 0,
        backgroundColor: '#111319',
        borderRight: '1px solid #232838',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        zIndex: 30,
      }}
    >
      {/* Top Header Placeholder (matching Ruler height 24px) */}
      <div
        style={{
          height: '24px',
          borderBottom: '1px solid #232838',
          backgroundColor: '#0c0e14',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: '#64748b',
          fontWeight: 600,
          letterSpacing: '0.5px',
        }}
      >
        TRACKS
      </div>

      {/* Track 1: Subtitle / Cues Track (Height: 48px) */}
      <div
        style={{
          height: '48px',
          borderBottom: '1px solid #1e2433',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          gap: '4px',
          color: '#94a3b8',
          cursor: 'pointer',
        }}
        onClick={() => {
          useTimelineStore.getState().setActiveRightTab('cues');
        }}
        title="Track Phụ đề / Subtitles (Nhấp để mở danh sách câu thoại)"
      >
        <GripVertical size={13} style={{ opacity: 0.4, cursor: 'grab' }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '5px' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackVisibility('cues');
            }}
            title={cuesTrack?.visible ? 'Ẩn track phụ đề' : 'Hiện track phụ đề'}
            style={{
              background: 'transparent',
              border: 'none',
              color: cuesTrack?.visible ? '#94a3b8' : '#ef4444',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
            }}
          >
            {cuesTrack?.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              borderRadius: '3px',
            }}
          >
            <Type size={11} strokeWidth={2.5} />
          </span>
        </div>
      </div>

      {/* Track 2: Video Filmstrip & BGM Track (Height: 52px) */}
      <div
        onClick={() => {
          const clips = useTimelineStore.getState().videoClips;
          const firstClipId = clips[0]?.id || 'video_clip_0';
          useCueStore.getState().setSelectedCueId(null);
          useTimelineStore.getState().setSelectedElement({ type: 'video', id: firstClipId });
          useTimelineStore.getState().setActiveRightTab('properties');
        }}
        style={{
          height: '52px',
          borderBottom: '1px solid #1e2433',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          gap: '4px',
          color: '#94a3b8',
          cursor: 'pointer',
        }}
        title="Track Video gốc & Âm thanh gốc (Nhấp để chọn và xem thuộc tính video)"
      >
        <GripVertical size={13} style={{ opacity: 0.4, cursor: 'grab' }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '5px' }}>
          {/* Mute Video button & Volume slider trigger (Hover tự mở popup, Click tắt/bật âm ngay lập tức) */}
          <button
            type="button"
            onMouseEnter={(e) => handleVolumeMouseEnter(e, videoTrack)}
            onMouseLeave={handleVolumeMouseLeave}
            onClick={(e) => handleToggleMute(e, 'video')}
            title={
              videoTrack.muted
                ? 'Đang tắt âm video gốc (Rê chuột để chỉnh âm lượng, Nhấp để bật lại)'
                : `Âm lượng video gốc: ${Math.round((videoTrack.volume ?? 1) * 100)}% (Rê chuột để chỉnh âm lượng, Nhấp để tắt tiếng)`
            }
            style={{
              background: videoTrack.muted ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
              border: videoTrack.muted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
              color: videoTrack.muted ? '#ef4444' : '#94a3b8',
              cursor: 'pointer',
              padding: '2px 3px',
              borderRadius: '3px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {videoTrack.muted ? <VolumeX size={13} color="#ef4444" /> : <Volume2 size={13} />}
          </button>

          <button
            type="button"
            onClick={() => toggleTrackVisibility('video')}
            title={videoTrack?.visible ? 'Ẩn video' : 'Hiện video'}
            style={{
              background: 'transparent',
              border: 'none',
              color: videoTrack?.visible ? '#94a3b8' : '#ef4444',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
            }}
          >
            {videoTrack?.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              backgroundColor: '#1e293b',
              color: '#a855f7',
              borderRadius: '3px',
            }}
          >
            <VideoIcon size={12} />
          </span>
        </div>
      </div>

      {/* Track 3: AI Narration Audio Track (Height: 48px) */}
      <div
        style={{
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          gap: '4px',
          color: '#94a3b8',
        }}
        title="Track Thuyết minh AI / TTS Narration"
      >
        <GripVertical size={13} style={{ opacity: 0.4, cursor: 'grab' }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              backgroundColor: '#1e293b',
              color: '#22c55e',
              padding: '1px 4px',
              borderRadius: '2px',
              maxWidth: '38px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={speakerName}
          >
            {speakerName.slice(0, 5)}
          </span>

          <button
            type="button"
            onMouseEnter={(e) => handleVolumeMouseEnter(e, audioTrack)}
            onMouseLeave={handleVolumeMouseLeave}
            onClick={(e) => handleToggleMute(e, 'tts-audio')}
            title={
              audioTrack.muted
                ? 'Đang tắt âm lồng tiếng (Rê chuột để chỉnh âm lượng, Nhấp để bật lại)'
                : `Âm lượng lồng tiếng: ${Math.round((audioTrack.volume ?? 1) * 100)}% (Rê chuột để chỉnh âm lượng, Nhấp để tắt tiếng)`
            }
            style={{
              background: audioTrack.muted ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
              border: audioTrack.muted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
              color: audioTrack.muted ? '#ef4444' : '#94a3b8',
              cursor: 'pointer',
              padding: '2px 3px',
              borderRadius: '3px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {audioTrack.muted ? <VolumeX size={13} color="#ef4444" /> : <Volume2 size={13} />}
          </button>

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              backgroundColor: '#1e293b',
              color: '#22c55e',
              borderRadius: '3px',
            }}
          >
            <Music size={12} />
          </span>
        </div>
      </div>

      {/* Active Volume Popover (Tự mở khi hover, đóng khi rời chuột) */}
      {activePopover && (
        <TrackVolumePopover
          track={activePopover.track}
          position={activePopover.position}
          onClose={() => setActivePopover(null)}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        />
      )}
    </div>
  );
};
