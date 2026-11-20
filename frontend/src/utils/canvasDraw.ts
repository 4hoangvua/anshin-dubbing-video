/**
 * Tiện ích hỗ trợ vẽ Canvas 2D tối ưu hóa hiệu năng cao cho Studio Timeline
 */

export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.floor(width * dpr);
  const targetHeight = Math.floor(height * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    return true;
  }
  return false;
}

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text || typeof text !== 'string' || text.length === 0 || maxWidth <= 10) return '';
  const ellipsis = '…';
  const width = ctx.measureText(text).width;
  if (width <= maxWidth) return text;

  let len = text.length;
  while (len > 0) {
    len--;
    const sub = text.substring(0, len) + ellipsis;
    if (ctx.measureText(sub).width <= maxWidth) {
      return sub;
    }
  }
  return '';
}

/**
 * Định dạng nhãn thời gian trên thước đo (VD: 00:01:23.00)
 */
function formatRulerTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}${ms > 0 ? `.${ms}s` : 's'}`;
}

/**
 * Vẽ thước đo thời gian (Timecode Ruler) thích ứng theo mức Zoom
 */
export function drawTimelineRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scrollLeft: number,
  zoom: number // pixels per second
) {
  // Nền thước đo
  ctx.fillStyle = '#13161f';
  ctx.fillRect(0, 0, width, height);

  // Đường viền đáy
  ctx.strokeStyle = '#262c3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();

  // Xác định bước nhảy vạch chia tùy theo mức Zoom
  let majorStepSec = 1;
  let minorTicksCount = 4;

  if (zoom >= 300) {
    majorStepSec = 0.5;
    minorTicksCount = 5;
  } else if (zoom >= 150) {
    majorStepSec = 1;
    minorTicksCount = 4;
  } else if (zoom >= 70) {
    majorStepSec = 2;
    minorTicksCount = 4;
  } else if (zoom >= 40) {
    majorStepSec = 5;
    minorTicksCount = 5;
  } else {
    majorStepSec = 10;
    minorTicksCount = 5;
  }

  const startSec = Math.floor(scrollLeft / zoom / majorStepSec) * majorStepSec;
  const endSec = (scrollLeft + width) / zoom;

  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let sec = startSec; sec <= endSec; sec += majorStepSec) {
    const x = sec * zoom - scrollLeft;
    if (x < -50 || x > width + 50) continue;

    // Vạch chính (Major tick)
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, height - 10);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();

    // Nhãn số thời gian
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(formatRulerTime(sec), x + 4, 3);

    // Vạch phụ (Minor ticks)
    const minorStepSec = majorStepSec / minorTicksCount;
    ctx.strokeStyle = '#3e4763';

    for (let j = 1; j < minorTicksCount; j++) {
      const minorSec = sec + j * minorStepSec;
      const minorX = minorSec * zoom - scrollLeft;
      if (minorX > 0 && minorX < width) {
        ctx.beginPath();
        ctx.moveTo(minorX + 0.5, height - 5);
        ctx.lineTo(minorX + 0.5, height);
        ctx.stroke();
      }
    }
  }
}
