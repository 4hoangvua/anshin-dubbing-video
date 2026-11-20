import React, { memo } from 'react';
import { Play, Split, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { CueItem } from '../../types';
import { SpeakerSelect } from './SpeakerSelect';
import { usePlayerStore } from '../../stores/playerStore';

interface CueRowProps {
  cue: CueItem;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onUpdateText: (id: number, text: { originalText?: string; translatedText?: string }) => void;
  onUpdateSpeaker: (id: number, speakerId: string) => void;
  onSplit: (id: number) => void;
  onDelete: (id: number) => void;
}

const formatSeconds = (sec: number): string => {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return '00:00.00';
  const safeSec = Math.max(0, sec);
  const m = Math.floor(safeSec / 60);
  const s = Math.floor(safeSec % 60);
  const ms = Math.floor((safeSec % 1) * 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

export const CueRow: React.FC<CueRowProps> = memo(
  ({ cue, isSelected, onSelect, onUpdateText, onUpdateSpeaker, onSplit, onDelete }) => {
    const seekTo = usePlayerStore((s) => s.seekTo);
    const effectiveSpeed = (cue.speed && Math.abs(cue.speed - 1.0) >= 0.02)
      ? cue.speed
      : (cue.playbackRate || 1.0);

    return (
      <div
        onClick={() => onSelect(cue.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: isSelected ? 'var(--bg-surface-2)' : 'transparent',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '6px 12px',
          gap: '8px',
          transition: 'background-color 0.1s ease',
          fontSize: '12px',
          userSelect: 'text',
          boxSizing: 'border-box',
        }}
      >
        {/* Index & Play button */}
        <div
          style={{
            width: '32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            #{cue.id}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (Number.isFinite(cue.startTime)) {
                seekTo(cue.startTime);
              }
            }}
            title="Tua đến câu này"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              borderRadius: '4px',
            }}
          >
            <Play size={12} fill="currentColor" />
          </button>
        </div>

        {/* Timings & Speed */}
        <div
          style={{
            width: '84px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontSize: '10px',
            color: 'var(--text-secondary)',
            flexShrink: 0,
            lineHeight: 1.3,
            gap: '2px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{formatSeconds(cue.startTime)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatSeconds(cue.endTime)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '9px', color: 'var(--accent-primary)', fontWeight: 600 }}>
              {(cue.duration ? cue.duration : cue.endTime - cue.startTime).toFixed(2)}s
            </span>

            {/* Speed Rate Tag: Hiển thị tốc độ x của từng câu lồng tiếng */}
            {(cue.audioFile || cue.speed || (cue.playbackRate && cue.playbackRate !== 1.0)) ? (
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: '3px',
                  lineHeight: 1,
                  fontFamily: 'monospace',
                  backgroundColor:
                    effectiveSpeed > 1.6
                      ? 'rgba(239, 68, 68, 0.25)'
                      : effectiveSpeed > 1.35
                      ? 'rgba(245, 158, 11, 0.25)'
                      : 'rgba(59, 130, 246, 0.15)',
                  color:
                    effectiveSpeed > 1.6
                      ? '#ef4444'
                      : effectiveSpeed > 1.35
                      ? '#f59e0b'
                      : 'var(--text-secondary, #94a3b8)',
                  border: `1px solid ${
                    effectiveSpeed > 1.6
                      ? 'rgba(239, 68, 68, 0.5)'
                      : effectiveSpeed > 1.35
                      ? 'rgba(245, 158, 11, 0.5)'
                      : 'rgba(255, 255, 255, 0.1)'
                  }`,
                }}
                title={
                  effectiveSpeed > 1.6
                    ? `Tốc độ: ${effectiveSpeed.toFixed(2)}x (CẢNH BÁO: Quá nhanh, dễ bị méo/vỡ tiếng!)\nAudio: ${(cue.audioDuration || (cue.duration || 1) * effectiveSpeed).toFixed(2)}s / Khung: ${(cue.duration || cue.endTime - cue.startTime).toFixed(2)}s`
                    : effectiveSpeed > 1.35
                    ? `Tốc độ: ${effectiveSpeed.toFixed(2)}x (Đọc khá nhanh)\nAudio: ${(cue.audioDuration || (cue.duration || 1) * effectiveSpeed).toFixed(2)}s / Khung: ${(cue.duration || cue.endTime - cue.startTime).toFixed(2)}s`
                    : `Tốc độ: ${effectiveSpeed.toFixed(2)}x (Tự nhiên, không vỡ tiếng)\nAudio: ${(cue.audioDuration || (cue.duration || 1) * effectiveSpeed).toFixed(2)}s / Khung: ${(cue.duration || cue.endTime - cue.startTime).toFixed(2)}s`
                }
              >
                {effectiveSpeed > 1.6 ? '🚨' : effectiveSpeed > 1.35 ? '⚡' : ''}{effectiveSpeed.toFixed(2)}x
              </span>
            ) : null}
          </div>
        </div>

        {/* Speaker Badge */}
        <div style={{ width: '88px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <SpeakerSelect
            currentSpeakerId={cue.speakerId}
            onSelect={(speakerId) => onUpdateSpeaker(cue.id, speakerId)}
          />
        </div>

        {/* Text Editors: Stacked Layout (Original top, Translated bottom) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          {/* Original Text */}
          <input
            type="text"
            value={cue.originalText}
            onChange={(e) => onUpdateText(cue.id, { originalText: e.target.value })}
            placeholder="Lời thoại gốc..."
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              height: '24px',
            }}
          />

          {/* Translated Text */}
          <input
            type="text"
            value={cue.translatedText || ''}
            onChange={(e) => onUpdateText(cue.id, { translatedText: e.target.value })}
            placeholder="Bản dịch tiếng Việt..."
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              height: '26px',
            }}
          />
        </div>

        {/* Status & Actions */}
        <div
          style={{
            width: '44px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {cue.audioFile ? (
              <span title="Đã có âm thanh lồng tiếng" style={{ display: 'flex' }}>
                <CheckCircle2 size={13} color="var(--accent-success)" />
              </span>
            ) : cue.needsReview ? (
              <span title="Cần xem xét tốc độ đọc" style={{ display: 'flex' }}>
                <AlertTriangle size={13} color="var(--accent-warning)" />
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSplit(cue.id);
              }}
              title="Tách câu"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                borderRadius: '3px',
              }}
            >
              <Split size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(cue.id);
              }}
              title="Xóa câu"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                borderRadius: '3px',
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }
);
