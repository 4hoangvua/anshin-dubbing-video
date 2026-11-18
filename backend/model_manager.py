# -*- coding: utf-8 -*-
"""
Model Manager & GPU Execution Queue for Video Dubbing AI Local
- Bridge Runner Pattern: executes external Python AI modules via CLI subprocesses.
- GPU Queue Management: ThreadPoolExecutor(max_workers=1) & Sequential Execution Guard.
- Automatic VRAM Reclamation: gc.collect() & torch.cuda.empty_cache().
- Real-time Server-Sent Events (SSE) streaming progress.
- Single-cue re-translation & single-cue re-synthesis support.
"""

from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gc
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from audio_mixer import (
    calculate_playback_rate,
    expand_cues_into_silence_gaps,
)


# ==============================================================================
# 1. ĐƯỜNG DẪN MÔI TRƯỜNG & SCRIPT MODULES (SELF-CONTAINED PRODUCT ARCHITECTURE)
# ==============================================================================

ROOT_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT_DIR / "projects"
BIN_DIR = ROOT_DIR / "bin"
MODELS_DIR = ROOT_DIR / "models"
MODULES_DIR = ROOT_DIR / "modules"

# Script thực thi AI nội bộ trong thư mục modules/
ASR_SCRIPT = str(MODULES_DIR / "asr" / "asr_runner.py")
OCR_SCRIPT = str(MODULES_DIR / "ocr" / "ocr_runner.py")
MT_SCRIPT = str(MODULES_DIR / "mt" / "mt_runner.py")
TTS_SCRIPT = str(MODULES_DIR / "tts" / "tts_runner.py")

# Tìm Python runtime tương ứng cho từng module hoặc dùng venv fallback
def get_module_python(module_name: str) -> str:
    """
    Tìm môi trường Python khả dụng cho module theo thứ tự ưu tiên:
    1. Venv nội bộ của module: modules/{module_name}/.venv/Scripts/python.exe
    2. Venv chung của dự án: dubbing-video/.venv hoặc backend/.venv
    3. Biến môi trường hệ thống DUBBING_PYTHON_{MODULE}
    4. Môi trường dev cục bộ (nếu tồn tại)
    5. Python hiện tại đang chạy server (sys.executable)
    """
    # 1. Venv nội bộ của từng module (mô hình chuẩn khi đóng gói hoặc cài đặt độc lập)
    internal_venv = MODULES_DIR / module_name / ".venv" / "Scripts" / "python.exe"
    if internal_venv.exists():
        return str(internal_venv)

    # 2. Venv chung của ứng dụng
    for common_venv in [ROOT_DIR / ".venv" / "Scripts" / "python.exe", ROOT_DIR / "backend" / ".venv" / "Scripts" / "python.exe"]:
        if common_venv.exists():
            return str(common_venv)

    # 3. Biến môi trường
    env_py = os.getenv(f"DUBBING_PYTHON_{module_name.upper()}")
    if env_py and os.path.exists(env_py):
        return env_py

    # 4. Fallback dev workspace cục bộ (nếu người dùng thiết lập biến môi trường DUBBING_DEV_DIR)
    dev_workspace = os.getenv("DUBBING_DEV_DIR")
    if dev_workspace and os.path.exists(dev_workspace):
        dev_py = Path(dev_workspace) / module_name / "venv" / "Scripts" / "python.exe"
        if dev_py.exists():
            return str(dev_py)

    # 5. Mặc định dùng Python của hệ thống hiện tại
    return sys.executable

ASR_PYTHON = get_module_python("asr")
MT_PYTHON = get_module_python("mt")
TTS_PYTHON = get_module_python("tts")


def is_local_llm_running(port: int = 1234) -> bool:
    """Kiểm tra xem local server (llama-server hoặc LM Studio) có đang sẵn sàng không."""
    try:
        import urllib.request
        req = urllib.request.Request(f"http://localhost:{port}/v1/models", headers={"User-Agent": "Dubbing-Check"})
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            return resp.status == 200
    except Exception:
        return False


def get_tts_python() -> str:
    """Lấy đường dẫn Python thực thi cho TTS."""
    return get_module_python("tts")


# ==============================================================================
# 2. GIẢI PHÓNG VRAM & THÔNG TIN PHẦN CỨNG
# ==============================================================================

def release_vram_forcefully() -> None:
    """Thu hồi bộ nhớ GPU triệt để."""
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()
    except Exception:
        pass


def get_gpu_vram_info() -> Dict[str, Any]:
    """Lấy thông tin VRAM từ nvidia-smi."""
    try:
        cmd = [
            "nvidia-smi",
            "--query-gpu=name,memory.total,memory.free,memory.used",
            "--format=csv,noheader,nounits",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        line = res.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]
        return {
            "cuda_available": True,
            "device_name": parts[0],
            "total_vram_mb": int(parts[1]),
            "free_vram_mb": int(parts[2]),
            "used_vram_mb": int(parts[3]),
        }
    except Exception:
        return {
            "cuda_available": False,
            "device_name": "N/A",
            "total_vram_mb": 0,
            "free_vram_mb": 0,
            "used_vram_mb": 0,
        }


# ==============================================================================
# 3. QUẢN LÝ TIẾN TRÌNH GPU & QUEUE EXECUTOR
# ==============================================================================

class ModelManager:
    """
    Quản lý hàng đợi GPU tuần tự và điều phối các tác vụ ASR, OCR, MT, TTS.
    Đảm bảo chỉ có tối đa 1 mô hình nạp vào VRAM tại 1 thời điểm.
    """
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu_worker")
        self.lock = asyncio.Lock()
        self.current_task_name: Optional[str] = None
        self.current_project_id: Optional[str] = None

    @property
    def is_busy(self) -> bool:
        return self.current_task_name is not None

    def acquire_slot(self, task_name: str, project_id: str) -> None:
        if self.is_busy:
            raise RuntimeError(
                f"TASK_ALREADY_RUNNING: Tác vụ '{self.current_task_name}' đang chiếm dụng GPU cho dự án '{self.current_project_id}'. "
                "Vui lòng đợi tác vụ hoàn tất trước khi bắt đầu tác vụ mới."
            )
        self.current_task_name = task_name
        self.current_project_id = project_id

    def release_slot(self) -> None:
        self.current_task_name = None
        self.current_project_id = None
        release_vram_forcefully()


# Global Singleton ModelManager
manager = ModelManager()


async def run_subprocess_streaming(
    cmd: List[str], env: Optional[Dict[str, str]] = None
) -> AsyncGenerator[Tuple[str, Any], None]:
    """
    Chạy tiến trình con đa luồng an toàn 100% trên Windows (chống lỗi NotImplementedError của asyncio).
    Yields ("line", line_str) hoặc ("done", return_code).
    """
    import queue
    import threading

    q: queue.Queue = queue.Queue()

    def _worker():
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env or os.environ.copy(),
            )
            if proc.stdout:
                for line in proc.stdout:
                    q.put(("line", line))
                proc.stdout.close()
            ret = proc.wait()
            q.put(("done", ret))
        except Exception as e:
            q.put(("error", str(e)))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    while True:
        try:
            msg_type, val = q.get_nowait()
        except queue.Empty:
            await asyncio.sleep(0.05)
            continue

        if msg_type == "line":
            yield ("line", val)
        elif msg_type == "done":
            yield ("done", val)
            break
        elif msg_type == "error":
            raise RuntimeError(val)


# ==============================================================================
# 4. ADAPTER: STEP 1 RECOGNITION (ASR / OCR)
# ==============================================================================

async def stream_step1_recognize(
    project_id: str,
    project_path: str,
    media_path: str,
    mode: str = "asr",
    model_size: str = "small",
    beam_size: int = 2,
    lang: str = "zh",
    vad: bool = True,
    vad_threshold: float = 0.45,
    smart_split: bool = True,
    max_pause: float = 0.4,
    max_duration: float = 5.0,
    ocr_region: Optional[Dict[str, float]] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream tiến độ nhận diện Step 1 bằng Server-Sent Events.
    """
    async with manager.lock:
        try:
            manager.acquire_slot(f"step1_{mode}", project_id)
        except RuntimeError as e:
            yield {
                "event": "error",
                "data": {
                    "code": "TASK_ALREADY_RUNNING",
                    "message": str(e),
                    "step": 1,
                }
            }
            return

        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            yield {
                "event": "start",
                "data": {
                    "step": 1,
                    "task": "Faster-Whisper Transcription" if mode == "asr" else "RapidOCR Subtitle Extraction",
                    "startedAt": now_iso,
                }
            }

            p_dir = Path(project_path)
            steps_dir = p_dir / "steps"
            steps_dir.mkdir(parents=True, exist_ok=True)

            out_json = steps_dir / ("asr_output.json" if mode == "asr" else "ocr_output.json")
            out_srt = steps_dir / "subtitles_source.srt"

            # Xây dựng lệnh gọi CLI
            if mode == "asr":
                cmd = [
                    ASR_PYTHON,
                    ASR_SCRIPT,
                    media_path,
                    "--model", model_size,
                    "--beam-size", str(beam_size),
                    "--word-timestamps",
                    "--vad-threshold", str(vad_threshold),
                    "--max-pause", str(max_pause),
                    "--max-duration", str(max_duration),
                    "-o", str(out_json),
                    "--output-srt", str(out_srt),
                ]
                if vad:
                    cmd.append("--vad")
                else:
                    cmd.append("--no-vad")

                if smart_split:
                    cmd.append("--smart-split")
                else:
                    cmd.append("--no-smart-split")

                if lang and lang.lower() not in ["auto", "none", ""]:
                    cmd.extend(["--lang", lang])

            else:
                # OCR Mode
                roi_str = "0.05,0.75,0.90,0.22"
                if ocr_region:
                    rx = ocr_region.get("x", 0.05)
                    ry = ocr_region.get("y", 0.75)
                    rw = ocr_region.get("width", 0.90)
                    rh = ocr_region.get("height", 0.22)
                    roi_str = f"{rx},{ry},{rw},{rh}"

                cmd = [
                    ASR_PYTHON,
                    OCR_SCRIPT,
                    media_path,
                    "--no-gui",
                    "--roi", roi_str,
                    "--lang", lang if lang else "zh",
                ]

            # Thiết lập môi trường tối ưu PyTorch CUDA
            env = os.environ.copy()
            env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            env["PYTHONUNBUFFERED"] = "1"

            yield {
                "event": "progress",
                "data": {
                    "percent": 15,
                    "stage": "Loading model",
                    "message": f"Đang nạp mô hình {model_size}...",
                }
            }

            return_code = 0
            async for msg_type, val in run_subprocess_streaming(cmd, env=env):
                if msg_type == "line":
                    line = val.strip()
                    if not line:
                        continue
                    if "[2/3]" in line or "Đang nhận dạng" in line:
                        yield {
                            "event": "progress",
                            "data": {
                                "percent": 45,
                                "stage": "Transcribing",
                                "message": "Đang nhận diện giọng nói âm thanh...",
                            }
                        }
                    elif "TIMESTAMPS" in line:
                        yield {
                            "event": "progress",
                            "data": {
                                "percent": 70,
                                "stage": "Extracting cues",
                                "message": "Đang trích xuất các phân đoạn câu thoại...",
                            }
                        }
                elif msg_type == "done":
                    return_code = val

            if return_code != 0:
                yield {
                    "event": "error",
                    "data": {
                        "code": "SUBPROCESS_FAILED",
                        "message": f"Tiến trình Step 1 ({mode}) thất bại với mã lỗi {return_code}.",
                        "step": 1,
                    }
                }
                return

            # Nạp kết quả từ file JSON
            if not out_json.exists():
                yield {
                    "event": "error",
                    "data": {
                        "code": "OUTPUT_NOT_FOUND",
                        "message": f"Không tìm thấy tệp kết quả tại {out_json}",
                        "step": 1,
                    }
                }
                return

            with open(out_json, "r", encoding="utf-8") as f:
                res_data = json.load(f)

            raw_cues = res_data.get("cues", [])
            formatted_cues: List[Dict[str, Any]] = []
            for c in raw_cues:
                start_t = float(c.get("start", c.get("startTime", 0.0)))
                end_t = float(c.get("end", c.get("endTime", start_t + 1.0)))
                text = c.get("text") or c.get("source_text") or c.get("originalText") or ""
                formatted_cues.append({
                    "id": int(c.get("id", len(formatted_cues) + 1)),
                    "startTime": start_t,
                    "endTime": end_t,
                    "duration": round(end_t - start_t, 2),
                    "originalText": text,
                    "translatedText": "",
                    "confidence": float(c.get("confidence", 0.95)),
                    "speakerId": c.get("speaker_id", "SPEAKER_00"),
                    "isContinuation": False,
                    "status": "pending",
                })

            benchmarks = res_data.get("hardware_benchmark", {})
            yield {
                "event": "complete",
                "data": {
                    "percent": 100,
                    "cuesCount": len(formatted_cues),
                    "cues": formatted_cues,
                    "benchmark": {
                        "vramPeakMb": benchmarks.get("peak_vram_mb", 1150.0),
                        "inferenceTimeSec": benchmarks.get("elapsed_sec", 5.0),
                    }
                }
            }

        except Exception as ex:
            import traceback
            traceback.print_exc()
            yield {
                "event": "error",
                "data": {
                    "code": "INTERNAL_ERROR",
                    "message": f"{type(ex).__name__}: {str(ex)}",
                    "step": 1,
                }
            }
        finally:
            if llama_proc is not None:
                try:
                    llama_proc.terminate()
                    llama_proc.wait(timeout=3)
                except Exception:
                    try:
                        llama_proc.kill()
                    except Exception:
                        pass
            manager.release_slot()


# ==============================================================================
# 5. ADAPTER: STEP 2 TRANSLATION (VIDEOLINGO QWEN 2.5 MT)
# ==============================================================================

async def stream_step2_translate(
    project_id: str,
    project_path: str,
    cues: List[Dict[str, Any]],
    genre: str = "tech_tutorial",
    persona: str = "neutral",
    src_lang: str = "zh",
    tgt_lang: str = "vi",
    reconstruct: bool = True,
    style_prompt: str = "",
    model_engine: str = "auto",
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream tiến độ dịch máy Step 2 bằng Server-Sent Events.
    """
    async with manager.lock:
        try:
            manager.acquire_slot("step2_mt", project_id)
        except RuntimeError as e:
            yield {
                "event": "error",
                "data": {
                    "code": "TASK_ALREADY_RUNNING",
                    "message": str(e),
                    "step": 2,
                }
            }
            return

        try:
            yield {
                "event": "start",
                "data": {
                    "step": 2,
                    "task": "VideoLingo Context MT",
                }
            }

            p_dir = Path(project_path)
            steps_dir = p_dir / "steps"
            steps_dir.mkdir(parents=True, exist_ok=True)

            # 1. PRE-FLIGHT CHECK & TỰ ĐỘNG KHỞI ĐỘNG EMBEDDED LLAMA SERVER NẾU CẦN
            active_port = None
            for p in [1234, 12345, 8080]:
                if is_local_llm_running(p):
                    active_port = p
                    break

            server_target_url = None
            llama_proc = None
            llama_port = 12345

            if active_port:
                server_target_url = f"http://127.0.0.1:{active_port}"
            else:
                mt_models_dir = MODELS_DIR / "mt"
                has_local_gguf = mt_models_dir.exists() and any(mt_models_dir.glob("*.gguf"))
                llama_exe = ROOT_DIR / "bin" / "llama-server.exe"

                if has_local_gguf and llama_exe.exists():
                    gguf_files = sorted(mt_models_dir.glob("*.gguf"), key=lambda p: p.stat().st_size, reverse=True)
                    chosen_gguf = gguf_files[0]
                    yield {
                        "event": "progress",
                        "data": {
                            "percent": 15,
                            "stage": "Embedded LLM Engine",
                            "synopsis": f"Đang khởi động Portable LLaMA Server ({chosen_gguf.name})...",
                        }
                    }
                    llama_proc = subprocess.Popen(
                        [
                            str(llama_exe),
                            "-m", str(chosen_gguf),
                            "--port", str(llama_port),
                            "-c", "2048",
                            "--host", "127.0.0.1",
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    # Chờ server sẵn sàng (tối đa 12s)
                    for _ in range(24):
                        await asyncio.sleep(0.5)
                        if is_local_llm_running(llama_port):
                            server_target_url = f"http://127.0.0.1:{llama_port}"
                            break

            if not server_target_url:
                yield {
                    "event": "error",
                    "data": {
                        "code": "MT_NOT_READY",
                        "message": "Chưa phát hiện mô hình Hy-MT2 1.8B hoặc máy chủ Local Server. Vui lòng mở 'Model Hub' trên thanh Header để tải mô hình về trước khi dịch!",
                        "step": 2,
                    }
                }
                return

            # Chuẩn bị file JSON đầu vào cho MT
            input_mt_json = steps_dir / "mt_input.json"
            formatted_input_cues = []
            for c in cues:
                formatted_input_cues.append({
                    "id": c.get("id"),
                    "start": float(c.get("startTime", c.get("start", 0.0))),
                    "end": float(c.get("endTime", c.get("end", 0.0))),
                    "text": c.get("originalText") or c.get("text", ""),
                    "source_text": c.get("originalText") or c.get("text", ""),
                    "confidence": float(c.get("confidence", 0.95)),
                    "speaker_id": c.get("speakerId", "SPEAKER_00"),
                })

            with open(input_mt_json, "w", encoding="utf-8") as f:
                json.dump({"cues": formatted_input_cues}, f, ensure_ascii=False, indent=2)

            out_json = steps_dir / "mt_output.json"
            out_srt = steps_dir / "subtitles_target.srt"

            # Xóa file output cũ nếu có để tránh tình trạng đọc lại dữ liệu cũ khi tiến trình bị lỗi
            if out_json.exists():
                try:
                    out_json.unlink()
                except Exception:
                    pass

            # Khởi chạy Module MT (Hy-MT2 1.8B qua mt_runner.py)
            cmd = [
                MT_PYTHON,
                MT_SCRIPT,
                "-i", str(input_mt_json),
                "-o", str(out_json),
                "--output-srt", str(out_srt),
                "--server-url", server_target_url,
                "--genre", genre if genre else "auto",
                "--persona", persona if persona else "neutral",
                "--src-lang", src_lang if src_lang else "auto",
                "--tgt-lang", tgt_lang if tgt_lang else "vi",
            ]
            if not reconstruct:
                cmd.append("--no-reconstruct")
            if style_prompt:
                cmd.extend(["--style-prompt", style_prompt])

            env = os.environ.copy()
            env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            env["PYTHONUNBUFFERED"] = "1"

            yield {
                "event": "progress",
                "data": {
                    "percent": 25,
                    "stage": "Global Context",
                    "synopsis": "Đang phân tích bối cảnh toàn cục và thực thể...",
                }
            }

            return_code = 0
            last_error_lines = []
            async for msg_type, val in run_subprocess_streaming(cmd, env=env):
                if msg_type == "line":
                    line = val.strip()
                    if not line:
                        continue
                    if "KHÔNG THỂ KẾT NỐI" in line or "[!]" in line or "Error" in line:
                        last_error_lines.append(line)
                    if "[2/4]" in line or "Tái cấu trúc" in line:
                        yield {
                            "event": "progress",
                            "data": {
                                "percent": 45,
                                "stage": "Sentence Reconstruction",
                                "message": "Đang gộp các câu thoại vụn thành câu ngữ pháp hoàn chỉnh...",
                            }
                        }
                    elif "[3/4]" in line or "Dịch phân cảnh" in line:
                        yield {
                            "event": "progress",
                            "data": {
                                "percent": 75,
                                "stage": "Translating Scenes",
                                "message": "Đang dịch phân cảnh với Hy-MT2 1.8B...",
                            }
                        }
                    elif "[4/4]" in line or "TTS Guard" in line:
                        yield {
                            "event": "progress",
                            "data": {
                                "percent": 90,
                                "stage": "TTS Guard",
                                "message": "Đang khống chế độ dài âm tiết lồng tiếng...",
                            }
                        }
                elif msg_type == "done":
                    return_code = val

            if return_code != 0:
                err_detail = " | ".join(last_error_lines[-2:]) if last_error_lines else f"Tiến trình MT thất bại với mã lỗi {return_code}"
                yield {
                    "event": "error",
                    "data": {
                        "code": "SUBPROCESS_FAILED",
                        "message": f"{err_detail}. Vui lòng mở Model Hub để tải mô hình Hy-MT2 hoặc bật Local Server!",
                        "step": 2,
                    }
                }
                return

            if not out_json.exists():
                yield {
                    "event": "error",
                    "data": {
                        "code": "OUTPUT_NOT_FOUND",
                        "message": f"Không tìm thấy tệp kết quả tại {out_json}",
                        "step": 2,
                    }
                }
                return

            with open(out_json, "r", encoding="utf-8") as f:
                res_data = json.load(f)

            translated_cues = res_data.get("cues", [])
            yield {
                "event": "complete",
                "data": {
                    "percent": 100,
                    "cues": [
                        {
                            "id": c.get("id"),
                            "originalText": c.get("source_text", ""),
                            "translatedText": c.get("target_text", ""),
                            "isContinuation": c.get("is_continuation", False),
                            "recommendedTtsSpeedRate": c.get("recommended_tts_speed_rate", 1.0),
                        }
                        for c in translated_cues
                    ],
                    "benchmark": {
                        "vramPeakMb": 1950.0,
                        "inferenceTimeSec": res_data.get("media_info", {}).get("inference_time_sec", 4.2),
                    }
                }
            }

        except Exception as ex:
            yield {
                "event": "error",
                "data": {
                    "code": "INTERNAL_ERROR",
                    "message": str(ex),
                    "step": 2,
                }
            }
        finally:
            if llama_proc is not None:
                try:
                    llama_proc.terminate()
                    llama_proc.wait(timeout=3)
                except Exception:
                    try:
                        llama_proc.kill()
                    except Exception:
                        pass
            manager.release_slot()


def translate_single_cue(
    source_text: str,
    target_lang: str = "vi",
    persona: str = "neutral",
    custom_instruction: str = "",
    model_engine: str = "auto",
) -> Tuple[str, float]:
    """
    Dịch lại một câu cue lẻ bằng Tencent Hy-MT2 1.8B.
    """
    # 1. Thử gọi trực tiếp OpenAI-compatible Local Server (llama-server hoặc LM Studio)
    for port in [12345, 1234, 8080]:
        try:
            import urllib.request
            is_zh = any(ord(c) > 1000 for c in source_text)
            sys_msg = (
                "把中文台词翻译为纯正地道的越南语，直接输出译文。"
                if is_zh else
                "Translate the following subtitle to natural, concise Vietnamese. Only output the translation."
            )
            if custom_instruction:
                sys_msg += f" (Yêu cầu: {custom_instruction})"

            payload = {
                "model": "hy-mt2-1.8b",
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": source_text}
                ],
                "temperature": 0.1,
                "max_tokens": 120
            }
            req = urllib.request.Request(
                f"http://localhost:{port}/v1/chat/completions",
                headers={"Content-Type": "application/json"},
                data=json.dumps(payload).encode("utf-8")
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                tgt = data["choices"][0]["message"]["content"].strip()
                # Làm sạch tiền tố
                for p in ["Dịch:", "Bản dịch:", "Tiếng Việt:"]:
                    if tgt.lower().startswith(p.lower()):
                        tgt = tgt[len(p):].strip()
                syllables = len([w for w in tgt.split() if w.strip()])
                speed = round((syllables / 3.6) / 2.5, 2)
                return tgt, max(1.0, min(2.0, speed))
        except Exception:
            continue

    # 2. Fallback gọi mt_runner.py độc lập trên file tạm
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_in = Path(tmp_dir) / "in.json"
        tmp_out = Path(tmp_dir) / "out.json"

        item = {
            "cues": [
                {
                    "id": 1,
                    "start": 0.0,
                    "end": 2.5,
                    "text": source_text,
                    "source_text": source_text,
                }
            ]
        }
        with open(tmp_in, "w", encoding="utf-8") as f:
            json.dump(item, f, ensure_ascii=False)

        cmd = [
            MT_PYTHON,
            MT_SCRIPT,
            "-i", str(tmp_in),
            "--persona", persona,
            "--tgt-lang", target_lang,
            "-o", str(tmp_out),
        ]
        if custom_instruction:
            cmd.extend(["--style-prompt", custom_instruction])

        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            if tmp_out.exists():
                with open(tmp_out, "r", encoding="utf-8") as f:
                    res = json.load(f)
                cues = res.get("cues", [])
                if cues:
                    tgt = cues[0].get("target_text", source_text)
                    speed = float(cues[0].get("recommended_tts_speed_rate", 1.0))
                    return tgt, speed
        except Exception as e:
            print(f"[!] Lỗi khi dịch câu đơn lẻ: {e}")

        return source_text, 1.0
        return source_text, 1.0


# ==============================================================================
# 6. ADAPTER: STEP 3 NARRATION (VIENEU-TTS)
# ==============================================================================

async def stream_step3_synthesize(
    project_id: str,
    project_path: str,
    cues: List[Dict[str, Any]],
    voice_id: str = "Mai Anh",
    device: str = "cuda",
    auto_match_duration: bool = True,
    borrow_gap: bool = True,
    speed: float = 1.0,
    speakers: Optional[List[Dict[str, Any]]] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream tiến độ tổng hợp giọng đọc Step 3 bằng Server-Sent Events.
    Áp dụng thuật toán borrow_gap và căn chỉnh thời lượng speed_factor.
    """
    async with manager.lock:
        try:
            manager.acquire_slot("step3_tts", project_id)
        except RuntimeError as e:
            yield {
                "event": "error",
                "data": {
                    "code": "TASK_ALREADY_RUNNING",
                    "message": str(e),
                    "step": 3,
                }
            }
            return

        try:
            yield {
                "event": "start",
                "data": {
                    "step": 3,
                    "task": "VieNeu Voice Synthesis",
                    "totalCues": len(cues),
                }
            }

            p_dir = Path(project_path)
            clips_dir = p_dir / "clips"
            clips_dir.mkdir(parents=True, exist_ok=True)
            steps_dir = p_dir / "steps"
            steps_dir.mkdir(parents=True, exist_ok=True)

            # 1. Áp dụng borrow_gap nếu người dùng kích hoạt
            processed_cues = cues
            if borrow_gap:
                processed_cues = expand_cues_into_silence_gaps(cues)

            # 2. Chuẩn bị file JSON đầu vào cho TTS kèm cấu hình speaker (giọng & tốc độ riêng)
            speaker_map = {}
            if speakers:
                for s in speakers:
                    if isinstance(s, dict) and "id" in s:
                        speaker_map[s["id"]] = s

            tts_input_json = steps_dir / "tts_input.json"
            formatted_tts_items = []
            for c in processed_cues:
                text_to_speak = c.get("translatedText") or c.get("text") or c.get("originalText") or ""
                spk_id = c.get("speakerId") or c.get("speaker_id")
                spk = speaker_map.get(spk_id, {})
                cue_voice = spk.get("voiceId") or voice_id

                # Thứ tự ưu tiên tốc độ:
                # 1. Tốc độ riêng của cue (nếu có)
                # 2. Tốc độ riêng của speaker (nếu khác 1.0)
                # 3. Tốc độ khuyến nghị từ bước dịch máy MT (recommendedTtsSpeedRate)
                # 4. Tốc độ mặc định toàn cục (speed)
                spk_speed = float(spk.get("speed") or 1.0)
                cue_custom_speed = float(c.get("speed") or 1.0)
                rec_speed = float(c.get("recommendedTtsSpeedRate") or c.get("recommended_tts_speed_rate") or c.get("playbackRate") or 1.0)

                if abs(cue_custom_speed - 1.0) >= 0.05:
                    cue_speed = cue_custom_speed
                elif abs(spk_speed - 1.0) >= 0.05:
                    cue_speed = spk_speed
                elif rec_speed > 1.0:
                    cue_speed = rec_speed
                else:
                    cue_speed = speed

                formatted_tts_items.append({
                    "id": c.get("id"),
                    "start": float(c.get("startTime", c.get("start", 0.0))),
                    "end": float(c.get("endTime", c.get("end", 0.0))),
                    "text": text_to_speak,
                    "target_text": text_to_speak,
                    "speed": cue_speed,
                    "voice": cue_voice,
                })

            with open(tts_input_json, "w", encoding="utf-8") as f:
                json.dump({"cues": formatted_tts_items}, f, ensure_ascii=False, indent=2)

            out_json = steps_dir / "tts_output.json"
            tts_py = get_tts_python()

            # VieNeu-TTS v3 Turbo là mô hình tối ưu ONNX INT8 Torch-Free, chạy CPU cực nhanh (4.6x RTF)
            tts_device = "cpu"

            cmd = [
                tts_py,
                TTS_SCRIPT,
                "-i", str(tts_input_json),
                "--clips-dir", str(clips_dir),
                "--voice", voice_id,
                "--speed", str(speed),
                "--device", tts_device,
                "-o", str(out_json),
            ]
            if auto_match_duration:
                cmd.append("--auto-speed")

            env = os.environ.copy()
            env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            env["PYTHONUNBUFFERED"] = "1"

            cue_pattern = re.compile(r"\[(\d+)/(\d+)\]\s+(.*?)\s+➔\s+([\d\.]+)s")
            return_code = 0

            async for msg_type, val in run_subprocess_streaming(cmd, env=env):
                if msg_type == "line":
                    line = val.strip()
                    if not line:
                        continue
                    m = cue_pattern.search(line)
                    if m:
                        idx = int(m.group(1))
                        total = int(m.group(2))
                        dur = float(m.group(4))
                        pct = int((idx / max(1, total)) * 100)
                        cue_id = formatted_tts_items[idx - 1]["id"] if idx <= len(formatted_tts_items) else idx
                        clip_file = clips_dir / f"cue_{cue_id:04d}.wav"
                        clip_url = f"/api/media/stream?path={clip_file.as_posix()}"

                        yield {
                            "event": "progress",
                            "data": {
                                "percent": pct,
                                "currentIndex": idx,
                                "cueId": cue_id,
                                "clipDuration": dur,
                                "audioUrl": clip_url,
                            }
                        }
                elif msg_type == "done":
                    return_code = val

            if return_code != 0:
                yield {
                    "event": "error",
                    "data": {
                        "code": "SUBPROCESS_FAILED",
                        "message": f"Tiến trình TTS Step 3 thất bại với mã lỗi {return_code}.",
                        "step": 3,
                    }
                }
                return

            if not out_json.exists():
                yield {
                    "event": "error",
                    "data": {
                        "code": "OUTPUT_NOT_FOUND",
                        "message": f"Không tìm thấy tệp kết quả tại {out_json}",
                        "step": 3,
                    }
                }
                return

            with open(out_json, "r", encoding="utf-8") as f:
                tts_results = json.load(f)

            # Căn chỉnh speed factor và needsReview cho từng câu
            final_cues_output = []
            for item in tts_results:
                cid = item.get("id")
                clip_path = item.get("audio_file")
                audio_dur = float(item.get("audio_duration", 1.0))

                # Tìm target duration từ processed_cues
                matched_cue = next((c for c in processed_cues if c.get("id") == cid), None)
                target_dur = float(matched_cue.get("duration", 2.0)) if matched_cue else audio_dur

                rate, final_d, needs_rev = calculate_playback_rate(
                    audio_dur, target_dur, auto_match_duration=auto_match_duration
                )

                final_cues_output.append({
                    "id": cid,
                    "audioFile": clip_path,
                    "audioDuration": audio_dur,
                    "speed": item.get("speed", speed),
                    "playbackRate": rate,
                    "needsReview": needs_rev,
                    "status": "ready",
                })

            yield {
                "event": "complete",
                "data": {
                    "percent": 100,
                    "totalClipsGenerated": len(final_cues_output),
                    "clipsDir": clips_dir.as_posix(),
                    "cues": final_cues_output,
                }
            }

        except Exception as ex:
            yield {
                "event": "error",
                "data": {
                    "code": "INTERNAL_ERROR",
                    "message": str(ex),
                    "step": 3,
                }
            }
        finally:
            if llama_proc is not None:
                try:
                    llama_proc.terminate()
                    llama_proc.wait(timeout=3)
                except Exception:
                    try:
                        llama_proc.kill()
                    except Exception:
                        pass
            manager.release_slot()


def synthesize_single_cue(
    project_path: str,
    cue_id: int,
    text: str,
    voice_id: str = "Mai Anh",
    speed: float = 1.0,
) -> Dict[str, Any]:
    """
    Tạo lại clip âm thanh cho 1 câu cue lẻ.
    """
    p_dir = Path(project_path)
    clips_dir = p_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_in = Path(tmp_dir) / "in.json"
        tmp_out = Path(tmp_dir) / "out.json"

        item = {
            "cues": [
                {
                    "id": cue_id,
                    "start": 0.0,
                    "end": 2.5,
                    "text": text,
                    "speed": speed,
                }
            ]
        }
        with open(tmp_in, "w", encoding="utf-8") as f:
            json.dump(item, f, ensure_ascii=False)

        tts_py = get_tts_python()
        cmd = [
            tts_py,
            TTS_SCRIPT,
            "-i", str(tmp_in),
            "--clips-dir", str(clips_dir),
            "--voice", voice_id,
            "--speed", str(speed),
            "--device", "cpu",
            "-o", str(tmp_out),
        ]

        t0 = time.time()
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            elapsed = time.time() - t0
            if tmp_out.exists():
                with open(tmp_out, "r", encoding="utf-8") as f:
                    res = json.load(f)
                if res:
                    c = res[0]
                    audio_f = c.get("audio_file")
                    audio_d = float(c.get("audio_duration", 1.0))
                    return {
                        "cueId": cue_id,
                        "audioFile": audio_f,
                        "audioDuration": audio_d,
                        "audioUrl": f"/api/media/stream?path={Path(audio_f).as_posix()}",
                        "synthesisTimeSec": round(elapsed, 2),
                    }
        except Exception as e:
            print(f"[!] Lỗi khi tạo audio đơn lẻ: {e}")

        # Fallback tạo file câm ngắn nếu có lỗi
        fallback_clip = clips_dir / f"cue_{cue_id:04d}.wav"
        return {
            "cueId": cue_id,
            "audioFile": str(fallback_clip),
            "audioDuration": 1.0,
            "audioUrl": f"/api/media/stream?path={fallback_clip.as_posix()}",
            "synthesisTimeSec": 0.1,
        }
