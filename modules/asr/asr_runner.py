# -*- coding: utf-8 -*-
"""
================================================================================
MODULE 1: NHẬN DẠNG GIỌNG NÓI ASR (FASTER-WHISPER & MULTIMODAL FUSION)
Đề tài NCKH: Hệ thống lồng tiếng Video đa ngữ AI Local
Kế thừa & Nâng cấp theo kiến trúc chuẩn dự án lemyloi-dichvideos
================================================================================
Tính năng cốt lõi:
  1. Trích xuất âm thanh tự động WAV 16kHz Mono từ video bằng FFmpeg.
  2. Faster-Whisper GPU/CPU với INT8_FLOAT32 tối ưu cho GTX 1060 (6GB VRAM).
  3. Thuật toán ngắt câu thông minh (Smart Sentence Splitter - lemyloi style):
     - Dấu kết thúc câu (。 ! ? . ; \n)
     - Dấu phẩy nghỉ khi câu đủ dài (>=2.0s hoặc >= 10 ký tự)
     - Khoảng lặng ngắt nghỉ giữa 2 từ liên tiếp (silence_gap >= 0.40s)
     - Khống chế thời lượng câu chuẩn video editor (<= 5.0s hoặc 30 ký tự)
     - Ghép từ theo ngôn ngữ (zh/ja viết liền, vi/en có khoảng trắng)
  4. Phân loại giới tính âm học qua F0 pitch (Autocorrelation CPU).
  5. Phân cụm người nói (Speaker Diarization) qua Voiceprint Embeddings.
  6. Dung hợp đa phương thức (Multimodal Fusion - fuse_ocr_and_asr):
     Tự động kết hợp phụ đề OCR và âm thanh ASR để triệt tiêu lỗi che khuất / sót câu.
  7. Xuất dữ liệu chuẩn Data Contract bàn giao cho MT & TTS.
================================================================================
"""

from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import json
import math
import os
from pathlib import Path
import site
import subprocess
import sys
import tempfile
import time
from typing import Any, Dict, List, Optional, Tuple

# 1. Tự động nạp thư viện DLL NVIDIA (cuBLAS, cuDNN) trên Windows
if sys.platform == "win32":
    possible_roots = []
    try:
        for site_pkg in site.getsitepackages():
            possible_roots.append(os.path.join(site_pkg, "nvidia"))
    except Exception:
        pass
    base_prefix = getattr(sys, "base_prefix", sys.prefix)
    possible_roots.append(os.path.join(base_prefix, "Lib", "site-packages", "nvidia"))
    for root in possible_roots:
        if os.path.exists(root):
            for sub in os.listdir(root):
                bin_dir = os.path.join(root, sub, "bin")
                if os.path.exists(bin_dir):
                    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
                    if hasattr(os, "add_dll_directory"):
                        try:
                            os.add_dll_directory(bin_dir)
                        except Exception:
                            pass

# Đảm bảo console UTF-8 không lỗi font tiếng Việt
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

try:
    from profiler import HardwareProfiler
except ImportError:
    HardwareProfiler = None

try:
    from speaker_diarizer import SpeakerDiarizer, load_audio_mono_16k
    HAS_DIARIZER = True
except ImportError:
    HAS_DIARIZER = False


# ==============================================================================
# 1. TIỆN ÍCH TRÍCH XUẤT ÂM THANH & ĐỊNH DẠNG (LEMYLOI CORE)
# ==============================================================================

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".wmv", ".m4v"}


def extract_audio_from_video(video_path: str, output_wav_path: Optional[str] = None) -> str:
    """Trích xuất file âm thanh WAV 16kHz Mono từ video bằng FFmpeg (chuẩn lemyloi)."""
    if not output_wav_path:
        p = Path(video_path)
        output_wav_path = str(p.parent / f"{p.stem}_asr_tmp.wav")

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        output_wav_path
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception as e:
        print(f"[!] Lỗi khi trích xuất âm thanh bằng FFmpeg: {e}")
        return video_path
    return output_wav_path


def format_srt_time(seconds: float) -> str:
    """Đổi số giây sang định dạng SRT chuẩn HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def save_to_srt(cues: List[Dict[str, Any]], filepath: str) -> None:
    """Lưu phụ đề nguồn ra tệp .srt chuẩn."""
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        for c in cues:
            f.write(f"{c['id']}\n")
            f.write(f"{format_srt_time(c['start'])} --> {format_srt_time(c['end'])}\n")
            f.write(f"{c['text']}\n\n")


# ==============================================================================
# 2. ƯỚC LƯỢNG CAO ĐỘ F0 & PHÂN LOẠI GIỚI TÍNH ÂM HỌC
# ==============================================================================

def estimate_pitch_f0(audio_segment: np.ndarray, sr: int = 16000, fmin: float = 75, fmax: float = 320) -> float:
    """Ước lượng tần số F0 bằng Autocorrelation nhẹ trên CPU (85Hz-155Hz Nam, 165Hz-260Hz Nữ)."""
    if len(audio_segment) < int(sr * 0.08):
        return 0.0

    frame_len = int(sr * 0.04)
    hop_len = int(sr * 0.02)
    min_lag = int(sr / fmax)
    max_lag = int(sr / fmin)

    pitches = []
    for i in range(0, len(audio_segment) - frame_len, hop_len):
        frame = audio_segment[i:i + frame_len]
        frame = frame - np.mean(frame)
        energy = np.sum(frame ** 2)
        if energy < 1e-4:
            continue
        corr = np.correlate(frame, frame, mode="full")
        corr = corr[len(corr) // 2:]
        if max_lag >= len(corr):
            continue
        peak_idx = min_lag + np.argmax(corr[min_lag:max_lag])
        if corr[0] > 0 and (corr[peak_idx] / corr[0]) > 0.30:
            f0 = sr / peak_idx
            if fmin <= f0 <= fmax:
                pitches.append(f0)

    if pitches:
        return float(np.median(pitches))
    return 0.0


def classify_gender(f0: float) -> str:
    """Phân loại giới tính âm học: M (Nam), F (Nữ), U (Không xác định/Âm nhạc)."""
    if 75 <= f0 <= 160:
        return "M"
    elif 160 < f0 <= 320:
        return "F"
    return "U"


# ==============================================================================
# 3. THUẬT TOÁN TÁCH CÂU THÔNG MINH (LEMYLOI NATURAL SPLITTER)
# ==============================================================================

def split_segment_into_cues(
    seg,
    total_duration: float,
    detected_lang: str = "zh",
    max_pause: float = 0.40,
    max_duration: float = 5.0,
    enable_split: bool = True,
) -> List[Dict[str, Any]]:
    """
    Tách 1 segment thô của Whisper thành các cue tự nhiên theo chuẩn video editor lemyloi:
    1. Gặp dấu kết thúc câu (。 ! ? . ; \n)
    2. Gặp dấu phẩy khi câu đã đủ dài (>= 2.0s hoặc >= 10 ký tự)
    3. Có khoảng lặng nghỉ giữa 2 từ liên tiếp >= 0.40s
    4. Câu thoại đã quá dài (>= 5.0s hoặc >= 30 ký tự)
    5. Nối từ: zh/ja viết liền không chèn space, en/vi có space.
    """
    default_conf = round(math.exp(min(0.0, getattr(seg, "avg_logprob", -0.05))), 4)
    words = getattr(seg, "words", None)

    # Nếu không bật tách câu hoặc không có word_timestamps
    if not enable_split or not words:
        text = seg.text.strip()
        if not text:
            return []
        s_t = round(float(seg.start), 2)
        e_t = round(float(min(total_duration, max(s_t + 0.2, seg.end))), 2)
        return [{
            "start": s_t,
            "end": e_t,
            "text": text,
            "confidence": default_conf,
        }]

    valid_words = [w for w in words if getattr(w, "word", "").strip()]
    if not valid_words:
        return []

    punctuation_marks = {"。", "！", "？", "；", ".", "!", "?", ";", "\n"}
    comma_marks = {"，", "、", ","}
    is_cjk = detected_lang.lower() in ["zh", "ja", "chinese", "japanese"]

    cues = []
    current_chunk_words = []
    chunk_start = None

    for i, w in enumerate(valid_words):
        w_text = w.word
        if chunk_start is None:
            chunk_start = w.start

        current_chunk_words.append(w_text)
        chunk_duration = w.end - chunk_start

        if is_cjk:
            current_text = "".join(current_chunk_words).strip()
        else:
            current_text = " ".join(current_chunk_words).strip()

        # Tiêu chí ngắt câu:
        is_sentence_end = any(w_text.endswith(p) for p in punctuation_marks)
        is_comma_pause = any(w_text.endswith(c) for c in comma_marks) and (chunk_duration >= 2.0 or len(current_text) >= 10)

        has_silence_gap = False
        if i + 1 < len(valid_words):
            gap = valid_words[i + 1].start - w.end
            if gap >= max_pause and len(current_text) >= 4:
                has_silence_gap = True

        is_too_long = chunk_duration >= max_duration or len(current_text) >= 30

        if is_sentence_end or is_comma_pause or has_silence_gap or is_too_long:
            cleaned_txt = current_text.strip()
            if cleaned_txt and len(cleaned_txt) >= 1:
                s_t = round(float(max(0.0, chunk_start - 0.05)), 2)
                e_t = round(float(min(total_duration, w.end + 0.05)), 2)
                if e_t <= s_t:
                    e_t = round(s_t + 0.2, 2)

                probs = [getattr(cw, "probability", default_conf) for cw in valid_words if hasattr(cw, "probability")]
                conf = round(float(np.mean(probs)), 4) if probs else default_conf

                cues.append({
                    "start": s_t,
                    "end": e_t,
                    "text": cleaned_txt,
                    "confidence": conf,
                })
            current_chunk_words = []
            chunk_start = None

    # Phần sót lại cuối segment
    if current_chunk_words and chunk_start is not None:
        if is_cjk:
            cleaned_txt = "".join(current_chunk_words).strip()
        else:
            cleaned_txt = " ".join(current_chunk_words).strip()

        if cleaned_txt:
            s_t = round(float(max(0.0, chunk_start - 0.05)), 2)
            e_t = round(float(min(total_duration, valid_words[-1].end + 0.05)), 2)
            if e_t <= s_t:
                e_t = round(s_t + 0.2, 2)

            cues.append({
                "start": s_t,
                "end": e_t,
                "text": cleaned_txt,
                "confidence": default_conf,
            })

    return cues


# ==============================================================================
# 4. MULTIMODAL FUSION: DUNG HỢP ĐA PHƯƠNG THỨC OCR & ASR (LEMYLOI)
# ==============================================================================

def fuse_ocr_and_asr(
    ocr_cues: List[Dict[str, Any]],
    asr_cues: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Dung hợp Đa phương thức (Multimodal Fusion):
    Kết hợp dữ liệu Thị giác (OCR) và Âm thanh (ASR) để tối đa hóa độ chính xác:
    - Nếu ASR khớp mốc thời gian và nội dung với OCR -> Ưu tiên mốc thời gian mượt mà của ASR.
    - Nếu có phân đoạn ASR nghe được nhưng OCR bị che/sót -> Tự động bù đắp vào danh sách.
    """
    if not ocr_cues:
        return asr_cues
    if not asr_cues:
        return ocr_cues

    fused = [dict(c) for c in ocr_cues]
    fused_idx = len(fused) + 1

    for a in asr_cues:
        matched = False
        a_txt = (a.get("text") or a.get("source_text") or "").strip().lower()
        a_start = float(a.get("start", 0.0))
        a_end = float(a.get("end", 0.0))

        for o in fused:
            o_txt = (o.get("text") or o.get("source_text") or "").strip().lower()
            o_start = float(o.get("start", 0.0))
            o_end = float(o.get("end", 0.0))

            time_overlap = max(0.0, min(a_end, o_end) - max(a_start, o_start))
            if time_overlap > 0.3:
                sim = SequenceMatcher(None, a_txt, o_txt).ratio()
                if sim > 0.4:
                    matched = True
                    # Cập nhật mốc thời gian ASR chuẩn hơn cho OCR
                    o["start"] = a_start
                    o["end"] = a_end
                    o["source_type"] = "FUSED_OCR_ASR"
                    break

        if not matched and a_txt:
            # ASR nghe được nhưng OCR không thấy -> Bổ sung
            a_copy = dict(a)
            a_copy["id"] = fused_idx
            a_copy["source_type"] = "ASR"
            fused_idx += 1
            fused.append(a_copy)

    # Sắp xếp lại theo thời gian
    fused.sort(key=lambda x: float(x.get("start", 0.0)))
    for idx, c in enumerate(fused, start=1):
        c["id"] = idx
        start_v = float(c.get("start", 0.0))
        end_v = float(c.get("end", start_v + 1.0))
        c["duration"] = round(max(0.1, end_v - start_v), 2)

    return fused


# ==============================================================================
# 5. PHÁT HIỆN THIẾT BỊ VÀ THỰC THI CHÍNH
# ==============================================================================

def resolve_device_and_compute_type() -> Tuple[str, str]:
    """Tự động phát hiện GPU và kiểu tính toán tối ưu cho kiến trúc card (GTX 1060 Pascal)."""
    device = "cpu"
    compute_type = "int8"
    try:
        import ctranslate2
        cuda_types = ctranslate2.get_supported_compute_types("cuda")
        if cuda_types:
            device = "cuda"
            if "int8_float32" in cuda_types:
                compute_type = "int8_float32"
            elif "float16" in cuda_types:
                compute_type = "float16"
            elif "float32" in cuda_types:
                compute_type = "float32"
            else:
                compute_type = "int8"
    except Exception:
        device = "cpu"
        compute_type = "int8"
    return device, compute_type


def main():
    parser = argparse.ArgumentParser(description="NCKH ASR Engine - Faster-Whisper (lemyloi architecture)")
    parser.add_argument("media", nargs="?", default="", help="Đường dẫn tệp video hoặc audio đầu vào")
    parser.add_argument("--model", "-m", type=str, default="small", help="Kích thước mô hình: tiny, base, small, medium, large-v3")
    parser.add_argument("--beam-size", "-b", type=int, default=2, help="Beam size")
    parser.add_argument("--word-timestamps", dest="word_timestamps", action="store_true", default=True, help="Bật timestamp từng từ")
    parser.add_argument("--no-word-timestamps", dest="word_timestamps", action="store_false", help="Tắt timestamp từng từ")
    parser.add_argument("--lang", "-l", type=str, default=None, help="Ngôn ngữ audio (zh, en, vi... hoặc để trống tự phát hiện)")
    parser.add_argument("--initial-prompt", type=str, default=None, help="Prompt mồi định hướng văn phong hoặc dấu câu")
    parser.add_argument("--vad", dest="vad", action="store_true", default=True, help="Bật Silero VAD lọc khoảng lặng")
    parser.add_argument("--no-vad", dest="vad", action="store_false", help="Tắt VAD")
    parser.add_argument("--vad-threshold", type=float, default=0.45, help="Ngưỡng nhạy VAD")
    parser.add_argument("--vad-pad", type=int, default=200, help="Đệm trước và sau mỗi đoạn âm thanh (ms)")
    parser.add_argument("--smart-split", dest="smart_split", action="store_true", default=True, help="Tách câu tự nhiên chuẩn video editor")
    parser.add_argument("--no-smart-split", dest="smart_split", action="store_false", help="Tắt tách câu tự nhiên")
    parser.add_argument("--max-pause", type=float, default=0.40, help="Khoảng lặng nghỉ tối đa giữa 2 từ (giây)")
    parser.add_argument("--max-duration", type=float, default=5.0, help="Thời lượng tối đa cho 1 phân đoạn (giây)")
    parser.add_argument("--min-confidence", type=float, default=0.35, help="Ngưỡng độ tin cậy tối thiểu")
    parser.add_argument("--no-speech-threshold", type=float, default=0.70, help="Ngưỡng phát hiện âm nhạc/khoảng lặng không lời")
    parser.add_argument("--gender", dest="detect_gender", action="store_true", default=False, help="Kích hoạt phân loại giới tính âm học qua F0")
    parser.add_argument("--diarize", action="store_true", default=False, help="Kích hoạt phân biệt người nói qua Voiceprint Clustered")
    parser.add_argument("--speakers", "-s", type=str, default="auto", help="Số lượng người nói (auto hoặc số nguyên)")
    parser.add_argument("--ocr-json", type=str, default=None, help="Đường dẫn file OCR JSON để thực hiện Multimodal Fusion")
    parser.add_argument("--output", "-o", type=str, default="output/asr_output.json", help="Đường dẫn tệp JSON đầu ra")
    parser.add_argument("--output-srt", type=str, default="output/subtitles_source.srt", help="Đường dẫn tệp SRT đầu ra")
    args, _ = parser.parse_known_args()

    media_path = args.media
    if not media_path:
        candidates = ["data/input_video.mp4", "data/input_audio.wav", "data/sample.mp3"]
        media_path = next((c for c in candidates if os.path.exists(c)), "data/input_video.mp4")

    if not os.path.exists(media_path):
        print(f"\n[!] Không tìm thấy tệp đầu vào: '{media_path}'")
        return

    # Nếu đầu vào là video, trích xuất audio WAV mono 16kHz trước (chuẩn lemyloi)
    ext = Path(media_path).suffix.lower()
    temp_wav_path = None
    audio_for_transcribe = media_path

    if ext in VIDEO_EXTENSIONS:
        print("[*] Phát hiện tệp Video. Đang trích xuất audio WAV mono 16kHz bằng FFmpeg...")
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            temp_wav_path = tf.name
        audio_for_transcribe = extract_audio_from_video(media_path, temp_wav_path)

    device, compute_type = resolve_device_and_compute_type()
    model_size = args.model
    lang_req = args.lang if args.lang and args.lang.lower() not in ["auto", "none", ""] else None

    print("=" * 70)
    print(" 🎙️  MÔ-ĐUN ASR (FASTER-WHISPER - LEMYLOI SPEC)")
    print("=" * 70)
    print(f"[*] TỆP ĐẦU VÀO : {media_path}")
    print(f"[*] MÔ HÌNH ASR : Faster-Whisper {model_size.upper()} ({device.upper()} | {compute_type})")
    print(f"[*] BEAM SIZE   : {args.beam_size}")
    print(f"[*] WORD TIMING : {'BẬT' if args.word_timestamps else 'TẮT'}")
    print(f"[*] VAD FILTER  : {'BẬT (min_silence=250ms, pad=' + str(args.vad_pad) + 'ms)' if args.vad else 'TẮT'}")
    print(f"[*] SMART SPLIT : {'BẬT (pause >= ' + str(args.max_pause) + 's, max_dur=' + str(args.max_duration) + 's)' if args.smart_split else 'TẮT'}")
    print(f"[*] DIARIZATION : {'BẬT' if args.diarize else 'TẮT'}")
    print(f"[*] NGÔN NGỮ    : {lang_req.upper() if lang_req else 'Tự động phát hiện'}")
    print("=" * 70)

    profiler = HardwareProfiler() if HardwareProfiler else None
    if profiler:
        profiler.start()

    initial_prompt = args.initial_prompt
    if lang_req in ["zh", "chinese"] and not initial_prompt:
        initial_prompt = "以下是普通话的简体中文句子，正确使用标点符号。"

    print("\n[1/3] Đang nạp mô hình Faster-Whisper...")
    t0 = time.time()
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=4, num_workers=1)
    except Exception as e:
        print(f"[!] GPU không khả dụng ({e}). Fallback CPU...")
        device = "cpu"
        compute_type = "int8"
        model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=4, num_workers=1)
    print(f"      ✓ Nạp mô hình hoàn tất ({time.time() - t0:.2f}s)")

    print("\n[2/3] Đang nhận dạng âm thanh...")
    t_start = time.time()

    vad_params = dict(
        min_silence_duration_ms=250,
        speech_pad_ms=args.vad_pad,
        threshold=args.vad_threshold,
    ) if args.vad else None

    segments_iter, info = model.transcribe(
        audio_for_transcribe,
        language=lang_req,
        initial_prompt=initial_prompt,
        beam_size=args.beam_size,
        word_timestamps=args.word_timestamps,
        vad_filter=args.vad,
        vad_parameters=vad_params,
        temperature=[0.0, 0.2],
        no_speech_threshold=args.no_speech_threshold,
        condition_on_previous_text=True,
    )

    detected_lang = info.language
    lang_prob = info.language_probability
    total_duration = info.duration
    print(f"      ✓ Ngôn ngữ : {detected_lang.upper()} (Độ tin cậy: {lang_prob*100:.1f}%)")
    print(f"      ✓ Thời lượng: {total_duration:.2f}s")

    audio_full = None
    if args.detect_gender or args.diarize:
        try:
            audio_full = decode_audio(audio_for_transcribe, sampling_rate=16000)
        except Exception as e:
            print(f"      [!] Không thể nạp waveform ({e})")

    cues = []
    cue_idx = 1
    print("\n[3/3] Trích xuất danh sách câu thoại:")

    for seg in segments_iter:
        raw_text = seg.text.strip()
        if not raw_text:
            continue

        split_chunks = split_segment_into_cues(
            seg,
            total_duration=total_duration,
            detected_lang=detected_lang,
            max_pause=args.max_pause,
            max_duration=args.max_duration,
            enable_split=args.smart_split,
        )

        for chunk in split_chunks:
            clean_text = chunk["text"]
            start_sec = chunk["start"]
            end_sec = chunk["end"]
            dur = round(end_sec - start_sec, 2)
            conf = chunk["confidence"]

            if conf < args.min_confidence:
                continue

            cue_item = {
                "id": cue_idx,
                "start": start_sec,
                "end": end_sec,
                "duration": dur,
                "text": clean_text,
                "source_text": clean_text,
                "confidence": conf,
                "source_type": "ASR",
                "detected_language": detected_lang,
                "speaker": "Speaker 1",
                "speaker_id": "SPEAKER_00",
                "speaker_color": "#22c55e",
            }

            if args.detect_gender and audio_full is not None and len(audio_full) > 0:
                s_samp = int(start_sec * 16000)
                e_samp = min(len(audio_full), int(end_sec * 16000))
                if e_samp > s_samp:
                    f0_v = round(estimate_pitch_f0(audio_full[s_samp:e_samp], sr=16000), 1)
                    cue_item["pitch_f0_hz"] = f0_v
                    cue_item["acoustic_gender"] = classify_gender(f0_v)

            cues.append(cue_item)
            cue_idx += 1

    # Chuẩn hóa đơn điệu mốc thời gian, loại bỏ chồng lấn
    for i in range(1, len(cues)):
        prev_end = cues[i - 1]["end"]
        curr_start = cues[i]["start"]
        if curr_start < prev_end:
            if cues[i]["end"] > prev_end + 0.15:
                cues[i]["start"] = prev_end
            else:
                mid_pt = round((prev_end + curr_start) / 2, 2)
                cues[i - 1]["end"] = mid_pt
                cues[i]["start"] = mid_pt
            cues[i - 1]["duration"] = round(max(0.05, cues[i - 1]["end"] - cues[i - 1]["start"]), 2)
            cues[i]["duration"] = round(max(0.05, cues[i]["end"] - cues[i]["start"]), 2)

    # 4. Phân cụm người nói (Diarization) nếu được yêu cầu
    diarization_info = {
        "total_speakers": 1,
        "speakers": [{"id": "SPEAKER_00", "label": "Speaker 1", "color": "#22c55e"}]
    }

    if args.diarize and HAS_DIARIZER and audio_full is not None and len(cues) > 0:
        print("\n[*] Đang thực hiện phân biệt người nói qua Voiceprint Embeddings...")
        try:
            diarizer = SpeakerDiarizer(sample_rate=16000)
            target_spk = None if args.speakers == "auto" else int(args.speakers)
            diarized_cues, spk_list = diarizer.diarize(cues, audio_full, n_speakers=target_spk)
            cues = diarized_cues
            diarization_info = {
                "total_speakers": len(spk_list),
                "speakers": spk_list
            }
            print(f"      ✓ Phát hiện {len(spk_list)} người nói.")
        except Exception as e:
            print(f"[!] Diarization thất bại ({e}). Giữ nguyên Speaker 1.")

    # 5. Multimodal Fusion (nếu có đầu vào OCR)
    if args.ocr_json and os.path.exists(args.ocr_json):
        print(f"\n[*] Đang thực hiện Dung hợp Đa phương thức với OCR ({args.ocr_json})...")
        try:
            with open(args.ocr_json, "r", encoding="utf-8") as f:
                ocr_data = json.load(f)
            ocr_cues = ocr_data.get("cues", [])
            cues = fuse_ocr_and_asr(ocr_cues, cues)
            print(f"      ✓ Dung hợp hoàn tất: Tổng số câu là {len(cues)}.")
        except Exception as e:
            print(f"[!] Lỗi khi dung hợp OCR-ASR ({e}).")

    # In kết quả dạng bảng
    print("-" * 75)
    print(f"{'#':<4} {'TIMESTAMPS':<22} | {'SPEAKER':<12} | {'VĂN BẢN NHẬN DIỆN'}")
    print("-" * 75)
    for c in cues:
        ts = f"[{c['start']:6.2f}s → {c['end']:6.2f}s]"
        spk = c.get("speaker", "Speaker 1")
        print(f"{c['id']:<4} {ts:<22} | {spk:<12} | {c['text']}")
    print("-" * 75)

    # 6. Dọn dẹp file tạm
    if temp_wav_path and os.path.exists(temp_wav_path):
        try:
            os.remove(temp_wav_path)
        except Exception:
            pass

    t_infer = time.time() - t_start
    hw_stats = profiler.stop() if profiler else {}

    # 7. Lưu file kết quả JSON và SRT
    output_json = Path(args.output)
    output_srt = Path(args.output_srt)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_srt.parent.mkdir(parents=True, exist_ok=True)

    contract_payload = {
        "cues": cues,
        "hardware_benchmark": hw_stats,
        "media_info": {
            "duration_sec": round(total_duration, 2),
            "language": detected_lang,
            "language_probability": round(lang_prob, 4),
        },
        "model_info": {
            "name": f"Faster-Whisper {model_size.upper()}",
            "device": device,
            "compute_type": compute_type,
            "beam_size": args.beam_size,
            "vad_filter": args.vad,
        },
        "diarization": diarization_info
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(contract_payload, f, ensure_ascii=False, indent=2)

    save_to_srt(cues, str(output_srt))

    print(f"\n[+] ĐÃ XUẤT TỆP JSON BÀN GIAO CHO MT & TTS : {output_json}")
    print(f"[+] ĐÃ XUẤT TỆP PHỤ ĐỀ NGUỒN SRT          : {output_srt}")
    print("======================================================================\n")

    if profiler:
        profiler.print_academic_report(
            task_name="Nhận dạng giọng nói (ASR - lemyloi)",
            model_name=f"Faster-Whisper {model_size.upper()} ({device.upper()} - {compute_type})",
            media_duration_sec=total_duration,
        )


if __name__ == "__main__":
    main()
