# -*- coding: utf-8 -*-
"""
Subprocess Runner & VRAM Lifecycle Management for Local AI Modules
- Windows UTF-8 console output/input safety.
- Unicode surrogate character sanitization (eliminates U+D800 to U+DFFF).
- Cross-directory NCKH module auto-discovery.
- Zero-leak PyTorch VRAM cleanup (gc.collect + empty_cache).
"""

from __future__ import annotations

import asyncio
import gc
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

# Đảm bảo UTF-8 trên Windows console
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def clean_surrogates(val: Any) -> Any:
    """Xóa bỏ triệt để các ký tự Unicode surrogate cấm trong UTF-8."""
    if isinstance(val, str):
        return "".join(c for c in val if not (0xD800 <= ord(c) <= 0xDFFF))
    elif isinstance(val, dict):
        return {clean_surrogates(k): clean_surrogates(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [clean_surrogates(x) for x in val]
    return val


def find_candidate_dir(candidates: List[Path]) -> Optional[Path]:
    """Tìm thư mục module khả dụng từ danh sách ứng viên."""
    for cand in candidates:
        if cand.resolve().exists():
            return cand.resolve()
    return None


def find_candidate_python(module_dir: Path) -> str:
    """Tìm python.exe trong môi trường venv của module."""
    if sys.platform == "win32":
        venv_py = module_dir / "venv" / "Scripts" / "python.exe"
        if venv_py.exists():
            return str(venv_py)
        dot_venv_py = module_dir / ".venv" / "Scripts" / "python.exe"
        if dot_venv_py.exists():
            return str(dot_venv_py)
    else:
        venv_py = module_dir / "venv" / "bin" / "python"
        if venv_py.exists():
            return str(venv_py)
        dot_venv_py = module_dir / ".venv" / "bin" / "python"
        if dot_venv_py.exists():
            return str(dot_venv_py)
    return sys.executable


def safe_vram_cleanup():
    """
    Thu hồi triệt để bộ nhớ đệm PyTorch và bộ thu gom rác Python.
    Giải phóng 100% VRAM không còn sử dụng.
    """
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except ImportError:
        pass


def get_gpu_vram_status() -> Dict[str, Any]:
    """Lấy thông số bộ nhớ GPU thời gian thực (MB)."""
    try:
        import torch
        if torch.cuda.is_available():
            dev = torch.cuda.current_device()
            dev_name = torch.cuda.get_device_name(dev)
            total_b = torch.cuda.get_device_properties(dev).total_memory
            reserved_b = torch.cuda.memory_reserved(dev)
            allocated_b = torch.cuda.memory_allocated(dev)
            free_b = total_b - reserved_b

            return {
                "available": True,
                "deviceName": dev_name,
                "totalMb": round(total_b / (1024 * 1024), 1),
                "allocatedMb": round(allocated_b / (1024 * 1024), 1),
                "reservedMb": round(reserved_b / (1024 * 1024), 1),
                "freeMb": round(free_b / (1024 * 1024), 1),
            }
    except Exception:
        pass

    return {
        "available": False,
        "deviceName": "CPU / No CUDA",
        "totalMb": 0,
        "allocatedMb": 0,
        "reservedMb": 0,
        "freeMb": 0,
    }


async def run_subprocess_streaming_safe(
    cmd: List[str],
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
) -> AsyncGenerator[Tuple[str, Any], None]:
    """
    Chạy subprocess bất đồng bộ và yield từng dòng stdout không chặn luồng (Non-blocking).
    """
    proc_env = (env or os.environ).copy()
    proc_env["PYTHONUNBUFFERED"] = "1"
    proc_env["PYTHONIOENCODING"] = "utf-8"
    proc_env["PYTHONUTF8"] = "1"

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        env=proc_env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    try:
        if proc.stdout:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                cleaned = clean_surrogates(decoded)
                if cleaned:
                    yield ("line", cleaned)

        return_code = await proc.wait()
        yield ("done", return_code)
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass
        safe_vram_cleanup()
