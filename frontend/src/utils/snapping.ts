/**
 * Magnetic Snapping Algorithm for Studio Timeline (10px threshold)
 * Calculates closest snap points (adjacent cue edges, playhead, 0s).
 */

export interface SnapResult {
  snappedTime: number;
  isSnapped: boolean;
  snapTargetTime: number | null;
}

export function calculateMagneticSnap(
  currentTime: number,
  targetTimes: number[],
  zoom: number, // pixels per second
  snapThresholdPx: number = 10
): SnapResult {
  if (zoom <= 0 || !targetTimes || !Array.isArray(targetTimes) || targetTimes.length === 0) {
    return { snappedTime: currentTime, isSnapped: false, snapTargetTime: null };
  }

  const thresholdSec = snapThresholdPx / zoom;
  let closestTarget: number | null = null;
  let minDiff = Infinity;

  for (const t of targetTimes) {
    const diff = Math.abs(currentTime - t);
    if (diff <= thresholdSec && diff < minDiff) {
      minDiff = diff;
      closestTarget = t;
    }
  }

  if (closestTarget !== null) {
    return {
      snappedTime: closestTarget,
      isSnapped: true,
      snapTargetTime: closestTarget,
    };
  }

  return {
    snappedTime: currentTime,
    isSnapped: false,
    snapTargetTime: null,
  };
}
