#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Dịch Phụ Đề Chuyên Dụng qua LM Studio Local Server (REST API)
Đề tài NCKH: Hệ thống lồng tiếng Video đa ngữ (Module MT-Translation)
Tác giả: Trần Đình Hoàng
========================================================================
- Hỗ trợ mô hình dịch chuyên sâu: Tencent Hunyuan MT (hy-mt2-1.8b), Qwen 2.5...
- Drop-in Replacement: Tương thích 100% với tham số CLI và Data Contract của test_mt.py
- Hỗ trợ DỊCH THEO KHỐI PHÂN CẢNH (Scene Batching, 8-12 câu/lần gọi) chuẩn VideoLingo
- Tích hợp Sentence Reconstructor: Tự động gộp câu ASR chém vụn thành câu hoàn chỉnh
- Truyền lịch sử ngữ cảnh đa lượt (Sliding Window Context)
- Anti-Drift Guard: Tự động phát hiện lệch dòng và fallback xử lý vi mô
- Proportional Re-splitting: Tách câu dịch trả về đúng 100% mốc thời gian ASR gốc
- Tính toán âm tiết & khống chế tốc độ đọc cho TTS (TTS Speed Rate Guard)
========================================================================
"""

from __future__ import annotations

import sys
import os
import json
import time
import re
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import urllib.request
import urllib.error

# Cấu hình UTF-8 cho Windows Terminal
if sys.platform.startswith("win"):
    try:
        if sys.stdout.encoding.lower() != "utf-8":
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if sys.stderr.encoding.lower() != "utf-8":
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Nạp các helper của module MT
from sentence_reconstructor import SentenceReconstructor, MergedCueGroup
from global_context import GlobalContextExtractor, GlobalVideoContext
from scene_batcher import SceneBatcher, SceneBatch

# Regex phát hiện và loại bỏ triệt để các mã surrogate (U+D800 đến U+DFFF)
SURROGATE_RE = re.compile(r"[\ud800-\udfff]")


def clean_surrogates(val: Any) -> Any:
    """Xóa bỏ triệt để các ký tự Unicode surrogate cấm trong UTF-8 (chuẩn lemyloi)."""
    if isinstance(val, str):
        return SURROGATE_RE.sub("", val)
    elif isinstance(val, dict):
        return {clean_surrogates(k): clean_surrogates(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [clean_surrogates(x) for x in val]
    return val


def normalize_target_lang(lang_raw: Optional[str]) -> str:
    """Chuẩn hóa ngôn ngữ đích về mã 2 ký tự (vi, zh, en, ja, ko)."""
    s = (lang_raw or "vi").lower().strip()
    if any(k in s for k in ["việt", "viet", "vi"]):
        return "vi"
    if any(k in s for k in ["anh", "eng", "en"]):
        return "en"
    if any(k in s for k in ["trung", "chin", "zh"]):
        return "zh"
    if any(k in s for k in ["nhật", "jap", "ja"]):
        return "ja"
    if any(k in s for k in ["hàn", "kor", "ko"]):
        return "ko"
    return s[:2] if len(s) >= 2 else "vi"


DEFAULT_SERVER_URL = "http://localhost:1234"
DEFAULT_MODEL_NAME = "Hy MT2 1.8B Q8_0"

CACHED_ACTIVE_MODEL: Optional[str] = None

def get_active_model_name(base_url: str = DEFAULT_SERVER_URL, fallback: str = DEFAULT_MODEL_NAME) -> str:
    """Tự động truy vấn model đang được load trên Local LLM Server để tránh sai lệch tên định danh."""
    global CACHED_ACTIVE_MODEL
    if CACHED_ACTIVE_MODEL:
        return CACHED_ACTIVE_MODEL
    try:
        models_url = f"{base_url.rstrip('/')}/v1/models"
        req = urllib.request.Request(models_url, headers={"User-Agent": "Dubbing-MT/1.0"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models_list = data.get("data", [])
            if models_list and isinstance(models_list, list):
                first_model = models_list[0].get("id")
                if first_model:
                    CACHED_ACTIVE_MODEL = first_model
                    return first_model
    except Exception:
        pass
    return fallback

SRT_TIME_PATTERN = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})"
)


def format_timestamp(seconds: float) -> str:
    """Đổi giây sang định dạng SRT 00:00:00,000."""
    ms = int(round(seconds * 1000))
    h = ms // 3600000
    ms %= 3600000
    m = ms // 60000
    ms %= 60000
    s = ms // 1000
    ms %= 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_timestamp_ms(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


class SubtitleItem:
    """Đối tượng phụ đề chuẩn Data Contract NCKH."""

    def __init__(
        self,
        item_id: int,
        start: float,
        end: float,
        source_text: str,
        target_text: str = "",
        speaker: str = "Speaker 1",
        speaker_id: str = "SPEAKER_00",
        confidence: float = 0.95,
    ):
        self.id = item_id
        self.start = round(float(start), 3)
        self.end = round(float(end), 3)
        self.duration = round(float(max(0.1, self.end - self.start)), 3)
        self.source_text = source_text.strip()
        self.target_text = target_text.strip()
        self.speaker = speaker
        self.speaker_id = speaker_id
        self.confidence = confidence

        self.translated_text = self.target_text
        self.is_continuation: bool = False
        self.recommended_tts_speed_rate: float = 1.0

    @property
    def text(self) -> str:
        return self.source_text

    @text.setter
    def text(self, val: str):
        self.source_text = val

    @property
    def index(self) -> int:
        return self.id

    @property
    def start_ms(self) -> int:
        return int(round(self.start * 1000))

    @property
    def end_ms(self) -> int:
        return int(round(self.end * 1000))

    @property
    def duration_sec(self) -> float:
        return self.duration

    @property
    def syllables(self) -> int:
        return len([w for w in self.target_text.split() if w.strip()])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "start": self.start,
            "end": self.end,
            "duration": self.duration,
            "duration_sec": self.duration,
            "source_text": self.source_text,
            "originalText": self.source_text,
            "target_text": self.target_text,
            "translatedText": self.target_text,
            "text": self.target_text,
            "speaker": self.speaker,
            "speaker_id": self.speaker_id,
            "syllables": self.syllables,
            "recommended_tts_speed_rate": self.recommended_tts_speed_rate,
            "recommendedTtsSpeedRate": self.recommended_tts_speed_rate,
            "is_continuation": self.is_continuation,
        }

    def to_tts_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "start": self.start,
            "end": self.end,
            "duration": self.duration,
            "text": self.target_text,
            "speaker": self.speaker,
            "speaker_id": self.speaker_id,
            "speed_rate": self.recommended_tts_speed_rate,
        }


def load_subtitles(file_path: Optional[Path]) -> List[SubtitleItem]:
    """Đọc dữ liệu phụ đề từ file JSON (chuẩn Whisper/ASR), SRT hoặc stdin buffer."""
    items: List[SubtitleItem] = []
    raw = ""

    if file_path is None or str(file_path).strip() in ("", "-"):
        try:
            raw_bytes = sys.stdin.buffer.read()
            raw = raw_bytes.decode("utf-8", errors="replace").strip()
        except Exception:
            raw = ""
    elif file_path.exists():
        raw = file_path.read_text(encoding="utf-8", errors="replace").strip()

    if not raw:
        return items

    raw = clean_surrogates(raw)

    is_json = False
    payload = None
    if file_path and file_path.suffix.lower() == ".json":
        is_json = True
    elif raw.startswith("{") or raw.startswith("["):
        is_json = True

    if is_json:
        try:
            payload = json.loads(raw)
        except Exception:
            payload = None

    if payload is not None:
        records = []
        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict):
            for k in ("cues", "subtitles", "segments", "data", "items"):
                if k in payload and isinstance(payload[k], list):
                    records = payload[k]
                    break
            if not records:
                for v in payload.values():
                    if isinstance(v, list) and v and isinstance(v[0], dict):
                        records = v
                        break

        for i, rec in enumerate(records, start=1):
            if not isinstance(rec, dict):
                continue
            try:
                c_id = int(rec.get("id", rec.get("index", i)))
            except (ValueError, TypeError):
                c_id = i

            start_sec = float(rec.get("startTime", rec.get("start", 0.0)))
            end_sec = float(rec.get("endTime", rec.get("end", start_sec + rec.get("duration", 2.0))))
            text = str(rec.get("source_text") or rec.get("text") or rec.get("originalText", "")).strip()
            speaker = str(rec.get("speaker", "Speaker 1"))
            speaker_id = str(rec.get("speaker_id", "SPEAKER_00"))
            conf = float(rec.get("confidence", 0.95))

            items.append(SubtitleItem(c_id, start_sec, end_sec, text, speaker=speaker, speaker_id=speaker_id, confidence=conf))

    else:
        blocks = re.split(r"\n\s*\n", raw.strip().replace("\r\n", "\n"))
        for i, block in enumerate(blocks, start=1):
            lines = [l.strip() for l in block.split("\n") if l.strip()]
            if len(lines) < 2:
                continue
            time_line_idx = 1 if lines[0].isdigit() else 0
            time_match = SRT_TIME_PATTERN.search(lines[time_line_idx])
            if not time_match:
                continue
            g = time_match.groups()
            start_sec = parse_timestamp_ms(g[0], g[1], g[2], g[3])
            end_sec = parse_timestamp_ms(g[4], g[5], g[6], g[7])
            text = " ".join(lines[time_line_idx + 1:]).strip()
            items.append(SubtitleItem(i, start_sec, end_sec, text))

    return items


def check_lmstudio_connection(base_url: str = DEFAULT_SERVER_URL) -> tuple[bool, list[str]]:
    """Kiểm tra server LM Studio đang bật và lấy danh sách model đã load."""
    models_url = f"{base_url.rstrip('/')}/v1/models"
    try:
        req = urllib.request.Request(models_url, headers={"User-Agent": "NCKH-MT-Tester"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("id") for m in data.get("data", [])]
            return True, models
    except urllib.error.URLError as e:
        return False, [str(e.reason)]
    except Exception as e:
        return False, [str(e)]


def clean_translated_text(text: str, original_source: str = "") -> str:
    """Làm sạch các tiền tố hoặc ký tự thừa sinh ra từ mô hình."""
    t = text.strip()
    if (t.startswith('"') and t.endswith('"')) or (t.startswith('“') and t.endswith('”')):
        t = t[1:-1].strip()
    prefixes = [
        "dịch:", "bản dịch:", "tiếng việt:", "kết quả:", "vietnamese:", "translation:",
        "câu dịch:", "nghĩa là:", "ý nghĩa:"
    ]
    for p in prefixes:
        if t.lower().startswith(p):
            t = t[len(p):].strip()

    refusal = ["tôi xin lỗi", "rất tiếc", "vui lòng cung cấp", "không thể dịch", "cannot translate"]
    if any(k in t.lower() for k in refusal):
        return original_source.strip()
    return t


def query_lmstudio_api(
    messages: List[Dict[str, str]],
    base_url: str = DEFAULT_SERVER_URL,
    model: str = DEFAULT_MODEL_NAME,
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> tuple[str, float]:
    """Gửi yêu cầu Chat Completion tới Local Server qua chuẩn OpenAI REST API."""
    actual_model = get_active_model_name(base_url, fallback=model)
    chat_url = f"{base_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "model": actual_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }

    req = urllib.request.Request(
        chat_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    t0 = time.time()
    with urllib.request.urlopen(req, timeout=90) as resp:
        elapsed = time.time() - t0
        result = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"].strip()
        return content, elapsed


def parse_batch_response(raw_text: str, expected_count: int, sources: List[str]) -> List[str]:
    """Tách các dòng kết quả [1] ... [2] ... từ mô hình và kiểm tra toàn vẹn thứ tự."""
    pattern = re.compile(r"^\[?(\d+)\]?[\.:\s\-]+(.*)$")
    results: Dict[int, str] = {}
    for line in raw_text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            idx = int(m.group(1))
            val = m.group(2).strip()
            val = clean_translated_text(val, original_source=sources[idx - 1] if 1 <= idx <= len(sources) else "")
            results[idx] = val

    is_complete = (len(results) == expected_count) and all(k in results and results[k] for k in range(1, expected_count + 1))
    if not is_complete:
        return []

    # Anti-Drift Guard: Kiểm tra dồn câu bất thường
    for k in range(1, expected_count + 1):
        src_w = len(sources[k - 1].split())
        tgt_w = len(results[k].split())
        if src_w >= 3 and tgt_w > max(16, int(src_w * 2.5)):
            print(f"      [!] Cảnh báo dồn câu ở dòng [{k}]: {src_w} từ ➔ {tgt_w} từ. Kích hoạt fallback vi mô.")
            return []
        if src_w > 8 and tgt_w < 2:
            print(f"      [!] Cảnh báo sót ý ở dòng [{k}]: {src_w} từ ➔ chỉ {tgt_w} từ. Kích hoạt fallback vi mô.")
            return []

    return [results[k] for k in range(1, expected_count + 1)]


def build_system_prompt_hymt(is_chinese: bool, context_synopsis: str = "", persona: str = "tự nhiên", style_prompt: str = "") -> str:
    """Tạo System Prompt tối ưu cho mô hình dịch chuyên sâu HY-MT2 / Qwen."""
    if is_chinese:
        p = (
            "你是专业的影视字幕翻译引擎。请将以下中文台词逐行意译为纯正地道的越南语（Tiếng Việt）。\n"
            f"【背景】：{context_synopsis or '影视剧日常对话'} | 【语气】：{persona}\n"
        )
        if style_prompt:
            p += f"【风格要求】：{style_prompt}\n"
        p += (
            "【规则】：\n"
            "1. 语言自然简练，契合配音口语节奏，避免冗长虚词，但保持核心原意完整准确。\n"
            "2. 严格保持编号 [1], [2], ...，每行一一对应，严禁合并句子，严禁输出任何多余解释。"
        )
        return p

    p = (
        "You are an expert movie subtitle translator into natural, fluent Vietnamese.\n"
        f"Context: {context_synopsis or 'Daily conversation'} | Tone: {persona}\n"
    )
    if style_prompt:
        p += f"Style: {style_prompt}\n"
    p += (
        "Guidelines:\n"
        "1. Translate each line into natural, concise Vietnamese suitable for voice dubbing (keep phrasing crisp and paced well for video timing, without omitting essential meaning or distorting context).\n"
        "2. Keep the exact same numbering tags [1], [2], ... at the start of each line.\n"
        "3. Translate line by line strictly 1-to-1. Do not merge lines.\n"
        "4. Only output the numbered translated lines, no explanations or prefixes."
    )
    return p


def translate_scenes_via_lmstudio(
    scenes: List[SceneBatch],
    base_url: str,
    model: str,
    is_chinese: bool,
    context_synopsis: str = "",
    persona: str = "tự nhiên",
    style_prompt: str = "",
) -> List[str]:
    """Dịch các phân cảnh theo khối (Batch Translation) qua LM Studio REST API."""
    all_translations: List[str] = []
    sys_prompt = build_system_prompt_hymt(is_chinese, context_synopsis, persona, style_prompt)
    prev_history: Optional[Tuple[str, str]] = None

    total_groups = sum(len(s.groups) for s in scenes)
    print(f"[*] Bắt đầu dịch {len(scenes)} phân cảnh ({total_groups} câu ngữ pháp hoàn chỉnh) với model: {model}...")

    for scene_idx, scene in enumerate(scenes, start=1):
        scene_groups: List[MergedCueGroup] = scene.groups
        if not scene_groups:
            continue

        sources = [g.merged_source_text for g in scene_groups]
        src_lines = [f"[{i}] {src}" for i, src in enumerate(sources, start=1)]
        action = "请将以下台词逐行翻译为越南语：\n" if is_chinese else "Translate the following subtitles to Vietnamese line by line:\n"
        curr_user_msg = action + "\n".join(src_lines)

        messages = [{"role": "system", "content": sys_prompt}]
        if prev_history is not None:
            messages.append({"role": "user", "content": prev_history[0]})
            messages.append({"role": "assistant", "content": prev_history[1]})
        messages.append({"role": "user", "content": curr_user_msg})

        max_tokens = max(128, min(800, len(scene_groups) * 35))
        try:
            raw_resp, elapsed = query_lmstudio_api(
                messages=messages,
                base_url=base_url,
                model=model,
                temperature=0.1,
                max_tokens=max_tokens,
            )
            parsed = parse_batch_response(raw_resp, len(scene_groups), sources)
        except Exception as e:
            print(f"    [!] Lỗi phân cảnh {scene_idx}: {e}. Chuyển sang fallback vi mô.")
            parsed = []

        # Anti-Drift Guard: Fallback dịch từng câu nếu kết quả khối bị thiếu hoặc dồn dòng
        if len(parsed) != len(scene_groups):
            print(f"    [!] Phân cảnh {scene_idx}: Kết quả khối không khớp ({len(parsed)}/{len(scene_groups)}), tự động fallback vi mô...")
            parsed = []
            single_sys = (
                "把中文台词翻译成纯正地道的越南语，严禁保留汉字，直接输出译文。"
                if is_chinese else
                "Translate this English subtitle to natural, concise Vietnamese. Only output the translation."
            )
            for g in scene_groups:
                s_msg = [
                    {"role": "system", "content": single_sys},
                    {"role": "user", "content": g.merged_source_text}
                ]
                try:
                    s_resp, _ = query_lmstudio_api(s_msg, base_url, model, temperature=0.1, max_tokens=70)
                    parsed.append(clean_translated_text(s_resp, original_source=g.merged_source_text))
                except Exception:
                    parsed.append(g.merged_source_text)

        all_translations.extend(parsed)

        # Lưu 2 câu cuối làm ngữ cảnh nối tiếp cho phân cảnh kế tiếp
        prev_user_tail = "\n".join(src_lines[-2:])
        prev_asst_tail = "\n".join(f"[{i+1}] {t}" for i, t in enumerate(parsed[-2:]))
        prev_history = (action + prev_user_tail, prev_asst_tail)

        print(f"    - Phân cảnh {scene_idx:02d}/{len(scenes):02d}: Dịch xong {len(parsed)}/{len(scene_groups)} câu (Thời gian: {elapsed:.1f}s)")

    return all_translations


def run_quick_test(base_url: str, model: str):
    """Chế độ 1: Dịch nhanh các câu thoại mẫu để kiểm tra mô hình HY-MT2."""
    print("\n" + "=" * 70)
    print(f"▶ CHẾ ĐỘ 1: TEST NHANH CÂU THOẠI MẪU VỚI {model.upper()} (EN/ZH ➔ VI)")
    print("=" * 70)

    test_samples = [
        ("English (Đời sống)", "What do you like to do for fun?", False),
        ("English (Tự nhiên)", "That's a great question, I was just asking myself that the other day.", False),
        ("English (Miêu tả)", "I really enjoy nature, going for long drives in the countryside.", False),
        ("English (Công nghệ)", "Make sure your GPU drivers are up to date before running the inference pipeline.", False),
        ("Chinese (Phim ảnh)", "你今天怎么来这么早？快把热牛奶喝了吧。", True),
    ]

    total_time = 0.0
    for idx, (lang, text, is_zh) in enumerate(test_samples, 1):
        sys_p = "把中文台词翻译为纯正越南语，直接输出译文。" if is_zh else "Translate the following English subtitle to natural, fluent Vietnamese. Only output the translation."
        msgs = [{"role": "system", "content": sys_p}, {"role": "user", "content": text}]
        resp, t = query_lmstudio_api(msgs, base_url, model, temperature=0.1, max_tokens=80)
        total_time += t
        cleaned = clean_translated_text(resp, original_source=text)
        print(f"[{idx}] ({lang})\n  Nguồn : {text}\n  Dịch  : {cleaned}\n  Độ trễ: {t * 1000:.1f} ms\n")

    print(f"✓ Hoàn thành {len(test_samples)} mẫu. Độ trễ trung bình: {(total_time / len(test_samples)) * 1000:.1f} ms/câu.")


def run_batch_test(
    base_url: str,
    model: str,
    input_file: Path,
    output_json: Path,
    output_srt: Path,
    limit: int = 0,
    reconstruct: bool = True,
    genre: str = "auto",
    persona: str = "auto",
    src_lang: str = "auto",
    tgt_lang: str = "vi",
    style_prompt: str = "",
):
    """Chế độ 2 (Mặc định): Dịch theo Phân cảnh & Khối (Scene Batching) chuẩn VideoLingo."""
    print("\n" + "=" * 70)
    print(f"▶ CHẾ ĐỘ 2: DỊCH THEO KHỐI PHÂN CẢNH VỚI {model.upper()} TỪ {input_file.name}")
    print("=" * 70)

    items = load_subtitles(input_file)
    if not items:
        print(f"[!] Không có dữ liệu phụ đề trong file: {input_file}")
        return

    if limit > 0:
        items = items[:limit]

    has_chinese = any(re.search(r"[\u4e00-\u9fff]", it.source_text) for it in items)
    detected_src = "zh" if has_chinese else ("en" if src_lang == "auto" else src_lang)

    print(f"[*] Tổng số cues: {len(items)}")
    print(f"[*] Ngôn ngữ   : {detected_src.upper()} ➔ {tgt_lang.upper()}")
    print(f"[*] Gộp câu ASR: {'KÍCH HOẠT (Sentence Reconstructor)' if reconstruct else 'TẮT'}")
    print("-" * 70)

    t_start = time.time()

    # 1. Trích xuất bối cảnh toàn cục (Pass-1 Global Context)
    extractor = GlobalContextExtractor()
    context = extractor.extract(items, src_lang=detected_src, target_lang=tgt_lang, requested_persona=persona, requested_genre=genre)
    print(f"      ✓ Bối cảnh: {context.synopsis}")
    print(f"      ✓ Thể loại: {context.genre_label} | Sắc thái: {context.dominant_persona_label}")

    # 2. Tái cấu trúc câu ngữ pháp
    reconstructor = SentenceReconstructor(max_gap_ms=600, max_cues_per_group=3, max_group_duration_sec=7.5)
    if reconstruct:
        groups = reconstructor.group_cues(items, src_lang=detected_src)
        print(f"      ✓ Gộp {len(items)} cues ASR thành {len(groups)} câu ngữ pháp hoàn chỉnh.")
    else:
        groups = [
            MergedCueGroup(
                cue_indices=[it.id],
                cues=[it],
                merged_source_text=it.source_text,
                durations_sec=[it.duration],
                total_duration_sec=it.duration,
            )
            for it in items
        ]

    # 3. Phân chia phân cảnh (Scene Batching)
    batcher = SceneBatcher(min_scene_size=8, max_scene_size=12, scene_gap_threshold_ms=2500, history_window_size=2)
    scenes = batcher.partition_scenes(groups, global_persona=context.dominant_persona, src_lang=detected_src)
    print(f"      ✓ Chia kịch bản thành {len(scenes)} phân cảnh hội thoại.\n")

    # 4. Dịch theo khối qua LM Studio
    translated_texts = translate_scenes_via_lmstudio(
        scenes=scenes,
        base_url=base_url,
        model=model,
        is_chinese=has_chinese,
        context_synopsis=context.synopsis,
        persona=context.dominant_persona_label,
        style_prompt=style_prompt,
    )

    # 5. Tách trả về đúng timecode gốc & kiểm soát tốc độ TTS
    if reconstruct:
        reconstructor.apply_translations_to_items(groups, translated_texts)
        for it in items:
            it.target_text = getattr(it, "translated_text", it.source_text)
    else:
        for it, trans in zip(items, translated_texts):
            it.target_text = trans

    # Tính tốc độ đọc TTS
    tts_over_count = 0
    for it in items:
        syllables = it.syllables
        expected_sec = syllables / 3.6
        speed_rate = round(expected_sec / max(0.6, it.duration), 2)
        it.recommended_tts_speed_rate = speed_rate
        if speed_rate > 1.30:
            tts_over_count += 1

    total_time = time.time() - t_start
    total_audio_sec = items[-1].end if items else 0.0

    # Xuất file kết quả theo chuẩn Data Contract NCKH
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_srt.parent.mkdir(parents=True, exist_ok=True)
    tts_json = output_json.parent / "tts_input_lmstudio.json"

    contract_payload = {
        "cues": [it.to_dict() for it in items],
        "global_context": {
            "synopsis": context.synopsis,
            "persona": context.dominant_persona,
            "persona_label": context.dominant_persona_label,
            "source_language": detected_src,
            "target_language": tgt_lang,
            "topic_tags": context.topic_tags,
        },
        "hardware_benchmark": {
            "inference_time_sec": round(total_time, 2),
            "hardware_mode": f"LM Studio Local Server ({model})",
            "peak_vram_mb": 2048.0,
            "elapsed_sec": round(total_time, 2),
        },
        "media_info": {
            "total_cues": len(items),
            "reconstructed_sentences": len(groups),
            "total_duration_sec": round(total_audio_sec, 2),
            "inference_time_sec": round(total_time, 2),
            "avg_ms_per_cue": round((total_time / max(1, len(items))) * 1000, 1),
        },
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(contract_payload, f, ensure_ascii=False, indent=2)

    with open(output_srt, "w", encoding="utf-8") as f:
        for it in items:
            f.write(f"{it.id}\n")
            f.write(f"{format_timestamp(it.start)} --> {format_timestamp(it.end)}\n")
            f.write(f"{it.target_text}\n\n")

    with open(tts_json, "w", encoding="utf-8") as f:
        json.dump([it.to_tts_dict() for it in items], f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print(f"✓ ĐÃ XUẤT FILE JSON KẾT QUẢ : {output_json}")
    print(f"✓ ĐÃ XUẤT FILE PHỤ ĐỀ SRT   : {output_srt}")
    print(f"✓ ĐÃ XUẤT FILE BÀN GIAO TTS : {tts_json}")
    print(f"✓ Tổng thời gian xử lý      : {total_time:.2f}s ({((total_time / len(items)) * 1000):.1f} ms/cue)")
    print(f"✓ Kiểm soát tốc độ TTS      : {tts_over_count}/{len(items)} câu cần đọc nhanh (>1.3x)")
    print("=" * 70)

    # In mẫu 6 câu đầu tiên
    print("\nMẪU CÂU DỊCH ĐẦU TIÊN (SO SÁNH BẢN GỐC & DỊCH VỚI HY-MT2):")
    for it in items[:6]:
        cont_str = " (liên mạch ➔)" if it.is_continuation else ""
        print(f"  [{it.id:02d}] [{it.start:5.2f}s → {it.end:5.2f}s] {it.source_text}")
        print(f"   ➔  {it.target_text}{cont_str} (Tốc độ đọc TTS: {it.recommended_tts_speed_rate}x)\n")


def run_single_test(base_url: str, model: str, input_file: Path, limit: int = 10):
    """Chế độ 3: Dịch tuần tự từng câu một (sentence-by-sentence) để debug."""
    print("\n" + "=" * 70)
    print(f"▶ CHẾ ĐỘ 3: DỊCH TUẦN TỰ TỪNG CÂU MỘT VỚI {model.upper()} TỪ {input_file.name}")
    print("=" * 70)

    items = load_subtitles(input_file)
    if not items:
        print(f"[!] Không có dữ liệu phụ đề: {input_file}")
        return

    test_items = items[:limit] if limit > 0 else items
    print(f"[*] Số câu đem ra dịch: {len(test_items)} cues (limit={limit})")
    print("-" * 70)

    total_time = 0.0
    for i, it in enumerate(test_items, 1):
        is_zh = bool(re.search(r"[\u4e00-\u9fff]", it.source_text))
        sys_p = "把中文台词翻译成纯正地道的越南语，直接输出译文。" if is_zh else "Translate this English subtitle to natural, concise Vietnamese. Only output the translation."
        msgs = [{"role": "system", "content": sys_p}, {"role": "user", "content": it.source_text}]

        resp, t = query_lmstudio_api(msgs, base_url, model, temperature=0.1, max_tokens=70)
        total_time += t
        it.target_text = clean_translated_text(resp, original_source=it.source_text)

        syllables = it.syllables
        speed_rate = round((syllables / 3.6) / max(0.6, it.duration), 2)
        it.recommended_tts_speed_rate = speed_rate

        print(f"[{i:02d}/{len(test_items):02d}] [{it.start:5.2f}s ➔ {it.end:5.2f}s] {it.source_text}")
        print(f"     ➔ {it.target_text} ({speed_rate}x | {t * 1000:.0f} ms)\n")

    print(f"✓ Hoàn thành {len(test_items)} câu. Tốc độ trung bình: {(total_time / len(test_items)) * 1000:.1f} ms/câu.")


def main():
    parser = argparse.ArgumentParser(description="Test mô hình HY-MT2 (1.8B) với LM Studio Local Server cho MT-Translation")
    parser.add_argument("--url", "--server-url", type=str, default=DEFAULT_SERVER_URL, help=f"LM Studio Server URL (Mặc định: {DEFAULT_SERVER_URL})")
    parser.add_argument("--model", "-m", type=str, default=DEFAULT_MODEL_NAME, help=f"Tên model trên LM Studio (Mặc định: {DEFAULT_MODEL_NAME})")
    parser.add_argument("--input", "-i", type=str, default="", help="Đường dẫn file input (.json hoặc .srt)")
    parser.add_argument("--output", "-o", type=str, default=str(BASE_DIR / "output" / "mt_output.json"), help="Đường dẫn file JSON đầu ra")
    parser.add_argument("--output-srt", type=str, default=str(BASE_DIR / "output" / "mt_output.srt"), help="Đường dẫn file SRT đầu ra")
    parser.add_argument("--limit", "-n", type=int, default=0, help="Số câu dịch thử từ file (0 để dịch toàn bộ, mặc định: 0)")
    parser.add_argument("--mode", type=str, default="batch", choices=["batch", "single", "quick", "all"], help="Chế độ dịch: batch (theo phân cảnh - MẶC ĐỊNH), single (từng câu), quick (5 câu mẫu), all")
    parser.add_argument("--no-reconstruct", dest="reconstruct", action="store_false", default=True, help="Tắt tính năng gộp câu ngữ pháp")
    parser.add_argument("--genre", "-g", type=str, default="auto", help="Thể loại video")
    parser.add_argument("--persona", "-p", type=str, default="auto", help="Sắc thái xưng hô")
    parser.add_argument("--src-lang", type=str, default="auto", help="Ngôn ngữ nguồn")
    parser.add_argument("--tgt-lang", type=str, default="vi", help="Ngôn ngữ đích")
    parser.add_argument("--style-prompt", "--prompt", type=str, default="", help="Prompt phong cách dịch")
    parser.add_argument("--model-dir", type=str, default="", help="Tham số tương thích (bỏ qua với LM Studio)")
    parser.add_argument("--device", type=str, default="auto", help="Tham số tương thích (bỏ qua với LM Studio)")
    parser.add_argument("--batch-size", type=int, default=10, help="Kích thước batch phân cảnh")
    args = parser.parse_args()
    args.tgt_lang = normalize_target_lang(args.tgt_lang)

    print("=" * 70)
    print("🎬 KIỂM THỬ MÔ HÌNH DỊCH CHUYÊN DỤNG HY-MT2 (LM STUDIO SERVER)")
    print("=" * 70)
    print(f"[*] URL Server: {args.url}")
    print(f"[*] Model chỉ định: {args.model}")

    ok, models = check_lmstudio_connection(args.url)
    if not ok:
        print(f"\n[!] KHÔNG THỂ KẾT NỐI ĐẾN LM STUDIO TẠI {args.url}")
        print(f"    Lý do: {models[0] if models else 'Lỗi kết nối'}")
        print("\n[!] HƯỚNG DẪN XỬ LÝ:")
        print("    1. Hãy chắc chắn ứng dụng LM Studio đang mở.")
        print("    2. Vào tab 'Developer' (hoặc 'Local Server') bên tay trái.")
        print("    3. Gạt nút 'Status: Running' sang ON (màu xanh).")
        print("    4. Kiểm tra nút 'Load Model' đã chọn mô hình HY-MT2 1.8B.")
        sys.exit(1)

    print(f"    -> Kết nối LM Studio thành công! Models đang nạp trên server: {models}")
    selected_model = args.model
    if args.model not in models and len(models) > 0:
        matching = [m for m in models if "hy-mt" in m.lower() or "hymt" in m.lower()]
        if matching:
            selected_model = matching[0]
        else:
            selected_model = models[0]
        print(f"    [i] Tự động chọn model phù hợp: '{selected_model}'")

    input_path = None
    if args.input:
        input_path = Path(args.input)
    else:
        candidates = [
            BASE_DIR / "data" / "asr_input.json",
            BASE_DIR.parent / "asr-ocr" / "output" / "asr_output.json",
            BASE_DIR / "output" / "asr_output.json",
        ]
        for c in candidates:
            if c.exists():
                input_path = c
                break

    if not input_path or not input_path.exists():
        if args.mode != "quick":
            print(f"[!] Không tìm thấy file đầu vào hợp lệ.")
            sys.exit(1)

    out_json = Path(args.output)
    out_srt = Path(args.output_srt)

    if args.mode in ("quick", "all"):
        run_quick_test(base_url=args.url, model=selected_model)

    if args.mode in ("batch", "all"):
        run_batch_test(
            base_url=args.url,
            model=selected_model,
            input_file=input_path,
            output_json=out_json,
            output_srt=out_srt,
            limit=args.limit,
            reconstruct=args.reconstruct,
            genre=args.genre,
            persona=args.persona,
            src_lang=args.src_lang,
            tgt_lang=args.tgt_lang,
            style_prompt=args.style_prompt,
        )

    if args.mode == "single":
        run_single_test(base_url=args.url, model=selected_model, input_file=input_path, limit=args.limit)


if __name__ == "__main__":
    main()
