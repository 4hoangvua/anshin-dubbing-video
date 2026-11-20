# Frontend Architecture & Implementation Rules for Dubbing Video Studio

## 1. Nền tảng Công nghệ & Thiết kế
- **Tech Stack**: React 19 + TypeScript + Vite + Meta Astryx (`@astryxdesign/core`, StyleX) (hướng tới Desktop Studio / Tauri v2).
- **Trải nghiệm Desktop-First (CapCut-lite)**: Phản hồi tức thì (<100ms), 60 FPS mượt mà ngay cả với video dài trên 2.000 câu thoại.
- **Cô lập Design System**: Toàn bộ component UI swizzle từ Astryx đặt trong `src/design-system/` (Button, Input, Select, Slider, Dialog, Badge, Tooltip, Tabs, Toast). Tuyệt đối là pure UI (stateless hoặc UI-state only), không chứa business logic lồng tiếng.
- **Dark/Light Mode tập trung**: 100% token màu sắc, khoảng cách, viền được quản lý qua StyleX tokens tại `src/theme/tokens.stylex.ts` và overrides tại `darkTheme.stylex.ts`, `lightTheme.stylex.ts`.

## 2. Kiến trúc 6 Zustand Stores Độc lập (Isolated State Architecture)
Tuyệt đối không gộp chung dữ liệu. Hệ thống phân định nghiêm ngặt thành 6 stores:
1. **`playerStore` (60Hz Transient Playback)**:
   - Quản lý `currentTime`, `duration`, `isPlaying`, `playbackRate`, `volume`, `isMuted`, `seekTarget`.
   - **CẤM TUYỆT ĐỐI**: Không subscribe `playerStore` vào các component cha, container tổng hoặc bảng thoại `VirtualCueTable`.
   - Cập nhật Playhead và text timecode bằng transient subscription (`usePlayerStore.subscribe((state) => ...)` hoặc `requestAnimationFrame`), cập nhật trực tiếp Canvas Overlay hoặc `ref.textContent`.
2. **`cueStore` (Data & Undo/Redo Temporal Stack)**:
   - Lưu trữ mảng `cues: CueItem[]` và ngăn xếp lịch sử Undo/Redo (`past`, `future`, tối đa 50 bước).
   - Hỗ trợ thao tác cục bộ theo ID (`updateCue`, `updateText`, `updateSpeaker`, `splitCue`, `mergeCues`, `deleteCue`).
   - Tự động tính toán lại `duration = Math.max(0, endTime - startTime)` khi cập nhật mốc thời gian.
3. **`timelineStore` (Coordinates & Viewport)**:
   - Quản lý `zoom` (px/sec: 20 - 500), `scrollLeft`, `viewportWidth`, danh sách track, công cụ (`select`, `split`, `slip`), và snap grid.
4. **`projectStore` (Metadata & Pipeline)**:
   - Quản lý `project`, `settings` (DSP, Ducking, Voice Engine), `speakers: SpeakerProfile[]`, `activeStep` (1-4), và đồng bộ lưu trữ server (`saveProject`).
5. **`modelStore` (Single-Download Queue & Hub)**:
   - Quản trị trạng thái model (`🟢 Sẵn sàng` / `☁️ Chưa tải`).
   - Khóa tải đơn nhiệm (`downloadingModelId`): Chặn triệt để tải nhiều model cùng lúc.
   - Bắt luồng SSE cập nhật tiến độ tải đồng bộ cho cả Modal Hub và các nút bấm thích ứng (Morphing Action Buttons).
6. **`uiStore` (Theme & Feedback)**:
   - Quản lý `theme` ('dark' | 'light'), collapse panel, modals (`modelHub`, `settings`), và hàng đợi `toasts`, `banner`.

## 3. Quy tắc Hiệu năng 60 FPS (BẮT BUỘC)
- **Virtual Scrolling cho Bảng Thoại**: Bắt buộc dùng `@tanstack/react-virtual` cho mọi danh sách cues. Cấm dùng `cues.map()` trực tiếp. Memoize từng dòng `CueRow`.
- **Dual-Layer HTML5 Canvas Timeline**:
  - Không dùng DOM divs để dựng timeline phụ đề.
  - Tầng Base Canvas: Vẽ ruler, video track, cue boxes, audio waveform mockup. Áp dụng Viewport Culling bằng Binary Search $O(\log N)$ (chỉ vẽ cues nằm trong vùng `[scrollLeft / zoom, (scrollLeft + width) / zoom]`). Chỉ vẽ lại khi zoom, scroll, hoặc data cue thay đổi.
  - Tầng Playhead Overlay Canvas: Nằm đè lên trên, chỉ vẽ kim chỉ giờ màu đỏ theo xung nhịp 60 FPS từ `playerStore`, không bao giờ kích hoạt vẽ lại tầng Base Canvas.
  - Hỗ trợ HiDPI / Retina: Chuẩn hóa tỉ lệ canvas với `window.devicePixelRatio`.

## 4. Giao tiếp Mạng & Xử lý Lỗi chuẩn RFC 7807
- Mọi API call phải đi qua `src/core/apiClient.ts` tập trung, tự động timeout, chuẩn hóa lỗi RFC 7807 (`code`, `message`, `step`, `details`).
- Chuyển đổi mã lỗi sang thông điệp tiếng Việt thân thiện qua `src/core/errorMapper.ts`.
- Mọi luồng SSE phải dùng `src/core/sseClient.ts`, bắt lỗi trực tiếp mà không nuốt ngoại lệ (fix silent error swallow).
- Bọc toàn bộ các vùng chính bằng `src/core/ErrorBoundary.tsx` để ngăn crash trắng trang.

## 5. Quy trình Kiểm tra Bắt buộc (Verification Loop)
Trước khi kết thúc bất kỳ Phase nào hoặc commit thay đổi, bắt buộc phải chạy và đạt 100% PASS bộ 3 lệnh:
1. `npx tsc --noEmit` (0 errors)
2. `npm run lint` (0 warnings/errors)
3. `npm run build` (Build bundle thành công)

## 6. Quy tắc Phòng thủ Dữ liệu Bất biến & Chống Lỗi Truy Cập Mảng Undefined (Defensive Programming & Zero-Crash Null Safety) - [HỌC TỪ LỖI THỰC TẾ]
**Bối cảnh sự cố**: Lỗi `Cannot read properties of undefined (reading 'length')` từng xuất hiện nhiều lần làm sập `ErrorBoundary` của Video Player & Timeline khi dữ liệu store chưa kịp nạp xong hoặc sau khi reset dự án.

**CÁC NGUYÊN TẮC BẮT BUỘC TUÂN THỦ TOÀN BỘ CODEBASE:**
1. **Cấm gọi thuộc tính/phương thức mảng trực tiếp khi chưa kiểm tra `Array.isArray()`**:
   - Tuyệt đối KHÔNG viết `cues.length`, `cues.find(...)`, `cues.map(...)`, `targetTimes.length`, `videoClips.find(...)`, `[...cues]` trực tiếp.
   - Luôn sử dụng fallback chuẩn hóa an toàn:
     ```typescript
     // Tại cấp component:
     const EMPTY_CUES: CueItem[] = [];
     const rawCues = useCueStore((s) => s.cues);
     const cues = Array.isArray(rawCues) ? rawCues : EMPTY_CUES;
     ```
2. **Quy tắc Guard Clause bắt buộc tại tầng Utility toán học**:
   - Mọi hàm trong `src/utils/` (`binarySearch.ts`, `snapping.ts`, `canvasDraw.ts`, `filmstripCache.ts`) nhận tham số mảng BẮT BUỘC phải có guard clause ở dòng đầu tiên:
     ```typescript
     if (!arr || !Array.isArray(arr) || arr.length === 0) return defaultVal;
     ```
3. **Phòng thủ tại Setter của Zustand Stores**:
   - Mọi Action nhận mảng (như `setCues`, `setSelectedCueIds`, `setVideoClips`, `deleteMultipleCues`) bắt buộc phải bọc an toàn:
     ```typescript
     setSelectedCueIds: (ids) => {
       const safeIds = Array.isArray(ids) ? ids : [];
       set({ selectedCueIds: safeIds, selectedCueId: safeIds.length > 0 ? safeIds[0] : null });
     }
     ```
4. **Phòng thủ Spread Operator `[...arr]`**:
   - Không bao giờ spread trực tiếp `[...cues]` vì nếu `cues` là `undefined` hoặc `null` sẽ gây ra ngoại lệ nghiêm trọng `TypeError: undefined is not iterable`.
   - Bắt buộc dùng: `[...(Array.isArray(cues) ? cues : [])]`.

