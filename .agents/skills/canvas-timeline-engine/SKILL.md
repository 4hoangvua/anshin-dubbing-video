---
name: canvas-timeline-engine
description: >-
  Kỹ thuật chuyên sâu về xây dựng, tối ưu hóa và bảo trì Multi-Track Canvas Timeline 60 FPS
  với Dual-Layer Architecture, Viewport Culling Binary Search O(log N) và HiDPI Canvas Scaling.
  Sử dụng khi phát triển hoặc tinh chỉnh Timeline trong dubbing-video.
---

# Canvas Timeline 60 FPS Engine Guide

Skill này hướng dẫn chi tiết cách hiện thực Multi-Track Timeline bằng HTML5 Canvas đạt chuẩn 60 FPS cho video dài trên 2.000 câu thoại.

## 1. Kiến trúc Dual-Layer Canvas (Hai Lớp Độc lập)
Để đạt 60 FPS khi video đang phát mà không làm chậm máy:
- **Tầng dưới (`MultiTrackCanvas`)**:
  - Vẽ Timecode Ruler, Video track, các hộp câu thoại (Cues), và Audio Waveforms.
  - **Chỉ vẽ lại khi**: Người dùng zoom, cuộn ngang timeline (`scrollLeft`), hoặc dữ liệu câu thoại thay đổi.
  - Không vẽ lại khi video đang chạy bình thường.
- **Tầng trên (`PlayheadCanvas`)**:
  - Nằm đè lên trên với thuộc tính CSS `pointer-events: none`.
  - Chỉ vẽ Kim Playhead màu đỏ và đường chỉ giờ.
  - Lắng nghe `playerStore.currentTime` trực tiếp hoặc qua `requestAnimationFrame`.
  - Khi Playhead di chuyển, chỉ xóa và vẽ lại khu vực nhỏ xung quanh kim chỉ giờ ($O(1)$).

## 2. Thuật toán Viewport Culling với Binary Search $O(\log N)$
Khi danh sách có 2.000+ câu thoại được sắp xếp tăng dần theo `startTime`:
1. Tính khoảng thời gian nhìn thấy trên màn hình:
   $$\text{visibleStart} = \frac{\text{scrollLeft}}{\text{zoom}}$$
   $$\text{visibleEnd} = \frac{\text{scrollLeft} + \text{canvasWidth}}{\text{zoom}}$$
2. Dùng Binary Search tìm câu đầu tiên có `endTime >= visibleStart` (Bắt buộc kiểm tra `Array.isArray`):
   ```typescript
   export function findFirstVisibleCueIndex(cues: CueItem[], visibleStart: number): number {
     if (!cues || !Array.isArray(cues) || cues.length === 0) return 0;
     let low = 0;
     let high = cues.length - 1;
     let result = 0;
     while (low <= high) {
       const mid = (low + high) >> 1;
       const midCue = cues[mid];
       if (midCue && midCue.endTime >= visibleStart) {
         result = mid;
         high = mid - 1; // Tìm tiếp bên trái xem có câu nào bắt đầu sớm hơn không
       } else {
         low = mid + 1;
       }
     }
     return result;
   }
   ```
3. Lặp từ `result` cho đến khi `cues[i].startTime > visibleEnd` thì `break`.
4. Số câu vẽ thực tế chỉ khoảng 10 - 40 câu, thời gian render mỗi frame $< 1\text{ms}$.

## 3. Khử mờ trên Màn hình HiDPI / Retina
Canvas HTML5 mặc định sẽ bị mờ trên màn hình có `devicePixelRatio > 1`. Bắt buộc dùng hàm chuẩn hóa:
```typescript
export function setupHiDPICanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
}
```

## 4. Tương tác Kéo Thả & Snapping
- **Kéo Playhead (Scrubbing)**: Chuyển đổi tọa độ chuột $X$ sang thời gian:
  $$\text{time} = \frac{X - \text{trackHeaderWidth} + \text{scrollLeft}}{\text{zoom}}$$
  Sau đó gọi `usePlayerStore.getState().seekTo(time)`.
- **Hít điểm bắt dính (Snapping)**: Khi kéo mép câu thoại, nếu khoảng cách tới đầu/đuôi câu lân cận hoặc vị trí Playhead nhỏ hơn `snapTolerancePx` (ví dụ 6px), tự động hít vào mốc thời gian đó.

## 5. Filmstrip Thumbnails Thật & Cắt Video Gốc (Track 2)
- **Filmstrip Thumbnail Cache**:
  - Backend cung cấp endpoint `GET /api/media/filmstrip?path=...&interval=2.0`.
  - Frontend gọi `preloadFilmstrip(videoPath)` để nạp trước các frame vào bộ nhớ.
  - Khi vẽ Track 2 trên Canvas, gọi `getNearestFilmstripFrame(videoPath, cellTimeSec)` và dùng `ctx.drawImage` để vẽ ảnh thật dạng cover-crop.
- **Phân đoạn Video Thật (`VideoClipSegment`)**:
  - `videoClips: VideoClipSegment[]` quản lý các đoạn cắt thật với `{ startTime, duration, trimStart, trimEnd }`.
  - Phím `S` (Split) cắt cả câu phụ đề và clip video tại Playhead; phím `Q`/`W` xén mép trái/phải clip video.

