# Backend Architecture & Implementation Rules for Dubbing Video Core

## 1. Cấu hình Server & Điều phối GPU (Single-Active Engine)
- **Host & Port**: FastAPI chạy cục bộ tại `127.0.0.1:8765`.
- **CORS**: Cho phép các origin cục bộ: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://tauri.localhost`, `tauri://localhost`.
- **GPU Queue Scheduler & Deadlock Prevention**:
  - Dùng `concurrent.futures.ThreadPoolExecutor(max_workers=1)` cho mọi tác vụ AI/GPU.
  - Tuyệt đối cấm chạy song song 2 tác vụ AI trên GPU (mục tiêu tối ưu cho VRAM 6GB như NVIDIA GTX 1060).
  - Hàm `acquire_slot()` bắt buộc có cơ chế tự động giải phóng slot cũ nếu nhận request mới từ cùng một dự án, loại bỏ hoàn toàn lỗi kẹt `TASK_ALREADY_RUNNING`.

## 2. Quản trị Tài nguyên & Zero-Leak VRAM Lifecycle
- **Single-Active Model**: Tại một thời điểm, chỉ một model AI được nạp vào VRAM (hoặc Faster-Whisper, hoặc Hy-MT2, hoặc VieNeu).
- **Thu hồi VRAM triệt để**: Khi tác vụ kết thúc hoặc chuyển bước:
  ```python
  import gc
  import torch
  gc.collect()
  if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  ```
- **Sidecar Lifecycle Manager (`llama-server.exe`)**:
  - Tự động kiểm tra `bin/llama-server.exe` (`ensure_llama_server`). Nếu chưa có, tự động tải portable binary từ nguồn uy tín.
  - Khởi động subprocess khi bắt đầu dịch Step 2 và tự động hủy tiến trình khi dịch xong để hệ điều hành thu hồi 100% VRAM (Zero-Leak).

## 3. Khóa Tải Đơn nhiệm (Single-Download Queue Lock)
- Khóa toàn cục `CURRENT_DOWNLOADING_MODEL_ID`: Tại một thời điểm chỉ cho phép tải duy nhất 1 model AI.
- Sử dụng endpoint CDN Mirror (`hf-mirror.com`) khi tải từ HuggingFace để đảm bảo tốc độ 15-40 MB/s tại Việt Nam.
- Truyền tiến độ tải dạng SSE stream (`GET /api/models/download-stream` hoặc tương đương).

## 4. Giao tiếp Thời gian thực (SSE) & Chuẩn Lỗi RFC 7807
- Mọi luồng xử lý dài (Nhận diện ASR, Dịch MT, Tổng hợp TTS, Xuất video) bắt buộc sử dụng **Server-Sent Events (SSE)** (`StreamingResponse(..., media_type="text/event-stream")`).
- Đảm bảo flush dữ liệu liên tục (`yield f"data: {json.dumps(payload)}\n\n"`).
- Khi có lỗi nghiệp vụ hoặc ngoại lệ, bắt buộc trả về response chuẩn **RFC 7807**:
  ```json
  {
    "error": {
      "code": "CUDA_OUT_OF_MEMORY",
      "message": "Không đủ bộ nhớ VRAM để khởi chạy mô hình Whisper Medium.",
      "step": 1,
      "details": { "free_vram_mb": 420, "required_vram_mb": 2048 }
    }
  }
  ```

## 5. Truyền tải Video & Audio (HTTP 206 Partial Content)
- Endpoint `/api/media/stream` bắt buộc hỗ trợ **HTTP Range Requests (Status Code 206 Partial Content)**.
- Cho phép trình duyệt tua (seek) video dung lượng lớn (1GB - 5GB) tức thời mà không nạp toàn bộ file vào RAM server.

## 6. Xử lý Âm thanh DSP & Hòa âm (Audio Ducking, Gap Borrowing & Subtitle Sync)
- **Thuật toán Mượn khoảng lặng (Silence Gap Borrowing)**: Tận dụng khoảng lặng tự nhiên giữa các câu thoại gốc để nới rộng thời gian đọc cho câu dịch ($R_{speed} = \operatorname{clamp}(R_{raw}, 1.0, 2.0)$).
- **Audio Ducking**: Tự động hạ âm lượng nhạc nền BGM xuống tỉ lệ cấu hình (mặc định -16.5 dB) với attack 150ms và release 400ms khi có giọng thuyết minh AI.
- **Timing Offset & Chống Đè giọng (Collision Prevention)**:
  - Cung cấp API `/api/step3/sync-subtitles` và `/api/step3/timing-offset` để căn chỉnh lại `placedStartTime`, `placedEndTime` khi câu đọc thực tế dài hơn thời lượng gốc.
- **Xuất video cuối cùng (Muxing)**: Gọi FFmpeg CLI với `-c:v copy -c:a aac -b:a 192k` để ghép âm thanh và video thành phẩm siêu nhanh mà không phải re-encode lại luồng hình ảnh.
