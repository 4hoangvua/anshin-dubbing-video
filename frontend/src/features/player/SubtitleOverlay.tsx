import React, { useEffect, useRef } from 'react';
import { useCueStore } from '../../stores/cueStore';
import { usePlayerStore } from '../../stores/playerStore';
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '../../types';

interface SubtitleOverlayProps {
  mode?: 'both' | 'target' | 'source';
}

/**
 * 60Hz Transient Subtitle Overlay
 * Lắng nghe currentTime qua usePlayerStore.subscribe và thay đổi styles từ useCueStore.subscribe,
 * cập nhật trực tiếp DOM mà KHÔNG gây re-render React Component!
 */
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ mode = 'both' }) => {
  const origRef = useRef<HTMLDivElement | null>(null);
  const transRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let lastSignature: string = '';

    const updateDOM = () => {
      const time = usePlayerStore.getState().currentTime;
      const isPlaying = usePlayerStore.getState().isPlaying;
      const cues = useCueStore.getState().cues;
      const selectedCueId = useCueStore.getState().selectedCueId;

      const active = cues.find((c) => time >= c.startTime && time <= c.endTime);

      if (active) {
        // Nếu câu thoại đang chọn và video đang DỪNG (!isPlaying),
        // SubtitleSelectionOverlay sẽ hiển thị khung kéo và tương tác.
        // Khi video đang CHẠY (isPlaying), SubtitleOverlay sẽ phụ trách hiển thị mượt mà.
        if (active.id === selectedCueId && !isPlaying) {
          if (containerRef.current) containerRef.current.style.display = 'none';
          lastSignature = '';
          return;
        }

        const style: SubtitleStyle = {
          ...DEFAULT_SUBTITLE_STYLE,
          ...(active.style || {}),
        };

        const signature = `${active.id}_${active.originalText}_${active.translatedText}_${JSON.stringify(style)}_${mode}_${isPlaying}_${selectedCueId}`;
        if (signature !== lastSignature) {
          lastSignature = signature;

          if (containerRef.current) {
            containerRef.current.style.display = 'flex';
            containerRef.current.style.transform = `translate(-50%, -50%) translate3d(${style.position.x}px, ${style.position.y}px, 0)`;
            containerRef.current.style.width = `${style.boxWidth}%`;
          }

          if (origRef.current && (mode === 'both' || mode === 'source')) {
            origRef.current.textContent = active.originalText;
          }

          if (transRef.current && (mode === 'both' || mode === 'target')) {
            transRef.current.textContent = active.translatedText || '';
            transRef.current.style.fontFamily = style.fontFamily;
            transRef.current.style.fontSize = `${style.fontSize}px`;
            transRef.current.style.fontWeight = style.fontWeight;
            transRef.current.style.fontStyle = style.fontStyle;
            transRef.current.style.textDecoration = style.textDecoration;
            transRef.current.style.color = style.textColor;
            transRef.current.style.textAlign = style.textAlign;

            const textShadows: string[] = [];
            if (style.hasStroke) {
              const sw = style.strokeWidth;
              const sc = style.strokeColor;
              textShadows.push(`-${sw}px -${sw}px 0 ${sc}, ${sw}px -${sw}px 0 ${sc}, -${sw}px ${sw}px 0 ${sc}, ${sw}px ${sw}px 0 ${sc}`);
            }
            if (style.hasShadow) {
              textShadows.push(`${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowColor}`);
            }
            transRef.current.style.textShadow = textShadows.join(', ');

            if (style.hasBackground) {
              transRef.current.style.backgroundColor = style.backgroundColor;
              transRef.current.style.padding = `${style.backgroundPaddingY}px ${style.backgroundPaddingX}px`;
              transRef.current.style.borderRadius = `${style.backgroundBorderRadius}px`;
            } else {
              transRef.current.style.backgroundColor = 'transparent';
              transRef.current.style.padding = '0';
              transRef.current.style.borderRadius = '0';
            }
          }
        }
      } else {
        if (lastSignature !== '') {
          lastSignature = '';
          if (containerRef.current) containerRef.current.style.display = 'none';
          if (origRef.current) origRef.current.textContent = '';
          if (transRef.current) transRef.current.textContent = '';
        }
      }
    };

    // Lắng nghe cả timeline playback time VÀ cue store changes (style, text, undo/redo)
    const unsubPlayer = usePlayerStore.subscribe(updateDOM);
    const unsubCue = useCueStore.subscribe(updateDOM);

    // Initial render
    updateDOM();

    return () => {
      unsubPlayer();
      unsubCue();
    };
  }, [mode]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) translate3d(0, 150px, 0)',
        display: 'none',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 20,
        gap: '4px',
        maxWidth: '95%',
      }}
    >
      {/* Original Subtitle (Source) */}
      {(mode === 'both' || mode === 'source') && (
        <div
          ref={origRef}
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: '#e2e8f0',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            textAlign: 'center',
            maxWidth: '90%',
            lineHeight: 1.3,
          }}
        />
      )}

      {/* Translated Subtitle (Target AI) */}
      {(mode === 'both' || mode === 'target') && (
        <div
          ref={transRef}
          style={{
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        />
      )}
    </div>
  );
};
