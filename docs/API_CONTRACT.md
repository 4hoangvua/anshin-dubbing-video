# API CONTRACT: ĐẶC TẢ GIAO DIỆN BACKEND & DATA CONTRACT

> **Dự án**: Hệ thống Lồng tiếng Video Đa ngữ (Video Dubbing) AI Local  
> **Server Base URL**: `http://127.0.0.1:8765`  
> **Giao thức**: HTTP REST (JSON) + Server-Sent Events (SSE Streaming) + HTTP 206 Partial Content (Media Streaming)  
> **Kiến trúc dữ liệu**: Single Source of Truth (`project.json`) kết hợp lưu trữ artifacts theo từng bước.

---

## 1. CẤU TRÚC DỰ ÁN TRÊN ĐĨA (DIRECTORY STRUCTURE)

Mỗi dự án lồng tiếng độc lập được lưu trữ trong một thư mục riêng biệt dưới `d:\NCKH\Goc\dubbing-video\projects\{projectId}/`:

```text
projects/{projectId}/
├── project.json                <-- Trạng thái toàn cục (Single Source of Truth)
├── media/
│   ├── input.mp4               <-- Video gốc do người dùng tải lên
│   ├── source_audio.wav        <-- Âm thanh gốc tách từ video (16kHz mono)
│   ├── isolated_bgm.wav        <-- Nhạc nền sau khi tách giọng nói (nếu có)
│   └── isolated_vocal.wav      <-- Giọng nói gốc tách rời (nếu có)
├── steps/
│   ├── asr_output.json         <-- Kết quả thô từ Step 1 (Faster-Whisper/OCR)
│   ├── subtitles_source.srt    <-- Phụ đề gốc SRT
│   ├── mt_output.json          <-- Kết quả thô từ Step 2 (Qwen 2.5 MT)
│   ├── subtitles_target.srt    <-- Phụ đề tiếng Việt SRT
│   └── tts_output.json         <-- Danh sách clip âm thanh đã sinh từ Step 3
├── clips/
│   ├── cue_0001.wav            <-- Tệp âm thanh thuyết minh từng câu (48kHz)
│   ├── cue_0002.wav
│   └── ...
└── export/
    ├── narration_track.wav     <-- Track âm thanh thuyết minh tổng hợp hoàn chỉnh
    ├── final_subtitles.ass     <-- Phụ đề kiểu dáng ASS chất lượng cao
    └── dubbed_video.mp4        <-- Video thành phẩm hoàn chỉnh (Audio Mixed + Soft/Hardsub)
```

---

## 2. CHUẨN CẤU TRÚC TRẠNG THÁI `project.json`

File `project.json` là bản mô tả trạng thái đầy đủ nhất của một project, đồng bộ liên tục giữa Frontend Studio và Backend Server.

```json
{
  "version": "1.0.0",
  "projectId": "prj_20261117_001",
  "name": "Huong-Dan-Lap-Trinh-Python",
  "createdAt": "2026-11-17T17:30:00.000Z",
  "updatedAt": "2026-11-17T17:35:12.000Z",
  "currentStep": 1,
  "videoInfo": {
    "filePath": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/media/input.mp4",
    "fileName": "input.mp4",
    "duration": 125.42,
    "fps": 30.0,
    "width": 1920,
    "height": 1080,
    "hasAudio": true,
    "audioSampleRate": 44100,
    "audioChannels": 2
  },
  "settings": {
    "sourceLang": "zh",
    "targetLang": "vi",
    "recognitionMode": "asr",
    "asrModel": "small",
    "ocrRegion": {
      "x": 0.1,
      "y": 0.8,
      "width": 0.8,
      "height": 0.15
    },
    "translationGenre": "tech_tutorial",
    "translationPersona": "neutral",
    "voiceEngine": "vieneu",
    "defaultVoiceId": "Mai Anh",
    "autoMatchDuration": true,
    "borrowGap": true,
    "maxGapBorrowRatio": 0.85,
    "maxBorrowSeconds": 3.5,
    "autoDucking": true,
    "duckingVolume": 0.15,
    "duckAttackMs": 150,
    "duckReleaseMs": 400,
    "sourceVolumeDb": -12.0,
    "ttsVolumeDb": 0.0,
    "exportSubtitleType": "soft"
  },
  "speakers": [
    {
      "id": "SPEAKER_00",
      "name": "Giảng viên A",
      "color": "#22c55e",
      "gender": "female",
      "voiceId": "Mai Anh",
      "pitch": 0,
      "speed": 1.0,
      "selfPronoun": "tôi",
      "addressPronoun": "các bạn"
    }
  ],
  "cues": [
    {
      "id": 1,
      "startTime": 0.42,
      "endTime": 2.85,
      "duration": 2.43,
      "originalText": "欢迎大家来到今天的Python编程课程。",
      "translatedText": "Chào mừng các bạn đến với khóa học lập trình Python hôm nay.",
      "speakerId": "SPEAKER_00",
      "confidence": 0.965,
      "isContinuation": false,
      "audioFile": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips/cue_0001.wav",
      "audioDuration": 2.38,
      "playbackRate": 1.0,
      "needsReview": false,
      "status": "ready"
    }
  ],
  "exportInfo": {
    "exportedFilePath": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/export/dubbed_video.mp4",
    "exportedAt": "2026-11-17T17:40:00.000Z",
    "exportDurationSec": 125.42,
    "fileSizeBytes": 45182910
  }
}
```

---

## 3. DANH SÁCH REST & SSE ENDPOINTS

### Bảng Tổng Hợp Endpoint
| Method | Endpoint | Giao thức | Mục đích |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | REST JSON | Kiểm tra tình trạng server, GPU, VRAM và các venv |
| `POST` | `/api/project/create` | Multipart / JSON | Khởi tạo dự án mới từ video hoặc file âm thanh |
| `GET` | `/api/project/load` | REST JSON | Đọc trạng thái `project.json` của một project |
| `POST` | `/api/project/save` | REST JSON | Lưu cập nhật trạng thái `project.json` |
| `GET` | `/api/media/stream` | HTTP 206 Partial | Stream video / audio với hỗ trợ tua nhanh (Range header) |
| `POST` | `/api/step1/recognize` | SSE Stream | Bước 1: Chạy ASR Faster-Whisper hoặc OCR phụ đề cứng |
| `POST` | `/api/step1/update-cues`| REST JSON | Chỉnh sửa, ghép, tách danh sách cues thủ công |
| `POST` | `/api/step2/translate` | SSE Stream | Bước 2: Dịch máy ngữ cảnh VideoLingo Qwen 2.5 |
| `POST` | `/api/step2/translate-single` | REST JSON | Dịch lại hoặc tinh chỉnh 1 câu đơn lẻ |
| `POST` | `/api/step3/synthesize` | SSE Stream | Bước 3: Tổng hợp giọng đọc toàn bộ video (VieNeu-TTS) |
| `POST` | `/api/step3/synthesize-single` | REST JSON | Tạo lại audio clip cho 1 câu cue cụ thể |
| `POST` | `/api/step4/export` | SSE Stream | Bước 4: Trộn âm (Ducking/BGM), nướng sub và render video |

---

## 4. CHI TIẾT REQUEST & RESPONSE CÁC ENDPOINT

### 4.1. `GET /api/health`
Kiểm tra khả năng hoạt động của hệ thống và tài nguyên GPU GTX 1060.

- **Request**: Không có body.
- **Response** `200 OK`:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-11-17T17:30:00Z",
  "system": {
    "os": "Windows",
    "python": "3.10.11",
    "cuda_available": true,
    "device_name": "NVIDIA GeForce GTX 1060 6GB",
    "total_vram_mb": 6144,
    "free_vram_mb": 4920
  },
  "modules": {
    "asr": { "available": true, "path": "D:/NCKH/Goc/asr-ocr" },
    "mt": { "available": true, "path": "D:/NCKH/Goc/mt-translation" },
    "tts": { "available": true, "path": "D:/NCKH/Goc/tts-vieneu" }
  }
}
```

---

### 4.2. `POST /api/project/create`
Khởi tạo project mới, copy file media gốc vào thư mục project và trích xuất thông số kỹ thuật (ffprobe). Hỗ trợ cả `multipart/form-data` và `application/json`.

- **Content-Type**: `multipart/form-data` hoặc `application/json`
- **Request Body (Multipart hoặc JSON)**:
  - `name`: (string, bắt buộc) Tên dự án.
  - `file`: (binary file, tùy chọn) Tệp video hoặc audio tải lên.
  - `existing_path`: (string, tùy chọn) Đường dẫn video có sẵn trên ổ đĩa nếu không upload file.
- **Response** `201 Created`:
```json
{
  "success": true,
  "projectId": "prj_20261117_001",
  "projectPath": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001",
  "project": { /* Toàn bộ object project.json mới tạo */ }
}
```

---

### 4.2.1. `GET /api/project/list`
Liệt kê danh sách các dự án gần đây trong thư mục `projects/` để hiển thị trên giao diện mở dự án.

- **Response** `200 OK`:
```json
{
  "projects": [
    {
      "projectId": "prj_20261117_175608",
      "name": "Bai-Giang-Tri-Tue-Nhan-Tao",
      "updatedAt": "2026-11-17T17:56:08.000Z",
      "cueCount": 18,
      "currentStep": 1,
      "videoName": "input.mp4",
      "duration": 125.4
    }
  ]
}
```

---

### 4.2.2. `POST /api/system/browse-file`
Mở hộp thoại Windows File Explorer trực tiếp trên màn hình máy tính để người dùng chọn tệp video/audio mà không cần nhập đường dẫn thủ công.

- **Request Body**:
```json
{
  "title": "Chọn tệp Video gốc",
  "file_type": "video"
}
```
- **Response** `200 OK`:
```json
{
  "cancelled": false,
  "filePath": "D:/NCKH/videos/sample.mp4",
  "fileName": "sample.mp4",
  "fileSizeMb": 45.2
}
```

---

### 4.2.3. `POST /api/system/browse-folder`
Mở hộp thoại Windows File Explorer để chọn một thư mục trên máy tính.

- **Response** `200 OK`:
```json
{
  "cancelled": false,
  "folderPath": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001",
  "folderName": "prj_20261117_001"
}
```

---

### 4.3. `GET /api/project/load`
Đọc toàn bộ dữ liệu dự án.

- **Query Parameters**:
  - `projectId`: (string, bắt buộc) Mã dự án.
- **Response** `200 OK`: Trả về toàn bộ nội dung của `project.json`.
- **Response** `404 Not Found`:
```json
{
  "detail": "Không tìm thấy dự án với ID: prj_20261117_001"
}
```

---

### 4.4. `POST /api/project/save`
Lưu đè trạng thái `project.json`.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "project": { /* Object project.json cập nhật */ }
}
```
- **Response** `200 OK`:
```json
{
  "success": true,
  "updatedAt": "2026-11-17T17:35:12.000Z"
}
```

---

### 4.5. `GET /api/media/stream` (HTTP 206 Partial Content)
Stream mượt mà video `.mp4` hoặc audio `.wav` trên trình duyệt mà không cần tải hết tệp, phục vụ xem trước và tua dòng thời gian (Seeking).

- **Headers Hỗ Trợ**: `Range: bytes=start-end`
- **Query Parameters**:
  - `path`: (string, bắt buộc) Đường dẫn tuyệt đối của tệp video hoặc clip âm thanh.
- **Response Headers**:
  - `HTTP/1.1 206 Partial Content`
  - `Content-Range: bytes 1048576-2097151/15728640`
  - `Accept-Ranges: bytes`
  - `Content-Length: 1048576`
  - `Content-Type: video/mp4` (hoặc `audio/wav`)

---

### 4.6. `POST /api/step1/recognize` (SSE Progress Streaming)
Khởi chạy Module ASR (Faster-Whisper) hoặc OCR dưới dạng tiến trình độc lập.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "mode": "asr",
  "model": "small",
  "beamSize": 2,
  "lang": "zh",
  "vad": true,
  "vadThreshold": 0.45,
  "smartSplit": true,
  "maxPause": 0.4,
  "maxDuration": 5.0
}
```
- **Response**: `text/event-stream; charset=utf-8`
- **SSE Events Payload**:
```text
event: start
data: {"step": 1, "task": "Faster-Whisper Transcription", "startedAt": "2026-11-17T17:31:00Z"}

event: progress
data: {"percent": 15, "stage": "Loading model", "message": "Đang nạp mô hình Faster-Whisper Small..."}

event: progress
data: {"percent": 55, "stage": "Transcribing", "processedSec": 68.2, "totalSec": 125.4}

event: complete
data: {
  "percent": 100,
  "cuesCount": 42,
  "cues": [
    {
      "id": 1,
      "startTime": 0.42,
      "endTime": 2.85,
      "duration": 2.43,
      "originalText": "欢迎大家来到今天的Python编程课程。",
      "translatedText": "",
      "confidence": 0.965,
      "speakerId": "SPEAKER_00"
    }
  ],
  "benchmark": { "vramPeakMb": 1150.2, "inferenceTimeSec": 6.8 }
}
```

---

### 4.7. `POST /api/step1/update-cues`
Cập nhật danh sách cues sau khi người dùng tinh chỉnh trên giao diện (sửa text, gán lại speaker, kéo mốc thời gian, tách/gộp câu).

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "cues": [
    {
      "id": 1,
      "startTime": 0.42,
      "endTime": 2.85,
      "originalText": "欢迎大家来到今天的Python编程课程。",
      "speakerId": "SPEAKER_00"
    }
  ]
}
```
- **Response** `200 OK`:
```json
{
  "success": true,
  "totalCues": 1
}
```

---

### 4.8. `POST /api/step2/translate` (SSE Progress Streaming)
Khởi chạy Module Dịch máy Ngữ cảnh VideoLingo (Qwen 2.5 1.5B Instruct trên CTranslate2 INT8).

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "genre": "tech_tutorial",
  "persona": "neutral",
  "srcLang": "zh",
  "tgtLang": "vi",
  "reconstruct": true,
  "stylePrompt": ""
}
```
- **Response**: `text/event-stream; charset=utf-8`
- **SSE Events Payload**:
```text
event: start
data: {"step": 2, "task": "VideoLingo Context MT"}

event: progress
data: {"percent": 25, "stage": "Global Context", "synopsis": "Khóa học lập trình Python cơ bản"}

event: progress
data: {"percent": 75, "stage": "Translating Scenes", "completedScenes": 3, "totalScenes": 4}

event: complete
data: {
  "percent": 100,
  "cues": [
    {
      "id": 1,
      "originalText": "欢迎大家来到今天的Python编程课程。",
      "translatedText": "Chào mừng các bạn đến với khóa học lập trình Python hôm nay.",
      "isContinuation": false,
      "recommendedTtsSpeedRate": 1.05
    }
  ],
  "benchmark": { "vramPeakMb": 1950.5, "inferenceTimeSec": 4.12 }
}
```

---

### 4.9. `POST /api/step2/translate-single`
Dịch lại một câu cue đơn lẻ khi người dùng muốn đổi văn phong hoặc prompt.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "cueId": 1,
  "sourceText": "欢迎大家来到今天的Python编程课程。",
  "targetLang": "vi",
  "persona": "informal",
  "customInstruction": "Dịch gần gũi, xưng hô 'mình' và 'các bạn'"
}
```
- **Response** `200 OK`:
```json
{
  "cueId": 1,
  "translatedText": "Chào các bạn, rất vui được gặp lại mọi người trong buổi học Python hôm nay.",
  "recommendedSpeedRate": 1.10
}
```

---

### 4.9b. `GET /api/tts/voices`
Lấy danh sách 18 giọng đọc bản địa tích hợp sẵn của VieNeu-TTS v3 Turbo phân nhóm theo vùng miền (Bắc - Trung - Nam), giới tính và phong cách, kèm giới hạn tốc độ chuẩn kỹ thuật NCKH (mở rộng tối đa 2.0x cho câu ngắn).

- **Response Status**: `200 OK`
- **Response Body**:
```json
{
  "voices": [
    {
      "id": "Mai Anh",
      "name": "Mai Anh (Nữ · Bắc)",
      "region": "Bắc",
      "gender": "female",
      "style": "Tin tức / Diễn thuyết",
      "description": "Giọng nữ truyền cảm, chuẩn phát thanh viên miền Bắc (Mặc định)"
    },
    {
      "id": "Minh Đức",
      "name": "Minh Đức (Nam · Bắc)",
      "region": "Bắc",
      "gender": "male",
      "style": "Tin tức / Diễn thuyết",
      "description": "Giọng nam trầm ấm, đĩnh đạc, chuyên nghiệp miền Bắc"
    }
  ],
  "defaultVoiceId": "Mai Anh",
  "maxSpeedRate": 2.0,
  "minSpeedRate": 0.75
}
```

---

### 4.10. `POST /api/step3/synthesize` (SSE Progress Streaming)
Khởi chạy Module VieNeu-TTS để sinh âm thanh cho toàn bộ cues trong dự án, đồng thời tính toán `borrow_gap` và `speed_factor`.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "voiceId": "Mai Anh",
  "device": "cuda",
  "autoMatchDuration": true,
  "borrowGap": true,
  "speed": 1.0
}
```
- **Response**: `text/event-stream; charset=utf-8`
- **SSE Events Payload**:
```text
event: start
data: {"step": 3, "task": "VieNeu Voice Synthesis", "totalCues": 42}

event: progress
data: {
  "percent": 30,
  "currentIndex": 12,
  "cueId": 12,
  "clipDuration": 2.45,
  "audioUrl": "/api/media/stream?path=D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips/cue_0012.wav"
}

event: complete
data: {
  "percent": 100,
  "totalClipsGenerated": 42,
  "clipsDir": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips",
  "cues": [
    {
      "id": 1,
      "audioFile": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips/cue_0001.wav",
      "audioDuration": 2.38,
      "playbackRate": 1.0,
      "needsReview": false,
      "status": "ready"
    }
  ]
}
```

---

### 4.11. `POST /api/step3/synthesize-single`
Sinh lại clip âm thanh cho 1 cue đơn lẻ khi người dùng đổi text, đổi giọng đọc hoặc đổi tốc độ.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "cueId": 1,
  "text": "Chào mừng các bạn đến với khóa học lập trình Python hôm nay.",
  "voiceId": "Minh Đức",
  "speed": 1.05
}
```
- **Response** `200 OK`:
```json
{
  "cueId": 1,
  "audioFile": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips/cue_0001.wav",
  "audioDuration": 2.25,
  "audioUrl": "/api/media/stream?path=D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/clips/cue_0001.wav",
  "synthesisTimeSec": 0.38
}
```

---

### 4.12. `POST /api/step4/export` (SSE Progress Streaming)
Thực thi FFmpeg để tạo timeline âm thanh thuyết minh, thực hiện Audio Ducking cho nhạc nền video gốc, ghép phụ đề và xuất video thành phẩm.

- **Content-Type**: `application/json`
- **Request Body**:
```json
{
  "projectId": "prj_20261117_001",
  "autoDucking": true,
  "duckingVolume": 0.15,
  "duckAttackMs": 150,
  "duckReleaseMs": 400,
  "sourceVolumeDb": -12.0,
  "ttsVolumeDb": 0.0,
  "exportSubtitleType": "soft",
  "resolution": "original",
  "videoCodec": "h264_nvenc"
}
```
- **Response**: `text/event-stream; charset=utf-8`
- **SSE Events Payload**:
```text
event: start
data: {"step": 4, "task": "Exporting Video & Audio Mixing"}

event: progress
data: {"percent": 25, "stage": "Building Narration Track", "message": "Đang ghép nối 42 clip âm thanh..."}

event: progress
data: {"percent": 60, "stage": "Applying Audio Ducking", "message": "Đang hạ âm lượng BGM với Attack 150ms / Release 400ms..."}

event: progress
data: {"percent": 90, "stage": "Rendering Video", "message": "FFmpeg NVENC encoding..."}

event: complete
data: {
  "percent": 100,
  "outputVideoPath": "D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/export/dubbed_video.mp4",
  "outputVideoUrl": "/api/media/stream?path=D:/NCKH/Goc/dubbing-video/projects/prj_20261117_001/export/dubbed_video.mp4",
  "fileSizeBytes": 45182910,
  "durationSec": 125.42
}
```

---

## 5. MÃ LỖI CHUẨN (STANDARD ERROR RESPONSES)

Tất cả các endpoint trả về lỗi định dạng chuẩn RFC 7807:

```json
{
  "error": {
    "code": "CUDA_OUT_OF_MEMORY",
    "message": "Không đủ bộ nhớ VRAM để khởi chạy mô hình. Vui lòng thử lại sau khi các tác vụ khác kết thúc.",
    "step": 2,
    "details": {
      "required_vram_mb": 2000,
      "free_vram_mb": 850
    }
  }
}
```

### Các Mã Lỗi Thường Gặp
- `PROJECT_NOT_FOUND` (404): Không tìm thấy mã dự án hoặc file `project.json`.
- `INVALID_MEDIA_FORMAT` (400): Định dạng video/audio không hỗ trợ hoặc file bị hỏng.
- `TASK_ALREADY_RUNNING` (409): Một bước AI khác đang chiếm GPU GTX 1060 (vi phạm quy tắc tuần tự).
- `CUDA_OUT_OF_MEMORY` (500): Tràn VRAM GPU.
- `SUBPROCESS_FAILED` (500): Tiến trình Python CLI trả về lỗi (exit code khác 0).
