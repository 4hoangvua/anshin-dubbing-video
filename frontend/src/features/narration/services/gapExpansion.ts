/**
 * Dịch vụ tối ưu và phân bổ khoảng lặng 2 chiều (Bidirectional Silence Gap Redistribution)
 * & Duy trì liền mạch giữa các vế câu chưa kết thúc (Incomplete Sentence Clause Continuity).
 *
 * Tính năng chính:
 * 1. Phân bổ 2 chiều (cả phía trước và phía sau) vào các khoảng lặng dư thừa.
 * 2. Tự động nhận diện các đoạn phụ đề/ASR bị cắt vụn trong cùng 1 câu chưa dứt.
 * 3. Khống chế khoảng cách giữa các vế trong cùng 1 câu ở mức tối ưu (<= 0.35s - 0.5s),
 *    giúp giọng đọc TTS liền mạch, trôi chảy, không bị ngắt quãng, tụt dốc ngữ điệu hay dính chùm.
 */

import type { CueItem } from '../../../types';

export interface GapExpansionOptions {
  /** Tốc độ đọc tiếng Việt mục tiêu (từ/giây), mặc định ~3.4 từ/giây */
  targetWordsPerSecond?: number;
  /** Khoảng cách đệm an toàn tối thiểu giữa 2 câu độc lập (giây), mặc định 0.25s */
  safetyPaddingSeconds?: number;
  /** Khoảng cách tối đa giữa các vế trong cùng 1 câu chưa dứt (giây), mặc định 0.35s */
  maxClauseGapSeconds?: number;
  /** Tỷ lệ tối đa của khoảng lặng được phép mượn (0.0 - 1.0), mặc định 0.85 (85%) */
  maxGapBorrowRatio?: number;
  /** Thời gian nới thêm tối đa cho một câu (giây), mặc định 3.5s */
  maxBorrowSeconds?: number;
  /** Cho phép mượn khoảng trống phía trước (lùi startTime), mặc định true */
  enableBackwardExpansion?: boolean;
}

export interface ExpandedCueResult {
  cue: CueItem;
  originalStartTime: number;
  originalEndTime: number;
  originalDuration: number;
  newStartTime: number;
  newEndTime: number;
  newDuration: number;
  expandedSeconds: number;
  wordCount: number;
  isContinuation: boolean;
}

/**
 * Đếm số từ trong văn bản (hỗ trợ tiếng Việt và các ngôn ngữ khác).
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Kiểm tra xem đoạn A và đoạn B có phải là 2 vế nối tiếp trong cùng một câu chưa kết thúc hay không.
 */
export function isIncompleteSentence(prevText: string, nextText: string): boolean {
  const prev = prevText.trim();
  const next = nextText.trim();
  if (!prev || !next) return false;

  // 1. Nếu đoạn A kết thúc bằng dấu chấm câu kết thúc (. ! ? 。 ！ ？ …) -> đã hết câu
  if (/[.!?。！？…]$/u.test(prev)) {
    return false;
  }

  // 2. Nếu đoạn A kết thúc bằng dấu phẩy, hai chấm, chấm phẩy, gạch nối -> rõ ràng chưa hết câu
  if (/[,:;\-~–—，、；：]$/u.test(prev)) {
    return true;
  }

  // 3. Nếu đoạn A kết thúc bằng các liên từ, giới từ, từ nối, từ chỉ thời/thể/phó từ tiếng Việt
  const CONTINUATION_END_WORDS = [
    'và', 'mà', 'hoặc', 'nhưng', 'bởi', 'vì', 'đối với', 'trong khi', 'là', 'của', 'rằng',
    'thì', 'ở', 'với', 'đã', 'đang', 'sẽ', 'có', 'để', 'cho', 'hay', 'nên', 'nếu', 'khi',
    'như', 'về', 'từ', 'bằng', 'theo', 'do', 'tại', 'cùng', 'cũng', 'rồi', 'lại', 'vừa',
    'chưa', 'không', 'chẳng', 'rất', 'quá', 'lắm', 'thế', 'vậy', 'này', 'kia', 'đó', 'đây',
    'được', 'bị', 'phải', 'muốn', 'cần', 'thấy', 'nghe', 'nói', 'biết', 'nghĩ', 'cho rằng',
    'nó', 'hắn', 'họ', 'chúng', 'tôi', 'bạn', 'anh', 'em', 'ông', 'bà', 'cô', 'chú', 'bản'
  ];
  const endWordsRegex = new RegExp(`\\b(${CONTINUATION_END_WORDS.join('|')})\\s*$`, 'iu');
  if (endWordsRegex.test(prev)) {
    return true;
  }

  // 4. Nếu đoạn B bắt đầu bằng chữ cái viết thường (không viết hoa) -> chắc chắn là vế tiếp
  const firstChar = next.charAt(0);
  if (firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase()) {
    return true;
  }

  // 5. Nếu đoạn B bắt đầu bằng các liên từ nối
  const CONTINUATION_START_WORDS = [
    'mà', 'và', 'nhưng', 'hoặc', 'cho nên', 'vì vậy', 'bởi vì', 'đối với', 'trong đó', 'mà còn', 'cũng như', 'thì', 'lại', 'với', 'bản', 'nó'
  ];
  const startWordsRegex = new RegExp(`^(${CONTINUATION_START_WORDS.join('|')})\\b`, 'iu');
  if (startWordsRegex.test(next)) {
    return true;
  }

  return !/[.!?。！？…]$/u.test(prev);
}

/**
 * Thuật toán phân bổ khoảng lặng 2 chiều thông minh.
 */
export function expandCueGaps(
  cues: CueItem[],
  options: GapExpansionOptions = {}
): ExpandedCueResult[] {
  const {
    targetWordsPerSecond = 3.4,
    safetyPaddingSeconds = 0.25,
    maxGapBorrowRatio = 0.85,
    maxBorrowSeconds = 3.5,
    enableBackwardExpansion = true,
  } = options;

  if (!cues || cues.length === 0) return [];

  const results: ExpandedCueResult[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const prev = i > 0 ? cues[i - 1] : null;
    const next = i < cues.length - 1 ? cues[i + 1] : null;

    const origStart = cue.startTime;
    const origEnd = cue.endTime;
    const origDuration = Math.max(0.1, origEnd - origStart);

    const textToRead = cue.translatedText || cue.originalText || '';
    const words = countWords(textToRead);

    // Thời gian lý tưởng cần cho câu đọc
    const neededDuration = words > 0 ? words / targetWordsPerSecond : origDuration;
    const deficitSeconds = Math.max(0, neededDuration - origDuration);

    // Hệ số căng thẳng thời lượng (Stress Ratio)
    const currentSpeed = cue.speed && Math.abs(cue.speed - 1.0) >= 0.02 ? cue.speed : (cue.playbackRate || 1.0);
    const stressRatio = origDuration > 0 ? Math.max(currentSpeed, neededDuration / origDuration) : 1.0;

    // Tự động thích ứng theo cảnh báo vượt thời gian:
    // Với các câu bị cảnh báo (>1.35x hoặc >1.6x), mở rộng biên độ mượn lớn hơn nhiều để kéo tốc độ về mức chuẩn
    const isDangerous = stressRatio > 1.6;
    const isFast = stressRatio > 1.35;

    const dynamicMaxBorrow = isDangerous
      ? Math.max(maxBorrowSeconds, 8.0) // Câu nguy cơ cao: mượn tối đa tới 8.0s
      : isFast
      ? Math.max(maxBorrowSeconds, 5.5) // Câu khá nhanh: mượn tối đa tới 5.5s
      : maxBorrowSeconds;

    const dynamicBorrowRatio = isDangerous ? 0.95 : isFast ? 0.90 : maxGapBorrowRatio;
    const dynamicSafetyPadding = isDangerous ? 0.12 : isFast ? 0.18 : safetyPaddingSeconds;
    const backwardWeight = isDangerous ? 0.65 : 0.45;

    let newStart = origStart;
    let newEnd = origEnd;

    const isContinuation = prev ? isIncompleteSentence(prev.translatedText || prev.originalText, textToRead) : false;

    if (deficitSeconds > 0) {
      // 1. Mượn khoảng lặng phía trước (Backward)
      if (enableBackwardExpansion && prev) {
        const gapBefore = origStart - prev.endTime;
        if (gapBefore > dynamicSafetyPadding) {
          const availableBefore = (gapBefore - dynamicSafetyPadding) * dynamicBorrowRatio;
          const borrowBefore = Math.min(deficitSeconds * backwardWeight, availableBefore, dynamicMaxBorrow * 0.5);
          newStart = Math.max(prev.endTime + dynamicSafetyPadding, origStart - borrowBefore);
        }
      }

      // Thời gian còn thiếu sau khi mượn phía trước
      const remainingDeficit = Math.max(0, neededDuration - (newEnd - newStart));

      // 2. Mượn khoảng lặng phía sau (Forward)
      if (remainingDeficit > 0 && next) {
        const gapAfter = next.startTime - origEnd;
        if (gapAfter > dynamicSafetyPadding) {
          const availableAfter = (gapAfter - dynamicSafetyPadding) * dynamicBorrowRatio;
          const borrowAfter = Math.min(remainingDeficit, availableAfter, dynamicMaxBorrow);
          newEnd = Math.min(next.startTime - dynamicSafetyPadding, origEnd + borrowAfter);
        }
      } else if (remainingDeficit > 0 && !next) {
        // Câu cuối cùng trong video
        newEnd = origEnd + Math.min(remainingDeficit, dynamicMaxBorrow);
      }
    }

    const newDuration = Math.max(0.1, newEnd - newStart);
    const expandedSeconds = Math.max(0, newDuration - origDuration);
    const updatedSpeed = words > 0 ? Math.max(1.0, +(neededDuration / newDuration).toFixed(2)) : 1.0;

    results.push({
      cue: {
        ...cue,
        startTime: Math.round(newStart * 1000) / 1000,
        endTime: Math.round(newEnd * 1000) / 1000,
        duration: Math.round(newDuration * 1000) / 1000,
        placedStartTime: Math.round(newStart * 1000) / 1000,
        placedEndTime: Math.round(newEnd * 1000) / 1000,
        speed: updatedSpeed,
        playbackRate: updatedSpeed,
        isContinuation,
      },
      originalStartTime: origStart,
      originalEndTime: origEnd,
      originalDuration: origDuration,
      newStartTime: Math.round(newStart * 1000) / 1000,
      newEndTime: Math.round(newEnd * 1000) / 1000,
      newDuration: Math.round(newDuration * 1000) / 1000,
      expandedSeconds: Math.round(expandedSeconds * 1000) / 1000,
      wordCount: words,
      isContinuation,
    });
  }

  return results;
}
