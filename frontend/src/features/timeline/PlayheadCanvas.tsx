import React, { useRef, useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { setupHiDPICanvas } from '../../utils/canvasDraw';

interface PlayheadCanvasProps {
  width: number;
  height: number;
  zoom: number; // px per second
  scrollLeft: number;
}

export const PlayheadCanvas: React.FC<PlayheadCanvasProps> = ({
  width,
  height,
  zoom,
  scrollLeft,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setupHiDPICanvas(canvas, ctx, width, height);

    let animationFrameId: number;

    const renderPlayhead = (currentTime: number) => {
      ctx.clearRect(0, 0, width, height);

      const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
      const playheadX = safeTime * zoom - scrollLeft;
      if (playheadX < -20 || playheadX > width + 20) return;

      ctx.save();

      // Vạch kim chỉ giờ màu đỏ (Red Playhead line)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX + 0.5, 0);
      ctx.lineTo(playheadX + 0.5, height);
      ctx.stroke();

      // Đầu kim Playhead chuẩn Lemyloi / CapCut (Vòng tròn đỏ viền trắng trên Ruler)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(playheadX + 0.5, 12, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Vòng tròn trắng ở giữa
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(playheadX + 0.5, 12, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    // Vẽ ngay lập tức theo thời gian hiện tại
    renderPlayhead(usePlayerStore.getState().currentTime);

    // Đăng ký 60Hz transient subscription từ playerStore
    const unsub = usePlayerStore.subscribe((state) => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        renderPlayhead(state.currentTime);
      });
    });

    return () => {
      unsub();
      cancelAnimationFrame(animationFrameId);
    };
  }, [width, height, zoom, scrollLeft]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
};
