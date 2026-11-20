import type { CueItem } from '../types';

/**
 * Thuật toán Binary Search O(log N) tìm chỉ số câu thoại đầu tiên
 * có endTime >= visibleStartSec.
 * Yêu cầu danh sách cues được sắp xếp tăng dần theo startTime.
 */
export function findFirstVisibleCueIndex(cues: CueItem[], visibleStartSec: number): number {
  if (!cues || !Array.isArray(cues) || cues.length === 0) return 0;

  let low = 0;
  let high = cues.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midCue = cues[mid];
    if (midCue && midCue.endTime >= visibleStartSec) {
      result = mid;
      high = mid - 1; // Tiếp tục tìm về phía bên trái xem có câu nào bắt đầu sớm hơn nữa không
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, result);
}

/**
 * Lọc danh sách cues nằm trong viewport [visibleStartSec, visibleEndSec]
 * với độ phức tạp tối ưu O(log N + K), trong đó K là số cues hiển thị trên màn hình (thường chỉ 10 - 40 câu).
 */
export function getVisibleCues(
  cues: CueItem[],
  visibleStartSec: number,
  visibleEndSec: number
): CueItem[] {
  if (!cues || !Array.isArray(cues) || cues.length === 0) return [];

  const startIndex = findFirstVisibleCueIndex(cues, visibleStartSec);
  const visible: CueItem[] = [];

  for (let i = startIndex; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue) continue;
    if (cue.startTime > visibleEndSec) {
      break; // Đã vượt qua mép phải màn hình, dừng duyệt ngay lập tức
    }
    visible.push(cue);
  }

  return visible;
}
