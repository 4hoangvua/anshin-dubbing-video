import React, { useRef, useEffect } from 'react';
import type { CueItem } from '../../types';
import { setupHiDPICanvas, drawTimelineRuler, drawRoundedRect, truncateText } from '../../utils/canvasDraw';
import { getVisibleCues } from '../../utils/binarySearch';
import { useProjectStore } from '../../stores/projectStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { getCachedWaveform, getWaveformPeaks } from '../../utils/waveformCache';
import { getNearestFilmstripFrame } from '../../utils/filmstripCache';

interface MultiTrackCanvasProps {
  width: number;
  height: number;
  zoom: number; // px per second
  scrollLeft: number;
  cues: CueItem[];
  selectedCueId: number | null;
  selectedCueIds?: number[];
  videoDuration: number;
}

export const RULER_HEIGHT = 24;
export const CUE_TRACK_Y = 24;
export const CUE_TRACK_HEIGHT = 48;
export const VIDEO_TRACK_Y = 72;
export const VIDEO_TRACK_HEIGHT = 52;
export const AUDIO_TRACK_Y = 124;
export const AUDIO_TRACK_HEIGHT = 48;

const EMPTY_CUES: CueItem[] = [];
const EMPTY_SELECTED_IDS: number[] = [];

export const MultiTrackCanvas: React.FC<MultiTrackCanvasProps> = ({
  width,
  height,
  zoom,
  scrollLeft,
  cues,
  selectedCueId,
  selectedCueIds,
  videoDuration,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const safeCues = Array.isArray(cues) ? cues : EMPTY_CUES;
  const safeSelectedIds = Array.isArray(selectedCueIds) ? selectedCueIds : EMPTY_SELECTED_IDS;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rawSpeakers = useProjectStore.getState().project?.speakers;
    const speakers = Array.isArray(rawSpeakers) ? rawSpeakers : [];
    const speakerMap = new Map(speakers.map((s) => [s.id, s]));

    setupHiDPICanvas(canvas, ctx, width, height);

    // 1. Nền tổng thể Dark Slate
    ctx.fillStyle = '#0d0f15';
    ctx.fillRect(0, 0, width, height);

    // 2. Thước đo thời gian phía trên (Ruler)
    drawTimelineRuler(ctx, width, RULER_HEIGHT, scrollLeft, zoom);

    // Đường viền ngăn cách các Track
    ctx.strokeStyle = '#222838';
    ctx.lineWidth = 1;

    // --- TRACK 1: Subtitle Cues Track (Y = 24, Height = 48) ---
    ctx.fillStyle = '#111319';
    ctx.fillRect(0, CUE_TRACK_Y, width, CUE_TRACK_HEIGHT);
    ctx.beginPath();
    ctx.moveTo(0, CUE_TRACK_Y + CUE_TRACK_HEIGHT - 0.5);
    ctx.lineTo(width, CUE_TRACK_Y + CUE_TRACK_HEIGHT - 0.5);
    ctx.stroke();

    // --- TRACK 2: Video Filmstrip Track (Y = 72, Height = 52) ---
    ctx.fillStyle = '#14161f';
    ctx.fillRect(0, VIDEO_TRACK_Y, width, VIDEO_TRACK_HEIGHT);

    const videoPath = useProjectStore.getState().project?.videoInfo?.filePath || '';

    // Vẽ các ô Filmstrip khung hình video
    const filmCellWidth = 78;
    const startCellIdx = Math.floor(scrollLeft / filmCellWidth);
    const endCellIdx = Math.ceil((scrollLeft + width) / filmCellWidth);

    ctx.save();
    for (let c = startCellIdx; c <= endCellIdx; c++) {
      const cellX = c * filmCellWidth - scrollLeft;
      const cellTimeSec = (c * filmCellWidth) / zoom;
      if (videoDuration > 0 && cellTimeSec > videoDuration) break;

      // Khung ô film
      ctx.strokeStyle = '#222838';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX + 0.5, VIDEO_TRACK_Y + 1.5, filmCellWidth - 1, VIDEO_TRACK_HEIGHT - 3);

      const frameImg = getNearestFilmstripFrame(videoPath, cellTimeSec);
      if (frameImg) {
        // Vẽ ảnh video frame thật (cover crop)
        const srcAspect = frameImg.naturalWidth / frameImg.naturalHeight;
        const dstW = filmCellWidth - 2;
        const dstH = VIDEO_TRACK_HEIGHT - 4;
        const dstAspect = dstW / dstH;
        let sx = 0;
        let sy = 0;
        let sw = frameImg.naturalWidth;
        let sh = frameImg.naturalHeight;

        if (srcAspect > dstAspect) {
          sw = frameImg.naturalHeight * dstAspect;
          sx = (frameImg.naturalWidth - sw) / 2;
        } else {
          sh = frameImg.naturalWidth / dstAspect;
          sy = (frameImg.naturalHeight - sh) / 2;
        }

        ctx.drawImage(frameImg, sx, sy, sw, sh, cellX + 1, VIDEO_TRACK_Y + 2, dstW, dstH);
      } else {
        // Gradient nền nhẹ tạo cảm giác video frame khi đang tải
        ctx.fillStyle = c % 2 === 0 ? '#181b24' : '#1b1e29';
        ctx.fillRect(cellX + 1, VIDEO_TRACK_Y + 2, filmCellWidth - 2, VIDEO_TRACK_HEIGHT - 4);
      }

      // Dấu thời gian nhỏ ở góc dưới
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '9px monospace';
      const m = Math.floor(cellTimeSec / 60);
      const s = Math.floor(cellTimeSec % 60);
      const timeStr = `${m}:${s.toString().padStart(2, '0')}`;
      ctx.fillText(timeStr, cellX + 4, VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT - 6);
    }
    ctx.restore();

    // Vẽ viền sáng khi Video Clip được chọn trên Track 2
    const selectedEl = useTimelineStore.getState().selectedElement;
    const rawClips = useTimelineStore.getState().videoClips;
    const videoClips = Array.isArray(rawClips) ? rawClips : [];
    if (selectedEl?.type === 'video') {
      const activeClip = videoClips.find((c) => c.id === selectedEl.id) || (videoDuration > 0 ? { id: 'video_clip_0', startTime: 0, duration: videoDuration } : null);
      if (activeClip) {
        const clipX = activeClip.startTime * zoom - scrollLeft;
        const clipW = Math.max(16, activeClip.duration * zoom);

        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(clipX + 1, VIDEO_TRACK_Y + 1.5, clipW - 2, VIDEO_TRACK_HEIGHT - 3);

        // Tay nắm bên trái
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(clipX + 1, VIDEO_TRACK_Y + 2, 6, VIDEO_TRACK_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(clipX + 3.5, VIDEO_TRACK_Y + 14, 1.5, VIDEO_TRACK_HEIGHT - 28);

        // Tay nắm bên phải
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(clipX + clipW - 7, VIDEO_TRACK_Y + 2, 6, VIDEO_TRACK_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(clipX + clipW - 4.5, VIDEO_TRACK_Y + 14, 1.5, VIDEO_TRACK_HEIGHT - 28);

        // Huy hiệu "Đã chọn video clip"
        ctx.fillStyle = '#0369a1';
        ctx.fillRect(clipX + 8, VIDEO_TRACK_Y + 4, 110, 16);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('🎬 ĐÃ CHỌN VIDEO', clipX + 14, VIDEO_TRACK_Y + 15);
        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.moveTo(0, VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT - 0.5);
    ctx.lineTo(width, VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT - 0.5);
    ctx.stroke();

    // --- TRACK 3: AI Narration Audio Cards Track (Y = 124, Height = 48) ---
    ctx.fillStyle = '#111319';
    ctx.fillRect(0, AUDIO_TRACK_Y, width, AUDIO_TRACK_HEIGHT);

    // 4. Viewport Culling: Chỉ duyệt cues trong tầm nhìn
    const visibleStartSec = Math.max(0, scrollLeft / zoom);
    const visibleEndSec = (scrollLeft + width) / zoom;
    const visibleCues = getVisibleCues(safeCues, visibleStartSec, visibleEndSec);

    // 5. Vẽ từng khối câu thoại Subtitle Pill trên Track 1
    visibleCues.forEach((cue) => {
      if (!cue) return;
      const cueStart = typeof cue.startTime === 'number' && Number.isFinite(cue.startTime) ? cue.startTime : 0;
      const cueEnd = typeof cue.endTime === 'number' && Number.isFinite(cue.endTime) ? cue.endTime : cueStart + 1.0;
      const cueX = cueStart * zoom - scrollLeft;
      const cueW = Math.max(12, (cueEnd - cueStart) * zoom);
      const isCueSelected =
        (safeSelectedIds && safeSelectedIds.includes(cue.id)) ||
        (selectedEl?.type === 'cue' && selectedEl.id === cue.id) ||
        (selectedEl === null && cue.id === selectedCueId);

      const spk = speakerMap.get(cue.speakerId);
      const spkColor = spk?.color || '#22c55e'; // Default emerald green

      const boxY = CUE_TRACK_Y + 8;
      const boxH = CUE_TRACK_HEIGHT - 16; // 32px cao

      ctx.save();

      // Vẽ hình viên thuốc bo tròn (Pill)
      drawRoundedRect(ctx, cueX, boxY, cueW, boxH, 6);

      if (isCueSelected) {
        // Viền đỏ rực bao quanh chuẩn CapCut
        ctx.fillStyle = '#15803d'; // Green base
        ctx.fill();

        ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset shadow
      } else {
        ctx.fillStyle = spkColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Nội dung text câu thoại
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      const textToDisplay = cue.translatedText || cue.originalText || (cue as unknown as { text?: string }).text || '';
      const truncated = truncateText(ctx, textToDisplay, isCueSelected ? cueW - 24 : cueW - 12);
      if (truncated) {
        ctx.fillText(truncated, isCueSelected ? cueX + 12 : cueX + 6, boxY + 20);
      }

      // Hai núm co giãn màu đỏ với vạch trắng chuẩn CapCut (ResizeHandle) khi được chọn
      if (isCueSelected && cueW > 18) {
        const handleW = 8;

        // 1. Núm bên trái (bo góc trái)
        ctx.fillStyle = '#ef4444';
        drawRoundedRect(ctx, cueX, boxY, handleW, boxH, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Vạch trắng dọc ở giữa núm trái
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, cueX + 3, boxY + (boxH - 14) / 2, 2, 14, 1);
        ctx.fill();

        // 2. Núm bên phải (bo góc phải)
        ctx.fillStyle = '#ef4444';
        drawRoundedRect(ctx, cueX + cueW - handleW, boxY, handleW, boxH, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Vạch trắng dọc ở giữa núm phải
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, cueX + cueW - handleW + 3, boxY + (boxH - 14) / 2, 2, 14, 1);
        ctx.fill();
      }

      ctx.restore();

      // 6. Vẽ Card Sóng âm AI Narration trên Track 3
      const rawAudioStart = cue.placedStartTime ?? cue.startTime;
      const audioStart = typeof rawAudioStart === 'number' && Number.isFinite(rawAudioStart) ? rawAudioStart : cueStart;
      const rawAudioEnd = cue.placedEndTime ?? cue.endTime;
      const audioEnd = typeof rawAudioEnd === 'number' && Number.isFinite(rawAudioEnd) ? rawAudioEnd : audioStart + (cue.audioDuration || 1.0);
      const audioX = audioStart * zoom - scrollLeft;
      const audioW = Math.max(12, (audioEnd - audioStart) * zoom);
      const audioBoxY = AUDIO_TRACK_Y + 6;
      const audioBoxH = AUDIO_TRACK_HEIGHT - 12; // 36px cao
      const isAudioSelected =
        (safeSelectedIds && safeSelectedIds.includes(cue.id)) ||
        (selectedEl?.type === 'audio' && selectedEl.id === cue.id);

      ctx.save();
      // Vẽ Card âm thanh bo tròn màu xanh lá
      drawRoundedRect(ctx, audioX, audioBoxY, audioW, audioBoxH, 6);
      if (isAudioSelected) {
        ctx.fillStyle = '#15803d';
        ctx.fill();
        ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = cue.audioFile ? '#16a34a' : 'rgba(22, 163, 74, 0.4)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Hai núm co giãn màu đỏ với vạch trắng cho audio card khi được chọn
      if (isAudioSelected && audioW > 18) {
        const handleW = 8;
        // Núm trái
        ctx.fillStyle = '#ef4444';
        drawRoundedRect(ctx, audioX, audioBoxY, handleW, audioBoxH, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, audioX + 3, audioBoxY + (audioBoxH - 14) / 2, 2, 14, 1);
        ctx.fill();

        // Núm phải
        ctx.fillStyle = '#ef4444';
        drawRoundedRect(ctx, audioX + audioW - handleW, audioBoxY, handleW, audioBoxH, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, audioX + audioW - handleW + 3, audioBoxY + (audioBoxH - 14) / 2, 2, 14, 1);
        ctx.fill();
      }

      // Đường kẻ tâm đứt đoạn màu trắng ở giữa Card âm thanh
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(audioX + 4, audioBoxY + audioBoxH / 2);
      ctx.lineTo(audioX + audioW - 4, audioBoxY + audioBoxH / 2);
      ctx.stroke();
      ctx.restore();

      // Vẽ các cột sóng âm màu trắng đối xứng qua trục tâm
      const cachedWave = cue.audioFile ? getCachedWaveform(cue.audioFile) : null;
      if (cue.audioFile && !cachedWave) {
        getWaveformPeaks(cue.audioFile).catch(() => {});
      }

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      const barSpacing = 3;
      const barCount = Math.floor((audioW - 8) / barSpacing);

      if (cachedWave && Array.isArray(cachedWave.peaks) && cachedWave.peaks.length > 0) {
        const peaks = cachedWave.peaks;
        for (let b = 0; b < barCount; b++) {
          const bx = audioX + 4 + b * barSpacing;
          const pIdx = Math.floor((b / barCount) * peaks.length);
          const peakVal = Math.min(1.0, Math.max(0.12, peaks[pIdx] || 0.25));
          const barH = (audioBoxH - 8) * peakVal;
          ctx.beginPath();
          ctx.moveTo(bx, audioBoxY + (audioBoxH - barH) / 2);
          ctx.lineTo(bx, audioBoxY + (audioBoxH + barH) / 2);
          ctx.stroke();
        }
      } else {
        // Preview nhịp sóng âm thanh khi đang chờ render
        for (let b = 0; b < barCount; b++) {
          const bx = audioX + 4 + b * barSpacing;
          const pseudoAmp = Math.sin(b * 0.8 + cue.id) * 0.35 + 0.5;
          const barH = (audioBoxH - 10) * pseudoAmp;
          ctx.beginPath();
          ctx.moveTo(bx, audioBoxY + (audioBoxH - barH) / 2);
          ctx.lineTo(bx, audioBoxY + (audioBoxH + barH) / 2);
          ctx.stroke();
        }
      }

      // Speed multiplier badge on audio card (hiển thị rõ câu nào đang bị co dãn tốc độ x bao nhiêu)
      const effectiveAudioSpeed = cue.playbackRate || cue.speed || 1.0;
      if (Math.abs(effectiveAudioSpeed - 1.0) >= 0.04 && audioW > 32) {
        ctx.save();
        const speedText = `${effectiveAudioSpeed > 1.6 ? '!' : ''}${effectiveAudioSpeed.toFixed(1)}x`;
        ctx.font = 'bold 9px monospace';
        const txtWidth = ctx.measureText(speedText).width;
        const bW = txtWidth + 6;
        const bH = 12;
        const bX = audioX + audioW - bW - 4;
        const bY = audioBoxY + 3;

        ctx.fillStyle = effectiveAudioSpeed > 1.6 ? '#ef4444' : effectiveAudioSpeed > 1.35 ? '#f59e0b' : 'rgba(56, 189, 248, 0.9)';
        drawRoundedRect(ctx, bX, bY, bW, bH, 3);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(speedText, bX + 3, bY + 9);
        ctx.restore();
      }

      ctx.restore();
    });

    // 7. Vạch đỏ kết thúc thời lượng video
    if (videoDuration > 0) {
      const endX = videoDuration * zoom - scrollLeft;
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [width, height, zoom, scrollLeft, safeCues, selectedCueId, safeSelectedIds, videoDuration]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
};
