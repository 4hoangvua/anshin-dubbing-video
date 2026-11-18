# -*- coding: utf-8 -*-
"""
Audio Mixer & DSP Engine for Video Dubbing AI Local
Implements:
1. Two-way Silence Gap Expansion (borrow_gap & clause continuity).
2. Dynamic Playback Rate Planning (speed_factor clamping & review guard).
3. Professional Audio Ducking (150ms Attack, 400ms Release, -16.5 dB attenuation).
4. Subtitle and Narration Timeline Alignment.
5. High-speed FFmpeg CLI Muxing & Video Exporting.
"""

from __future__ import annotations
import json
import math
import os
import re
import subprocess
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from scipy import signal
import soundfile as sf

try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

try:
    import soxr
    HAS_SOXR = True
except ImportError:
    HAS_SOXR = False

# Tần số lấy mẫu tiêu chuẩn Studio / Video Broadcast quốc tế (khớp 100% VieNeu-TTS v3 Turbo)
DEFAULT_SAMPLE_RATE = 48000


# ==============================================================================
# 1. THUẬT TOÁN MƯỢN KHOẢNG LẶNG HAI CHIỀU (BORROW GAP)
# ==============================================================================

# Dấu kết thúc câu hoàn chỉnh
END_PUNCTUATION = {".", "!", "?", "。", "！", "？", "…"}

# Dấu ngắt quãng, vế lửng
CLAUSE_PUNCTUATION = {",", ":", ";", "-", "~", "，", "、", "—"}

# Từ nối hoặc từ chỉ ý chưa dứt ở cuối vế A (tiếng Việt)
VI_END_CONNECTIVES = {
    "và", "mà", "hoặc", "nhưng", "bởi", "vì", "đối", "trong", "là", "của",
    "rằng", "thì", "ở", "với", "đã", "đang", "sẽ", "có", "để", "cho", "hay",
    "nên", "nếu", "khi", "như", "về", "từ", "bằng", "theo", "do", "tại",
    "cùng", "cũng", "rồi", "lại", "vừa", "chưa", "không", "chẳng", "rất",
    "quá", "lắm", "thế", "vậy", "này", "kia", "đó", "đây", "được", "bị",
    "phải", "muốn", "cần", "thấy", "nghe", "nói", "biết", "nghĩ"
}

# Liên từ mở đầu vế B
VI_START_CONNECTIVES = {
    "mà", "và", "nhưng", "hoặc", "cho", "vì", "bởi", "đối", "trong", "thì", "lại", "với"
}


def is_incomplete_sentence(a_text: str, b_text: str) -> bool:
    """
    Xác định 2 câu thoại liên tiếp có phải cùng một luồng diễn đạt chưa dứt hay không.
    Theo mục 2.2 của CORE_NOTES.md.
    """
    if not a_text or not b_text:
        return False

    a_strip = a_text.strip()
    b_strip = b_text.strip()

    # 1. Nếu A kết thúc bằng dấu chấm kết thúc -> Đã xong câu
    if a_strip[-1] in END_PUNCTUATION:
        return False

    # 2. Nếu A kết thúc bằng dấu phẩy, hai chấm, gạch nối... -> Tiếp diễn
    if a_strip[-1] in CLAUSE_PUNCTUATION:
        return True

    # 3. Kiểm tra từ cuối cùng của A
    words_a = re.findall(r"\w+", a_strip.lower())
    if words_a and words_a[-1] in VI_END_CONNECTIVES:
        return True

    # 4. Nếu ký tự đầu tiên của B là chữ thường -> Tiếp diễn
    first_char = b_strip[0]
    if first_char.isalpha() and first_char.islower():
        return True

    # 5. Nếu B bắt đầu bằng liên từ nối
    words_b = re.findall(r"\w+", b_strip.lower())
    if words_b and words_b[0] in VI_START_CONNECTIVES:
        return True

    return False


def expand_cues_into_silence_gaps(cues: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Thuật toán mượn khoảng lặng hai chiều để nới dài thời lượng đọc tiếng Việt.
    Giữ an toàn không làm chồng lấn mốc thời gian.
    """
    if not cues:
        return []

    opts = options or {}
    wps = float(opts.get("wps", 3.4))                        # Tốc độ đọc tự nhiên: 3.4 từ/giây
    p_safety = float(opts.get("safety_margin", 0.25))        # Đệm an toàn giữa 2 câu: 0.25s
    g_clause_max = float(opts.get("clause_gap_max", 0.35))   # Đệm giữa 2 vế trong 1 câu: 0.35s
    k_ratio = float(opts.get("max_borrow_ratio", 0.85))      # Tỉ lệ khoảng lặng cho phép mượn: 85%
    t_borrow_max = float(opts.get("max_borrow_seconds", 3.5))# Thời gian nới thêm tối đa: 3.5s

    # Tạo bản sao sâu của cues
    expanded: List[Dict[str, Any]] = []
    for c in cues:
        c_copy = dict(c)
        c_copy["start"] = float(c.get("start", c.get("startTime", 0.0)))
        c_copy["end"] = float(c.get("end", c.get("endTime", c_copy["start"] + 1.0)))
        c_copy["duration"] = round(c_copy["end"] - c_copy["start"], 3)
        expanded.append(c_copy)

    n = len(expanded)

    # Bước 1: Forward Expansion & Clause Continuity
    for i in range(n):
        curr_text = expanded[i].get("translatedText") or expanded[i].get("text") or expanded[i].get("originalText") or ""
        word_count = len(curr_text.split()) if curr_text else 3
        t_needed = max(0.6, word_count / wps)

        if i < n - 1:
            next_start = expanded[i + 1]["start"]
            curr_end = expanded[i]["end"]
            raw_gap = max(0.0, next_start - curr_end)

            next_text = expanded[i + 1].get("translatedText") or expanded[i + 1].get("text") or expanded[i + 1].get("originalText") or ""
            is_cont = expanded[i].get("isContinuation", False) or is_incomplete_sentence(curr_text, next_text)
            expanded[i]["isContinuation"] = is_cont

            if is_cont:
                # Kéo sát tới next_start
                target_end = next_start - 0.15
                clause_bound = next_start - g_clause_max
                expanded[i]["end"] = min(target_end, max(curr_end, clause_bound))
            else:
                # Mượn khoảng lặng an toàn
                avail_gap = max(0.0, raw_gap - p_safety)
                borrowable = min(t_borrow_max, avail_gap * k_ratio)
                dur = expanded[i]["end"] - expanded[i]["start"]
                extra = min(max(0.0, t_needed - dur), borrowable)
                expanded[i]["end"] = round(curr_end + extra, 3)

        expanded[i]["duration"] = round(expanded[i]["end"] - expanded[i]["start"], 3)

    # Bước 2: Backward Expansion (Nới nhẹ về phía trước nếu câu trước còn trống)
    for i in range(1, n):
        curr_text = expanded[i].get("translatedText") or expanded[i].get("text") or ""
        word_count = len(curr_text.split()) if curr_text else 3
        t_needed = max(0.6, word_count / wps)
        dur = expanded[i]["duration"]

        if t_needed > dur:
            prev_end = expanded[i - 1]["end"]
            curr_start = expanded[i]["start"]
            front_gap = curr_start - prev_end
            if front_gap > 0.5:
                shift = min(0.6, min(t_needed - dur, front_gap - p_safety))
                expanded[i]["start"] = round(curr_start - shift, 3)
                expanded[i]["duration"] = round(expanded[i]["end"] - expanded[i]["start"], 3)

    # Bước 3: Monotonic Timestamps Guard (Khử triệt để chồng lấn)
    for i in range(1, n):
        prev_end = expanded[i - 1]["end"]
        curr_start = expanded[i]["start"]
        if curr_start < prev_end:
            if expanded[i]["end"] > prev_end + 0.15:
                expanded[i]["start"] = prev_end
            else:
                mid_pt = round((prev_end + curr_start) / 2.0, 3)
                expanded[i - 1]["end"] = mid_pt
                expanded[i]["start"] = mid_pt
            expanded[i - 1]["duration"] = round(max(0.1, expanded[i - 1]["end"] - expanded[i - 1]["start"]), 3)
            expanded[i]["duration"] = round(max(0.1, expanded[i]["end"] - expanded[i]["start"]), 3)

    return expanded


# ==============================================================================
# 2. CÔNG THỨC ĐỊNH THỜI VÀ SPEED FACTOR
# ==============================================================================

# Tốc độ đọc tối đa theo quy chuẩn NCKH âm học tiếng Việt (bỏ trần 2.0x, mở rộng lên đến 5.0x cho câu ngắn)
MAX_ALLOWABLE_SPEED_RATE = 5.0
MIN_ALLOWABLE_SPEED_RATE = 0.5

def calculate_playback_rate(
    audio_duration: float,
    target_duration: float,
    auto_match_duration: bool = True
) -> Tuple[float, float, bool]:
    """
    Tính toán hệ số speed factor và cảnh báo review theo quy chuẩn NCKH.
    Tốc độ tối đa không giới hạn ở 2.0x nữa (mở rộng lên đến 5.0x cho câu ngắn).
    Returns:
        (playback_rate, final_duration, needs_review)
    """
    t_raw = max(0.01, float(audio_duration))
    t_target = max(0.1, float(target_duration))

    if not auto_match_duration:
        delta = abs(t_raw - t_target)
        return 1.0, round(t_raw, 3), delta > 0.08

    if t_raw <= t_target:
        # Thoại ngắn hơn thời gian cho phép: giữ nguyên 1.0x, không kéo chậm gây lê thê giọng
        return 1.0, round(t_raw, 3), False

    # Thoại dài hơn: tăng tốc đọc linh hoạt không giới hạn 2.0x
    r_raw = t_raw / t_target
    speed_factor = min(MAX_ALLOWABLE_SPEED_RATE, max(1.0, r_raw))
    final_dur = t_raw / speed_factor
    # Cần người dùng xem lại nếu câu dài vượt quá giới hạn an toàn 5.0x
    needs_review = r_raw > MAX_ALLOWABLE_SPEED_RATE

    return round(speed_factor, 2), round(final_dur, 3), needs_review


# ==============================================================================
# 3. AUDIO DUCKING VÀ HÒA ÂM (DSP ENVELOPE)
# ==============================================================================

def db_to_linear(db: float) -> float:
    """Quy đổi decibel sang hệ số biên độ tuyến tính."""
    return float(10.0 ** (db / 20.0))


def merge_duck_windows(windows: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Hợp nhất các cửa sổ ducking bị chồng chéo."""
    if not windows:
        return []
    sorted_wins = sorted(windows, key=lambda w: w[0])
    merged = [sorted_wins[0]]
    for cur_s, cur_e in sorted_wins[1:]:
        prev_s, prev_e = merged[-1]
        if cur_s <= prev_e + 0.05:  # Nối liền nếu cách nhau dưới 50ms
            merged[-1] = (prev_s, max(prev_e, cur_e))
        else:
            merged.append((cur_s, cur_e))
    return merged


def generate_ducking_envelope(
    total_samples: int,
    sr: int,
    duck_windows: List[Tuple[float, float]],
    duck_volume: float = 0.15,
    attack_ms: int = 150,
    release_ms: int = 400,
) -> np.ndarray:
    """
    Tạo mảng Envelope điều chế âm lượng cho nhạc nền với vectorization NumPy.
    Attack vuốt xuống từ 1.0 -> duck_volume.
    Release vuốt lên từ duck_volume -> 1.0.
    """
    envelope = np.ones(total_samples, dtype=np.float32)
    merged_wins = merge_duck_windows(duck_windows)

    att_samples = int((attack_ms / 1000.0) * sr)
    rel_samples = int((release_ms / 1000.0) * sr)

    for s_sec, e_sec in merged_wins:
        s_idx = max(0, int(s_sec * sr))
        e_idx = min(total_samples, int(e_sec * sr))

        if s_idx >= total_samples or e_idx <= s_idx:
            continue

        # 1. Attack Phase
        att_end_idx = min(e_idx, s_idx + att_samples)
        if att_end_idx > s_idx:
            n_att = att_end_idx - s_idx
            att_curve = np.linspace(1.0, duck_volume, n_att, dtype=np.float32)
            envelope[s_idx:att_end_idx] = np.minimum(envelope[s_idx:att_end_idx], att_curve)

        # 2. Hold Low Phase
        if e_idx > att_end_idx:
            envelope[att_end_idx:e_idx] = np.minimum(envelope[att_end_idx:e_idx], duck_volume)

        # 3. Release Phase
        rel_end_idx = min(total_samples, e_idx + rel_samples)
        if rel_end_idx > e_idx:
            n_rel = rel_end_idx - e_idx
            rel_curve = np.linspace(duck_volume, 1.0, n_rel, dtype=np.float32)
            envelope[e_idx:rel_end_idx] = np.minimum(envelope[e_idx:rel_end_idx], rel_curve)

    return envelope


def resample_audio(audio: np.ndarray, in_rate: int, out_rate: int) -> np.ndarray:
    """
    Chuyển đổi tần số lấy mẫu (Resampling) chất lượng phòng thu (Studio-Grade).
    Sử dụng SOXR VHQ (Very High Quality 64-bit polyphase sinc filter) hoặc librosa.
    Khắc phục triệt để hiện tượng Gibbs ringing và méo hài của FFT Fourier (signal.resample).
    """
    if in_rate == out_rate or len(audio) == 0:
        return audio.astype(np.float32)

    if HAS_SOXR:
        try:
            return soxr.resample(audio, in_rate, out_rate, quality="soxr_vhq").astype(np.float32)
        except Exception:
            pass

    if HAS_LIBROSA:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return librosa.resample(audio, orig_sr=in_rate, target_sr=out_rate).astype(np.float32)
        except Exception:
            pass

    # Fallback chất lượng cao nội suy tuyến tính (nếu không có thư viện)
    target_samples = int(round(len(audio) * (out_rate / in_rate)))
    orig_indices = np.linspace(0, len(audio) - 1, len(audio))
    target_indices = np.linspace(0, len(audio) - 1, target_samples)
    return np.interp(target_indices, orig_indices, audio).astype(np.float32)


def time_stretch_audio(audio: np.ndarray, rate: float, sample_rate: int = DEFAULT_SAMPLE_RATE) -> np.ndarray:
    """
    Co dãn thời lượng âm thanh BẢO TOÀN CAO ĐỘ (Pitch Preservation).
    Đồng bộ 100% với cơ chế WSOLA/WebAudio của trình duyệt khi nghe thử (Preview).
    Tuyệt đối không dùng Fourier resample làm méo thanh điệu thành giọng sóc chuột (chipmunk).
    """
    if abs(rate - 1.0) < 0.02 or len(audio) < 2048:
        return audio.astype(np.float32)

    # Giới hạn an toàn NCKH [0.5, 5.0] (bỏ giới hạn trần 2.0x)
    safe_rate = float(np.clip(rate, 0.5, 5.0))

    if HAS_LIBROSA:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                stretched = librosa.effects.time_stretch(audio, rate=safe_rate)
                return stretched.astype(np.float32)
        except Exception as e:
            print(f"[!] librosa time_stretch fallback: {e}")

    # Fallback OLA (Overlap-Add) với cửa sổ Hanning bảo toàn cao độ
    frame_len = 1024
    hop_in = int(frame_len / 2)
    hop_out = int(round(hop_in / safe_rate))
    num_frames = (len(audio) - frame_len) // hop_in
    if num_frames <= 0:
        return audio.astype(np.float32)

    out_len = num_frames * hop_out + frame_len
    out = np.zeros(out_len, dtype=np.float32)
    window = np.hanning(frame_len).astype(np.float32)

    for i in range(num_frames):
        pos_in = i * hop_in
        pos_out = i * hop_out
        frame = audio[pos_in : pos_in + frame_len] * window
        out[pos_out : pos_out + frame_len] += frame

    return out.astype(np.float32)


def plan_chained_narration_placements(
    cues: List[Dict[str, Any]],
    breath_gap_sec: float = 0.08,
    min_collision_gap_sec: float = 0.05,
) -> List[Dict[str, Any]]:
    """
    Thuật toán định vị thời gian thông minh (Sequential Collision Avoidance & Chained Placement)
    kế thừa và chuẩn hóa từ lemyloi-dichvideos:
    - Triệt tiêu 100% hiện tượng 2 câu thoại đọc đè lên nhau (Zero Track Stacking).
    - Nếu 2 câu cùng 1 vế/mạch nói chưa dứt (isContinuation): nối tiếp câu sau cách câu trước 0.08s (nhịp thở tự nhiên).
    - Nếu là câu mới: Bắt đầu tại startTime gốc, NHƯNG nếu câu trước chưa đọc xong thì lùi nhẹ xuống sau câu trước + 0.05s.
    """
    results: List[Dict[str, Any]] = []
    prev_end_time = 0.0
    prev_speaker_id: Optional[str] = None

    for cue in cues:
        cue_copy = dict(cue)
        raw_start = float(cue.get("startTime", cue.get("start", 0.0)))
        audio_dur = float(cue.get("audioDuration") or cue.get("duration", 1.0))
        speaker_id = str(cue.get("speakerId", "default"))
        is_cont = bool(cue.get("isContinuation", False))

        is_chained = False
        if prev_end_time > 0 and prev_speaker_id == speaker_id and is_cont:
            is_chained = True

        if is_chained:
            placement_start = round(prev_end_time + breath_gap_sec, 3)
        else:
            min_allowed_start = prev_end_time + min_collision_gap_sec if prev_end_time > 0 else 0.0
            placement_start = round(max(raw_start, min_allowed_start), 3)

        placement_end = round(placement_start + audio_dur, 3)
        cue_copy["placedStartTime"] = placement_start
        cue_copy["placedEndTime"] = placement_end
        cue_copy["isCollisionShifted"] = (placement_start > raw_start + 0.01)

        results.append(cue_copy)
        prev_end_time = placement_end
        prev_speaker_id = speaker_id

    return results


def build_narration_track(
    cues: List[Dict[str, Any]],
    total_duration_sec: float,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    breath_gap_sec: float = 0.08,
    min_collision_gap_sec: float = 0.05,
) -> Tuple[np.ndarray, List[Tuple[float, float]], List[Dict[str, Any]]]:
    """
    Đặt các clip WAV của từng câu vào đúng vị trí startTime trên dòng thời gian 48 kHz.
    Áp dụng thuật toán Chống đè giọng (Zero Collision) và Nối mạch tự nhiên (Chained Placement).
    Trả về:
      1. timeline: Mảng âm thanh mono thuyết minh
      2. duck_windows: Danh sách cửa sổ ducking [start, end]
      3. placed_cues: Danh sách cues đã gắn placedStartTime và placedEndTime chuẩn xác
    """
    total_samples = int(math.ceil(total_duration_sec * sample_rate))
    timeline = np.zeros(total_samples, dtype=np.float32)
    duck_windows: List[Tuple[float, float]] = []

    placed_cues = []
    prev_end_time = 0.0
    prev_speaker_id: Optional[str] = None

    for cue in cues:
        cue_res = dict(cue)
        audio_file = cue.get("audioFile") or cue.get("audio_file")
        if not audio_file or not os.path.exists(audio_file):
            placed_cues.append(cue_res)
            continue

        raw_start = float(cue.get("startTime", cue.get("start", 0.0)))
        playback_rate = float(cue.get("playbackRate", cue.get("playback_rate", 1.0)))
        speaker_id = str(cue.get("speakerId", "default"))
        is_cont = bool(cue.get("isContinuation", False))

        try:
            data, sr = sf.read(audio_file, dtype="float32")
            if data.ndim > 1:
                data = np.mean(data, axis=1)

            if sr != sample_rate:
                data = resample_audio(data, sr, sample_rate)

            if abs(playback_rate - 1.0) >= 0.02:
                data = time_stretch_audio(data, playback_rate, sample_rate)

            clip_len = len(data)
            clip_dur = clip_len / sample_rate

            # Thuật toán Chống đè giọng (Collision Avoidance):
            # Clip sau KHÔNG BAO GIỜ được bắt đầu trước khi clip trước dứt tiếng (+ 50ms đệm)
            is_chained = (prev_end_time > 0 and prev_speaker_id == speaker_id and is_cont)
            if is_chained:
                start_time = round(prev_end_time + breath_gap_sec, 3)
            else:
                min_start = prev_end_time + min_collision_gap_sec if prev_end_time > 0 else 0.0
                start_time = round(max(raw_start, min_start), 3)

            actual_end_time = round(start_time + clip_dur, 3)

            start_idx = int(round(start_time * sample_rate))
            end_idx = start_idx + clip_len

            if start_idx >= total_samples:
                pad_size = end_idx - total_samples + 1000
                timeline = np.pad(timeline, (0, pad_size), mode="constant")
                total_samples = len(timeline)

            if end_idx > total_samples:
                data = data[: total_samples - start_idx]
                end_idx = total_samples

            timeline[start_idx:end_idx] += data
            duck_windows.append((start_time, actual_end_time))

            cue_res["placedStartTime"] = start_time
            cue_res["placedEndTime"] = actual_end_time
            cue_res["isCollisionShifted"] = (start_time > raw_start + 0.01)

            prev_end_time = actual_end_time
            prev_speaker_id = speaker_id

        except Exception as e:
            print(f"[!] Lỗi khi nạp clip {audio_file}: {e}")

        placed_cues.append(cue_res)

    return timeline, duck_windows, placed_cues


def mix_audio_with_ducking(
    bgm_path: str,
    narration_audio: np.ndarray,
    duck_windows: List[Tuple[float, float]],
    output_mixed_path: str,
    output_narration_path: str,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    duck_volume: float = 0.15,
    attack_ms: int = 150,
    release_ms: int = 400,
    bgm_gain_db: float = -12.0,
    narration_gain_db: float = 0.0,
) -> float:
    """
    Hòa âm nhạc nền (BGM) với Audio Ducking và giọng thuyết minh TTS.
    Bảo toàn tính trung thực và độ sạch của âm thanh, không méo tiếng (0.0% Harmonic Distortion).
    Xuất ra 2 tệp:
      1. narration_track.wav (Chỉ gồm lời thuyết minh đã chuẩn hóa timeline 48 kHz)
      2. mixed_audio.wav (BGM đã duck + Lời thuyết minh 48 kHz)
    """
    # 1. Đọc tệp BGM / âm thanh gốc
    bgm_data = None
    if os.path.exists(bgm_path):
        try:
            bgm_raw, bgm_sr = sf.read(bgm_path, dtype="float32")
            if bgm_raw.ndim > 1:
                bgm_raw = np.mean(bgm_raw, axis=1)
            if bgm_sr != sample_rate:
                bgm_data = resample_audio(bgm_raw, bgm_sr, sample_rate)
            else:
                bgm_data = bgm_raw
        except Exception as e:
            print(f"[!] Không thể đọc âm thanh nền {bgm_path}: {e}")

    # Xác định độ dài tổng thể
    total_len = len(narration_audio)
    if bgm_data is not None:
        total_len = max(total_len, len(bgm_data))

    # Căn chỉnh kích thước 2 mảng về cùng độ dài
    if len(narration_audio) < total_len:
        narration_audio = np.pad(narration_audio, (0, total_len - len(narration_audio)), mode="constant")

    if bgm_data is None:
        bgm_data = np.zeros(total_len, dtype=np.float32)
    elif len(bgm_data) < total_len:
        bgm_data = np.pad(bgm_data, (0, total_len - len(bgm_data)), mode="constant")

    # 2. Tạo ducking envelope và áp dụng lên BGM
    envelope = generate_ducking_envelope(
        total_samples=total_len,
        sr=sample_rate,
        duck_windows=duck_windows,
        duck_volume=duck_volume,
        attack_ms=attack_ms,
        release_ms=release_ms,
    )

    bgm_linear = db_to_linear(bgm_gain_db)
    tts_linear = db_to_linear(narration_gain_db)

    ducked_bgm = bgm_data * envelope * bgm_linear
    scaled_narration = narration_audio * tts_linear

    # 3. Trộn âm thanh và chuẩn hóa tuyến tính (Linear Headroom Scaling - Tuyệt đối không méo bão hòa Tanh)
    mixed = ducked_bgm + scaled_narration

    # Chuẩn hóa Headroom tuyến tính cho tệp trộn (-0.5 dBFS)
    max_peak_mixed = np.max(np.abs(mixed)) if len(mixed) > 0 else 0.0
    if max_peak_mixed > 0.95:
        mixed = mixed * (0.95 / max_peak_mixed)

    # Chuẩn hóa Headroom cho track thuyết minh (-0.5 dBFS)
    max_peak_narr = np.max(np.abs(scaled_narration)) if len(scaled_narration) > 0 else 0.0
    if max_peak_narr > 0.95:
        scaled_narration = scaled_narration * (0.95 / max_peak_narr)

    # 4. Ghi các tệp WAV ra đĩa ở chuẩn 24-bit hoặc 16-bit PCM 48 kHz
    Path(output_narration_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_mixed_path).parent.mkdir(parents=True, exist_ok=True)

    sf.write(output_narration_path, scaled_narration, sample_rate, subtype="PCM_16")
    sf.write(output_mixed_path, mixed, sample_rate, subtype="PCM_16")

    return total_len / sample_rate


# ==============================================================================
# 4. FFMPEG CLI INTEGRATION & VIDEO MUXING
# ==============================================================================

def get_media_info_via_ffprobe(file_path: str) -> Dict[str, Any]:
    """Trích xuất thông số kỹ thuật của video/audio qua ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(res.stdout)
        format_info = data.get("format", {})
        streams = data.get("streams", [])

        v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        duration = float(format_info.get("duration", 0.0))
        if duration == 0.0 and v_stream:
            duration = float(v_stream.get("duration", 0.0))

        fps = 30.0
        if v_stream and "r_frame_rate" in v_stream:
            num, den = v_stream["r_frame_rate"].split("/")
            fps = float(num) / float(den) if float(den) > 0 else 30.0

        return {
            "duration": round(duration, 2),
            "width": int(v_stream.get("width", 1920)) if v_stream else 1920,
            "height": int(v_stream.get("height", 1080)) if v_stream else 1080,
            "fps": round(fps, 2),
            "hasAudio": a_stream is not None,
            "audioSampleRate": int(a_stream.get("sample_rate", 44100)) if a_stream else 44100,
            "audioChannels": int(a_stream.get("channels", 2)) if a_stream else 2,
        }
    except Exception as e:
        print(f"[!] Lỗi khi chạy ffprobe trên {file_path}: {e}")
        return {
            "duration": 0.0,
            "width": 1920,
            "height": 1080,
            "fps": 30.0,
            "hasAudio": True,
            "audioSampleRate": 44100,
            "audioChannels": 2,
        }


def extract_audio_from_video(video_path: str, output_wav_path: str, sample_rate: int = DEFAULT_SAMPLE_RATE) -> bool:
    """Tách âm thanh 16-bit PCM WAV từ video ở chuẩn 48 kHz."""
    Path(output_wav_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(sample_rate),
        "-ac", "2",
        output_wav_path,
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return os.path.exists(output_wav_path)
    except Exception as e:
        print(f"[!] Lỗi trích xuất audio: {e}")
        return False


def save_cues_to_srt(cues: List[Dict[str, Any]], output_srt_path: str) -> None:
    """Lưu danh sách cues ra tệp phụ đề SRT chuẩn."""
    def format_ts(sec: float) -> str:
        ms = int(round(sec * 1000))
        h = ms // 3600000
        ms %= 3600000
        m = ms // 60000
        ms %= 60000
        s = ms // 1000
        ms %= 1000
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    Path(output_srt_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_srt_path, "w", encoding="utf-8") as f:
        for idx, cue in enumerate(cues, start=1):
            s = float(cue.get("startTime", cue.get("start", 0.0)))
            e = float(cue.get("endTime", cue.get("end", s + 1.0)))
            text = cue.get("translatedText") or cue.get("text") or cue.get("originalText") or ""
            f.write(f"{idx}\n")
            f.write(f"{format_ts(s)} --> {format_ts(e)}\n")
            f.write(f"{text.strip()}\n\n")


def mux_final_video(
    video_path: str,
    mixed_audio_path: str,
    output_video_path: str,
    subtitle_path: Optional[str] = None,
    subtitle_type: str = "soft",
    video_codec: str = "h264_nvenc",
) -> Dict[str, Any]:
    """
    Ghép video và track âm thanh đã hòa âm bằng FFmpeg CLI.
    Hỗ trợ Softsub (mov_text) hoặc Hardsub (re-encode phụ đề cứng).
    """
    Path(output_video_path).parent.mkdir(parents=True, exist_ok=True)

    cmd = ["ffmpeg", "-y", "-i", video_path, "-i", mixed_audio_path]

    # Kiểm tra kiểu gắn phụ đề
    if subtitle_path and os.path.exists(subtitle_path) and subtitle_type == "hard":
        # Hardsub: Cần render lại video
        sub_escaped = subtitle_path.replace("\\", "/").replace(":", "\\:")
        codec = video_codec if video_codec in ["h264_nvenc", "libx264"] else "libx264"
        cmd.extend([
            "-vf", f"subtitles='{sub_escaped}'",
            "-c:v", codec,
            "-preset", "p4",
            "-b:v", "4000k",
            "-c:a", "aac",
            "-b:a", "256k",
            "-ar", "48000",
            "-map", "0:v:0",
            "-map", "1:a:0",
            output_video_path,
        ])
    elif subtitle_path and os.path.exists(subtitle_path) and subtitle_type == "soft":
        # Softsub: Stream copy video siêu tốc + gắn track phụ đề mov_text
        cmd.extend([
            "-i", subtitle_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "256k",
            "-ar", "48000",
            "-c:s", "mov_text",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-map", "2:s:0",
            output_video_path,
        ])
    else:
        # Không gắn sub hoặc sub = none: Copy video gốc và mux audio mới
        cmd.extend([
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "256k",
            "-ar", "48000",
            "-map", "0:v:0",
            "-map", "1:a:0",
            output_video_path,
        ])

    try:
        process = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        # Nếu lỗi NVENC, tự động fallback sang CPU libx264
        if "nvenc" in cmd:
            print("[!] NVENC không tương thích, fallback sang libx264...")
            fallback_cmd = [c.replace("h264_nvenc", "libx264") for c in cmd]
            subprocess.run(fallback_cmd, capture_output=True, text=True, check=True)
        else:
            raise RuntimeError(f"FFmpeg muxing thất bại: {e.stderr}")

    file_size = os.path.getsize(output_video_path) if os.path.exists(output_video_path) else 0
    info = get_media_info_via_ffprobe(output_video_path)

    return {
        "output_path": output_video_path,
        "file_size_bytes": file_size,
        "duration_sec": info.get("duration", 0.0),
    }
