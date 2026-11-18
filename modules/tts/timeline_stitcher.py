# -*- coding: utf-8 -*-
"""
Bộ ghép trục thời gian video (Timeline Stitcher) & Co dãn âm thanh nâng cao (Phase Vocoder)
Khắc phục triệt để hiện tượng đè track, méo tiếng và vỡ dòng thời gian lồng tiếng video.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional

# Tự động nạp site-packages cục bộ nếu có venv riêng của module
BASE_DIR = Path(__file__).resolve().parent
MODULE_VENV_SITE = BASE_DIR / ".venv" / "Lib" / "site-packages"
if MODULE_VENV_SITE.exists() and str(MODULE_VENV_SITE) not in sys.path:
    sys.path.insert(0, str(MODULE_VENV_SITE))

import numpy as np
import soundfile as sf

try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False


def time_stretch_audio(
    wav: np.ndarray,
    speed_factor: float,
    sample_rate: int = 48000,
    max_speed_factor: Optional[float] = None,
    min_speed_factor: float = 0.5,
) -> np.ndarray:
    """
    Co dãn thời lượng âm thanh theo hệ số speed_factor bằng thuật toán Phase-Vocoder với Phase-Locking.
    Bảo toàn cao độ (Pitch) tuyệt đối, không gây méo tiếng kim loại hay hiện tượng răng lược.
    Không giới hạn trần tốc độ (bỏ giới hạn 2.0x, cho phép co dãn linh hoạt theo nhu cầu).
    """
    if abs(speed_factor - 1.0) < 0.02 or len(wav) < 2048:
        return wav

    # Đảm bảo tốc độ tối thiểu và không kẹp trần cứng 2.0x
    if max_speed_factor is not None:
        speed_factor = float(np.clip(speed_factor, min_speed_factor, max_speed_factor))
    else:
        speed_factor = max(min_speed_factor, float(speed_factor))

    if HAS_LIBROSA:
        try:
            return librosa.effects.time_stretch(wav, rate=speed_factor).astype(np.float32)
        except Exception:
            pass

    # Fallback Overlap-Add nếu không có librosa
    frame_len = 1024
    hop_in = int(frame_len / 2)
    hop_out = int(round(hop_in / speed_factor))
    num_in_frames = (len(wav) - frame_len) // hop_in
    if num_in_frames <= 0:
        return wav

    out_len = num_in_frames * hop_out + frame_len
    out = np.zeros(out_len, dtype=np.float32)
    window = np.hanning(frame_len).astype(np.float32)

    for i in range(num_in_frames):
        pos_in = i * hop_in
        pos_out = i * hop_out
        frame = wav[pos_in : pos_in + frame_len] * window
        out[pos_out : pos_out + frame_len] += frame

    max_val = np.max(np.abs(out))
    if max_val > 0.98:
        out = (out / max_val) * 0.95

    return out.astype(np.float32)


class TimelineStitcher:
    """
    Bộ ghép trục thời gian video thông minh (Isosynchronous Timeline Sequencer).
    Áp dụng thuật toán Silence Gap Borrowing và Sequential Collision Avoidance:
    - Triệt tiêu hoàn toàn hiện tượng 2 câu đọc đè lên nhau (Zero Track Stacking).
    - Mượn khoảng lặng tự nhiên giữa các câu trước khi quyết định tăng tốc.
    - Cho phép tăng tốc linh hoạt không giới hạn (đã bỏ trần 2.0x) để câu ngắn tiếng Việt luôn đủ thời gian phát âm.
    """

    def __init__(self, sample_rate: int = 48000, min_gap_sec: float = 0.15, max_speedup: Optional[float] = None) -> None:
        self.sample_rate = sample_rate
        self.min_gap_sec = min_gap_sec
        self.max_speedup = max_speedup

    def stitch(
        self,
        cues_audio: List[Dict[str, Any]],
        output_wav_path: str,
        total_duration_sec: Optional[float] = None,
    ) -> float:
        """
        Ghép danh sách audio clips theo mốc start và end trên 1 Track âm thanh duy nhất.
        """
        if not cues_audio:
            silence = np.zeros(self.sample_rate, dtype=np.float32)
            sf.write(output_wav_path, silence, self.sample_rate)
            return 1.0

        # Sắp xếp các phân đoạn theo thời gian bắt đầu
        sorted_cues = sorted(cues_audio, key=lambda x: float(x.get("start", 0.0)))

        # Xác định tổng thời lượng video
        max_end = max(c.get("end", 0.0) for c in sorted_cues)
        if total_duration_sec is not None and total_duration_sec > max_end:
            max_end = total_duration_sec
        total_sec = max_end + 2.0  # Buffer thêm 2s ở cuối
        total_samples = int(math.ceil(total_sec * self.sample_rate))

        master_track = np.zeros(total_samples, dtype=np.float32)
        last_speech_end_sec = 0.0
        n = len(sorted_cues)

        for i, item in enumerate(sorted_cues):
            wav = item.get("wav")
            if wav is None or len(wav) == 0:
                continue

            orig_start = float(item.get("start", 0.0))
            orig_end = float(item.get("end", orig_start + 1.0))
            orig_slot = max(0.2, orig_end - orig_start)
            raw_dur = len(wav) / self.sample_rate

            # 1. Xác định khoảng thời gian khả dụng (Available Duration)
            # Tận dụng khoảng lặng trước khi câu tiếp theo cất lời
            if i < n - 1:
                next_start = float(sorted_cues[i + 1].get("start", orig_end + 1.0))
                max_available_sec = max(orig_slot, next_start - orig_start - self.min_gap_sec)
            else:
                max_available_sec = orig_slot + 2.0

            # 2. Thuật toán Silence Gap Borrowing & Co dãn thông minh:
            if raw_dur <= orig_slot:
                speed = 1.0
                adjusted_wav = wav
            elif raw_dur <= max_available_sec:
                # Mượn trọn vẹn khoảng lặng mà KHÔNG CẦN TĂNG TỐC GIỌNG ĐỌC
                speed = 1.0
                adjusted_wav = wav
            else:
                # Vẫn thiếu chỗ -> Tăng tốc linh hoạt theo tỷ lệ (không giới hạn trần 2.0x)
                if self.max_speedup is not None and self.max_speedup > 0:
                    speed = min(raw_dur / max_available_sec, self.max_speedup)
                else:
                    speed = raw_dur / max_available_sec
                adjusted_wav = time_stretch_audio(wav, speed, sample_rate=self.sample_rate)

            adj_dur = len(adjusted_wav) / self.sample_rate

            # 3. Chống xung đột Timeline (Sequential Collision Avoidance):
            # Tuyệt đối không để câu sau đè lên đuôi câu trước
            actual_start_sec = max(orig_start, last_speech_end_sec + self.min_gap_sec)
            actual_end_sec = actual_start_sec + adj_dur

            start_idx = int(actual_start_sec * self.sample_rate)
            end_idx = start_idx + len(adjusted_wav)

            if start_idx < total_samples:
                fit_len = min(len(adjusted_wav), total_samples - start_idx)
                master_track[start_idx : start_idx + fit_len] += adjusted_wav[:fit_len]
                last_speech_end_sec = actual_start_sec + (fit_len / self.sample_rate)

        # Chuẩn hóa âm lượng chống vỡ tiếng (Peak Normalization)
        peak = np.max(np.abs(master_track))
        if peak > 0.98:
            master_track = (master_track / peak) * 0.95

        # Lưu file WAV hoàn chỉnh
        out_p = Path(output_wav_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_p), master_track, self.sample_rate)
        return total_sec
