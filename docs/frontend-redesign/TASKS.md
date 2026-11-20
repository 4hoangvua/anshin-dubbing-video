 KHAI TÁI CẤU TRÚC FRONTEND STUDIO (`dubbing-video`)

> **Quy tắc bắt buộc**: Thực hiện tuần tự từng Phase (Phase 0 -> Phase 4).
> Sau khi hoàn thành mỗi Phase, bắt buộc chạy và báo cáo bộ 3 lệnh kiểm tra:
> 1. `npx tsc --noEmit`
> 2. `npm run lint`
> 3. `npm run build`
> Chỉ khi cả 3 lệnh **PASS 100%** mới được cập nhật dấu `[x]` và xin ý kiến xác nhận của người dùng trước khi chuyển sang Phase kế tiếp.

---

## BẢNG TIẾN ĐỘ TỔNG QUAN

| Giai đoạn | Nội dung trọng tâm | Trạng thái | Verification Gate |
|:---|:---|:---:|:---:|
| **Phase 0** | Khung nền tảng (Foundation), StyleX Tokens, 6 Zustand Stores, Core Network & Error | `[x] Hoàn thành` | PASS 100% |
| **Phase 1** | Astryx Design System Swizzle & Studio Layout Shell Responsive | `[x] Hoàn thành` | PASS 100% |
| **Phase 2** | VirtualCueTable (TanStack Virtual), VideoPlayer (Transient 60Hz) & Undo/Redo | `[x] Hoàn thành` | PASS 100% |
| **Phase 3** | Dual-Layer HTML5 Canvas Timeline 60 FPS (Viewport Culling & Playhead) | `[x] Hoàn thành` | PASS 100% |
| **Phase 4** | Ghép nối 4 Steps Pipeline, In-App Model Hub, Phím tắt & Đóng gói hoàn thiện | `[x] Hoàn thành` | PASS 100% |

---

## CHI TIẾT CÁC PHASE & NHIỆM VỤ

### 📌 PHASE 0: SETUP FOUNDATION, THEME TOKENS, 6 STORES & CORE NETWORK
*Mục tiêu: Thiết lập hệ thống thư mục mới, cấu hình token StyleX/Astryx, khởi tạo 6 Zustand stores độc lập và lớp mạng xử lý lỗi RFC 7807.*

- [x] **Task 0.1: Khởi tạo cấu trúc thư mục mới**
  - Tạo các thư mục: `src/design-system/`, `src/theme/`, `src/core/`, `src/stores/`, `src/features/`, `src/utils/`.
- [x] **Task 0.2: Thiết lập Design Tokens & Theme Mode**
  - Cấu hình `src/theme/tokens.stylex.ts` với đầy đủ bộ token: Surface (0, 1, 2, active), Text (primary, secondary, muted), Border (subtle, strong), Accent (brand, success, warning, danger) và Timeline (ruler, playhead, cueBox, waveform).
  - Cấu hình `src/theme/darkTheme.stylex.ts` và `src/theme/lightTheme.stylex.ts`.
  - Cấu hình `src/theme/global.css` (reset CSS, font-family, dark scrollbar styling).
- [x] **Task 0.3: Lớp Mạng & Xử lý Lỗi chuẩn RFC 7807**
  - Triển khai `src/core/apiClient.ts`: Fetch client chuẩn hóa lỗi, timeout, tự động parse RFC 7807 error format.
  - Triển khai `src/core/errorMapper.ts`: Ánh xạ mã lỗi `CUDA_OUT_OF_MEMORY`, `TASK_ALREADY_RUNNING`, `MODEL_NOT_FOUND` sang tiếng Việt thân thiện.
  - Triển khai `src/core/sseClient.ts`: Hook/Helper kết nối Server-Sent Events với cờ error không nuốt ngoại lệ.
  - Triển khai `src/core/ErrorBoundary.tsx`: Fallback UI bảo vệ component không làm trắng trang.
- [x] **Task 0.4: Khởi tạo 6 Zustand Stores độc lập**
  - `src/stores/playerStore.ts`: 60Hz transient state (`currentTime`, `duration`, `isPlaying`, `playbackRate`, `volume`, `seekTarget`).
  - `src/stores/cueStore.ts`: Danh sách câu thoại kèm ngăn xếp lịch sử Undo/Redo (`past`, `future`, tối đa 50 bước).
  - `src/stores/timelineStore.ts`: Quản lý tọa độ timeline, zoom (px/s), scrollLeft, công cụ (`select`, `split`, `slip`).
  - `src/stores/projectStore.ts`: Metadata dự án, thông số DSP, danh sách Speaker, bước active (1-4).
  - `src/stores/modelStore.ts`: Quản trị trạng thái model, khóa tải đơn nhiệm (`downloadingModelId`), bắt stream tiến độ SSE.
  - `src/stores/uiStore.ts`: Dark/Light theme, modal active, layout collapse, hàng đợi Toasts & Banner.
- [x] **Verification Gate Phase 0**:
  - [x] `npx tsc --noEmit` không lỗi.
  - [x] `npm run lint` không warning/error.
  - [x] `npm run build` thành công.

---

### 📌 PHASE 1: ASTRYX DESIGN SYSTEM SWIZZLE & RESPONSIVE STUDIO LAYOUT
*Mục tiêu: Đóng gói các UI component nguyên tử trong `src/design-system/` và dựng Layout Shell 3 ngưỡng responsive.*

- [x] **Task 1.1: Swizzle / Đóng gói Core UI Components (`src/design-system/`)**
  - `Button`: Biến thể `primary`, `secondary`, `outline`, `ghost`, `danger`, hỗ trợ loading spinner và icon.
  - `Input`: Ô nhập text, number có prefix/suffix icon và error state.
  - `Select`: Dropdown chọn ngôn ngữ, chọn model, chọn speaker theo WAI-ARIA.
  - `Slider`: Thanh trượt mượt mà cho Volume, Speed factor, Timeline Zoom.
  - `Dialog` (Modal): Khung backdrop, header, body, footer cho ModelHub & Cài đặt.
  - `Badge`: Thẻ hiển thị trạng thái `🟢 Sẵn sàng`, `☁️ Chưa tải`, Speaker color tag.
  - `Tooltip`: Tooltip giải thích phím tắt và chỉ số kỹ thuật.
  - `Tabs`: Bộ chuyển tab cho Inspector và Compact layout.
  - `Toast`: Khung thông báo popup góc dưới/trên màn hình.
- [x] **Task 1.2: Dựng Studio Header & Status Bar**
  - `StudioHeader.tsx`: Hiển thị tên video, nút Quick Save, nút Model Hub, công tắc Theme Dark/Light.
  - `StatusBar.tsx`: Hiển thị thông số GPU thực tế (Tên GPU, VRAM trống / tổng VRAM) và trạng thái Backend.
- [x] **Task 1.3: Dựng Step Navigator (Wizard Bar)**
  - `StepNavigator.tsx`: Thanh điều hướng 4 bước trực quan:
    1. Nhận diện (Recognition)
    2. Dịch thuật (Translation)
    3. Lồng tiếng (Narration)
    4. Xuất bản (Export)
- [x] **Task 1.4: Triển khai Ma trận Responsive Layout Shell**
  - `>= 1440px`: Hiển thị 3 cột chuẩn Studio (Left: Step Panel, Center: Player & Timeline, Right: Cue Table & Inspector).
  - `1280px - 1439px`: Hiển thị 2 cột, Inspector thu vào Drawer tự động.
  - `< 1280px`: Hiển thị chế độ Tabbed Workspace bảo toàn độ rộng chỉnh sửa.
- [x] **Verification Gate Phase 1**:
  - [x] `npx tsc --noEmit` không lỗi.
  - [x] `npm run lint` không warning/error.
  - [x] `npm run build` thành công.

---

### 📌 PHASE 2: HIGH-PERFORMANCE DATA & MEDIA VIEWERS (60 FPS)
*Mục tiêu: Nâng cấp VideoPlayer và VirtualCueTable hoạt động mượt mà với 2.000+ câu thoại, cách ly hoàn toàn xung nhịp 60Hz.*

- [x] **Task 2.1: Triển khai VirtualCueTable tối ưu hóa cao**
  - Tích hợp `@tanstack/react-virtual` cuộn ảo mượt mà với danh sách 2.000+ câu thoại.
  - Tối ưu hóa memoization cho từng dòng `CueRow.tsx` (chỉ re-render dòng đang sửa hoặc dòng có ID thay đổi).
  - Tích hợp gán Speaker nhanh với mã màu trực quan.
  - Tích hợp ô tìm kiếm lọc câu nhanh và bộ lọc `câu cần xem xét` (needsReview).
- [x] **Task 2.2: Tích hợp Lịch sử Chỉnh sửa Undo / Redo cho CueStore**
  - Hỗ trợ phím tắt `Ctrl+Z` (Undo) và `Ctrl+Y` / `Ctrl+Shift+Z` (Redo).
  - Đảm bảo snapshot chỉ ghi nhận các hành vi thay đổi dữ liệu (sửa text, đổi speaker, đổi thời lượng, tách/gộp câu).
- [x] **Task 2.3: Triển khai VideoPlayer với Transient Subscriptions**
  - Kết nối HTML5 Video element với `playerStore`.
  - Cơ chế cập nhật Playhead 60Hz: Dùng `requestAnimationFrame` và transient `playerStore.subscribe`, không đẩy state 60Hz vào cây React component.
  - Tích hợp Subtitle Overlay hiển thị phụ đề thời gian thực nổi trên video preview.
  - Hỗ trợ Range Requests HTTP 206 để tua video dung lượng lớn không giật lag.
- [x] **Verification Gate Phase 2**:
  - [x] `npx tsc --noEmit` không lỗi.
  - [x] `npm run lint` không warning/error.
  - [x] `npm run build` thành công.

---

### 📌 PHASE 3: DUAL-LAYER HTML5 CANVAS TIMELINE (60 FPS)
*Mục tiêu: Xây dựng Timeline biên tập đa track (CapCut-lite) vẽ trực tiếp trên HTML5 Canvas, hỗ trợ Viewport Culling và Playhead Overlay riêng biệt.*

- [x] **Task 3.1: Bộ tính toán Tọa độ & Viewport Culling**
  - Xây dựng `src/utils/binarySearch.ts` tìm kiếm câu thoại trong viewport với độ phức tạp $O(\log N)$.
  - Xây dựng `src/utils/canvasDraw.ts` vẽ hộp cue bo góc, nhãn speaker, văn bản rút gọn (text truncation).
- [x] **Task 3.2: Tầng Base MultiTrackCanvas**
  - Vẽ thước thời gian (Timeline Ruler) với các vạch giây / mili-giây co giãn theo mức Zoom.
  - Vẽ track Video Clip, track Câu thoại (Cues), và track Âm thanh (Audio Waveform dạng mockup/thực tế).
  - Chỉ vẽ lại khi: người dùng cuộn ngang, zoom, hoặc danh sách cues thay đổi.
- [x] **Task 3.3: Tầng PlayheadCanvas Overlay (60Hz)**
  - Tách riêng trên thẻ `<canvas>` trong suốt nằm đè lên trên.
  - Đăng ký transient listener lắng nghe `currentTime` từ `playerStore`.
  - Di chuyển kim Playhead mượt mà 60 FPS mà không làm vẽ lại các track phụ đề bên dưới.
- [x] **Task 3.4: Tương tác Timeline (Scrubbing, Zooming, Selecting)**
  - Kéo kim Playhead (Scrubbing) tua video tức thời.
  - Cuộn chuột + Ctrl / Slider để phóng to thu nhỏ Timeline (Zoom 20px/s đến 500px/s).
  - Click chọn cue trên timeline -> tự động cuộn VirtualCueTable tới câu tương ứng (`scrollToIndex`).
  - Hỗ trợ thao tác kéo mép (Resize) điều chỉnh `startTime` và `endTime` của câu thoại.
- [x] **Verification Gate Phase 3**:
  - [x] `npx tsc --noEmit` không lỗi.
  - [x] `npm run lint` không warning/error.
  - [x] `npm run build` thành công.

---

### 📌 PHASE 4: FEATURE STEPS, MODEL HUB & PRODUCTION POLISH
*Mục tiêu: Hoàn thiện 4 bước nghiệp vụ, nâng cấp Model Hub với Smart Action Buttons, kiểm thử toàn diện.*

- [x] **Task 4.1: Tái cấu trúc 4 Bước Pipeline (Step Panels)**
  - `Step1Recognition.tsx`: Tùy chọn Whisper/OCR, VAD, Smart Split, thanh tiến trình nhận diện SSE.
  - `Step2Translation.tsx`: Chọn sắc thái (Persona), văn phong (Genre), dịch hàng loạt và dịch đơn lẻ với Hy-MT2 1.8B.
  - `Step3Narration.tsx`: Gán 18 giọng đọc VieNeu bản địa, công tắc mượn khoảng lặng (Borrow Gap), nghe thử từng câu và đồng bộ phụ đề.
  - `Step4Export.tsx`: Cấu hình Audio Ducking (Attack 150ms / Release 400ms), xuất phụ đề mềm/cứng, thanh tiến trình render video FFmpeg/NVENC.
- [x] **Task 4.2: Tái cấu trúc In-App Model Hub & Morphing Action Buttons**
  - Khóa tải đơn nhiệm (`CURRENT_DOWNLOADING_MODEL_ID`): Ngăn chặn bấm tải cùng lúc nhiều model.
  - Các nút hành động chính (Run Action Button) tự động biến đổi thành `[ ⬇️ Tải mô hình này ]` nếu model chưa được nạp.
  - Gợi ý cấu hình tự động dựa trên GPU VRAM máy tính quét được từ `/api/models/recommendations`.
- [x] **Task 4.3: Tích hợp Bộ Phím tắt Biên tập Video Chuẩn (CapCut/Premiere-like)**
  - `Space`: Play / Pause video.
  - `J` / `K` / `L`: Tua lùi, Dừng, Tua tới.
  - `Ctrl + Z` / `Ctrl + Y`: Undo / Redo chỉnh sửa.
  - `Ctrl + S`: Lưu dự án tức thì.
  - `S` (khi đang chọn cue): Tách câu tại vị trí Playhead.
  - `Delete` / `Backspace`: Xóa câu đang chọn.
- [x] **Task 4.4: Kiểm thử Toàn diện & Nghiệm thu Sản phẩm**
  - Chạy `npx tsc --noEmit` (0 lỗi).
  - Chạy `npm run lint` (0 cảnh báo).
  - Chạy `npm run build` (Build bundle tối ưu).
  - Thử nghiệm tải dự án giả lập 2.000 câu thoại để kiểm tra FPS thực tế.
- [x] **Verification Gate Phase 4**:
  - [x] `npx tsc --noEmit` không lỗi.
  - [x] `npm run lint` không warning/error.
  - [x] `npm run build` thành công.
