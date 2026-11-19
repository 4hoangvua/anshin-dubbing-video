# -*- coding: utf-8 -*-
"""
Model Hub & Auto-Downloader Service for Video Dubbing AI Local
- Quản lý danh mục mô hình AI (Faster-Whisper, Hy-MT2 1.8B GGUF, VieNeu-TTS).
- Tự động phát hiện cấu hình phần cứng (RAM, GPU, VRAM) để gợi ý model tối ưu.
- Tải mô hình 1-click có hỗ trợ streaming tiến độ (Server-Sent Events) và lưu vào models/.
"""

from __future__ import annotations
import asyncio
import os
from pathlib import Path
import shutil
import sys
import time
from typing import Any, AsyncGenerator, Dict, List, Optional
import urllib.request
import psutil

ROOT_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT_DIR / "models"

# ==============================================================================
# DANH MỤC MODEL CHUẨN PRODUCT (CATALOG)
# ==============================================================================

MODEL_CATALOG: Dict[str, Dict[str, Any]] = {
    # 1. Nhận diện giọng nói (ASR - Faster-Whisper)
    "whisper-tiny": {
        "id": "whisper-tiny",
        "category": "asr",
        "name": "Faster-Whisper Tiny",
        "size_mb": 150,
        "vram_required_mb": 800,
        "hardware_tier": "cpu",
        "description": "Siêu nhẹ, tốc độ cực nhanh, phù hợp máy cấu hình yếu hoặc chỉ dùng CPU.",
        "download_url": "https://hf-mirror.com/Systran/faster-whisper-tiny/resolve/main/model.bin",
        "dest_dir": "asr/whisper-tiny",
        "target_file": "model.bin",
    },
    "whisper-small": {
        "id": "whisper-small",
        "category": "asr",
        "name": "Faster-Whisper Small (Khuyên dùng)",
        "size_mb": 490,
        "vram_required_mb": 1500,
        "hardware_tier": "recommended",
        "description": "Cân bằng hoàn hảo giữa độ chính xác nhận diện và tài nguyên VRAM (tối ưu cho GTX 1060 6GB).",
        "download_url": "https://hf-mirror.com/Systran/faster-whisper-small/resolve/main/model.bin",
        "dest_dir": "asr/whisper-small",
        "target_file": "model.bin",
    },
    "whisper-medium": {
        "id": "whisper-medium",
        "category": "asr",
        "name": "Faster-Whisper Medium",
        "size_mb": 1500,
        "vram_required_mb": 2600,
        "hardware_tier": "high",
        "description": "Độ chính xác rất cao, nhận diện chuẩn ngữ cảnh phức tạp (yêu cầu GPU từ 8GB VRAM).",
        "download_url": "https://hf-mirror.com/Systran/faster-whisper-medium/resolve/main/model.bin",
        "dest_dir": "asr/whisper-medium",
        "target_file": "model.bin",
    },

    # 2. Dịch máy chuyên sâu (MT - Tencent Hunyuan Hy-MT2 1.8B GGUF)
    "hy-mt2-1.8b-q4": {
        "id": "hy-mt2-1.8b-q4",
        "category": "mt",
        "name": "Tencent Hy-MT2 1.8B (Q4_K_M - Chuẩn cân bằng)",
        "size_mb": 1150,
        "vram_required_mb": 1800,
        "hardware_tier": "recommended",
        "description": "Chất lượng dịch vượt trội API thương mại, chuẩn ngữ cảnh phim và video đa ngữ (chạy tốt cả CPU & GPU).",
        "download_url": "https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf",
        "dest_dir": "mt",
        "target_file": "Hy-MT2-1.8B-Q4_K_M.gguf",
    },
    "hy-mt2-1.8b-q8": {
        "id": "hy-mt2-1.8b-q8",
        "category": "mt",
        "name": "Hy MT2 1.8B Q8_0 (Chất lượng tối đa)",
        "size_mb": 1910,
        "vram_required_mb": 2100,
        "hardware_tier": "high",
        "description": "Bản lượng tử hóa chất lượng cao 8-bit (1.91 GB). Bảo toàn trọn vẹn ngữ nghĩa và độ chính xác dịch thuật tối đa.",
        "download_url": "https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf",
        "dest_dir": "mt",
        "target_file": "Hy-MT2-1.8B-Q8_0.gguf",
    },

    # 3. Tổng hợp giọng đọc (TTS - VieNeu v3 Turbo)
    "vieneu-v3-turbo": {
        "id": "vieneu-v3-turbo",
        "category": "tts",
        "name": "VieNeu-TTS v3 Turbo (18 Giọng đọc bản địa)",
        "size_mb": 250,
        "vram_required_mb": 1500,
        "hardware_tier": "recommended",
        "description": "Bộ 18 giọng đọc đa vùng miền Bắc - Trung - Nam, hỗ trợ đọc diễn cảm và co dãn tốc độ linh hoạt.",
        "download_url": "https://hf-mirror.com/pnnbao-ump/VieNeu-TTS-v3-Turbo/resolve/main/model.safetensors",
        "dest_dir": "tts",
        "target_file": "model.safetensors",
    },
}


def get_hardware_info() -> Dict[str, Any]:
    """Quét thông số phần cứng hiện tại của máy tính người dùng."""
    total_ram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    
    cuda_available = False
    device_name = "CPU Only"
    total_vram_mb = 0
    free_vram_mb = 0

    try:
        import torch
        if torch.cuda.is_available():
            cuda_available = True
            device_name = torch.cuda.get_device_name(0)
            total_vram_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
            free_vram_mb = int(torch.cuda.mem_get_info()[0] / (1024 * 1024))
    except Exception:
        pass

    # Phân nhóm phần cứng (tier)
    if not cuda_available or total_vram_mb < 4000:
        tier = "cpu"
    elif total_vram_mb <= 6500:
        tier = "recommended"  # Tương đương GTX 1060 6GB
    else:
        tier = "high"         # GPU >= 8GB

    return {
        "cuda_available": cuda_available,
        "device_name": device_name,
        "total_ram_gb": total_ram_gb,
        "total_vram_mb": total_vram_mb,
        "free_vram_mb": free_vram_mb,
        "suggested_tier": tier,
    }


def get_models_status() -> List[Dict[str, Any]]:
    """Kiểm tra danh sách các model và trạng thái đã tải hay chưa trên đĩa."""
    results = []
    for m_id, item in MODEL_CATALOG.items():
        dest = MODELS_DIR / item["dest_dir"] / item["target_file"]
        is_downloaded = dest.exists() and dest.stat().st_size > 1024 * 1024
        file_size_mb = round(dest.stat().st_size / (1024 * 1024), 1) if dest.exists() else 0
        
        # Kiểm tra case-insensitive nếu người dùng đã tải với tên viết hoa/thường khác nhau
        if not is_downloaded:
            p_dir = MODELS_DIR / item["dest_dir"]
            if p_dir.exists():
                for f in p_dir.iterdir():
                    if f.is_file() and f.name.lower() == item["target_file"].lower() and f.stat().st_size > 1024 * 1024:
                        is_downloaded = True
                        dest = f
                        file_size_mb = round(f.stat().st_size / (1024 * 1024), 1)
                        break

        results.append({
            **item,
            "is_downloaded": is_downloaded,
            "local_path": dest.as_posix() if is_downloaded else "",
            "local_size_mb": file_size_mb,
        })
    return results


def ensure_llama_server() -> bool:
    """Tự động kiểm tra và tải portable llama-server.exe (Windows x64) vào bin/ nếu chưa có."""
    bin_dir = ROOT_DIR / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    llama_exe = bin_dir / "llama-server.exe"
    if llama_exe.exists():
        return True

    zip_url = "https://github.com/ggml-org/llama.cpp/releases/download/b12530/llama-b12530-bin-win-cpu-x64.zip"
    temp_zip = bin_dir / "llama_server_temp.zip"
    try:
        req = urllib.request.Request(zip_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(temp_zip, "wb") as out_f:
            shutil.copyfileobj(resp, out_f)

        import zipfile
        with zipfile.ZipFile(temp_zip, "r") as zf:
            zf.extractall(bin_dir)

        if temp_zip.exists():
            temp_zip.unlink()

        return llama_exe.exists()
    except Exception:
        if temp_zip.exists():
            try:
                temp_zip.unlink()
            except Exception:
                pass
        return False


CURRENT_DOWNLOADING_MODEL_ID: Optional[str] = None


async def stream_download_model(model_id: str) -> AsyncGenerator[Dict[str, Any], None]:
    """Tải model với SSE tiến độ phần trăm real-time. Chỉ cho phép tải 1 model tại một thời điểm."""
    global CURRENT_DOWNLOADING_MODEL_ID

    if CURRENT_DOWNLOADING_MODEL_ID is not None and CURRENT_DOWNLOADING_MODEL_ID != model_id:
        active_name = MODEL_CATALOG.get(CURRENT_DOWNLOADING_MODEL_ID, {}).get("name", CURRENT_DOWNLOADING_MODEL_ID)
        yield {
            "event": "error",
            "data": {
                "message": f"Hệ thống đang tải mô hình '{active_name}'. Vui lòng chờ tải xong trước khi tải mô hình khác!",
                "activeModelId": CURRENT_DOWNLOADING_MODEL_ID
            }
        }
        return

    if model_id not in MODEL_CATALOG:
        yield {
            "event": "error",
            "data": {"message": f"Không tìm thấy model ID: {model_id}"}
        }
        return

    info = MODEL_CATALOG[model_id]
    dest_dir = MODELS_DIR / info["dest_dir"]
    dest_dir.mkdir(parents=True, exist_ok=True)
    target_file = dest_dir / info["target_file"]
    temp_file = dest_dir / f"{info['target_file']}.download"

    CURRENT_DOWNLOADING_MODEL_ID = model_id
    url = info["download_url"]
    yield {
        "event": "start",
        "data": {
            "modelId": model_id,
            "name": info["name"],
            "totalSizeMb": info["size_mb"],
            "message": f"Bắt đầu tải {info['name']}..."
        }
    }

    try:
        def _download():
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp, open(temp_file, "wb") as out_f:
                total_len = int(resp.headers.get("Content-Length", info["size_mb"] * 1024 * 1024))
                downloaded = 0
                chunk_size = 1024 * 1024  # 1MB chunks

                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    out_f.write(chunk)
                    downloaded += len(chunk)

            # Đổi tên file tạm sang file chính thức sau khi tải trọn vẹn
            if temp_file.exists():
                if target_file.exists():
                    target_file.unlink()
                temp_file.rename(target_file)

            # Nếu là ASR Faster-Whisper, tự động đồng bộ thêm config và vocabulary nếu thiếu
            if info.get("category") == "asr" and "Systran/" in url:
                base_repo = url.rsplit("/resolve/main/", 1)[0]
                for extra in ["config.json", "tokenizer.json", "vocabulary.txt"]:
                    extra_dest = dest_dir / extra
                    if not extra_dest.exists():
                        try:
                            extra_url = f"{base_repo}/resolve/main/{extra}"
                            req_ex = urllib.request.Request(extra_url, headers={"User-Agent": "Mozilla/5.0"})
                            with urllib.request.urlopen(req_ex, timeout=15) as r, open(extra_dest, "wb") as ef:
                                ef.write(r.read())
                        except Exception:
                            pass

            # Nếu là MT Model, tự động tải portable llama-server.exe vào bin/ nếu chưa có
            if info.get("category") == "mt":
                ensure_llama_server()

        # Chạy tải ngầm trong thread riêng để không block FastAPI
        loop = asyncio.get_running_loop()
        download_task = loop.run_in_executor(None, _download)

        # Polling tiến độ file size tạm để bắn SSE
        while not download_task.done():
            await asyncio.sleep(0.5)
            if temp_file.exists():
                curr_size = temp_file.stat().st_size
                curr_mb = round(curr_size / (1024 * 1024), 1)
                percent = min(99, int((curr_size / (info["size_mb"] * 1024 * 1024)) * 100))
                yield {
                    "event": "progress",
                    "data": {
                        "modelId": model_id,
                        "downloadedMb": curr_mb,
                        "totalMb": info["size_mb"],
                        "percent": percent,
                    }
                }

        await download_task

        yield {
            "event": "complete",
            "data": {
                "modelId": model_id,
                "percent": 100,
                "localPath": target_file.as_posix(),
                "message": f"Tải thành công {info['name']}!"
            }
        }

    except Exception as e:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)
        yield {
            "event": "error",
            "data": {
                "modelId": model_id,
                "message": f"Lỗi tải model: {str(e)}"
            }
        }
    finally:
        CURRENT_DOWNLOADING_MODEL_ID = None
