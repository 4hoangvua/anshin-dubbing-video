# -*- coding: utf-8 -*-
"""
================================================================================
MODULE 1B: TRÍCH XUẤT PHỤ ĐỀ VIDEO HARD-SUB OCR (RAPIDOCR EVENT-DRIVEN)
Đề tài NCKH: Hệ thống lồng tiếng Video đa ngữ AI Local
Kế thừa & Nâng cấp theo kiến trúc chuẩn dự án lemyloi-dichvideos
================================================================================
Kiến trúc 2-Tier Pipeline:
  Tier A (Fast Scanner):
    - TextPrescanner: Quét mẫu video tự động xác định ngưỡng sáng và phát hiện Watermark/Logo tĩnh.
    - TextMaskExtractor: Lọc hình thái học Connected Components để tách nét chữ ra khỏi nền video.
    - Temporal Mask Similarity: So sánh biến đổi nét chữ qua Jaccard IoU.
  Tier B (Heavy OCR):
    - Kích hoạt RapidOCR (PP-OCRv6 ONNX) DUY NHẤT 1 LẦN cho mỗi sự kiện phụ đề hoàn chỉnh.
    - Chọn khung hình sắc nét nhất (Laplacian Variance cực đại) hoặc Temporal Ink Fusion.
    - Smart Cue Deduplication: Gộp tự động các câu trùng lặp do phân mảnh khung hình.
================================================================================
"""

from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import json
import os
import re
import sys
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

# Giới hạn số luồng OpenCV để không chiếm dụng 100% CPU
cv2.setNumThreads(2)

# Đảm bảo in tiếng Việt trên console Windows không bị lỗi font/mã hóa
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from profiler import HardwareProfiler
except ImportError:
    HardwareProfiler = None


# ==============================================================================
# 1. TIỆN ÍCH CHỌN VÙNG ROI & ĐỊNH DẠNG MỐC THỜI GIAN
# ==============================================================================

def format_srt_time(seconds: float) -> str:
    """Đổi số giây sang định dạng SRT chuẩn HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def save_to_srt(cues: List[Dict[str, Any]], filepath: str) -> None:
    """Lưu phụ đề nguồn ra tệp .srt chuẩn."""
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        for c in cues:
            f.write(f"{c['id']}\n")
            f.write(f"{format_srt_time(c['start'])} --> {format_srt_time(c['end'])}\n")
            f.write(f"{c['text']}\n\n")


def select_roi_interactive(video_path: str, default_roi: Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
    """Mở cửa sổ OpenCV cho phép người dùng kéo chuột chọn vùng phụ đề trực quan."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return default_roi

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * 2))
    ret, frame = cap.read()
    if not ret or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        return default_roi

    h, w = frame.shape[:2]
    window_title = "CHON VUNG PHU DE (ROI) - Keo chuot -> SPACE/ENTER de bat dau (ESC de dung mac dinh)"

    dx, dy, dw, dh = int(default_roi[0] * w), int(default_roi[1] * h), int(default_roi[2] * w), int(default_roi[3] * h)
    preview = frame.copy()
    cv2.rectangle(preview, (dx, dy), (dx + dw, dy + dh), (0, 255, 0), 2)
    cv2.putText(preview, "Vung goi y mac dinh (Nhan ESC neu muon dung vung nay)", (dx + 10, dy - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

    try:
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, min(w, 1024), min(h, 600))
        r = cv2.selectROI(window_title, preview, fromCenter=False, showCrosshair=True)
        cv2.destroyAllWindows()

        rx, ry, rw, rh = r
        if rw > 10 and rh > 10:
            norm_roi = (round(rx / w, 4), round(ry / h, 4), round(rw / w, 4), round(rh / h, 4))
            print(f"[*] Đã chọn vùng ROI: x={norm_roi[0]}, y={norm_roi[1]}, w={norm_roi[2]}, h={norm_roi[3]}")
            return norm_roi
    except Exception as e:
        print(f"[!] Không thể mở cửa sổ đồ họa GUI ({e}). Dùng vùng mặc định.")

    print(f"[*] Dùng vùng ROI mặc định: {default_roi}")
    return default_roi


# ==============================================================================
# 2. BỘ TRÍCH XUẤT MẶT NẠ CHỮ & PHÁT HIỆN LOGO TĨNH (LEMYLOI SPEC)
# ==============================================================================

class TextPrescanner:
    """Quét mẫu video để tự động xác định ngưỡng sáng và phát hiện Watermark/Logo tĩnh."""

    @staticmethod
    def prescan(video_path: str, rx: int, ry: int, rw: int, rh: int, sample_count: int = 25) -> Dict[str, Any]:
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total_frames <= 0:
            cap.release()
            return {"threshold": 180, "static_mask": None}

        step = max(1, total_frames // sample_count)
        samples = []
        for idx in range(0, total_frames, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if ok and frame is not None:
                crop = frame[ry:ry + rh, rx:rx + rw]
                if crop.size > 0:
                    samples.append(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))

        cap.release()

        if not samples:
            return {"threshold": 180, "static_mask": None}

        # Ước lượng ngưỡng sáng (85th percentile, clamp 150 - 225)
        all_pixels = np.concatenate([f.ravel() for f in samples])
        estimated_thresh = int(np.percentile(all_pixels, 85)) if all_pixels.size > 0 else 180
        estimated_thresh = max(150, min(225, estimated_thresh))

        # Phát hiện watermark đứng yên liên tục (>= 80% số frame)
        binary_masks = [cv2.threshold(f, estimated_thresh, 255, cv2.THRESH_BINARY)[1] for f in samples]
        accumulated = np.mean(binary_masks, axis=0) if binary_masks else np.zeros_like(samples[0])
        static_mask = (accumulated >= (0.80 * 255)).astype(np.uint8) * 255

        return {"threshold": estimated_thresh, "static_mask": static_mask}


class TextMaskExtractor:
    """
    Trích xuất mặt nạ nét chữ bằng Connected Components:
    - Loại bỏ mảng nền video chuyển động lớn (>35% diện tích).
    - Loại bỏ các hạt nhiễu nhỏ (<12px).
    - Khử logo/watermark tĩnh đã xác định từ trước.
    """

    def __init__(self, threshold: int = 180, static_mask: Optional[np.ndarray] = None):
        self.threshold = threshold
        self.static_mask = static_mask

    def extract_mask(self, gray_crop: np.ndarray) -> np.ndarray:
        if gray_crop.size == 0:
            return gray_crop

        h, w = gray_crop.shape[:2]
        if w > 480:
            scale = 480.0 / w
            gray_crop = cv2.resize(gray_crop, (480, int(h * scale)), interpolation=cv2.INTER_AREA)

        _, mask = cv2.threshold(gray_crop, self.threshold, 255, cv2.THRESH_BINARY)

        if self.static_mask is not None and self.static_mask.size > 0:
            resized_static = cv2.resize(self.static_mask, (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_NEAREST)
            mask = cv2.bitwise_and(mask, cv2.bitwise_not(resized_static))

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 2))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        clean_mask = np.zeros_like(mask)
        img_area = mask.shape[0] * mask.shape[1]

        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            box_w = stats[i, cv2.CC_STAT_WIDTH]
            box_h = stats[i, cv2.CC_STAT_HEIGHT]

            if area < 12 or area > (img_area * 0.35):
                continue
            aspect_ratio = box_w / max(1, box_h)
            if aspect_ratio > 25 or aspect_ratio < 0.05:
                continue

            clean_mask[labels == i] = 255

        return clean_mask


def calculate_mask_similarity(m1: np.ndarray, m2: np.ndarray) -> float:
    """Tính độ tương đồng Jaccard IoU giữa 2 mặt nạ nét chữ (0.0 đến 1.0)."""
    if m1.shape != m2.shape:
        m2 = cv2.resize(m2, (m1.shape[1], m1.shape[0]), interpolation=cv2.INTER_NEAREST)

    intersection = np.count_nonzero(cv2.bitwise_and(m1, m2))
    union = np.count_nonzero(cv2.bitwise_or(m1, m2))
    if union == 0:
        return 1.0 if intersection == 0 else 0.0
    return float(intersection) / float(union)


# ==============================================================================
# 3. LÀM SẠCH VĂN BẢN VÀ GỘP CÂU TRÙNG LẶP (DEDUPLICATION)
# ==============================================================================

def clean_ocr_text(text: str) -> str:
    """Làm sạch văn bản OCR và chuẩn hóa Unicode NFC theo chuẩn lemyloi."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[,\.?!;:—\-_ ]+", "", text)
    text = re.sub(r"[,、]+$", "", text)
    return text.strip()


def text_similarity(s1: str, s2: str) -> float:
    """Tính độ tương đồng chuỗi văn bản không dấu câu."""
    s1_norm = re.sub(r"[^\w\u4e00-\u9fff]", "", s1.lower())
    s2_norm = re.sub(r"[^\w\u4e00-\u9fff]", "", s2.lower())
    if not s1_norm or not s2_norm:
        return 0.0
    return SequenceMatcher(None, s1_norm, s2_norm).ratio()


def merge_consecutive_duplicate_cues(cues: List[Dict[str, Any]], max_gap_sec: float = 0.65) -> List[Dict[str, Any]]:
    """Gộp các câu phụ đề liên tiếp bị trùng lặp hoặc phân mảnh do nhấp nháy chuyển cảnh."""
    if not cues:
        return []

    merged = []
    curr = dict(cues[0])

    for nxt in cues[1:]:
        gap = float(nxt["start"]) - float(curr["end"])
        sim = text_similarity(curr["text"], nxt["text"])

        # Nếu cùng nội dung (tương đồng >= 75%) và cách nhau dưới 0.65s -> Gộp làm 1
        if sim >= 0.75 and gap <= max_gap_sec:
            curr["end"] = nxt["end"]
            curr["confidence"] = max(curr["confidence"], nxt["confidence"])
            if len(nxt["text"]) > len(curr["text"]):
                curr["text"] = nxt["text"]
                curr["source_text"] = nxt["text"]
        else:
            curr["duration"] = round(float(curr["end"]) - float(curr["start"]), 2)
            merged.append(curr)
            curr = dict(nxt)

    curr["duration"] = round(float(curr["end"]) - float(curr["start"]), 2)
    merged.append(curr)

    for idx, c in enumerate(merged, start=1):
        c["id"] = idx

    return merged


# ==============================================================================
# 4. EVENT-DRIVEN VIDEO OCR PIPELINE (LEMYLOI SPEC)
# ==============================================================================

class VideoOCRPipeline:
    """
    Bộ máy OCR phụ đề Video hai tầng (Detector-First & Event-Driven):
    - Tầng 1: Theo dõi biến đổi nét chữ qua Jaccard Mask IoU.
    - Tầng 2: RapidOCR ONNX chỉ chạy đúng 1 lần khi câu phụ đề kết thúc.
    """

    def __init__(self, lang: str = "zh", scan_fps: float = 3.5):
        self.scan_fps = scan_fps
        self.lang = lang
        self._rapidocr_engine = None
        self._init_rapidocr()

    def _init_rapidocr(self):
        """Khởi tạo mô hình RapidOCR với tham số khống chế tài nguyên chuẩn lemyloi."""
        params = {
            "Global.log_level": "error",
            "Global.text_score": 0.35,
            "Det.limit_side_len": 736,
            "Det.unclip_ratio": 1.8,
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
        }

        print("[*] Đang khởi tạo mô hình RapidOCR (PP-OCRv6 ONNX, CPU Threads=2)...")
        try:
            from rapidocr import RapidOCR
            try:
                self._rapidocr_engine = RapidOCR(params=params)
            except Exception:
                self._rapidocr_engine = RapidOCR()
            print("[✓] RapidOCR Engine đã nạp thành công.")
        except Exception:
            try:
                from rapidocr_onnxruntime import RapidOCR
                try:
                    self._rapidocr_engine = RapidOCR(params=params)
                except Exception:
                    self._rapidocr_engine = RapidOCR()
                print("[✓] RapidOCR (onnxruntime) đã nạp thành công.")
            except Exception as e2:
                print(f"[!] Không thể nạp RapidOCR: {e2}")
                self._rapidocr_engine = None

    def _parse_rapid_output(self, res) -> Tuple[List[str], float]:
        """Trích xuất danh sách văn bản và độ tin cậy từ đầu ra của RapidOCR."""
        if not res or self._rapidocr_engine is None:
            return [], 0.0

        txts = getattr(res, "txts", None)
        scores = getattr(res, "scores", None)
        boxes = getattr(res, "boxes", None)

        lines: List[str] = []
        valid_scores: List[float] = []

        if txts is not None and scores is not None:
            items = list(zip(txts, scores, boxes if boxes is not None else [None] * len(txts)))
            if boxes is not None and len(boxes) > 0:
                try:
                    items.sort(key=lambda item: item[2][0][1] if item[2] is not None and len(item[2]) > 0 else 0)
                except Exception:
                    pass

            for t, s, _ in items:
                text_str = str(t).strip()
                score_val = float(s) if s is not None else 0.80
                if text_str and score_val >= 0.35:
                    lines.append(text_str)
                    valid_scores.append(score_val)

        elif isinstance(res, (tuple, list)):
            raw_items = res[0] if isinstance(res, tuple) and len(res) > 0 else res
            if isinstance(raw_items, list):
                for item in raw_items:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        txt_val = str(item[1]).strip()
                        score_val = float(item[2]) if len(item) >= 3 and item[2] is not None else 0.80
                        if txt_val and score_val >= 0.35:
                            lines.append(txt_val)
                            valid_scores.append(score_val)

        avg_score = float(np.mean(valid_scores)) if valid_scores else 0.80
        return lines, avg_score

    def run_ocr_on_crop(self, image_crop: np.ndarray) -> Tuple[str, float]:
        """Chạy OCR lên một ảnh crop."""
        if self._rapidocr_engine is None or image_crop.size == 0:
            return "", 0.0
        try:
            res = self._rapidocr_engine(image_crop)
            lines, avg_score = self._parse_rapid_output(res)
            full_text = clean_ocr_text(" ".join(lines))
            return full_text, round(avg_score, 4)
        except Exception:
            return "", 0.0

    def process_video(self, video_path: str, roi: Tuple[float, float, float, float]) -> Tuple[List[Dict[str, Any]], float]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise FileNotFoundError(f"Không thể mở file video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        orig_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration_sec = total_frames / orig_fps
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        rx = int(roi[0] * w)
        ry = int(roi[1] * h)
        rw = int(roi[2] * w)
        rh = int(roi[3] * h)

        print("\n" + "=" * 65)
        print(f"[*] VIDEO         : {os.path.basename(video_path)} ({w}x{h}, {duration_sec:.2f}s)")
        print(f"[*] ROI CROP      : [{rx}, {ry}, {rw}, {rh}] ({rw}x{rh} px)")

        # 1. Prescan lấy ngưỡng sáng & lọc Watermark
        print("[*] [1/3] Đang phân tích mẫu Video (Prescanning)...")
        prescan_info = TextPrescanner.prescan(video_path, rx, ry, rw, rh)
        threshold = prescan_info["threshold"]
        static_mask = prescan_info["static_mask"]
        print(f"      • Ngưỡng sáng ước lượng : {threshold}")
        print(f"      • Khử Watermark/Logo    : {'Đã bật' if static_mask is not None else 'Không có'}")

        extractor = TextMaskExtractor(threshold=threshold, static_mask=static_mask)

        frame_step = max(1, int(round(orig_fps / self.scan_fps)))
        effective_fps = orig_fps / frame_step
        print(f"[*] [2/3] Quét phụ đề hướng sự kiện (~{effective_fps:.1f} FPS)...")
        print("=" * 65)

        raw_cues = []
        cue_idx = 1

        prev_text_mask = None
        event_active = False
        event_start_time = 0.0
        event_frames = []

        frame_count = 0
        pbar_width = 30

        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            frame_count += 1

            for _ in range(frame_step - 1):
                if not cap.grab():
                    break
                frame_count += 1

            current_time = (frame_count - 1) / orig_fps

            crop = frame[ry:ry + rh, rx:rx + rw]
            gray_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            text_mask = extractor.extract_mask(gray_crop)

            text_pixel_count = np.count_nonzero(text_mask)
            has_text = text_pixel_count > 60

            laplacian_var = cv2.Laplacian(gray_crop, cv2.CV_64F).var()

            if prev_text_mask is not None and has_text:
                mask_sim = calculate_mask_similarity(text_mask, prev_text_mask)
            else:
                mask_sim = 0.0

            # QUẢN LÝ SỰ KIỆN PHỤ ĐỀ (EVENT-DRIVEN STATE MACHINE)
            if has_text and not event_active:
                event_active = True
                event_start_time = current_time
                event_frames = [(laplacian_var, current_time, crop)]

            elif event_active and has_text and mask_sim >= 0.45:
                event_frames.append((laplacian_var, current_time, crop))

            elif event_active and (not has_text or mask_sim < 0.45):
                event_end_time = current_time
                event_dur = event_end_time - event_start_time

                if event_dur >= 0.30 and event_frames:
                    best_crop = max(event_frames, key=lambda x: x[0])[2]
                    text, conf = self.run_ocr_on_crop(best_crop)

                    if text and len(text) >= 1:
                        raw_cues.append({
                            "id": cue_idx,
                            "start": round(event_start_time, 2),
                            "end": round(event_end_time, 2),
                            "duration": round(event_dur, 2),
                            "text": text,
                            "source_text": text,
                            "confidence": conf,
                            "source_type": "OCR",
                            "speaker": "Speaker 1",
                            "speaker_id": "SPEAKER_00",
                            "speaker_color": "#22c55e",
                        })
                        cue_idx += 1

                if has_text and mask_sim < 0.45:
                    event_active = True
                    event_start_time = current_time
                    event_frames = [(laplacian_var, current_time, crop)]
                else:
                    event_active = False
                    event_frames = []

            prev_text_mask = text_mask

            progress = min(1.0, current_time / max(duration_sec, 0.001))
            filled = int(pbar_width * progress)
            bar = "█" * filled + "░" * (pbar_width - filled)
            sys.stdout.write(f"\r  [{bar}] {progress * 100:5.1f}% ({current_time:.1f}s / {duration_sec:.1f}s)")
            sys.stdout.flush()

        if event_active and event_frames:
            event_end_time = duration_sec
            event_dur = event_end_time - event_start_time
            if event_dur >= 0.30:
                best_crop = max(event_frames, key=lambda x: x[0])[2]
                text, conf = self.run_ocr_on_crop(best_crop)
                if text and len(text) >= 1:
                    raw_cues.append({
                        "id": cue_idx,
                        "start": round(event_start_time, 2),
                        "end": round(event_end_time, 2),
                        "duration": round(event_dur, 2),
                        "text": text,
                        "source_text": text,
                        "confidence": conf,
                        "source_type": "OCR",
                        "speaker": "Speaker 1",
                        "speaker_id": "SPEAKER_00",
                        "speaker_color": "#22c55e",
                    })

        cap.release()

        print("\n\n[*] [3/3] Đang tối ưu & gộp các câu trùng lặp...")
        final_cues = merge_consecutive_duplicate_cues(raw_cues)

        print("-" * 65)
        print(f"{'#':<4} {'TIMESTAMPS':<22} | {'VĂN BẢN QUÉT ĐƯỢC'}")
        print("-" * 65)
        for c in final_cues:
            ts = f"[{c['start']:6.2f}s → {c['end']:6.2f}s]"
            print(f"{c['id']:<4} {ts:<22} | {c['text']}")
        print("-" * 65)

        return final_cues, duration_sec


# ==============================================================================
# 5. HÀM MAIN
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="NCKH Video OCR Subtitle Extractor (lemyloi spec)")
    parser.add_argument("video", nargs="?", default=None, help="Đường dẫn file video đầu vào")
    parser.add_argument("--roi", default=None, help="Tọa độ ROI: 'x,y,w,h' (tỉ lệ từ 0.0 đến 1.0)")
    parser.add_argument("--no-gui", action="store_true", help="Không mở cửa sổ kéo chuột, dùng ROI mặc định")
    parser.add_argument("--fps", type=float, default=3.5, help="Tốc độ quét scan FPS (mặc định 3.5)")
    parser.add_argument("--lang", default="zh", help="Ngôn ngữ nhận dạng (zh, en, vi, ja, ko)")
    parser.add_argument("-o", "--output", default="output/ocr_output.json", help="Đường dẫn file JSON đầu ra")
    parser.add_argument("--output-srt", default=None, help="Đường dẫn file SRT đầu ra")
    args = parser.parse_args()

    if args.video:
        video_path = args.video
    else:
        candidates = ["data/input_video.mp4", "data/sample.mp4", "data/video.mp4"]
        video_path = next((c for c in candidates if os.path.exists(c)), "data/input_video.mp4")

    if not os.path.exists(video_path):
        print(f"[!] Không tìm thấy file video: {video_path}")
        return

    default_roi = (0.05, 0.75, 0.90, 0.22)

    if args.roi:
        try:
            parts = [float(p.strip()) for p in args.roi.split(",")]
            if len(parts) == 4:
                roi = (parts[0], parts[1], parts[2], parts[3])
            else:
                roi = default_roi
        except Exception:
            roi = default_roi
    elif not args.no_gui:
        roi = select_roi_interactive(video_path, default_roi)
    else:
        roi = default_roi

    profiler = HardwareProfiler() if HardwareProfiler else None
    if profiler:
        profiler.start()

    pipeline = VideoOCRPipeline(lang=args.lang, scan_fps=args.fps)
    cues, video_duration = pipeline.process_video(video_path, roi)

    hw_stats = profiler.stop() if profiler else {}

    output_json = Path(args.output)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_srt = Path(args.output_srt) if args.output_srt else output_json.with_suffix(".srt")

    contract_payload = {
        "cues": cues,
        "hardware_benchmark": hw_stats,
        "media_info": {
            "duration_sec": round(video_duration, 2),
            "language": args.lang,
        },
        "model_info": {
            "name": f"RapidOCR PP-OCRv6 ({args.lang})",
            "roi": roi,
            "scan_fps": args.fps,
        },
        "diarization": {
            "total_speakers": 1,
            "speakers": [{"id": "SPEAKER_00", "label": "Speaker 1", "color": "#22c55e"}]
        }
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(contract_payload, f, ensure_ascii=False, indent=2)
    save_to_srt(cues, str(output_srt))

    print(f"\n[✓] Đã lưu kết quả JSON : {output_json}")
    print(f"[✓] Đã lưu file phụ đề SRT: {output_srt}")


if __name__ == "__main__":
    main()
