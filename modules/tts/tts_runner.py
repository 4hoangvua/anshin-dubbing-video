#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Module Tạo Giọng Đọc Thuần VieNeu-TTS (Natural Local TTS)
========================================================
Tạo giọng nói tiếng Việt tự nhiên từ danh sách phụ đề / câu thoại.
Không can thiệp thuật toán kéo giãn thời lượng hay làm méo tiếng.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List

BASE_DIR = Path(__file__).resolve().parent

# Tự động nạp site-packages cục bộ nếu có venv riêng của module
MODULE_VENV_SITE = BASE_DIR / ".venv" / "Lib" / "site-packages"
if MODULE_VENV_SITE.exists() and str(MODULE_VENV_SITE) not in sys.path:
    sys.path.insert(0, str(MODULE_VENV_SITE))

# Cấu hình UTF-8 cho Windows Console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import soundfile as sf
from vieneu_engine import VieNeuEngine


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="NCKH: VieNeu-TTS Voice Synthesis (Thuần tự nhiên)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-i", "--input",
        default="",
        help="Đường dẫn file JSON đầu vào từ MT/ASR",
    )
    parser.add_argument(
        "-o", "--output",
        default=str(BASE_DIR / "output" / "tts_output.json"),
        help="Đường dẫn file JSON tổng hợp danh sách audio đã sinh",
    )
    parser.add_argument(
        "--clips-dir",
        default=str(BASE_DIR / "output" / "clips"),
        help="Thư mục lưu các file âm thanh riêng lẻ (.wav)",
    )
    parser.add_argument(
        "--voice",
        default="Mai Anh",
        help="Tên giọng đọc (Mai Anh, Minh Đức, Thái Sơn, Xuân Vĩnh, Trúc Ly...)",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="Tốc độ đọc mặc định (1.0 = tự nhiên)",
    )
    parser.add_argument(
        "--max-speed",
        type=float,
        default=0.0,
        help="Giới hạn tốc độ đọc tối đa khi tự động co dãn (mặc định 0.0 = không giới hạn trần)",
    )
    parser.add_argument(
        "--auto-speed",
        action="store_true",
        help="Tự động tăng tốc nếu câu đọc dài hơn khung thời gian slot của câu (bỏ giới hạn 1.35x)",
    )
    parser.add_argument(
        "--stitch",
        action="store_true",
        help="Ghép toàn bộ các câu thoại vào trục thời gian video (output/dubbed_timeline.wav)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="Thiết bị thực thi (CPU / CUDA)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Giới hạn số câu để test nhanh (0 = toàn bộ)",
    )
    return parser.parse_args()


def load_cues(input_file: Path) -> List[Dict[str, Any]]:
    """Đọc dữ liệu câu thoại từ file JSON (chuẩn MT / ASR)."""
    with open(input_file, "r", encoding="utf-8", errors="replace") as f:
        data = json.load(f)

    if isinstance(data, dict):
        if "cues" in data:
            return data["cues"]
        elif "items" in data:
            return data["items"]
        return [data]
    elif isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def main() -> None:
    args = parse_arguments()

    # Tìm file đầu vào nếu không truyền qua -i
    input_path = None
    if args.input:
        input_path = Path(args.input)
    else:
        candidates = [
            BASE_DIR.parent / "mt-translation" / "output" / "tts_input.json",
            BASE_DIR.parent / "mt-translation" / "output" / "mt_output.json",
            BASE_DIR / "data" / "mt_input.json",
        ]
        for c in candidates:
            if c.exists():
                input_path = c
                break

    if not input_path or not input_path.exists():
        print(f"[!] Không tìm thấy file đầu vào. Vui lòng truyền đường dẫn qua -i.")
        sys.exit(1)

    cues = load_cues(input_path)
    if not cues:
        print(f"[!] Không có câu thoại nào trong file: {input_path}")
        sys.exit(1)

    if args.limit > 0:
        cues = cues[: args.limit]

    output_json = Path(args.output).resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    clips_dir = Path(args.clips_dir).resolve()
    clips_dir.mkdir(parents=True, exist_ok=True)

    print("=================================================================")
    print(f"[*] FILE ĐẦU VÀO : {input_path}")
    print(f"[*] GIỌNG ĐỌC    : {args.voice}")
    print(f"[*] THIẾT BỊ     : {args.device.upper()}")
    print(f"[*] SỐ CÂU       : {len(cues)} câu")
    print("=================================================================")

    # Khởi động Engine thuần
    engine = VieNeuEngine(engine_type="local", device=args.device)

    print(f"[*] Bắt đầu tạo giọng đọc cho {len(cues)} câu...")
    t0 = time.perf_counter()
    results: List[Dict[str, Any]] = []

    for idx, cue in enumerate(cues, start=1):
        cue_id = cue.get("id", idx)
        text = str(
            cue.get("text")
            or cue.get("target_text")
            or cue.get("tts_payload", {}).get("text_to_speak", "")
        ).strip()

        if not text:
            continue

        cue_speed = float(cue.get("speed", cue.get("recommended_tts_speed_rate", args.speed)))
        start_sec = float(cue.get("start", 0.0))
        end_sec = float(cue.get("end", start_sec + 2.0))
        slot_dur = max(0.2, end_sec - start_sec)

        cue_t0 = time.perf_counter()
        cue_voice = str(cue.get("voice") or args.voice)

        # Tự động điều chỉnh tốc độ nếu bật --auto-speed và cue_speed chưa được chỉ định khác 1.0
        if args.auto_speed and abs(cue_speed - 1.0) < 0.02:
            wav_raw = engine.synthesize(text=text, voice=cue_voice, speed=1.0)
            raw_dur = len(wav_raw) / engine.sample_rate
            if raw_dur > slot_dur:
                # Không giới hạn trần 2.0x, linh hoạt co dãn theo đúng thời lượng slot
                if args.max_speed > 0:
                    needed_speed = round(min(raw_dur / slot_dur, args.max_speed), 2)
                else:
                    needed_speed = round(raw_dur / slot_dur, 2)
                wav = engine.synthesize(text=text, voice=cue_voice, speed=needed_speed)
                cue_speed = needed_speed
            else:
                wav = wav_raw
        else:
            wav = engine.synthesize(text=text, voice=cue_voice, speed=cue_speed)

        elapsed = time.perf_counter() - cue_t0
        audio_dur = len(wav) / engine.sample_rate

        clip_name = f"cue_{cue_id:04d}.wav"
        clip_path = clips_dir / clip_name
        sf.write(str(clip_path), wav, engine.sample_rate)

        results.append({
            "id": cue_id,
            "start": start_sec,
            "end": end_sec,
            "text": text,
            "speed": cue_speed,
            "audio_file": str(clip_path),
            "audio_duration": round(audio_dur, 2),
            "synthesis_time": round(elapsed, 2),
        })

        preview_text = text if len(text) <= 35 else text[:32] + "..."
        speed_tag = f" @{cue_speed:.2f}x" if abs(cue_speed - 1.0) >= 0.02 else ""
        print(f"  [{idx}/{len(cues)}] {preview_text:<35} ➔ {audio_dur:.2f}s{speed_tag} ({elapsed:.2f}s)")

    total_time = time.perf_counter() - t0
    total_audio_sec = sum(r["audio_duration"] for r in results)

    # Lưu kết quả manifest
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    if args.stitch and results:
        from timeline_stitcher import TimelineStitcher
        dubbed_wav = output_json.parent / "dubbed_timeline.wav"
        max_limit_str = f"max={args.max_speed:.1f}x" if args.max_speed > 0 else "không giới hạn trần"
        print(f"[*] Đang ghép Master Timeline (bỏ giới hạn 2.0x, {max_limit_str})...")
        stitcher = TimelineStitcher(sample_rate=engine.sample_rate, max_speedup=args.max_speed if args.max_speed > 0 else None)
        for r in results:
            data, _ = sf.read(r["audio_file"], dtype="float32")
            r["wav"] = data
        final_sec = stitcher.stitch(results, str(dubbed_wav))
        print(f"[✓] Đã tạo file Master Timeline: {dubbed_wav} ({final_sec:.2f}s)")

    print("=================================================================")
    print(f"[✓] Đã tạo thành công {len(results)} file âm thanh.")
    print(f"[✓] Thư mục clips : {clips_dir}")
    print(f"[✓] File manifest : {output_json}")
    print(f"[✓] Tổng thời lượng âm thanh : {total_audio_sec:.2f}s | Sinh trong: {total_time:.2f}s")
    print("=================================================================")


if __name__ == "__main__":
    main()
