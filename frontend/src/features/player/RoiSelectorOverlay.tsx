import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { OcrRegion } from '../../types';

interface RoiSelectorOverlayProps {
  containerWidth: number;
  containerHeight: number;
  visible?: boolean;
}

const DEFAULT_ROI: OcrRegion = {
  x: 0.05,
  y: 0.75,
  width: 0.90,
  height: 0.22,
};

export const RoiSelectorOverlay: React.FC<RoiSelectorOverlayProps> = ({
  containerWidth,
  containerHeight,
  visible = true,
}) => {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);

  const savedRoi = project?.settings?.ocrRegion;
  const [localRoi, setLocalRoi] = useState<OcrRegion | null>(null);
  const roi = localRoi || savedRoi || DEFAULT_ROI;

  const isDraggingRef = useRef<boolean>(false);
  const isResizingRef = useRef<string | null>(null);
  const startPosRef = useRef<{ clientX: number; clientY: number; roi: OcrRegion }>({
    clientX: 0,
    clientY: 0,
    roi: DEFAULT_ROI,
  });

  const handleMouseDown = (e: React.MouseEvent, handleType: string | null) => {
    e.stopPropagation();
    e.preventDefault();

    if (handleType) {
      isResizingRef.current = handleType;
    } else {
      isDraggingRef.current = true;
    }

    startPosRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      roi: { ...roi },
    };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current && !isResizingRef.current) return;
      if (containerWidth <= 0 || containerHeight <= 0) return;

      const dx = (e.clientX - startPosRef.current.clientX) / containerWidth;
      const dy = (e.clientY - startPosRef.current.clientY) / containerHeight;
      const orig = startPosRef.current.roi;

      let newX = orig.x;
      let newY = orig.y;
      let newW = orig.width;
      let newH = orig.height;

      if (isDraggingRef.current) {
        newX = Math.max(0, Math.min(1 - orig.width, orig.x + dx));
        newY = Math.max(0, Math.min(1 - orig.height, orig.y + dy));
      } else if (isResizingRef.current) {
        const handle = isResizingRef.current;
        if (handle.includes('e')) {
          newW = Math.max(0.05, Math.min(1 - orig.x, orig.width + dx));
        }
        if (handle.includes('s')) {
          newH = Math.max(0.05, Math.min(1 - orig.y, orig.height + dy));
        }
        if (handle.includes('w')) {
          const maxLeftShift = orig.width - 0.05;
          const shift = Math.max(-orig.x, Math.min(maxLeftShift, dx));
          newX = orig.x + shift;
          newW = orig.width - shift;
        }
        if (handle.includes('n')) {
          const maxTopShift = orig.height - 0.05;
          const shift = Math.max(-orig.y, Math.min(maxTopShift, dy));
          newY = orig.y + shift;
          newH = orig.height - shift;
        }
      }

      const updated: OcrRegion = {
        x: Math.round(newX * 1000) / 1000,
        y: Math.round(newY * 1000) / 1000,
        width: Math.round(newW * 1000) / 1000,
        height: Math.round(newH * 1000) / 1000,
      };

      setLocalRoi(updated);
    },
    [containerWidth, containerHeight]
  );

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current || isResizingRef.current) {
      isDraggingRef.current = false;
      isResizingRef.current = null;
      updateSettings({ ocrRegion: roi });
    }
  }, [roi, updateSettings]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  if (!visible) return null;

  const leftPx = roi.x * containerWidth;
  const topPx = roi.y * containerHeight;
  const widthPx = roi.width * containerWidth;
  const heightPx = roi.height * containerHeight;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <div
        onMouseDown={(e) => handleMouseDown(e, null)}
        style={{
          position: 'absolute',
          left: `${leftPx}px`,
          top: `${topPx}px`,
          width: `${widthPx}px`,
          height: `${heightPx}px`,
          border: '2px dashed #10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          boxShadow: '0 0 12px rgba(16, 185, 129, 0.3)',
          cursor: 'move',
          pointerEvents: 'auto',
          boxSizing: 'border-box',
          userSelect: 'none',
        }}
      >
        {/* Label Badge */}
        <div
          style={{
            position: 'absolute',
            top: '-24px',
            left: 0,
            backgroundColor: '#10b981',
            color: '#ffffff',
            padding: '2px 6px',
            borderRadius: '3px',
            fontSize: '11px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Vùng OCR: {Math.round(roi.width * 100)}% x {Math.round(roi.height * 100)}%</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLocalRoi(DEFAULT_ROI);
              updateSettings({ ocrRegion: DEFAULT_ROI });
            }}
            style={{
              background: 'rgba(0,0,0,0.2)',
              border: 'none',
              color: '#fff',
              fontSize: '10px',
              cursor: 'pointer',
              borderRadius: '2px',
              padding: '1px 4px',
            }}
          >
            Mặc định
          </button>
        </div>

        {/* 4 Corner Handles */}
        <div
          onMouseDown={(e) => handleMouseDown(e, 'nw')}
          style={{
            position: 'absolute',
            top: '-5px',
            left: '-5px',
            width: '10px',
            height: '10px',
            backgroundColor: '#10b981',
            borderRadius: '2px',
            cursor: 'nwse-resize',
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'ne')}
          style={{
            position: 'absolute',
            top: '-5px',
            right: '-5px',
            width: '10px',
            height: '10px',
            backgroundColor: '#10b981',
            borderRadius: '2px',
            cursor: 'nesw-resize',
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'sw')}
          style={{
            position: 'absolute',
            bottom: '-5px',
            left: '-5px',
            width: '10px',
            height: '10px',
            backgroundColor: '#10b981',
            borderRadius: '2px',
            cursor: 'nesw-resize',
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'se')}
          style={{
            position: 'absolute',
            bottom: '-5px',
            right: '-5px',
            width: '10px',
            height: '10px',
            backgroundColor: '#10b981',
            borderRadius: '2px',
            cursor: 'nwse-resize',
          }}
        />
      </div>
    </div>
  );
};
