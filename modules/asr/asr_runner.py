"""
================================================================================
NHẬN DẠNG GIỌNG NÓI THUẦN TÚY (PURE ASR - FASTER WHISPER)
Đề tài NCKH: Hệ thống lồng tiếng Video đa ngữ
Thành viên phụ trách: Võ Thành Công (Module 1 - ASR)
================================================================================
Mục tiêu:
  - Nhận diện giọng nói chính xác 100%, nguyên bản, không bị nuốt chữ hay bỏ sót từ.
  - Loại bỏ hoàn toàn các bộ lọc can thiệp phụ (không phân vai phức tạp, không regex xóa từ lặp, không chém vụn VAD).
  - Tối ưu chạy mượt mà trên GPU NVIDIA (GTX 1060) với kiểu tính toán INT8_FLOAT32.
  - Xuất dữ liệu chuẩn Data Contract bàn giao cho MT (Hoàng) và TTS (Duy).
================================================================================
"""

import os
import sys
import site
import time
import json
import math
import argparse
from pathlib import Path

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
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
import numpy as np

try:
    from profiler import HardwareProfiler
except ImportError:
    HardwareProfiler = None


def estimate_pitch_f0(audio_segment: np.ndarray, sr: int = 16000, fmin: float = 75, fmax: float = 320) -> float:
    """
    Ước lượng tần số cơ bản F0 (Pitch) bằng thuật toán Autocorrelation theo khung thời gian.
    - Nam giới (M) thường có F0 trong khoảng 85Hz - 155Hz.
    - Nữ giới (F) thường có F0 trong khoảng 165Hz - 260Hz.
    Không tốn VRAM, chạy cực nhanh trên CPU.
    """
    if len(audio_segment) < int(sr * 0.08):  # Dưới 80ms không đủ ước lượng
        return 0.0

    frame_len = int(sr * 0.04)  # 40ms frame
    hop_len = int(sr * 0.02)    # 20ms hop
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
    """Phân loại giới tính âm học từ F0: 'M' (Nam), 'F' (Nữ), 'U' (Chưa rõ/Âm nhạc)."""
    if 75 <= f0 <= 160:
        return "M"
    elif 160 < f0 <= 320:
        return "F"
    return "U"


def split_segment_into_cues(
    seg,
    total_duration: float,
    max_pause: float = 0.6,
    max_duration: float = 6.0,
    enable_split: bool = True,
) -> list[dict]:
    """
    Tách 1 segment thô của Whisper thành các cue nhỏ chuẩn Dubbing/Subtitle dựa trên:
    1. Dấu câu kết thúc (. ? ! 。 ？ ！).
    2. Khoảng lặng ngập ngừng giữa 2 từ liên tiếp >= max_pause (mặc định 0.6s).
    3. Giới hạn thời lượng câu dài >= max_duration (mặc định 6.0s) khi có dấu phẩy hoặc khoảng nghỉ nhẹ.
    """
    default_conf = round(math.exp(min(0.0, getattr(seg, "avg_logprob", -0.05))), 4)
    words = getattr(seg, "words", None)

    # Nếu không có thông tin từ hoặc tắt tính năng smart split -> giữ nguyên segment
    if not enable_split or not words or len(words) == 0:
        valid_words = [w for w in words if w.word.strip()] if words else []
        if valid_words:
            t_start = max(0.0, valid_words[0].start - 0.05)
            t_end = min(total_duration, valid_words[-1].end + 0.10)
        else:
            t_start = seg.start
            t_end = seg.end
        start_sec = round(t_start, 2)
        end_sec = round(max(start_sec + 0.2, t_end), 2)
        return [{
            "start": start_sec,
            "end": end_sec,
            "text": seg.text.strip(),
            "confidence": default_conf,
        }]

    valid_words = [w for w in words if w.word.strip()]
    if not valid_words:
        return []

    # Gom các cụm từ (word groups) thỏa mãn điều kiện tách
    word_groups = []
    current_words = []
    sentence_puncts = (".", "?", "!", "。", "？", "！")
    soft_puncts = (",", ";", ":", "，", "；", "：")
    abbreviations = ("mr.", "mrs.", "ms.", "dr.", "vs.", "st.", "etc.", "e.g.", "i.e.")

    for i, w in enumerate(valid_words):
        current_words.append(w)
        w_text = w.word.strip()
        w_lower = w_text.lower()

        is_punct_end = any(w_text.endswith(p) for p in sentence_puncts)
        if is_punct_end and w_lower in abbreviations:
            is_punct_end = False

        # 2. Phát hiện người nói ngập ngừng hoặc nghỉ hơi
        has_pause = False
        if i < len(valid_words) - 1:
            pause_time = valid_words[i + 1].start - w.end
            # Nếu có dấu phẩy hoặc dấu ngắt nhẹ và có khoảng nghỉ >= 0.20s -> tách cụm
            if any(w_text.endswith(p) for p in soft_puncts) and pause_time >= 0.20:
                has_pause = True
            elif pause_time >= max_pause:
                has_pause = True

        # 3. Phân đoạn phụ đề ngắn chuẩn CapCut (Short Chunks: tối đa 4-5 giây hoặc 8 từ)
        current_dur = current_words[-1].end - current_words[0].start
        is_too_long = False
        if len(current_words) >= 3:
            if (current_dur >= max_duration or len(current_words) >= 8):
                if any(w_text.endswith(p) for p in soft_puncts):
                    is_too_long = True
                elif i < len(valid_words) - 1 and (valid_words[i + 1].start - w.end) >= 0.20:
                    is_too_long = True
                elif current_dur >= (max_duration + 1.5):
                    is_too_long = True

        if (is_punct_end or has_pause or is_too_long) and i < len(valid_words) - 1:
            word_groups.append(current_words)
            current_words = []

    if current_words:
        word_groups.append(current_words)

    # Chống chém vụn từ đơn lẻ (Anti-Fragmentation):
    # Nếu một nhóm chỉ có 1 từ ngắn (< 0.8s), gộp nó vào nhóm liền kề để không bị ngắt cụt lủn
    merged_groups = []
    for grp in word_groups:
        if not merged_groups:
            merged_groups.append(grp)
        else:
            grp_dur = grp[-1].end - grp[0].start
            prev_dur = merged_groups[-1][-1].end - merged_groups[-1][0].start
            if len(grp) == 1 and grp_dur < 0.8:
                merged_groups[-1].extend(grp)
            elif len(merged_groups[-1]) == 1 and prev_dur < 0.8:
                merged_groups[-1].extend(grp)
            else:
                merged_groups.append(grp)
    word_groups = merged_groups

    # Chuyển đổi các word groups thành cues với mốc thời gian liên tục, không chồng lấn
    split_cues = []
    for g_idx, group in enumerate(word_groups):
        chunk_text = "".join(cw.word for cw in group).strip()
        if not chunk_text:
            continue

        raw_start = group[0].start
        raw_end = group[-1].end

        # Xử lý mốc thời gian bắt đầu
        if g_idx == 0:
            c_start = round(max(0.0, raw_start - 0.05), 2)
        else:
            prev_group = word_groups[g_idx - 1]
            gap = raw_start - prev_group[-1].end
            if gap >= 0.12:
                c_start = round(raw_start - min(0.05, gap * 0.4), 2)
            else:
                c_start = round((prev_group[-1].end + raw_start) / 2, 2)

        # Xử lý mốc thời gian kết thúc
        if g_idx == len(word_groups) - 1:
            c_end = round(min(total_duration, max(c_start + 0.2, raw_end + 0.08)), 2)
        else:
            next_group = word_groups[g_idx + 1]
            gap = next_group[0].start - raw_end
            if gap >= 0.12:
                c_end = round(raw_end + min(0.06, gap * 0.4), 2)
            else:
                c_end = round((raw_end + next_group[0].start) / 2, 2)

        # Đảm bảo c_end luôn lớn hơn c_start
        if c_end <= c_start:
            c_end = round(c_start + 0.2, 2)

        probs = [getattr(cw, "probability", default_conf) for cw in group if getattr(cw, "probability", None) is not None]
        c_conf = round(float(np.mean(probs)), 4) if probs else default_conf

        split_cues.append({
            "start": c_start,
            "end": c_end,
            "text": chunk_text,
            "confidence": c_conf,
        })

    return split_cues


def format_srt_time(seconds: float) -> str:
    """Định dạng giây sang mốc thời gian SRT chuẩn HH:MM:SS,mmm."""
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    msecs = int(round((seconds - int(seconds)) * 1000))
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{msecs:03d}"


def save_to_srt(cues: list, filepath: str) -> None:
    """Lưu phụ đề nguồn ra tệp .srt."""
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        for c in cues:
            f.write(f"{c['id']}\n")
            f.write(f"{format_srt_time(c['start'])} --> {format_srt_time(c['end'])}\n")
            f.write(f"{c['text']}\n\n")


def resolve_device_and_compute_type() -> tuple[str, str]:
    """Tự động phát hiện GPU và kiểu tính toán tối ưu cho kiến trúc card (GTX 1060 Pascal)."""
    device = "cpu"
    compute_type = "int8"
    try:
        import ctranslate2
        cuda_types = ctranslate2.get_supported_compute_types("cuda")
        if cuda_types:
            device = "cuda"
            if "int8_float32" in cuda_types:
                compute_type = "int8_float32"  # Tối ưu nhất cho GTX 1060 / Pascal
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
    parser = argparse.ArgumentParser(description="Mô-đun ASR thuần túy - Faster-Whisper")
    parser.add_argument("media", nargs="?", default="", help="Đường dẫn tệp video hoặc audio đầu vào")
    parser.add_argument("--model", "-m", type=str, default="small", help="Kích thước mô hình: tiny, base, small, medium, large-v3 (Mặc định: medium)")
    parser.add_argument("--beam-size", "-b", type=int, default=2, help="Beam size (Mặc định: 1 giải mã tham lam nhanh nhất)")
    parser.add_argument("--word-timestamps", dest="word_timestamps", action="store_true", default=True, help="Bật tính năng timestamp từng từ để cắt khoảng lặng chính xác (Mặc định BẬT)")
    parser.add_argument("--no-word-timestamps", dest="word_timestamps", action="store_false", help="Tắt timestamp từng từ")
    parser.add_argument("--gender", dest="detect_gender", action="store_true", default=False, help="Kích hoạt phân loại giới tính âm học (Nam/Nữ) qua F0 (Mặc định: TẮT)")
    parser.add_argument("--no-gender", dest="detect_gender", action="store_false", help="Tắt phân loại giới tính âm học")
    parser.add_argument("--lang", "-l", type=str, default=None, help="Ngôn ngữ audio (zh, en, vi... hoặc để trống tự phát hiện)")
    parser.add_argument("--initial-prompt", type=str, default=None, help="Prompt moi dinh huong van phong hoac dau cau")
    parser.add_argument("--vad", dest="vad", action="store_true", default=True, help="Bật Silero VAD lọc khoảng lặng để tăng tốc")
    parser.add_argument("--no-vad", dest="vad", action="store_false", help="Tắt VAD để bảo toàn 100%% âm thanh gốc")
    parser.add_argument("--vad-threshold", type=float, default=0.45, help="Ngưỡng nhạy VAD (Mặc định: 0.45 chuẩn Silero, lọc tiếng thở và ngập ngừng)")
    parser.add_argument("--vad-pad", type=int, default=200, help="Đệm trước và sau mỗi đoạn âm thanh (ms, Mặc định: 200ms để không nuốt khoảng lặng)")
    parser.add_argument("--smart-split", dest="smart_split", action="store_true", default=True, help="Tự động tách câu thông minh theo dấu câu (. ? !) và khoảng lặng ngập ngừng (Mặc định: BẬT)")
    parser.add_argument("--no-smart-split", dest="smart_split", action="store_false", help="Tắt tách câu thông minh, giữ nguyên phân đoạn gốc của Whisper")
    parser.add_argument("--max-pause", type=float, default=0.4, help="Khoảng lặng tối đa giữa 2 từ liên tiếp trước khi tách câu (giây, Mặc định: 0.4s chuẩn CapCut)")
    parser.add_argument("--max-duration", type=float, default=5.0, help="Thời lượng tối đa cho một phân đoạn phụ đề/lồng tiếng (giây, Mặc định: 5.0s chuẩn CapCut)")
    parser.add_argument("--min-confidence", type=float, default=0.35, help="Ngưỡng độ tin cậy tối thiểu để loại bỏ ảo giác và tạp âm (Mặc định: 0.35)")
    parser.add_argument("--no-speech-threshold", type=float, default=0.70, help="Ngưỡng phát hiện âm nhạc/khoảng lặng không lời (Mặc định: 0.70)")
    parser.add_argument("--diarize", action="store_true", default=False, help="Cờ tương thích (bỏ qua khi dùng thuần)")
    parser.add_argument("--no-diarize", action="store_true", default=False, help="Cờ tương thích (bỏ qua khi dùng thuần)")
    parser.add_argument("--speakers", "-s", type=str, default="auto", help="Cờ tương thích số người nói")
    parser.add_argument("--output", "-o", type=str, default="output/asr_output.json", help="Đường dẫn tệp JSON đầu ra")
    parser.add_argument("--output-srt", type=str, default="output/subtitles-source.srt", help="Đường dẫn tệp SRT đầu ra")
    args, _ = parser.parse_known_args()

    # Tìm tệp đầu vào nếu không truyền trực tiếp
    media_path = args.media
    if not media_path:
        candidates = ["data/input_video.mp4", "data/input_audio.wav", "data/sample.mp3"]
        media_path = next((c for c in candidates if os.path.exists(c)), "data/input_video.mp4")

    if not os.path.exists(media_path):
        print(f"\n[!] Không tìm thấy tệp đầu vào: '{media_path}'")
        print("    Vui lòng sao chép video/audio vào thư mục 'data/' hoặc chỉ định đường dẫn tệp.\n")
        return

    device, compute_type = resolve_device_and_compute_type()
    model_size = args.model
    lang_req = args.lang if args.lang and args.lang.lower() not in ["auto", "none", ""] else None

    print("=" * 70)
    print(" 🎙️  MÔ-ĐUN ASR THUẦN TÚY (FASTER-WHISPER)")
    print("=" * 70)
    print(f"[*] TỆP ĐẦU VÀO : {media_path}")
    print(f"[*] MÔ HÌNH ASR : Faster-Whisper {model_size.upper()} ({device.upper()} | {compute_type})")
    print(f"[*] BEAM SIZE   : {args.beam_size} (Độ chính xác cao)")
    print(f"[*] WORD TIMING : {'KÍCH HOẠT (Lọc khoảng lặng chính xác từng từ)' if args.word_timestamps else 'TẮT'}")
    print(f"[*] ACOUSTIC F0 : {'KÍCH HOẠT (Phân loại giới tính âm học Nam/Nữ)' if args.detect_gender else 'TẮT (Mặc định)'}")
    print(f"[*] CHẾ ĐỘ VAD  : {'KÍCH HOẠT (Ngưỡng ' + str(args.vad_threshold) + ', đệm ' + str(args.vad_pad) + 'ms)' if args.vad else 'TẮT (Bảo toàn 100% âm thanh gốc, chống nuốt chữ)'}")
    print(f"[*] SMART SPLIT : {'KÍCH HOẠT (Ngắt ngập ngừng >= ' + str(args.max_pause) + 's, Max ' + str(args.max_duration) + 's, chuẩn CapCut)' if args.smart_split else 'TẮT (Giữ nguyên segment gốc)'}")
    print(f"[*] LỌC ẢO GIÁC : KÍCH HOẠT (Loại bỏ câu có độ tin cậy < {args.min_confidence*100:.0f}%, lọc nhạc no_speech={args.no_speech_threshold})")
    print(f"[*] NGÔN NGỮ    : {lang_req.upper() if lang_req else 'Tự động phát hiện'}")
    print("=" * 70)

    # Khởi động bộ đo lường tài nguyên phần cứng NCKH
    profiler = HardwareProfiler() if HardwareProfiler else None
    if profiler:
        profiler.start()

    # Tự động tối ưu prompt và VAD nếu chọn tiếng Trung
    initial_prompt = args.initial_prompt
    if lang_req in ["zh", "chinese"] and not initial_prompt:
        initial_prompt = "以下是普通话的简体中文句子，正确使用标点符号。"
        print(f"[*] PROMPT TIẾNG TRUNG: Tự động kích hoạt (Mồi chữ Giản thể & Dấu câu chuẩn)")

    # 1. Khởi tạo mô hình
    print("\n[1/3] Đang nạp mô hình Faster-Whisper...")
    t0 = time.time()
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=4, num_workers=1)
    except Exception as e:
        print(f"[!] GPU không khả dụng ({e}). Chuyển sang chạy trên CPU...")
        device = "cpu"
        compute_type = "int8"
        model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=4, num_workers=1)
    t_load = time.time() - t0
    print(f"      ✓ Nạp mô hình hoàn tất ({t_load:.2f}s)")

    # 2. Suy luận ASR thuần túy (Transcribe)
    print("\n[2/3] Đang nhận dạng âm thanh...")
    t_start = time.time()
    
    # Cấu hình VAD chuẩn hóa theo năng lượng âm học (không nuốt quãng nghỉ ngập ngừng)
    vad_params = dict(
        min_silence_duration_ms=250,
        speech_pad_ms=args.vad_pad,       # 200ms thay vì 500ms
        threshold=args.vad_threshold,     # 0.45 thay vì 0.25 để lọc tiếng thở/tạp âm
    ) if args.vad else None

    segments_iter, info = model.transcribe(
        media_path,
        language=lang_req,
        initial_prompt=initial_prompt,
        beam_size=args.beam_size,
        word_timestamps=args.word_timestamps,
        vad_filter=args.vad,
        vad_parameters=vad_params,
        temperature=[0.0, 0.2],
        no_speech_threshold=args.no_speech_threshold,
        condition_on_previous_text=True,  # Giữ mạch văn bản liên tục giữa các câu
    )

    detected_lang = info.language
    lang_prob = info.language_probability
    total_duration = info.duration
    print(f"      ✓ Ngôn ngữ nhận diện : {detected_lang.upper()} (Độ tin cậy: {lang_prob*100:.1f}%)")
    print(f"      ✓ Thời lượng âm thanh : {total_duration:.2f}s")

    # Nạp mảng audio để phân tích âm học F0 / Gender (nếu người dùng bật cờ --gender)
    audio_full = None
    if args.detect_gender:
        try:
            audio_full = decode_audio(media_path, sampling_rate=16000)
        except Exception as e:
            print(f"      [!] Không thể nạp waveform để tính F0 ({e})")

    # 3. Thu thập câu thoại nguyên bản (Không qua các bộ cắt regex hay xóa từ vấp)
    cues = []
    print("\n[3/3] Trích xuất danh sách phân đoạn câu thoại:")
    if args.detect_gender:
        print("-" * 88)
        print(f"{'#':<4} {'TIMESTAMPS':<22} | {'CONF':<7} | {'GIỚI TÍNH':<10} | {'LỜI THOẠI NGUYÊN BẢN'}")
        print("-" * 88)
    else:
        print("-" * 75)
        print(f"{'#':<4} {'TIMESTAMPS':<22} | {'ĐỘ TIN CẬY':<11} | {'LỜI THOẠI NGUYÊN BẢN'}")
        print("-" * 75)

    cue_idx = 1
    for seg in segments_iter:
        raw_text = seg.text.strip()
        if not raw_text:
            continue
        
        # Áp dụng thuật toán Smart Splitting (ngắt câu theo dấu câu và ngập ngừng)
        split_chunks = split_segment_into_cues(
            seg,
            total_duration=total_duration,
            max_pause=args.max_pause,
            max_duration=args.max_duration,
            enable_split=args.smart_split,
        )

        for chunk in split_chunks:
            clean_text = chunk["text"]
            if not clean_text:
                continue

            start_sec = chunk["start"]
            end_sec = chunk["end"]
            dur = round(end_sec - start_sec, 2)
            conf = chunk["confidence"]

            # Bộ lọc loại bỏ ảo giác, tiếng thở và tạp âm độ tin cậy thấp:
            if conf < args.min_confidence:
                continue
            words_in_text = clean_text.split()
            if len(words_in_text) <= 1 and dur < 0.8 and conf < 0.50:
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
                "speaker": "Speaker 1",
                "speaker_id": "SPEAKER_00",
                "speaker_color": "#22c55e",
            }

            # 2. Acoustic Gender Classification & F0 (Chỉ đưa vào khi bật --gender):
            if args.detect_gender:
                f0_val = 0.0
                gender_val = "U"
                if audio_full is not None and len(audio_full) > 0:
                    samp_start = int(start_sec * 16000)
                    samp_end = min(len(audio_full), int(end_sec * 16000))
                    if samp_end > samp_start:
                        sub_audio = audio_full[samp_start:samp_end]
                        f0_val = round(estimate_pitch_f0(sub_audio, sr=16000), 1)
                        gender_val = classify_gender(f0_val)
                cue_item["acoustic_gender"] = gender_val
                cue_item["pitch_f0_hz"] = f0_val

            cues.append(cue_item)
            cue_idx += 1

    # Chuẩn hóa đơn điệu mốc thời gian toàn cục (Khử triệt để 100% hiện tượng chồng lấn thời gian)
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

    # Hiển thị bảng câu thoại sau khi đã chuẩn hóa mốc thời gian
    for c in cues:
        ts_str = f"[{c['start']:6.2f}s → {c['end']:6.2f}s]"
        conf_val = c.get("confidence", 0.8)
        if args.detect_gender:
            f0_display = c.get("pitch_f0_hz", 0.0)
            g_display = c.get("acoustic_gender", "U")
            gender_desc = f"{g_display} ({f0_display:4.1f}Hz)" if f0_display > 0 else f"{g_display}"
            print(f"{c['id']:<4} {ts_str:<22} | {conf_val*100:5.1f}% | {gender_desc:<10} | {c['text']}")
        else:
            print(f"{c['id']:<4} {ts_str:<22} | {conf_val*100:5.1f}%      | {c['text']}")

    t_infer = time.time() - t_start
    hw_stats = profiler.stop() if profiler else {}

    print("-" * (88 if args.detect_gender else 75))
    print(f"[✓] Tổng số câu nhận dạng : {len(cues)} câu")
    print(f"[✓] Thời gian suy luận    : {t_infer:.2f}s (Tốc độ: {total_duration / max(0.1, t_infer):.1f}x thời gian thực)")

    # 4. Lưu kết quả chuẩn Data Contract cho Module 2 (MT) & Module 3 (TTS)
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
        "diarization": {
            "total_speakers": 1,
            "speakers": [{"id": "SPEAKER_00", "label": "Speaker 1", "color": "#22c55e"}]
        }
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(contract_payload, f, ensure_ascii=False, indent=2)

    save_to_srt(cues, str(output_srt))

    print(f"\n[+] ĐÃ XUẤT TỆP JSON BÀN GIAO CHO MT & TTS : {output_json}")
    print(f"[+] ĐÃ XUẤT TỆP PHỤ ĐỀ NGUỒN SRT          : {output_srt}")
    print("======================================================================\n")

    # 5. Bảng báo cáo khoa học NCKH toàn diện (VRAM, RAM, CPU, RTF, Tốc độ)
    if profiler:
        profiler.print_academic_report(
            task_name="Nhận dạng giọng nói thuần (ASR)",
            model_name=f"Faster-Whisper {model_size.upper()} ({device.upper()} - {compute_type})",
            media_duration_sec=total_duration,
        )


if __name__ == "__main__":
    main()
