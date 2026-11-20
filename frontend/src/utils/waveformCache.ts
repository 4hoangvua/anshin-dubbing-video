/**
 * In-memory Waveform Cache for 60 FPS Canvas Timeline
 * Caches normalized peak amplitudes [0.0 - 1.0] per audio file.
 */

import { apiClient } from '../core/apiClient';

interface WaveformData {
  duration: number;
  pointsPerSecond: number;
  peaks: number[];
}

const waveformMemoryCache = new Map<string, WaveformData>();
const pendingRequests = new Map<string, Promise<WaveformData | null>>();

export async function getWaveformPeaks(filePath: string): Promise<WaveformData | null> {
  if (!filePath) return null;

  if (waveformMemoryCache.has(filePath)) {
    return waveformMemoryCache.get(filePath)!;
  }

  if (pendingRequests.has(filePath)) {
    return pendingRequests.get(filePath)!;
  }

  const promise = (async () => {
    try {
      const data = await apiClient.get<WaveformData>(
        `/api/media/waveform?path=${encodeURIComponent(filePath)}&points_per_second=50`
      );
      if (data && Array.isArray(data.peaks)) {
        waveformMemoryCache.set(filePath, data);
        return data;
      }
    } catch {
      // Fallback
    } finally {
      pendingRequests.delete(filePath);
    }
    return null;
  })();

  pendingRequests.set(filePath, promise);
  return promise;
}

export function getCachedWaveform(filePath: string): WaveformData | undefined {
  return waveformMemoryCache.get(filePath);
}
