/**
 * Chained Narration Placement & Speech Rate Alignment
 * Kỹ thuật phân bổ các clip âm thanh lồng tiếng nối chuỗi (Chained Narration)
 * từ lemyloi-dichvideos.
 */

import { isIncompleteSentence } from './gapExpansion';
import type { CueItem } from '../../../types';

export interface ChainedPlacementOutput {
  cueId: number;
  placedStartTime: number;
  placedEndTime: number;
  isChained: boolean;
  playbackRate: number;
}

export function planChainedNarrationPlacements(
  cues: CueItem[],
  breathGapSeconds = 0.08
): ChainedPlacementOutput[] {
  const results: ChainedPlacementOutput[] = [];
  let prevSpeakerId: string | null = null;
  let prevAudioEndTime = 0;

  for (let i = 0; i < cues.length; i++) {
    const current = cues[i];
    const prev = i > 0 ? cues[i - 1] : null;

    const currentSpeaker = current.speakerId || 'SPEAKER_00';
    const currentText = current.translatedText || current.originalText || '';
    const prevText = prev ? prev.translatedText || prev.originalText || '' : '';

    const clipDuration = current.audioDuration || Math.max(0.2, current.endTime - current.startTime);

    let isChained = false;
    if (prev && prevSpeakerId === currentSpeaker) {
      const isContinuous =
        current.isContinuation === true ||
        (prev.endTime <= current.startTime &&
          current.startTime - prev.endTime <= 0.65 &&
          isIncompleteSentence(prevText, currentText));

      if (isContinuous && prevAudioEndTime > 0) {
        isChained = true;
      }
    }

    let placementStart: number;
    if (isChained) {
      // Nối tiếp tự nhiên ngay sau clip trước + nhịp thở nhẹ
      placementStart = Math.round((prevAudioEndTime + breathGapSeconds) * 1000) / 1000;
    } else {
      placementStart = Math.round(
        Math.max(
          current.placedStartTime || current.startTime,
          prevAudioEndTime > 0 ? prevAudioEndTime + 0.04 : 0
        ) * 1000
      ) / 1000;
    }

    const availableWindow = Math.max(0.2, (current.placedEndTime || current.endTime) - placementStart);
    let targetRate = 1.0;

    if (clipDuration > availableWindow && availableWindow > 0) {
      // Chỉ tăng tốc nhẹ tối đa 1.35x, nếu không đủ thì nới tiếp thời gian
      targetRate = Math.min(1.35, Math.max(0.85, clipDuration / availableWindow));
    }

    const effectiveDuration = clipDuration / targetRate;
    const placementEnd = Math.round((placementStart + effectiveDuration) * 1000) / 1000;

    prevSpeakerId = currentSpeaker;
    prevAudioEndTime = placementEnd;

    results.push({
      cueId: current.id,
      placedStartTime: placementStart,
      placedEndTime: placementEnd,
      isChained,
      playbackRate: targetRate,
    });
  }

  return results;
}
