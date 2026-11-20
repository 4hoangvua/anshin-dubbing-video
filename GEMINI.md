# DUBBING-VIDEO SYSTEM RULES & GUIDELINES

Dự án `dubbing-video` là hệ thống lồng tiếng video tự động và bán tự động AI chạy hoàn toàn Offline (Local), tối ưu sâu cho phần cứng phổ thông (NVIDIA GTX 1060 6GB VRAM) và giao diện Studio CapCut-lite 60 FPS.

## 1. QUY TẮC PHÁT TRIỂN FRONTEND
- **Tech Stack**: React 19 + TypeScript + Vite + Meta Astryx (`@astryxdesign/core`, StyleX) (tương thích Tauri v2 Desktop).
- **Thiết kế UI & Design System**:
  - Toàn bộ component UI swizzle từ Astryx đặt trong `src/design-system/` (pure UI, không chứa business logic lồng tiếng).
  - Quản trị màu sắc Dark/Light tập trung qua StyleX tokens tại `src/theme/tokens.stylex.ts`.
- **Hiệu năng 60 FPS (BẮT BUỘC)**:
  - Phân tách nghiêm ngặt 6 Zustand stores: `playerStore` (60Hz transient), `cueStore` (Undo/Redo), `timelineStore`, `projectStore`, `modelStore`, `uiStore`.
  - CẤM subscribe `playerStore` từ bảng câu thoại hoặc container cha. Playhead cập nhật qua transient `usePlayerStore.subscribe` vẽ trên Canvas Overlay riêng hoặc `ref.textContent`.
  - Bảng câu thoại bắt buộc dùng `@tanstack/react-virtual`.
  - Timeline biên tập bắt buộc dùng HTML5 2D Canvas với Viewport Culling theo Binary Search $O(\log N)$.
- **Xử lý Lỗi & Network**:
  - Mọi API/SSE request đi qua `src/core/apiClient.ts` và `src/core/errorMapper.ts` (chuẩn RFC 7807), hiển thị qua Toast/Banner từ `uiStore`, bọc ngoài bằng `ErrorBoundary`.
- **Defensive Null-Safety & Zero-Crash (BẮT BUỘC & HỌC TỪ LỖI THỰC TẾ)**:
  - CẤM TUYỆT ĐỐI gọi `.length`, `.find()`, `.filter()`, `.map()`, `[...arr]` trên mảng khi chưa kiểm tra `Array.isArray()`.
  - Mọi hàm trong `src/utils/` (`binarySearch`, `snapping`, `canvasDraw`) bắt buộc có Guard Clause ở dòng đầu: `if (!arr || !Array.isArray(arr) || arr.length === 0) return defaultVal;`.
  - Mọi Component UI và Store Setter phải fallback mảng bằng `const safe = Array.isArray(val) ? val : [];` để chặn đứng 100% lỗi `Cannot read properties of undefined (reading 'length')`.
- **Verification Gates**:
  - Mọi thay đổi code phải kiểm tra và vượt qua bộ 3 lệnh: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## 2. QUY TẮC PHÁT TRIỂN BACKEND
- **FastAPI Core**: Chạy tại `127.0.0.1:8765`, CORS hỗ trợ origin web và tauri.
- **Single-Active Engine & Deadlock Prevention**:
  - Dùng `ThreadPoolExecutor(max_workers=1)` khóa hàng đợi GPU.
  - Cơ chế `acquire_slot()` tự động thu hồi tài nguyên của phiên cũ khi cùng `projectId`, loại bỏ lỗi `TASK_ALREADY_RUNNING`.
- **Zero-Leak VRAM Lifecycle**:
  - Tại một thời điểm chỉ nạp 1 model AI vào VRAM. Thu hồi triệt để `gc.collect()` và `torch.cuda.empty_cache()` khi kết thúc tác vụ.
  - Sidecar `llama-server.exe` tự động khởi động khi dịch Step 2 và tự hủy tiến trình khi dịch xong.
- **Single-Download Queue Lock**:
  - Khóa toàn cục `CURRENT_DOWNLOADING_MODEL_ID` ngăn tải nhiều model đồng thời.
  - Tải qua CDN Mirror (`hf-mirror.com`) với SSE stream tiến độ % real-time.
- **Media & Audio DSP**:
  - `/api/media/stream` bắt buộc hỗ trợ HTTP 206 Range Requests.
  - Tự động áp dụng Audio Ducking (-16.5 dB, Attack 150ms / Release 400ms) và Silence Gap Borrowing.
  - Chuẩn hóa response lỗi theo chuẩn RFC 7807.
