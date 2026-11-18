# Frontend Architecture & Implementation Rules for Dubbing Video

## 1. Công nghệ & Nền tảng
- **Tech Stack:** Vite + React 19 + TypeScript + Tailwind CSS (chuẩn bị sẵn sàng cho Tauri v2).
- **Desktop First:** Ưu tiên tối đa trải nghiệm máy tính để bàn (Desktop layout), độ phản hồi tức thì (<100ms), không giật lag.

## 2. Quy tắc Ảo hóa Danh sách Cues (Virtual Scrolling) - BẮT BUỘC
- Mọi danh sách hiển thị phụ đề/cues (ở Bước 1, Bước 2, Bước 3) **bắt buộc sử dụng `@tanstack/react-virtual`**.
- Tuyệt đối không dùng `array.map()` thông thường để render danh sách cues dài.
- Chỉ render các thẻ DOM nằm trong vùng nhìn thấy (viewport) cộng 3-5 phần tử đệm (overscan). Đảm bảo giao diện duy trì 60 FPS mượt mà kể cả khi video có hơn 1.000 câu thoại.

## 3. Phân tách Store Trạng thái (Zustand State Isolation)
Không gộp chung toàn bộ dữ liệu vào một Store khổng lồ như Lemyloi. Bắt buộc tách thành 3 Store độc lập:
1. **`projectStore`**: Lưu metadata dự án (`id`, `name`, `media_path`, `speakers`, `active_step`, `settings`).
2. **`cueStore`**: Lưu mảng `cues` và các action thao tác câu (`updateCueText`, `updateCueSpeaker`, `splitCue`, `mergeCues`, `updateCueAudio`).
   - Cung cấp cơ chế update theo ID cục bộ để tránh re-render các câu không bị ảnh hưởng.
3. **`playerStore`**: Quản lý trạng thái video phát sóng (`currentTime`, `duration`, `isPlaying`, `volume`).
   - Cập nhật tần số cao (60 Hz) nhưng chỉ những component cần hiển thị thời gian hoặc thanh trượt mới lắng nghe `playerStore`. Bảng cues không được lắng nghe trực tiếp `currentTime` của `playerStore` nếu không cần thiết.

## 4. Kiến trúc Giao diện Split-View Studio
- **Vùng bên trái (40% - 45%):**
  - Trình phát Video HTML5 Native (kết nối endpoint `/api/media/stream` qua HTTP 206).
  - Lớp phủ phụ đề (Subtitle Overlay) hiển thị câu thoại hiện tại theo thời gian thực.
  - Cụm điều khiển Play/Pause, tua lùi 5s, tua tới 5s, thanh trượt thời gian.
- **Vùng bên phải (55% - 60%):**
  - Thanh Tab 4 bước trực quan: `[1. Nhận diện] -> [2. Dịch thuật] -> [3. Lồng tiếng] -> [4. Xuất file]`.
  - Không gian thao tác theo từng bước:
    - Bước 1 (Recognition): Bảng câu gốc, gán Speaker, sửa text, nút Play nghe câu lẻ.
    - Bước 2 (Translation): Bảng 2 cột song song (Gốc - Dịch), cấu hình xưng hô, sửa câu dịch, nút Dịch lại câu lẻ.
    - Bước 3 (Narration): Bảng gán Voice từng Speaker, nút Nghe thử giọng câu lẻ, nút Tạo lại giọng câu lẻ.
    - Bước 4 (Export): Tùy chỉnh tỉ lệ âm lượng BGM/Giọng đọc, nút Bắt đầu xuất video hoàn chỉnh.

## 5. Kết nối Backend & Lắng nghe SSE
- Tạo custom hook `useSSE()` để kết nối endpoint `/api/stepX/...`, nhận dữ liệu streaming JSON và cập nhật thanh tiến trình theo thời gian thực.
- Xử lý lỗi kết nối một cách êm ái (graceful fallback) và hiển thị thông báo toast rõ ràng.
