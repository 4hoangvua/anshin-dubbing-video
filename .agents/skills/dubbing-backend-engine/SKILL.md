---
name: dubbing-backend-engine
description: >-
  Hướng dẫn và quy tắc kiến trúc Backend FastAPI của dubbing-video: Single-Active Engine,
  quản lý VRAM 6GB, Sidecar llama-server.exe, VieNeu TTS ONNX, Single-Download Queue và RFC 7807.
  Sử dụng khi phát triển, debug hoặc tích hợp API Backend.
---

# Dubbing Backend Architecture & Engine Guide

Skill này hướng dẫn quy chuẩn vận hành, quản trị tài nguyên và triển khai logic cho Backend FastAPI của `dubbing-video`.

## 1. Bộ điều phối GPU & Chống Kẹt Slot (Deadlock Prevention)
Hệ thống chạy trên GPU 6GB VRAM (như GTX 1060), do đó:
- Dùng `ThreadPoolExecutor(max_workers=1)` để tuần tự hóa tác vụ AI.
- Cơ chế `acquire_slot()`:
  - Nếu một tác vụ mới từ cùng một `projectId` được gửi tới (ví dụ người dùng bấm chạy lại sau khi sửa tham số), server phải tự động thu hồi tài nguyên của phiên trước đó thay vì trả về lỗi `TASK_ALREADY_RUNNING`.

## 2. Quản trị Bộ nhớ Zero-Leak VRAM
- **Khi kết thúc bất kỳ tác vụ ASR, MT, TTS nào**:
  ```python
  import gc
  import torch
  gc.collect()
  if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  ```
- **Sidecar `llama-server.exe` Lifecycle**:
  - Không giữ tiến trình C++ chạy thường trực trong RAM.
  - Khởi động subprocess với model `hy-mt2-1.8b` khi bắt đầu dịch Step 2.
  - Gửi request dịch từng scene/batch.
  - Khi hoàn tất, gửi tín hiệu terminate tiến trình và đợi OS thu hồi 100% VRAM.

## 3. Khóa Tải Đơn nhiệm Model Hub
- Sử dụng biến khóa `CURRENT_DOWNLOADING_MODEL_ID`.
- Khi đang tải 1 model, mọi yêu cầu tải model khác phải bị từ chối với mã lỗi `DOWNLOAD_IN_PROGRESS`.
- Luôn sử dụng CDN Mirror `hf-mirror.com` khi tải từ HuggingFace để đạt tốc độ tối đa tại Việt Nam.

## 4. Chuẩn phản hồi Lỗi RFC 7807
Mọi endpoint FastAPI khi gặp lỗi nghiệp vụ phải trả về HTTP 400/409/500 theo schema:
```python
from pydantic import BaseModel
from typing import Optional, Dict, Any

class ErrorDetail(BaseModel):
    code: str
    message: str
    step: Optional[int] = None
    details: Optional[Dict[str, Any]] = None

class RFC7807Error(BaseModel):
    error: ErrorDetail
```
Các mã lỗi chuẩn: `CUDA_OUT_OF_MEMORY`, `TASK_ALREADY_RUNNING`, `MODEL_NOT_FOUND`, `DOWNLOAD_IN_PROGRESS`, `INVALID_CUE_TIMING`.

## 5. Xử lý Âm thanh DSP & Hòa âm
- **Silence Gap Borrowing**: Tận dụng khoảng lặng giữa 2 câu thoại để câu dịch không bị tăng tốc độ quá nhanh ($R_{speed} \le 2.0$).
- **Audio Ducking**: Tự động giảm âm lượng BGM với Attack 150ms / Release 400ms và duck volume -16.5 dB.
- **Timing Synchronization**: Cung cấp endpoint `/api/step3/sync-subtitles` để tự động dời `placedStartTime` và `placedEndTime` khi câu đọc AI có độ dài vượt quá mốc thời gian gốc.
