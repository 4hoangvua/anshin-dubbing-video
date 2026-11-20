import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { usePlayerStore } from '../../stores/playerStore';
import { Button } from '../../design-system/Button';

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const VideoControls: React.FC = () => {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackRate = usePlayerStore((s) => s.playbackRate);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const timecodeRef = useRef<HTMLSpanElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // Transient 60Hz subscription: Chỉ cập nhật DOM thật, KHÔNG re-render component React!
  useEffect(() => {
    const unsub = usePlayerStore.subscribe((state) => {
      const cur = state.currentTime;
      const dur = state.duration;

      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      }

      if (progressFillRef.current && dur > 0) {
        const percent = Math.min(100, Math.max(0, (cur / dur) * 100));
        progressFillRef.current.style.width = `${percent}%`;
      }
    });

    return unsub;
  }, []);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const duration = usePlayerStore.getState().duration;
    if (Number.isFinite(duration) && duration > 0) {
      seekTo(ratio * duration);
    }
  };

  const handleSkip = (seconds: number) => {
    const current = usePlayerStore.getState().currentTime;
    const duration = usePlayerStore.getState().duration;
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const target = safeDuration > 0
      ? Math.max(0, Math.min(safeDuration, safeCurrent + seconds))
      : Math.max(0, safeCurrent + seconds);
    if (Number.isFinite(target)) {
      seekTo(target);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-surface-0)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '6px 12px',
        gap: '6px',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Mini Seekbar */}
      <div
        ref={progressBarRef}
        onClick={handleSeekClick}
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'var(--border-strong)',
          borderRadius: '3px',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          ref={progressFillRef}
          style={{
            height: '100%',
            width: '0%',
            backgroundColor: 'var(--accent-primary)',
            borderRadius: '3px',
            transition: 'width 0.05s linear',
          }}
        />
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Left: Playback controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Button
            size="sm"
            variant="primary"
            onClick={togglePlay}
            style={{ width: '32px', height: '30px', padding: 0 }}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleSkip(-5)}
            title="Tua lùi 5 giây (J)"
            style={{ width: '30px', height: '30px', padding: 0 }}
          >
            <RotateCcw size={14} />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleSkip(5)}
            title="Tua tới 5 giây (L)"
            style={{ width: '30px', height: '30px', padding: 0 }}
          >
            <RotateCw size={14} />
          </Button>

          {/* Transient Timecode Display */}
          <span
            ref={timecodeRef}
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginLeft: '6px',
            }}
          >
            00:00 / 00:00
          </span>
        </div>

        {/* Right: Playback Rate Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Rate Selector */}
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
            style={{
              backgroundColor: 'var(--bg-surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              padding: '2px 4px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
        </div>
      </div>
    </div>
  );
};
