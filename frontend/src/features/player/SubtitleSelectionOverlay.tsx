import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useCueStore } from '../../stores/cueStore';
import { usePlayerStore } from '../../stores/playerStore';
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '../../types';

interface SubtitleSelectionOverlayProps {
  containerSize: { width: number; height: number };
  mode?: 'both' | 'target' | 'source';
}

export const SubtitleSelectionOverlay: React.FC<SubtitleSelectionOverlayProps> = ({ containerSize, mode = 'both' }) => {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // Zero re-render during 60Hz playback: returns 0 when playing
  const currentTime = usePlayerStore((s) => (s.isPlaying ? 0 : s.currentTime));

  const selectedCueId = useCueStore((s) => s.selectedCueId);
  const cues = useCueStore((s) => s.cues);
  const updateCueStyle = useCueStore((s) => s.updateCueStyle);

  const selectedCue = cues.find((c) => c.id === selectedCueId);
  const style: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    ...(selectedCue?.style || {}),
  };

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCenterGuide, setShowCenterGuide] = useState(false);

  // Drag state refs
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const currentPosRef = useRef<{ x: number; y: number }>(style.position || { x: 0, y: 150 });

  // Sync currentPosRef when cue style changes from outside
  useEffect(() => {
    if (!isDragging) {
      currentPosRef.current = style.position || { x: 0, y: 150 };
      if (boxRef.current) {
        boxRef.current.style.transform = `translate(-50%, -50%) translate3d(${currentPosRef.current.x}px, ${currentPosRef.current.y}px, 0)`;
      }
    }
  }, [style.position, isDragging, selectedCueId]);

  // Handle Box Drag (Move Position X/Y)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: currentPosRef.current.x,
      startY: currentPosRef.current.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    let targetX = dragStartRef.current.startX + dx;
    let targetY = dragStartRef.current.startY + dy;

    // Smart Snapping: Snap to Center X within 6px threshold
    if (Math.abs(targetX) < 6) {
      targetX = 0;
      setShowCenterGuide(true);
    } else {
      setShowCenterGuide(false);
    }

    currentPosRef.current = { x: targetX, y: targetY };

    if (boxRef.current) {
      boxRef.current.style.transform = `translate(-50%, -50%) translate3d(${targetX}px, ${targetY}px, 0)`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    dragStartRef.current = null;
    setIsDragging(false);
    setShowCenterGuide(false);

    if (selectedCueId !== null) {
      updateCueStyle(selectedCueId, { position: currentPosRef.current }, true);
    }
  };

  // Handle Corner Handle Resize (Font Size Scaling)
  const handleCornerResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startY = e.clientY;
      const initialFontSize = style.fontSize;

      const onPointerMove = (moveEv: PointerEvent) => {
        const delta = (startY - moveEv.clientY) * 0.2; // Drag up increases font size
        const nextFontSize = Math.min(60, Math.max(10, Math.round(initialFontSize + delta)));
        if (selectedCueId !== null) {
          updateCueStyle(selectedCueId, { fontSize: nextFontSize }, false);
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (selectedCueId !== null) {
          updateCueStyle(selectedCueId, {}, true); // Push to history
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [selectedCueId, style.fontSize, updateCueStyle]
  );

  // Handle Side Handle Resize (Box Width % Scaling)
  const handleSideResizeStart = useCallback(
    (e: React.PointerEvent, side: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const initialBoxWidth = style.boxWidth;
      const containerW = containerSize.width || 800;

      const onPointerMove = (moveEv: PointerEvent) => {
        const deltaPx = side === 'right' ? moveEv.clientX - startX : startX - moveEv.clientX;
        const deltaPct = (deltaPx / (containerW / 2)) * 50;
        const nextWidth = Math.min(95, Math.max(30, Math.round(initialBoxWidth + deltaPct)));
        if (selectedCueId !== null) {
          updateCueStyle(selectedCueId, { boxWidth: nextWidth }, false);
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (selectedCueId !== null) {
          updateCueStyle(selectedCueId, {}, true); // Push to history
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [selectedCueId, style.boxWidth, containerSize.width, updateCueStyle]
  );

  // NGUYÊN TẮC KIẾN TRÚC CAPCUT / LEMYLOI:
  // 1. Khi video đang CHẠY (isPlaying === true): ẩn toàn bộ bounding box và chốt kéo để xem video mượt mà.
  // 2. Khi video DỪNG (!isPlaying): Bounding box CHỈ hiển thị nếu currentTime nằm trong khoảng [startTime, endTime] của cue đó!
  //    (Hoặc khi người dùng đang giữ chuột kéo rê isDragging).
  if (isPlaying || !selectedCue) return null;

  const isInRange = currentTime >= selectedCue.startTime - 0.05 && currentTime <= selectedCue.endTime + 0.05;
  if (!isDragging && !isInRange) {
    return null;
  }

  return (
    <>
      {/* Smart Guide Line: Vertical Center X */}
      {showCenterGuide && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            width: '1px',
            backgroundColor: '#ef4444',
            boxShadow: '0 0 6px rgba(239, 68, 68, 0.8)',
            zIndex: 35,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Interactive Selection Bounding Box */}
      <div
        ref={boxRef}
        data-subtitle-box="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: `${style.boxWidth}%`,
          maxWidth: '95%',
          transform: `translate(-50%, -50%) translate3d(${style.position.x}px, ${style.position.y}px, 0)`,
          border: '1.5px dashed #06b6d4',
          borderRadius: `${style.backgroundBorderRadius || 4}px`,
          backgroundColor: isDragging ? 'rgba(6, 182, 212, 0.08)' : 'rgba(6, 182, 212, 0.03)',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: 30,
          padding: '6px 12px',
          boxSizing: 'border-box',
          transition: isDragging ? 'none' : 'border-color 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
        }}
        title="Kéo rê để chỉnh vị trí phụ đề trên màn hình video, kéo chốt góc để phóng to/thu nhỏ"
      >
        {/* Top-Left Corner Handle */}
        <div
          onPointerDown={handleCornerResizeStart}
          style={{
            position: 'absolute',
            top: '-5px',
            left: '-5px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            border: '2px solid #06b6d4',
            cursor: 'nwse-resize',
            zIndex: 32,
          }}
          title="Kéo để chỉnh cỡ chữ"
        />

        {/* Top-Right Corner Handle */}
        <div
          onPointerDown={handleCornerResizeStart}
          style={{
            position: 'absolute',
            top: '-5px',
            right: '-5px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            border: '2px solid #06b6d4',
            cursor: 'nesw-resize',
            zIndex: 32,
          }}
          title="Kéo để chỉnh cỡ chữ"
        />

        {/* Bottom-Left Corner Handle */}
        <div
          onPointerDown={handleCornerResizeStart}
          style={{
            position: 'absolute',
            bottom: '-5px',
            left: '-5px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            border: '2px solid #06b6d4',
            cursor: 'nesw-resize',
            zIndex: 32,
          }}
          title="Kéo để chỉnh cỡ chữ"
        />

        {/* Bottom-Right Corner Handle */}
        <div
          onPointerDown={handleCornerResizeStart}
          style={{
            position: 'absolute',
            bottom: '-5px',
            right: '-5px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            border: '2px solid #06b6d4',
            cursor: 'nwse-resize',
            zIndex: 32,
          }}
          title="Kéo để chỉnh cỡ chữ"
        />

        {/* Left Side Handle (Box Width) */}
        <div
          onPointerDown={(e) => handleSideResizeStart(e, 'left')}
          style={{
            position: 'absolute',
            top: '50%',
            left: '-4px',
            transform: 'translateY(-50%)',
            width: '6px',
            height: '18px',
            borderRadius: '3px',
            backgroundColor: '#06b6d4',
            cursor: 'ew-resize',
            zIndex: 32,
          }}
          title="Kéo sang trái để mở rộng độ rộng khung phụ đề"
        />

        {/* Right Side Handle (Box Width) */}
        <div
          onPointerDown={(e) => handleSideResizeStart(e, 'right')}
          style={{
            position: 'absolute',
            top: '50%',
            right: '-4px',
            transform: 'translateY(-50%)',
            width: '6px',
            height: '18px',
            borderRadius: '3px',
            backgroundColor: '#06b6d4',
            cursor: 'ew-resize',
            zIndex: 32,
          }}
          title="Kéo sang phải để mở rộng độ rộng khung phụ đề"
        />

        {/* Original Subtitle (Source) if mode is 'both' or 'source' */}
        {(mode === 'both' || mode === 'source') && selectedCue.originalText && (
          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              color: '#e2e8f0',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              textAlign: 'center',
              maxWidth: '90%',
              lineHeight: 1.3,
              pointerEvents: 'none',
            }}
          >
            {selectedCue.originalText}
          </div>
        )}

        {/* Text Preview / Content inside Bounding Box (Target AI) */}
        {(mode === 'both' || mode === 'target') && (
          <div
            style={{
              fontFamily: style.fontFamily,
              fontSize: `${style.fontSize}px`,
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
              textDecoration: style.textDecoration,
              color: style.textColor,
              textAlign: style.textAlign,
              lineHeight: 1.4,
              textShadow: [
                style.hasStroke
                  ? `-${style.strokeWidth}px -${style.strokeWidth}px 0 ${style.strokeColor}, ${style.strokeWidth}px -${style.strokeWidth}px 0 ${style.strokeColor}, -${style.strokeWidth}px ${style.strokeWidth}px 0 ${style.strokeColor}, ${style.strokeWidth}px ${style.strokeWidth}px 0 ${style.strokeColor}`
                  : '',
                style.hasShadow
                  ? `${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowColor}`
                  : '',
              ]
                .filter(Boolean)
                .join(', '),
              backgroundColor: style.hasBackground ? style.backgroundColor : 'transparent',
              padding: style.hasBackground ? `${style.backgroundPaddingY}px ${style.backgroundPaddingX}px` : 0,
              borderRadius: `${style.backgroundBorderRadius}px`,
              pointerEvents: 'none',
              width: '100%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {selectedCue.translatedText || selectedCue.originalText || 'Nhập phụ đề...'}
          </div>
        )}

        {/* Position & Font Size Tooltip Badge */}
        <div
          style={{
            position: 'absolute',
            bottom: '-22px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            color: '#94a3b8',
            fontSize: '10px',
            fontFamily: 'monospace',
            padding: '1px 6px',
            borderRadius: '3px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          X: {Math.round(style.position.x)} Y: {Math.round(style.position.y)} | {style.fontSize}px | {style.boxWidth}%
        </div>
      </div>
    </>
  );
};
