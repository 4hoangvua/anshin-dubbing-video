import React from 'react';
import { Type, Sparkles, Volume2, Move, Palette, Layers, Undo2, Redo2, Check, Film, Scissors, VolumeX, Eye, EyeOff, Music } from 'lucide-react';
import { useCueStore } from '../../stores/cueStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useUIStore } from '../../stores/uiStore';
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '../../types';

const FONT_OPTIONS = [
  'Roboto',
  'Inter',
  'Montserrat',
  'Be Vietnam Pro',
  'Arial',
  'Times New Roman',
  'Playfair Display',
  'sans-serif',
];

const PRESET_COLORS = ['#ffffff', '#facc15', '#38bdf8', '#4ade80', '#f87171', '#fb923c', '#e879f9'];

export const PropertiesInspector: React.FC = () => {
  const selectedCueId = useCueStore((s) => s.selectedCueId);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];
  const updateCueStyle = useCueStore((s) => s.updateCueStyle);
  const syncSpeakerStyle = useCueStore((s) => s.syncSpeakerStyle);
  const syncAllStyles = useCueStore((s) => s.syncAllStyles);
  const canUndo = useCueStore((s) => s.canUndo);
  const canRedo = useCueStore((s) => s.canRedo);
  const undo = useCueStore((s) => s.undo);
  const redo = useCueStore((s) => s.redo);
  const setSelectedCueId = useCueStore((s) => s.setSelectedCueId);

  const selectedElement = useTimelineStore((s) => s.selectedElement);
  const setSelectedElement = useTimelineStore((s) => s.setSelectedElement);
  const rawClips = useTimelineStore((s) => s.videoClips);
  const videoClips = Array.isArray(rawClips) ? rawClips : [];
  const tracks = useTimelineStore((s) => s.tracks);
  const setTrackVolume = useTimelineStore((s) => s.setTrackVolume);
  const setTrackMuted = useTimelineStore((s) => s.setTrackMuted);
  const toggleTrackVisibility = useTimelineStore((s) => s.toggleTrackVisibility);
  const setTrackHeight = useTimelineStore((s) => s.setTrackHeight);
  const splitVideoClip = useTimelineStore((s) => s.splitVideoClip);
  const trimVideoClip = useTimelineStore((s) => s.trimVideoClip);

  const project = useProjectStore((s) => s.project);
  const videoInfo = project?.videoInfo;
  const videoTrack = tracks.find((t) => t.id === 'video') || { volume: 1.0, muted: false, visible: true, height: 52 };
  const speakers = useProjectStore((s) => s.project?.speakers || []);
  const selectedCue = cues.find((c) => c.id === selectedCueId);

  // VIEW 1: VIDEO PROPERTIES INSPECTOR
  if (selectedElement?.type === 'video') {
    const activeClip = videoClips.find((c) => c.id === selectedElement.id) ||
      videoClips[0] || {
        id: 'video_clip_0',
        startTime: 0,
        duration: videoInfo?.duration || 0,
        trimStart: 0,
        trimEnd: 0,
        volume: videoTrack.volume ?? 1.0,
        muted: videoTrack.muted ?? false,
      };

    const currentTime = usePlayerStore.getState().currentTime;

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-surface-0)',
          fontSize: '12px',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Film size={15} color="#38bdf8" />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
              Thuộc tính Video Clip
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontWeight: 600,
              }}
            >
              Track 2 · Video
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedElement(null);
            }}
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-2)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Bỏ chọn
          </button>
        </div>

        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Thông tin tệp video gốc */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: 'var(--bg-surface-1)', padding: '10px', borderRadius: '6px' }}>
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
              Thông tin tệp video
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tên tệp:</span>
              <span style={{ fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {videoInfo?.fileName || 'input.mp4'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Độ phân giải:</span>
              <span style={{ fontFamily: 'monospace' }}>{videoInfo?.width || 1920} x {videoInfo?.height || 1080}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tốc độ khung hình:</span>
              <span style={{ fontFamily: 'monospace' }}>{videoInfo?.fps || 30} FPS</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tổng thời lượng:</span>
              <span style={{ fontFamily: 'monospace' }}>{(videoInfo?.duration || 0).toFixed(2)}s</span>
            </div>
          </div>

          {/* Âm lượng & Bật/Tắt tiếng Video gốc */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                <Volume2 size={14} />
                <span>Âm lượng video gốc (Gain)</span>
              </div>
              <button
                type="button"
                onClick={() => setTrackMuted('video', !videoTrack.muted)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: videoTrack.muted ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
                  backgroundColor: videoTrack.muted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-surface-2)',
                  color: videoTrack.muted ? '#ef4444' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {videoTrack.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                <span>{videoTrack.muted ? 'Đang tắt tiếng' : 'Bật tiếng'}</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="0"
                max="2.0"
                step="0.05"
                value={videoTrack.volume ?? 1.0}
                onChange={(e) => setTrackVolume('video', parseFloat(e.target.value))}
                style={{ flex: 1, cursor: 'pointer' }}
              />
              <span style={{ fontFamily: 'monospace', width: '42px', textAlign: 'right', fontWeight: 600 }}>
                {Math.round((videoTrack.volume ?? 1.0) * 100)}%
              </span>
            </div>
          </div>

          {/* Phân đoạn Clip & Cắt xén (Trim & Split) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              <Scissors size={14} />
              <span>Phân đoạn & Cắt xén (Trim)</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Bắt đầu trên Timeline</span>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '13px' }}>{activeClip.startTime.toFixed(2)}s</div>
              </div>
              <div style={{ backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Thời lượng đoạn này</span>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '13px' }}>{activeClip.duration.toFixed(2)}s</div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                onClick={() => splitVideoClip(currentTime)}
                style={{
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '11px',
                }}
                title="Cắt đoạn video tại Playhead (Phím S)"
              >
                ✂️ Cắt tại Playhead (S)
              </button>
              <button
                type="button"
                onClick={() => trimVideoClip(activeClip.id, 'left', currentTime)}
                style={{
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '11px',
                }}
                title="Xén đầu trái tới Playhead (Phím Q)"
              >
                ◀️ Xén trái (Q)
              </button>
              <button
                type="button"
                onClick={() => trimVideoClip(activeClip.id, 'right', currentTime)}
                style={{
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '11px',
                }}
                title="Xén đuôi phải từ Playhead (Phím W)"
              >
                ▶️ Xén phải (W)
              </button>
              <button
                type="button"
                onClick={() => {
                  useTimelineStore.getState().setVideoClips([
                    {
                      id: 'video_clip_0',
                      startTime: 0,
                      duration: videoInfo?.duration || 0,
                      trimStart: 0,
                      trimEnd: 0,
                      volume: 1.0,
                      muted: false,
                    },
                  ]);
                }}
                style={{
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-2)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
                title="Khôi phục video liền mạch ban đầu"
              >
                🔄 Khôi phục ban đầu
              </button>
            </div>
          </div>

          {/* Hiển thị & Chiều cao Track */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Bố cục Track Video</span>
              <button
                type="button"
                onClick={() => toggleTrackVisibility('video')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                {videoTrack.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                <span>{videoTrack.visible ? 'Đang hiện' : 'Đang ẩn'}</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', width: '80px' }}>Chiều cao Track:</span>
              <input
                type="range"
                min="32"
                max="80"
                value={videoTrack.height ?? 52}
                onChange={(e) => setTrackHeight('video', parseInt(e.target.value, 10))}
                style={{ flex: 1, cursor: 'pointer' }}
              />
              <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{videoTrack.height ?? 52}px</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: AUDIO / VOICE NARRATION PROPERTIES INSPECTOR
  if (selectedElement?.type === 'audio') {
    const activeCue = cues.find((c) => c.id === selectedElement.id);
    if (activeCue) {
      const spk = speakers.find((s) => s.id === activeCue.speakerId);

      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            backgroundColor: 'var(--bg-surface-0)',
            fontSize: '12px',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Music size={16} color="#22c55e" />
              <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                Thuộc tính Âm thanh Giọng đọc (#{activeCue.id})
              </span>
            </div>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                backgroundColor: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              🎙️ Track 3: Narration
            </span>
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Lời thoại hiển thị */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Lời thoại câu thuyết minh:</span>
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-surface-1)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  color: '#ffffff',
                  fontSize: '12px',
                  lineHeight: 1.4,
                }}
              >
                {activeCue.translatedText || activeCue.originalText || '(Trống)'}
              </div>
            </div>

            {/* Thông tin Nhân vật & Giọng AI */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '14px',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nhân vật & Giọng đọc AI</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: spk?.color || '#22c55e',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{spk?.name || 'Mặc định'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({spk?.voiceId || 'Mai Anh'})</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCueId(activeCue.id);
                    setSelectedElement({ type: 'cue', id: activeCue.id });
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface-2)',
                    color: 'var(--text-primary)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Chuyển sang chỉnh font, màu sắc, vị trí phụ đề câu này"
                >
                  📝 Sang chỉnh Phụ đề
                </button>
              </div>
            </div>

            {/* Tốc độ đọc & Âm lượng */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Tốc độ & Thời lượng</span>
                {activeCue.playbackRate && activeCue.playbackRate > 1.35 && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      backgroundColor: activeCue.playbackRate > 1.6 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                      color: activeCue.playbackRate > 1.6 ? '#f87171' : '#facc15',
                      border: `1px solid ${activeCue.playbackRate > 1.6 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(234, 179, 8, 0.4)'}`,
                    }}
                  >
                    {activeCue.playbackRate > 1.6 ? '🚨 Quá nhanh / Dễ vỡ tiếng' : '⚠️ Khá nhanh'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                  <span>Tốc độ đọc (Playback Rate)</span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color:
                        (activeCue.speed || activeCue.playbackRate || 1.0) > 1.6
                          ? '#f87171'
                          : (activeCue.speed || activeCue.playbackRate || 1.0) > 1.35
                          ? '#facc15'
                          : '#38bdf8',
                    }}
                  >
                    ⚡ {(activeCue.speed && Math.abs(activeCue.speed - 1.0) >= 0.02 ? activeCue.speed : (activeCue.playbackRate || 1.0)).toFixed(2)}x
                  </span>
                </div>

                {activeCue.playbackRate && activeCue.playbackRate > 1.6 && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#f87171',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      marginTop: '4px',
                      lineHeight: 1.4,
                    }}
                  >
                    💡 <strong>Mẹo tránh méo giọng:</strong> Câu dịch tiếng Việt quá dài so với thời gian thoại gốc. Bạn nên rút gọn bớt từ ngữ ở câu này hoặc bật tính năng <em>"Mượn khoảng lặng lân cận"</em> ở Bước 3.
                  </div>
                )}
              </div>

              {/* So sánh Thời lượng Âm thanh vs Khung hình video */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Thời lượng Audio đọc</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#22c55e', fontSize: '12px' }}>
                    {(activeCue.audioDuration || ((activeCue.duration || 1) * (activeCue.playbackRate || 1.0))).toFixed(2)}s
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Khung hình video gốc</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8', fontSize: '12px' }}>
                    {(activeCue.duration || (activeCue.endTime - activeCue.startTime)).toFixed(2)}s
                  </div>
                </div>
              </div>
            </div>

            {/* Mốc thời gian Timeline */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '14px',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Mốc thời gian trên Timeline</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface-1)',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Bắt đầu</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: '#38bdf8' }}>
                    {(activeCue.placedStartTime ?? activeCue.startTime).toFixed(2)}s
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface-1)',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Kết thúc</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: '#38bdf8' }}>
                    {(activeCue.placedEndTime ?? activeCue.endTime).toFixed(2)}s
                  </div>
                </div>
              </div>
            </div>

            {/* Tệp âm thanh đã tổng hợp */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '14px',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Trạng thái tệp âm thanh (WAV)</span>
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-surface-1)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '11px',
                  color: activeCue.audioFile ? '#4ade80' : 'var(--text-muted)',
                }}
              >
                {activeCue.audioFile ? `✓ Đã tạo file: ${activeCue.audioFile}` : 'Chưa tổng hợp âm thanh (Hãy chuyển qua Bước 3)'}
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  // VIEW 3: EMPTY STATE (NOTHING SELECTED)
  if (!selectedCue) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          color: 'var(--text-muted)',
          fontSize: '13px',
          textAlign: 'center',
          gap: '14px',
        }}
      >
        <Layers size={38} style={{ opacity: 0.3 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Chưa chọn phần tử nào</span>
          <span style={{ fontSize: '12px' }}>Nhấp chọn một câu phụ đề, đoạn âm thanh hoặc video trên Timeline để chỉnh thuộc tính:</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '240px' }}>
          <button
            type="button"
            onClick={() => {
              if (cues.length > 0) {
                setSelectedCueId(cues[0].id);
                setSelectedElement({ type: 'cue', id: cues[0].id });
              }
            }}
            disabled={cues.length === 0}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-1)',
              color: 'var(--text-primary)',
              cursor: cues.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            📝 Chọn câu phụ đề đầu tiên
          </button>

          <button
            type="button"
            onClick={() => {
              if (cues.length > 0) {
                setSelectedCueId(null);
                setSelectedElement({ type: 'audio', id: cues[0].id });
              }
            }}
            disabled={cues.length === 0}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-1)',
              color: '#22c55e',
              cursor: cues.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            🎙️ Chọn đoạn âm thanh đầu tiên
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCueId(null);
              setSelectedElement({ type: 'video', id: videoClips[0]?.id || 'video_clip_0' });
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-1)',
              color: '#38bdf8',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            🎬 Chọn đoạn Video Track
          </button>
        </div>
      </div>
    );
  }

  const style: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    ...(selectedCue.style || {}),
  };

  const speaker = speakers.find((s) => s.id === selectedCue.speakerId);
  const speakerName = speaker?.name || selectedCue.speakerId || 'Mặc định';

  const handleStyleChange = (patch: Partial<SubtitleStyle>) => {
    if (selectedCueId !== null) {
      updateCueStyle(selectedCueId, patch, true);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-surface-0)',
        fontSize: '12px',
        color: 'var(--text-primary)',
      }}
    >
      {/* Top Header: Cue Title & Undo/Redo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
            Thuộc tính Câu #{selectedCue.id}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              fontWeight: 600,
            }}
          >
            {speakerName}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-2)',
              color: canUndo ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: canUndo ? 'pointer' : 'not-allowed',
              opacity: canUndo ? 1 : 0.4,
            }}
            title="Hoàn tác (Ctrl+Z)"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-2)',
              color: canRedo ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: canRedo ? 'pointer' : 'not-allowed',
              opacity: canRedo ? 1 : 0.4,
            }}
            title="Làm lại (Ctrl+Y)"
          >
            <Redo2 size={13} />
          </button>
        </div>
      </div>

      {/* Sync Style Actions Banner */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#06b6d4', fontWeight: 600, fontSize: '11px' }}>
          <Sparkles size={13} />
          <span>Đồng bộ phong cách phụ đề</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <button
            type="button"
            onClick={() => {
              const count = cues.filter((c) => c.speakerId === selectedCue.speakerId).length;
              syncSpeakerStyle(selectedCue.speakerId, style);
              useUIStore.getState().addToast({
                type: 'success',
                title: 'Đã đồng bộ kiểu phụ đề thành công',
                description: `Đã áp dụng định dạng cho ${count} câu của vai [${speakerName}]`,
              });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '11px',
            }}
            title="Áp dụng font, cỡ, viền, vị trí của câu này cho tất cả câu của cùng nhân vật"
          >
            <Check size={12} />
            <span>Cho vai [{speakerName}]</span>
          </button>

          <button
            type="button"
            onClick={() => {
              syncAllStyles(style);
              useUIStore.getState().addToast({
                type: 'success',
                title: 'Đã đồng bộ toàn bộ phụ đề thành công',
                description: `Đã áp dụng định dạng cho tất cả ${cues.length} câu thoại trong video`,
              });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              color: '#3b82f6',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '11px',
            }}
            title="Áp dụng phong cách này cho toàn bộ video"
          >
            <Sparkles size={12} />
            <span>Cho TẤT CẢ câu</span>
          </button>
        </div>
      </div>

      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* GROUP 1: TYPOGRAPHY */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            <Type size={14} />
            <span>Kiểu chữ & Phông (Typography)</span>
          </div>

          {/* Font Family Select */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Phông chữ</label>
            <select
              value={style.fontFamily}
              onChange={(e) => handleStyleChange({ fontFamily: e.target.value })}
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface-2)',
                color: 'var(--text-primary)',
                fontFamily: style.fontFamily,
                cursor: 'pointer',
              }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {/* Style Buttons & Alignment */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {/* Bold / Italic / Underline */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => handleStyleChange({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: style.fontWeight === 'bold' ? 'var(--color-primary)' : 'var(--bg-surface-2)',
                  color: style.fontWeight === 'bold' ? '#ffffff' : 'var(--text-primary)',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                B
              </button>
              <button
                type="button"
                onClick={() => handleStyleChange({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: style.fontStyle === 'italic' ? 'var(--color-primary)' : 'var(--bg-surface-2)',
                  color: style.fontStyle === 'italic' ? '#ffffff' : 'var(--text-primary)',
                  fontStyle: 'italic',
                  cursor: 'pointer',
                }}
              >
                I
              </button>
              <button
                type="button"
                onClick={() => handleStyleChange({ textDecoration: style.textDecoration === 'underline' ? 'none' : 'underline' })}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: style.textDecoration === 'underline' ? 'var(--color-primary)' : 'var(--bg-surface-2)',
                  color: style.textDecoration === 'underline' ? '#ffffff' : 'var(--text-primary)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                U
              </button>
            </div>

            {/* Alignment Left / Center / Right */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => handleStyleChange({ textAlign: align })}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: style.textAlign === align ? 'var(--color-primary)' : 'var(--bg-surface-2)',
                    color: style.textAlign === align ? '#ffffff' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '10px',
                    textTransform: 'uppercase',
                  }}
                >
                  {align === 'left' ? 'Trái' : align === 'center' ? 'Giữa' : 'Phải'}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size & Box Width */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Cỡ chữ</span>
                <span style={{ fontFamily: 'monospace' }}>{style.fontSize}px</span>
              </div>
              <input
                type="range"
                min="10"
                max="60"
                value={style.fontSize}
                onChange={(e) => handleStyleChange({ fontSize: parseInt(e.target.value, 10) })}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Độ rộng khung</span>
                <span style={{ fontFamily: 'monospace' }}>{style.boxWidth}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="95"
                value={style.boxWidth}
                onChange={(e) => handleStyleChange({ boxWidth: parseInt(e.target.value, 10) })}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>

        {/* GROUP 2: COLORS, STROKE & SHADOW */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            <Palette size={14} />
            <span>Màu sắc, Viền & Đổ bóng</span>
          </div>

          {/* Text Fill Color */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Màu chữ chính</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="color"
                  value={style.textColor}
                  onChange={(e) => handleStyleChange({ textColor: e.target.value })}
                  style={{ width: '24px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{style.textColor}</span>
              </div>
            </div>

            {/* Color Presets */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleStyleChange({ textColor: c })}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: style.textColor === c ? '2px solid #06b6d4' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Stroke / Outline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={style.hasStroke}
                  onChange={(e) => handleStyleChange({ hasStroke: e.target.checked })}
                />
                <span>Viền chữ (Stroke)</span>
              </label>

              {style.hasStroke && (
                <input
                  type="color"
                  value={style.strokeColor}
                  onChange={(e) => handleStyleChange({ strokeColor: e.target.value })}
                  style={{ width: '20px', height: '20px', border: 'none', cursor: 'pointer', background: 'none' }}
                />
              )}
            </div>

            {style.hasStroke && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Độ dày</span>
                <input
                  type="range"
                  min="1"
                  max="6"
                  value={style.strokeWidth}
                  onChange={(e) => handleStyleChange({ strokeWidth: parseInt(e.target.value, 10) })}
                  style={{ flex: 1, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>{style.strokeWidth}px</span>
              </div>
            )}
          </div>

          {/* Shadow */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={style.hasShadow}
                  onChange={(e) => handleStyleChange({ hasShadow: e.target.checked })}
                />
                <span>Đổ bóng (Shadow)</span>
              </label>
            </div>

            {style.hasShadow && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px', width: '48px' }}>Độ nhòe</span>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={style.shadowBlur}
                    onChange={(e) => handleStyleChange({ shadowBlur: parseInt(e.target.value, 10) })}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>{style.shadowBlur}px</span>
                </div>
              </div>
            )}
          </div>

          {/* Background Box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-surface-1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={style.hasBackground}
                  onChange={(e) => handleStyleChange({ hasBackground: e.target.checked })}
                />
                <span>Hộp nền (Background Box)</span>
              </label>

              {style.hasBackground && (
                <input
                  type="color"
                  value={style.backgroundColor}
                  onChange={(e) => handleStyleChange({ backgroundColor: e.target.value })}
                  style={{ width: '20px', height: '20px', border: 'none', cursor: 'pointer', background: 'none' }}
                />
              )}
            </div>

            {style.hasBackground && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Bo góc</span>
                  <input
                    type="range"
                    min="0"
                    max="16"
                    value={style.backgroundBorderRadius}
                    onChange={(e) => handleStyleChange({ backgroundBorderRadius: parseInt(e.target.value, 10) })}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Đệm</span>
                  <input
                    type="range"
                    min="2"
                    max="16"
                    value={style.backgroundPaddingX}
                    onChange={(e) => handleStyleChange({ backgroundPaddingX: parseInt(e.target.value, 10) })}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* GROUP 3: POSITION & DIRECT CONTROLS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              <Move size={14} />
              <span>Vị trí trên Video (Tọa độ X / Y)</span>
            </div>
            <button
              type="button"
              onClick={() => handleStyleChange({ position: { x: 0, y: 150 } })}
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '3px',
                backgroundColor: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="Đặt lại vị trí căn giữa dưới đáy"
            >
              Căn đáy (X:0, Y:150)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Ngang (X)</span>
                <span style={{ fontFamily: 'monospace' }}>{Math.round(style.position.x)}px</span>
              </div>
              <input
                type="range"
                min="-250"
                max="250"
                value={style.position.x}
                onChange={(e) => handleStyleChange({ position: { ...style.position, x: parseInt(e.target.value, 10) } })}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Dọc (Y)</span>
                <span style={{ fontFamily: 'monospace' }}>{Math.round(style.position.y)}px</span>
              </div>
              <input
                type="range"
                min="-220"
                max="220"
                value={style.position.y}
                onChange={(e) => handleStyleChange({ position: { ...style.position, y: parseInt(e.target.value, 10) } })}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: 'italic' }}>
            💡 Mẹo: Bạn có thể nhấp và kéo trực tiếp hộp phụ đề ngay trên màn hình video!
          </span>
        </div>

        {/* GROUP 4: AUDIO GAIN & SPEED */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', paddingBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            <Volume2 size={14} />
            <span>Âm thanh & Tốc độ câu này</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Tốc độ đọc</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8' }}>
                  {(selectedCue.speed && Math.abs(selectedCue.speed - 1.0) >= 0.02 ? selectedCue.speed : (selectedCue.playbackRate || 1.0)).toFixed(2)}x
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px' }}>
                <span>Thời lượng</span>
                <span style={{ fontFamily: 'monospace' }}>{(selectedCue.duration || 0).toFixed(2)}s</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', paddingTop: '4px' }}>
                {selectedCue.audioFile ? 'Đã có file Audio TTS' : 'Chưa tổng hợp'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
