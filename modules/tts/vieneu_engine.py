# -*- coding: utf-8 -*-
"""
Bộ điều phối tổng hợp giọng nói VieNeu-TTS (Dual-Engine: Local v3-Turbo & Cloud v4 API).
Tương thích hoàn toàn cho nghiên cứu khoa học NCKH và đối sánh hiệu năng.
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
import urllib.request
import urllib.error

# Tự động nạp site-packages cục bộ nếu có venv riêng của module
BASE_DIR = Path(__file__).resolve().parent
MODULE_VENV_SITE = BASE_DIR / ".venv" / "Lib" / "site-packages"
if MODULE_VENV_SITE.exists() and str(MODULE_VENV_SITE) not in sys.path:
    sys.path.insert(0, str(MODULE_VENV_SITE))

import numpy as np
import soundfile as sf

try:
    from timeline_stitcher import time_stretch_audio
except ImportError:
    time_stretch_audio = None

try:
    from vieneu import Vieneu
    HAS_LOCAL_VIENEU = True
except ImportError:
    Vieneu = None
    HAS_LOCAL_VIENEU = False


class VieNeuEngine:
    """Lớp bọc điều khiển VieNeu-TTS hỗ trợ cả On-Device (v3-Turbo) và Cloud API (v4)."""

    PRESET_VOICES_V3 = [
        ("Mai Anh", "Nữ · Bắc · Tin tức / Diễn thuyết"),
        ("Minh Đức", "Nam · Bắc · Tin tức / Diễn thuyết"),
        ("Thái Sơn", "Nam · Nam · Kể chuyện / Truyền cảm"),
        ("Xuân Vĩnh", "Nam · Nam · Tự nhiên / Đời thường"),
        ("Thanh Bình", "Nam · Bắc · Kể chuyện"),
        ("Trúc Ly", "Nữ · Bắc · Tự nhiên"),
        ("Đoan Trang", "Nữ · Bắc · Tự nhiên"),
        ("Thục Đoan", "Nữ · Nam · Kể chuyện"),
        ("Minh Triết", "Nam · Nam · Tin tức"),
        ("Thùy Dung", "Nữ · Nam · Tin tức"),
        ("Quang Sơn", "Nam · Trung · Tự nhiên"),
        ("Ngọc Trân", "Nữ · Trung · Tự nhiên"),
        ("Mỹ Duyên", "Nữ · Nam · Đọc truyện"),
        ("Quỳnh Anh", "Nữ · Bắc · Đọc truyện"),
        ("Đức Trí", "Nam · Nam · Đọc truyện"),
        ("Kim Thanh", "Nữ · Nam · Đọc truyện"),
        ("Ngọc Huyền", "Nữ · Bắc · Tự nhiên"),
        ("Adam", "Nam · Nam · Tự nhiên"),
    ]

    def __init__(
        self,
        engine_type: str = "local",  # "local" (v3-Turbo) hoặc "v4-cloud" (VieNeu v4)
        device: str = "auto",        # "cpu", "cuda", "auto"
        precision: str = "int8",     # "int8" hoặc "fp32"
        api_key: str = "",
        api_base_url: str = "https://api.vieneu.io/v1",
    ) -> None:
        self.engine_type = engine_type.lower()
        self.device = device
        self.precision = precision
        self.api_key = api_key or os.environ.get("VIENEU_API_KEY", "")
        self.api_base_url = api_base_url.rstrip("/")
        self.sample_rate = 48000
        self._local_tts = None

        if self.engine_type in ("local", "v3", "v3turbo"):
            self._init_local_engine()

    def _init_local_engine(self) -> None:
        """Khởi tạo mô hình VieNeu-TTS v3 Turbo chạy cục bộ offline."""
        if not HAS_LOCAL_VIENEU:
            raise RuntimeError(
                "Không tìm thấy thư viện 'vieneu'. Hãy cài đặt bằng lệnh: pip install vieneu"
            )

        # Chọn thiết bị thực thi
        dev = "cpu"
        backend = "onnx"
        if self.device == "cuda":
            dev = "cuda"
            backend = "torch"

        print(f"[*] Đang nạp VieNeu-TTS v3 Turbo ({backend.upper()}, {dev}, precision={self.precision})...")
        self._local_tts = Vieneu(
            mode="v3turbo",
            device=dev,
            backend=backend,
            precision=self.precision,
        )
        self.sample_rate = getattr(self._local_tts, "sample_rate", 48000)
        print(f"[✓] Nạp VieNeu v3-Turbo thành công (Sample Rate: {self.sample_rate} Hz).")

    def list_preset_voices(self) -> List[Tuple[str, str]]:
        """Trả về danh sách các giọng đọc tích hợp sẵn."""
        if self._local_tts is not None:
            try:
                raw_voices = self._local_tts.list_preset_voices()
                return [(v[1], v[0]) for v in raw_voices]
            except Exception:
                pass
        return self.PRESET_VOICES_V3

    def synthesize(
        self,
        text: str,
        voice: str = "Mai Anh",
        speed: float = 1.0,
        ref_audio: Optional[str] = None,
    ) -> np.ndarray:
        """
        Tổng hợp giọng nói từ văn bản.
        Trả về: numpy array float32 audio waveform.
        """
        clean_text = text.strip()
        if not clean_text:
            return np.zeros(int(self.sample_rate * 0.2), dtype=np.float32)

        # 1. Chế độ Cloud VieNeu v4 (nếu cấu hình)
        if self.engine_type in ("v4", "v4-cloud", "cloud"):
            return self._synthesize_cloud_v4(clean_text, voice=voice, speed=speed)

        # 2. Chế độ On-Device Local v3 Turbo (mặc định)
        if self._local_tts is None:
            self._init_local_engine()

        if ref_audio and os.path.exists(ref_audio):
            # Tính năng Nhân bản giọng nói tức thì (Instant Voice Cloning)
            wav = self._local_tts.infer(clean_text, ref_audio=ref_audio)
        else:
            # Dùng giọng đọc mẫu có sẵn
            wav = self._local_tts.infer(clean_text, voice=voice)

        wav = np.asarray(wav, dtype=np.float32)

        # Điều chỉnh tốc độ đọc nếu speed != 1.0 (Bỏ giới hạn cứng 1.35x, cho phép co dãn linh hoạt cho câu ngắn)
        if abs(speed - 1.0) >= 0.02 and len(wav) > 0 and time_stretch_audio is not None:
            wav = time_stretch_audio(wav, speed_factor=speed, sample_rate=self.sample_rate)

        return wav

    def _synthesize_cloud_v4(
        self,
        text: str,
        voice: str = "Mai Anh",
        speed: float = 1.0,
    ) -> np.ndarray:
        """Gọi API VieNeu v4 Cloud thông qua chuẩn OpenAI Audio Speech endpoint."""
        if not self.api_key:
            raise ValueError(
                "Để sử dụng VieNeu v4 Cloud API, bạn cần cung cấp API Key qua tham số --api-key hoặc biến môi trường VIENEU_API_KEY."
            )

        url = f"{self.api_base_url}/audio/speech"
        payload = {
            "model": "vieneu-v4",
            "input": text,
            "voice": voice,
            "response_format": "wav",
            "speed": speed,
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "NCKH-Dubbing-VieNeu/1.0",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                audio_bytes = resp.read()
                wav, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
                self.sample_rate = sr
                return wav
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Lỗi khi gọi VieNeu v4 Cloud API ({e.code}): {err_msg}")
        except Exception as e:
            raise RuntimeError(f"Không thể kết nối tới VieNeu v4 Cloud API: {e}")

