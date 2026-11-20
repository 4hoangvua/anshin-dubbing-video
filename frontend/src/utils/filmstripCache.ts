/**
 * Filmstrip Thumbnail Cache for Canvas Timeline 60 FPS
 * Tải trước và lưu trữ các khung hình video đã giải mã để vẽ trực tiếp lên HTML5 Canvas.
 */

import { apiClient } from '../core/apiClient';

interface FilmstripThumbItem {
  time: number;
  path: string;
  url: string;
}

interface FilmstripResponse {
  interval: number;
  count: number;
  thumbnails: FilmstripThumbItem[];
}

const manifestCache = new Map<string, FilmstripResponse>();
const imageBitmaps = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<void>>();

export async function preloadFilmstrip(videoPath: string): Promise<void> {
  if (!videoPath) return;
  if (manifestCache.has(videoPath)) return;
  if (loadingPromises.has(videoPath)) return loadingPromises.get(videoPath);

  const promise = (async () => {
    try {
      const data = await apiClient.get<FilmstripResponse>(
        `/api/media/filmstrip?path=${encodeURIComponent(videoPath)}&interval=2.0`
      );
      if (data && Array.isArray(data.thumbnails)) {
        manifestCache.set(videoPath, data);

        // Preload images into memory
        for (const item of data.thumbnails) {
          if (item && item.url && !imageBitmaps.has(item.url)) {
            const img = new Image();
            img.src = item.url;
            imageBitmaps.set(item.url, img);
          }
        }
      }
    } catch {
      // Bỏ qua lỗi ngầm nếu video chưa sẵn sàng
    }
  })();

  loadingPromises.set(videoPath, promise);
  return promise;
}

export function getNearestFilmstripFrame(videoPath: string, timeSec: number): HTMLImageElement | null {
  if (!videoPath) return null;
  const manifest = manifestCache.get(videoPath);
  if (!manifest || !Array.isArray(manifest.thumbnails) || manifest.thumbnails.length === 0) {
    // Kích hoạt preload nếu chưa có
    preloadFilmstrip(videoPath);
    return null;
  }

  const interval = manifest.interval || 2.0;
  const idx = Math.min(manifest.thumbnails.length - 1, Math.max(0, Math.round(timeSec / interval)));
  const thumb = manifest.thumbnails[idx];
  if (!thumb) return null;

  const img = imageBitmaps.get(thumb.url);
  if (img && img.complete && img.naturalWidth > 0) {
    return img;
  }

  // Nếu chưa có trong cache thì tạo và nạp
  if (!img) {
    const newImg = new Image();
    newImg.src = thumb.url;
    imageBitmaps.set(thumb.url, newImg);
  }

  return null;
}
