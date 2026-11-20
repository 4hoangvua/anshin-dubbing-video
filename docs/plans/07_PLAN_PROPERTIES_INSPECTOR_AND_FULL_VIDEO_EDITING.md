# KẾ HOẠCH NÂNG CẤP 07: PROPERTIES INSPECTOR, DIRECT VIDEO PREVIEW MANIPULATION & TRUE VIDEO EDITING

> **Mục tiêu**: Bóc tách toàn diện từ `lemyloi-dichvideos` và CapCut để nâng cấp hệ thống `dubbing-video` đạt chuẩn Studio chuyên nghiệp:
> 1. **Bảng điều khiển thuộc tính đa thành phần (Properties Inspector)**: Tùy biến chi tiết Subtitle Typography (Font, Size, Màu chữ, Viền chữ, Đổ bóng, Hộp nền, Vị trí X/Y), Audio Gain/Speed, và Video Properties.
> 2. **Tương tác trực tiếp trên màn hình Video Preview (Direct Manipulation)**: Kéo thả vị trí phụ đề, co giãn kích thước hộp chữ trực tiếp trên video với khung bao (Selection Bounding Box) và đường gióng bắt dính (Guide Lines).
> 3. **Kiến trúc State 60 FPS chống giật lag (Zero-Lag Re-render Avoidance)**: Phân tách luồng kéo rê transient (DOM CSS transform) khỏi state commit, Dual-layer Canvas Timeline, và cô lập subscription giữa Playback loop và Inspector Panel.
> 4. **Cắt / Ghép Video Thật & Filmstrip Thumbnails**: Quản lý đa đoạn video (`videoClips: VideoClipSegment[]`), lệnh cắt `S`/`Q`/`W` áp dụng cho cả video gốc, trích xuất thumbnail thật trên Track 2 từ Backend FFmpeg.

---

## I. BÓC TÁCH KIẾN TRÚC & GIẢI PHÁP TỪ NGUỒN THAM KHẢO (LEMYLOI-DICHVIDEOS)

### 1.1. Mô hình Quản lý Thuộc tính Đa Thành phần (Multi-Track Element Data Model)
Trong `lemyloi-dichvideos`, mỗi track chứa các phần tử (`TimelineElement`) mang thuộc tính chuyên biệt:

```typescript
// Subtitle / Text Element
export interface TextElement {
  id: string;
  type: "text";
  content: string;
  startTime: number;
  duration: number;
  // Typography
  fontFamily: string; // "Inter", "Roboto", "Montserrat", "Be Vietnam Pro"...
  fontSize: number;   // 12px - 120px
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline" | "line-through";
  textAlign: "left" | "center" | "right";
  color: string;      // Màu chữ Hex/RGBA (#FFFFFF)
  // Hiệu ứng viền (Stroke) & Đổ bóng (Shadow)
  stroke?: { color: string; width: number };
  shadow?: { color: string; offsetX: number; offsetY: number; blur: number };
  // Nền hộp chữ (Background Box)
  backgroundColor: string; // "transparent", "#000000", v.v.
  backgroundOpacity?: number;
  backgroundPaddingX?: number;
  backgroundPaddingY?: number;
  backgroundBorderRadius?: number;
  // Tọa độ và Khung bao (Transform & Box Width)
  boxWidth?: number; // % độ rộng màn hình để tự động xuống dòng (auto-wrap)
  transform: {
    position: { x: number; y: number }; // Độ lệch so với tâm video (0, 0 là chính giữa)
    scale: number;
    rotate: number;
  };
  opacity: number; // 0.0 - 1.0
}

// Audio Element
export interface AudioElement {
  id: string;
  type: "audio";
  startTime: number;
  duration: number;
  volume: number;       // 0.0 - 2.0 (0% - 200%)
  playbackRate: number; // 0.5x - 2.0x
  muted: boolean;
  duckWindows?: Array<{
    startOffset: number;
    endOffset: number;
    duckVolume: number; // Tùy chỉnh mức hạ âm lượng cho từng đoạn
  }>;
}

// Video Element (True Video Segment)
export interface VideoElement {
  id: string;
  type: "video";
  startTime: number;    // Vị trí bắt đầu trên Timeline
  duration: number;     // Thời lượng hiển thị trên Timeline
  trimStart: number;    // Điểm cắt đầu (In-point) trong file video gốc
  trimEnd: number;      // Điểm cắt đuôi (Out-point) trong file video gốc
  volume: number;       // Âm lượng video gốc (0.0 - 2.0)
  muted: boolean;
  opacity: number;
  transform: {
    position: { x: number; y: number };
    scale: number;
    rotate: number;
    flipX?: boolean;    // Lật gương video
  };
}
```

### 1.2. Bảng Điều khiển Thuộc tính (Properties Panel)
Trong `lemyloi-dichvideos/apps/web/src/components/editor/panels/properties/`:
- **Nhận diện thành phần được chọn**: Lắng nghe `useElementSelection()`. Khi người dùng click vào một element (hoặc nhiều element cùng loại), bảng sẽ tự động render view tương ứng:
  - Nếu là `text`: Hiển thị `TextProperties` (Quản lý Font chữ tiếng Việt, Kích cỡ, Kiểu B/I/U, Màu chữ, Viền stroke, Đổ bóng shadow, Nền hộp, Tọa độ X/Y).
  - Nếu là `audio`: Hiển thị `AudioProperties` (Thanh trượt Volume 0-200%, Tốc độ đọc 0.5x-2x, Pitch).
  - Nếu là `video`: Hiển thị `VideoProperties` (Âm lượng video gốc, Tỷ lệ Scale, Lật gương, Độ mờ Opacity).
- **Tính năng cực kỳ giá trị - Đồng bộ phong cách phụ đề (Sync Subtitle Styles)**:
  - `⚡ Đồng bộ cho phân vai [Speaker]`: Copy toàn bộ font, màu sắc, vị trí, viền của câu đang chọn cho tất cả các câu thoại cùng người nói.
  - `🌐 Đồng bộ cho TẤT CẢ phụ đề`: Áp dụng mẫu phụ đề chuẩn cho toàn bộ video chỉ với 1 click!

### 1.3. Tương tác Trực tiếp trên Màn hình Video Preview (`SelectionOverlay`)
Trong `lemyloi-dichvideos/apps/web/src/components/editor/panels/preview/selection-overlay.tsx`:
- Khi một câu phụ đề được chọn, một hộp bao tương tác (`SelectionOverlay`) được đặt đè lên màn hình video:
  - **Viền bao xanh dương** bao quanh đúng kích thước trực quan của phụ đề (tính toán qua `measureText` của Canvas 2D ẩn).
  - **4 núm chốt góc (Corner Handles)**: Kéo để phóng to/thu nhỏ tỷ lệ (`scale`).
  - **2 núm chốt cạnh bên (Side Handles)**: Kéo sang trái/phải để điều chỉnh giới hạn độ rộng xuống dòng (`boxWidth`).
  - **Thao tác Kéo rê (Drag to Move)**: Nhấp giữ vào giữa hộp phụ đề và kéo đến vị trí mong muốn (ví dụ kéo lên trên đỉnh video để tránh che phụ đề gốc, hoặc kéo xuống đáy).
  - **Thước ngắm bắt dính (Guide Lines)**: Tự động hiển thị đường kẻ vàng/xanh khi phụ đề được căn thẳng trục giữa màn hình (Center X) hoặc căn đáy an toàn (Bottom Safety Margin).

### 1.4. Cơ chế Quản lý State & Tránh Re-render (Zero-Lag 60 FPS Performance)
`lemyloi-dichvideos` giải quyết bài toán chống giật lag khi kéo thả bằng 3 kỹ thuật cốt lõi:
1. **Cô lập State Dragging (Transient Interaction)**:
   - Trong lúc chuột di chuyển (`pointermove`), tọa độ X/Y hoặc độ rộng được cập nhật trực tiếp vào style của phần tử DOM bằng `translate3d(x, y, 0)` hoặc qua `requestAnimationFrame`.
   - **CẤM** ghi đè vào History/Undo/Redo trong lúc đang kéo (`pushHistory: false`).
   - Chỉ khi nhả chuột (`pointerup`), tọa độ cuối cùng mới được lưu vào store chính với `pushHistory: true`.
2. **Bộ so sánh Memo hạt mịn (`areTimelineElementPropsEqual`)**:
   - Chỉ element nào có `elementId === dragState.elementId` mới cập nhật lại. Các element ở track khác hoặc ở xa ngoài viewport hoàn toàn không bị kích hoạt re-render.
3. **Phân tách Store**:
   - Biến thời gian phát `currentTime` (thay đổi 60 lần/giây) được cô lập trong Playback Manager. Bảng thuộc tính Properties Panel **không bao giờ** subscribe `currentTime`, do đó khi video đang phát thì bảng thuộc tính hoàn toàn tĩnh (0 re-renders).

---

## II. ĐỐI SOÁNH HIỆN TRẠNG DỰ ÁN `DUBBING-VIDEO` VÀ KHOẢNG TRỐNG

| Tiêu chí | `lemyloi-dichvideos` / CapCut | `dubbing-video` hiện tại | Khoảng trống cần nâng cấp |
| :--- | :--- | :--- | :--- |
| **Bảng thuộc tính Subtitle** | Có panel chi tiết: Font family, Font size, Màu sắc, Viền Stroke, Đổ bóng Shadow, Nền, X/Y | Chỉ có hiển thị text cứng trong bảng câu thoại | **Chưa có Properties Panel**. Cần tạo `PropertiesInspector.tsx` cho phép tùy biến style toàn diện. |
| **Kéo thả vị trí Subtitle trên Video** | Khung bao `SelectionOverlay`, kéo trực tiếp trên màn hình video | Phụ đề overlay cố định ở `bottom: 24px` | **Chưa có tính năng kéo thả trên màn hình video**. Cần tạo `SubtitleSelectionOverlay.tsx`. |
| **Đồng bộ phong cách Subtitle** | Đồng bộ theo Speaker hoặc Toàn bộ | Chưa có | Cần tính năng đồng bộ style theo phân vai nhân vật. |
| **Quản lý Video Track** | Cắt / Xén / Ghép nhiều đoạn video thật (`VideoElement`) | Chỉ có 1 file video duy nhất; cắt chỉ cắt câu thoại | Cần mô hình `videoClips` hỗ trợ cắt xén video gốc thật. |
| **Hiển thị Filmstrip trên Timeline** | Khung hình thumbnail thật của video được giải mã và vẽ | Đang vẽ các ô hình học giả lập (`#181b24`) | Cần trích xuất Thumbnail qua Backend FFmpeg và vẽ ảnh thật lên Track 2. |
| **Hiệu năng 60 FPS** | Memo hạt mịn + CSS transforms | Đã có Dual-layer Canvas Timeline & Zustand transient | Cần duy trì kiến trúc Zustand không re-render khi tích hợp Inspector. |

---

## III. BẢN THIẾT KẾ KIẾN TRÚC & GIẢI PHÁP NÂNG CẤP CHO `DUBBING-VIDEO`

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       STUDIO WORKSPACE                                       │
├──────────────────────────────┬────────────────────────────────┬──────────────────────────────┤
│    LEFT: STEP CONTROLS       │    CENTER: VIDEO & TIMELINE    │   RIGHT: CUES & INSPECTOR    │
│                              │                                │                              │
│ • Step 1: Nhận diện OCR/ASR  │ ┌────────────────────────────┐ │ ┌──────────────────────────┐ │
│ • Step 2: Dịch thuật LLM     │ │ VideoPlayer (HTML5 Video)  │ │ │ [Cues Table] [Thuộc tính]│ │
│ • Step 3: Lồng tiếng TTS     │ │ ┌────────────────────────┐ │ │ ├──────────────────────────┤ │
│ • Step 4: Xuất bản Video     │ │ │ SubtitleSelectionOverlay││ │ │ PROPERITES INSPECTOR      │ │
│                              │ │ │ • Bounding Box + Handles││ │ │ • Font Family & Size     │ │
│                              │ │ │ • Drag Subtitle Position││ │ │ • Color / Stroke / Shadow │ │
│                              │ │ └────────────────────────┘ │ │ │ • Background Box & Radius│ │
│                              │ └────────────────────────────┘ │ │ • Speaker Volume / Speed  │ │
│                              │ ┌────────────────────────────┐ │ │ • Video Clip Trim & Gain  │ │
│                              │ │ CanvasTimeline (Dual Layer)│ │ │ • Đồng bộ theo Phân vai  │ │
│                              │ │ Track 1: Subtitle Pills    │ │ └──────────────────────────┘ │
│                              │ │ Track 2: Real Filmstrip    │ │                              │
│                              │ │ Track 3: Audio Waveforms   │ │                              │
│                              │ └────────────────────────────┘ │                              │
└──────────────────────────────┴────────────────────────────────┴──────────────────────────────┘
```

---

## IV. KẾ HOẠCH HÀNH ĐỘNG TUẦN TỰ (4 GIAI ĐOẠN)

### Giai đoạn 1: Mở rộng Data Models & Subtitle Style Contract
- **Mở rộng `CueItem` trong `frontend/src/types/index.ts`**:
  ```typescript
  export interface SubtitleStyle {
    fontFamily: string;     // Mặc định: "Roboto", hỗ trợ font tiếng Việt
    fontSize: number;       // Mặc định: 18px (tỷ lệ chuẩn trên video)
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    textDecoration: 'none' | 'underline';
    textColor: string;      // Mặc định: "#FFFFFF"
    strokeColor?: string;   // Mặc định: "#000000"
    strokeWidth?: number;   // Mặc định: 2px
    shadowColor?: string;   // Mặc định: "rgba(0,0,0,0.8)"
    shadowBlur?: number;    // Mặc định: 4px
    shadowOffsetX?: number; // Mặc định: 1px
    shadowOffsetY?: number; // Mặc định: 2px
    backgroundColor?: string; // Mặc định: "rgba(0,0,0,0.6)" hoặc "transparent"
    backgroundPaddingX?: number;
    backgroundPaddingY?: number;
    backgroundBorderRadius?: number;
    textAlign: 'left' | 'center' | 'right';
    boxWidth?: number;      // % màn hình (mặc định: 80%)
    position: { x: number; y: number }; // Offset pixel từ tâm màn hình video
  }
  ```
- **Thêm Style mặc định vào `Project.settings`** để mọi câu mới đều kế thừa tự động.
- **Mở rộng `VideoClipSegment`**:
  ```typescript
  export interface VideoClipSegment {
    id: string;
    startTime: number;    // Giây trên timeline
    duration: number;     // Độ dài trên timeline
    trimStart: number;    // Offset giây trong video nguồn
    trimEnd: number;      // Offset giây từ đuôi video nguồn
    volume: number;       // 0.0 - 2.0
    muted: boolean;
  }
  ```

### Giai đoạn 2: Trực quan hóa & Tương tác Trực tiếp trên Video (`SubtitleSelectionOverlay.tsx`)
- Tạo component `SubtitleSelectionOverlay.tsx` gắn đè lên trên thẻ `<video>`:
  - Khi có câu thoại đang được chọn (`selectedCueId`), hiển thị khung chữ nhật nét mảnh viền xanh neon quanh câu phụ đề hiện tại.
  - Vẽ 4 chốt góc tròn (`nwse-resize`, `nesw-resize`) để kéo chỉnh font size trực tiếp.
  - Vẽ 2 chốt mép cạnh bên (`ew-resize`) để kéo co giãn độ rộng khung (`boxWidth`).
  - Cho phép người dùng nhấp giữ chuột vào khối phụ đề để kéo di chuyển (`position.x`, `position.y`) tự do trên khung hình video.
  - Hỗ trợ Snap Guideline: Bắt dính tự động khi phụ đề nằm ở chính giữa trục dọc ($X = 0$) hoặc mép dưới chuẩn an toàn 10%.
  - Toàn bộ quá trình kéo rê sử dụng `pointermove` cập nhật trực tiếp `transform: translate3d(x, y, 0)` trên thẻ DOM, chỉ cập nhật vào `cueStore` khi nhả chuột (`pointerup`) để đảm bảo mượt mà 60 FPS tuyệt đối.

### Giai đoạn 3: Xây dựng Bảng Điều khiển Thuộc tính (Properties Inspector Panel)
- Tạo component `frontend/src/features/cues/PropertiesInspector.tsx`:
  - Đặt dưới dạng Tab chuyển đổi song song với `VirtualCueTable` ở cột bên phải, hoặc mở rộng trong giao diện Studio.
  - **Khối Typography & Styling**:
    - Lựa chọn Font chữ Việt hóa chuẩn: *Roboto, Inter, Montserrat, Be Vietnam Pro, Arial, Times New Roman*.
    - Nút bấm kiểu chữ: **B** (Đậm), *I* (Nghiêng), <u>U</u> (Gạch chân).
    - Slider + Number Input kích cỡ chữ (Font size: 10px - 72px).
    - Thanh kéo độ rộng khung (Auto-wrap box width: 30% - 95%).
    - Bộ chọn màu (Color Picker): Màu chữ, Màu viền Stroke (kèm độ dày slider), Màu đổ bóng Shadow.
    - Hộp nền (Background Box): Bật/tắt màu nền, chọn màu, độ trong suốt (opacity), bo góc (border radius).
  - **Khối Audio / Giọng đọc**:
    - Âm lượng câu thoại (0% - 200%).
    - Tốc độ phát (Speed: 0.5x - 2.0x).
  - **Khối Đồng bộ Phong cách Nhanh**:
    - Nút `⚡ Đồng bộ cho phân vai [Speaker]`: Tự động áp dụng toàn bộ font, cỡ, viền, vị trí của câu này cho tất cả các câu của cùng nhân vật.
    - Nút `🌐 Đồng bộ cho tất cả`: Áp dụng cho toàn bộ dự án.

### Giai đoạn 4: Real Video Filmstrip Thumbnails & Cắt Ghép Video Thật
- **Backend API**:
  - `GET /api/media/filmstrip?projectId=...&interval=2.0`:
  - Dùng FFmpeg trích xuất thumbnails video tự động: `ffmpeg -i input.mp4 -vf "fps=1/2,scale=160:90" filmstrip_%04d.jpg` lưu vào cache của dự án.
  - Trả về danh sách metadata và URL các ảnh thumbnail.
- **Frontend Canvas Rendering**:
  - `MultiTrackCanvas.tsx`: Tải trước các thumbnail vào `HTMLImageElement` cache.
  - Khi vẽ Track 2 (Video Track), thay thế các ô màu giả lập bằng lệnh vẽ ảnh thật `ctx.drawImage(...)` có cắt tỉa tỉ lệ (cover-crop) chuẩn xác theo `trimStart` và `zoom`.
- **Cắt xén Video thật (True Video Split & Trim)**:
  - Khi ấn phím `S` (Split): Ngoài việc cắt câu phụ đề, hệ thống tạo ra 2 đoạn `VideoClipSegment` với điểm `trimStart` và `trimEnd` tương ứng.
  - Khi ấn `Q` (Trim Left) hoặc `W` (Trim Right): Thu hẹp đoạn video tương ứng với vị trí playhead.
  - Khi ấn `Delete`: Xóa đoạn video clip được chọn.
  - Step 4 Export: FFmpeg nhận danh sách các đoạn `videoClips`, dùng `select='between(t,...)'` hoặc `concat` filter để ghép thành video hoàn chỉnh theo đúng các nhát cắt của người dùng.

---

## V. TIÊU CHÍ NGHIỆM THU (VERIFICATION CRITERIA)
1. **Trực quan & Tiện ích**: Người dùng có thể kéo thả thay đổi vị trí phụ đề ở bất kỳ đâu trên màn hình video, đổi font chữ, màu viền, đổ bóng và bấm đồng bộ cho toàn bộ nhân vật.
2. **Hiệu năng 60 FPS**: Thao tác kéo thả phụ đề và phát video không gây giật lag, không gây re-render bảng câu thoại hay timeline.
3. **Filmstrip Thật**: Track 2 trên Timeline hiển thị ảnh chụp thật từ video gốc thay cho khung hình rỗng.
4. **Vượt qua toàn bộ Verification Gates**:
   - `npx tsc --noEmit`: 0 lỗi TypeScript.
   - `npm run lint`: 0 cảnh báo ESLint nghiêm trọng.
   - `npm run build`: Build production thành công.
   - `pytest backend/test_backend.py`: 100% tests vượt qua.
