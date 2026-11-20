---
name: frontend-studio-architecture
description: >-
  Hướng dẫn và quy chuẩn thiết kế, xây dựng và bảo trì giao diện Frontend Studio
  (React 19, Meta Astryx / StyleX, 6 Zustand stores, 60 FPS Virtual Table & Canvas Timeline, RFC 7807).
  Sử dụng khi phát triển, sửa đổi hoặc thêm tính năng vào frontend của dự án dubbing-video.
---

# Frontend Studio Architecture & Implementation Guide

Skill này hướng dẫn chi tiết cách tổ chức và phát triển các thành phần trong Frontend Studio của `dubbing-video` theo tiêu chuẩn CapCut-lite 60 FPS.

## 1. Cấu trúc 6 Zustand Stores & Nguyên tắc Phân tách
Mỗi store đảm nhiệm một vai trò độc lập:
1. `playerStore`: Trạng thái playback thời gian thực (60Hz).
   - Chỉ cập nhật Playhead và Timecode display thông qua transient subscription:
     ```typescript
     // ✅ ĐÚNG: Transient subscription không gây re-render component
     useEffect(() => {
       const unsub = usePlayerStore.subscribe(
         (state) => state.currentTime,
         (currentTime) => {
           if (timeRef.current) timeRef.current.textContent = formatTime(currentTime);
         }
       );
       return unsub;
     }, []);

     // ❌ SAI: Gây re-render 60 lần/giây cho cả component
     const currentTime = usePlayerStore((s) => s.currentTime);
     ```
2. `cueStore`: Lưu trữ `cues: CueItem[]` và quản lý Undo/Redo:
   - Ngăn xếp `past` và `future` (tối đa 50 bước).
   - Mọi thao tác chỉnh sửa dữ liệu (`updateCue`, `splitCue`, `mergeCues`, `deleteCue`) phải đẩy snapshot vào `past`.
3. `timelineStore`: Tỉ lệ co giãn `zoom` (px/sec), `scrollLeft`, kích thước track, và công cụ active.
4. `projectStore`: Cấu hình dự án, danh sách `speakers`, tiến trình bước 1-4, và `saveProject`.
5. `modelStore`: Danh mục mô hình AI, khóa tải đơn nhiệm (`downloadingModelId`), bắt stream tiến độ SSE.
6. `uiStore`: Quản trị theme Dark/Light, trạng thái modal, và hàng đợi Toast/Banner thông báo.

## 2. Quy tắc Swizzle Astryx Design System (`src/design-system/`)
- Mọi component trong `src/design-system/` phải là **Pure UI Component**.
- Không được import bất kỳ store nghiệp vụ nào (`cueStore`, `projectStore`...) vào trong `design-system/`.
- Styling 100% bằng StyleX tokens từ `src/theme/tokens.stylex.ts`.

## 3. Virtual Scrolling với `@tanstack/react-virtual`
- Danh sách câu thoại trong `VirtualCueTable` bắt buộc bọc qua `useVirtualizer`.
- Cấu hình đệm `overscan: 5` để cuộn mượt mà.
- Bọc từng `CueRow` trong `React.memo` với custom comparator để chỉ re-render dòng có dữ liệu thay đổi.

## 4. Xử lý Lỗi RFC 7807 & Kết nối Mạng
- Mọi request API phải dùng hàm tiện ích từ `src/core/apiClient.ts`.
- Khi API trả về lỗi:
  ```typescript
  try {
    const res = await apiClient.post('/api/step1/recognize', body);
  } catch (err: any) {
    const userMessage = mapErrorToUserMessage(err);
    useUIStore.getState().addToast({ type: 'error', title: 'Lỗi nhận diện', description: userMessage });
  }
  ```

## 5. Quy trình Kiểm thử Bắt buộc (Verification Loop)
Trước khi bàn giao kết quả bất kỳ task nào, chạy lệnh:
```bash
npx tsc --noEmit && npm run lint && npm run build
```
Đảm bảo 100% PASS không có lỗi cú pháp hoặc type error.

## 6. Bảng Thuộc tính & Tương tác Trực tiếp trên Video Preview
- **`PropertiesInspector`**:
  - Tùy chỉnh chi tiết Typography (Font, Size, B/I/U, Align, Box width).
  - Tùy biến Màu sắc, Viền Stroke, Đổ bóng Shadow, Hộp nền Background Box.
  - Tùy biến Âm lượng (0-200%) và Tốc độ phát (0.5x-2.0x).
  - Tính năng đồng bộ: `⚡ Đồng bộ cho phân vai [Speaker]` & `🌐 Đồng bộ cho TẤT CẢ` kèm Toast thông báo số câu cập nhật.
  - Nút lưu nhanh phụ đề lên máy chủ kèm phản hồi trạng thái.
- **`SubtitleSelectionOverlay` (Direct Manipulation trên Video Preview - Chuẩn CapCut / LemyLoi)**:
  - Bounding Box nét mảnh đứt kèm 4 chốt góc tròn (co giãn font size) và 2 chốt cạnh bên (co giãn box width).
  - Thao tác kéo rê phụ đề tự do trên màn hình video (cập nhật `position: { x, y }`).
  - **Quy tắc hiển thị nghiêm ngặt**:
    1. Khi video đang phát (`isPlaying === true`): Khung chọn ẩn hoàn toàn để không cản trở xem trước video.
    2. Khi video dừng (`!isPlaying`): Khung chọn CHỈ hiển thị nếu `currentTime` nằm trong khoảng thời gian `[startTime, endTime]` của câu đó (ngăn chặn đóng băng chữ phụ đề cũ khi video đã chạy qua phân đoạn khác).
  - **Zero-Lag Performance**: Trong lúc rê chuột (`pointermove`), chỉ cập nhật style DOM qua `transform: translate3d(x, y, 0)`; chỉ commit vào `cueStore` (lưu history) khi nhả chuột (`pointerup`).
- **`SubtitleOverlay` (Lớp hiển thị phụ đề thời gian thực 60Hz)**:
  - Lắng nghe cả `playerStore` (mốc thời gian playback) VÀ `cueStore` (thay đổi kiểu dáng, nội dung chữ).
  - Áp dụng ngay lập tức định dạng mới (font, màu, viền, nền, vị trí) lên màn hình mà không bắt buộc người dùng phải chọn lại hoặc chuyển track.
- **Nguyên tắc phát thanh lồng tiếng thử nghiệm (Narration Preview Guard)**:
  - Chỉ tự động phát âm thanh thuyết minh AI khi video đang thực sự chạy (`isPlaying === true`).
  - Khi video đang dừng, việc nhấp chọn câu thoại hoặc kéo Playhead tua mốc thời gian phải tuyệt đối im lặng, không tự ý phát âm thanh.

