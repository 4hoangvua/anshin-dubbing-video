# Backend Architecture & Implementation Rules for Dubbing Video

## 1. Server Configuration & Threading
- **Host & Port:** FastAPI chạy cục bộ tại `127.0.0.1:8765`.
- **CORS:** Kích hoạt CORS cho phép các origin cục bộ (`http://localhost:5173`, `http://tauri.localhost`, `tauri://localhost`).
- **GPU Queue Management:**
  - Bắt buộc dùng `concurrent.futures.ThreadPoolExecutor(max_workers=1)` cho mọi tác vụ gọi AI/GPU.
  - Tuyệt đối không cho phép 2 tác vụ AI chạy song song trên GPU (NVIDIA GTX 1060 6GB VRAM có giới hạn).

## 2. Quản lý Bộ nhớ VRAM & Model Lifecycle
- **Quy tắc Single Model:** Tại một thời điểm, chỉ nạp đúng 1 model AI vào VRAM (ASR/OCR hoặc MT hoặc TTS).
- **Thu hồi bộ nhớ tức thì:** Khi kết thúc tác vụ AI hoặc khi người dùng chuyển bước, giải phóng tài nguyên triệt để:
  ```python
  import gc
  import torch
  gc.collect()
  if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  ```
- **Không can thiệp mã nguồn gốc:** Tuyệt đối không sửa code bên trong `asr-ocr/`, `mt-translation/`, `tts-vieneu/`. Chỉ viết Adapter gọi qua `subprocess.Popen` hoặc script bridge trỏ đúng `python.exe` trong `venv` của từng module.

## 3. Giao tiếp Thời gian thực (Real-time Streaming)
- Sử dụng **Server-Sent Events (SSE)** (`StreamingResponse(..., media_type="text/event-stream")`) để truyền tiến độ cho các tác vụ tốn thời gian:
  ```json
  data: {"step": "recognition", "status": "processing", "progress": 45.5, "message": "Đang nhận diện câu 15/30...", "cue": {...}}
  ```
- Kết thúc stream bằng event `{"status": "completed", "result": {...}}` hoặc `{"status": "error", "error": "..."}`.

## 4. Truyền tải Video/Audio (Media Streaming)
- Endpoint `/api/media/stream` bắt buộc hỗ trợ **HTTP Range Requests (Status Code 206 Partial Content)**.
- Cho phép trình duyệt và video player tua (seek) tùy ý mượt mà mà không nạp toàn bộ file dung lượng lớn vào RAM.

## 5. Xử lý & Hòa âm (Audio Mixing & Export)
- **Chuẩn hóa Audio:** Tạo timeline audio bằng `numpy` và `soundfile` ở tần số lấy mẫu cố định (24kHz hoặc 44.1kHz).
- **Time-Stretching:** Sử dụng `pyrubberband` hoặc thuật toán WSOLA co giãn thời lượng để khớp `speed_factor` của từng cue.
- **Ducking:** Hạ âm lượng nhạc nền (BGM) xuống mức cấu hình (ví dụ -12 dB) với attack 150ms và release 400ms trong các khoảng thời gian có tiếng lồng tiếng.
- **Ghép Video Cuối cùng:** Gọi FFmpeg CLI với `-c:v copy -c:a aac -b:a 192k` để mux video cực nhanh mà không re-encode lại hình ảnh.
