# -*- coding: utf-8 -*-
"""
Pydantic Schemas & Data Contract for Video Dubbing AI Local
Single Source of Truth: project.json
Compliant with API_CONTRACT.md and RFC 7807 Error Responses.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ==============================================================================
# 1. CORE DATA STRUCTURES (project.json Single Source of Truth)
# ==============================================================================

class OCRRegion(BaseModel):
    x: float = Field(0.05, description="Tọa độ x góc trên bên trái (tỉ lệ 0.0 - 1.0)")
    y: float = Field(0.75, description="Tọa độ y góc trên bên trái (tỉ lệ 0.0 - 1.0)")
    width: float = Field(0.90, description="Chiều rộng vùng ROI (tỉ lệ 0.0 - 1.0)")
    height: float = Field(0.22, description="Chiều cao vùng ROI (tỉ lệ 0.0 - 1.0)")


class ProjectSettings(BaseModel):
    sourceLang: str = Field("zh", description="Ngôn ngữ gốc (zh, en, auto...)")
    targetLang: str = Field("vi", description="Ngôn ngữ mục tiêu (mặc định vi)")
    recognitionMode: str = Field("asr", description="Chế độ nhận diện: asr | ocr")
    asrModel: str = Field("small", description="Mô hình Faster-Whisper: tiny, base, small, medium")
    ocrRegion: Optional[OCRRegion] = Field(default_factory=OCRRegion)
    translationGenre: str = Field("tech_tutorial", description="Thể loại: tech_tutorial, general_dialogue...")
    translationPersona: str = Field("neutral", description="Sắc thái xưng hô: neutral, informal, polite, intimate")
    voiceEngine: str = Field("vieneu", description="Engine tạo giọng đọc")
    defaultVoiceId: str = Field("Mai Anh", description="Giọng đọc mặc định")
    autoMatchDuration: bool = Field(True, description="Tự động tính speed factor để khớp thời lượng")
    borrowGap: bool = Field(True, description="Mượn khoảng lặng giữa các câu")
    maxGapBorrowRatio: float = Field(0.85, description="Tỉ lệ khoảng lặng tối đa được phép mượn")
    maxBorrowSeconds: float = Field(3.5, description="Thời gian mượn tối đa cho 1 câu (giây)")
    autoDucking: bool = Field(True, description="Bật tự động Audio Ducking cho nhạc nền")
    duckingVolume: float = Field(0.15, description="Hệ số âm lượng BGM khi bị duck (0.15 = -16.5 dB)")
    duckAttackMs: int = Field(150, description="Thời gian vuốt nhỏ dần (ms)")
    duckReleaseMs: int = Field(400, description="Thời gian phục hồi âm lượng (ms)")
    sourceVolumeDb: float = Field(-12.0, description="Âm lượng nhạc nền/thoại gốc (dB)")
    ttsVolumeDb: float = Field(0.0, description="Âm lượng giọng thuyết minh TTS (dB)")
    exportSubtitleType: str = Field("soft", description="Kiểu phụ đề xuất bản: soft | hard | none")


class VideoInfo(BaseModel):
    filePath: str = Field("", description="Đường dẫn tuyệt đối đến tệp video gốc")
    fileName: str = Field("", description="Tên tệp video gốc")
    duration: float = Field(0.0, description="Thời lượng video (giây)")
    fps: float = Field(30.0, description="Khung hình trên giây")
    width: int = Field(1920, description="Chiều rộng khung hình")
    height: int = Field(1080, description="Chiều cao khung hình")
    hasAudio: bool = Field(True, description="Video có kênh âm thanh không")
    audioSampleRate: int = Field(44100, description="Tần số lấy mẫu âm thanh (Hz)")
    audioChannels: int = Field(2, description="Số kênh âm thanh")


class SpeakerProfile(BaseModel):
    id: str = Field("SPEAKER_00", description="Mã người nói")
    name: str = Field("Người thuyết minh", description="Tên hiển thị")
    color: str = Field("#22c55e", description="Mã màu đại diện")
    gender: Optional[str] = Field("female", description="Giới tính: female | male | unknown")
    voiceId: str = Field("Mai Anh", description="ID giọng đọc gán cho speaker này")
    pitch: float = Field(0.0, description="Tần số F0 hoặc độ cao giọng")
    speed: float = Field(1.0, description="Hệ số tốc độ đọc")
    selfPronoun: Optional[str] = Field("tôi", description="Đại từ tự xưng")
    addressPronoun: Optional[str] = Field("các bạn", description="Đại từ gọi người nghe")


class CueItem(BaseModel):
    id: int = Field(..., description="Mã định danh câu thoại (1, 2, 3...)")
    startTime: float = Field(..., description="Thời điểm bắt đầu (giây)")
    endTime: float = Field(..., description="Thời điểm kết thúc (giây)")
    duration: float = Field(..., description="Thời lượng câu thoại (giây)")
    originalText: str = Field(..., description="Lời thoại gốc đã nhận dạng")
    translatedText: str = Field("", description="Bản dịch tiếng Việt")
    speakerId: str = Field("SPEAKER_00", description="Mã định danh speaker")
    confidence: float = Field(1.0, description="Độ tin cậy nhận diện (0.0 - 1.0)")
    isContinuation: bool = Field(False, description="Có phải vế câu tiếp diễn của câu trước không")
    audioFile: Optional[str] = Field(None, description="Đường dẫn file wav clip đã sinh")
    audioDuration: Optional[float] = Field(None, description="Thời lượng thực tế của clip audio (giây)")
    speed: float = Field(1.0, description="Tốc độ đọc giọng TTS gốc")
    playbackRate: float = Field(1.0, description="Tốc độ phát đã co giãn để khớp timeline")
    needsReview: bool = Field(False, description="Cần người dùng xem lại nếu vượt ngưỡng an toàn 2.0x")
    placedStartTime: Optional[float] = Field(None, description="Thời điểm bắt đầu thực tế sau khi chống đè giọng")
    placedEndTime: Optional[float] = Field(None, description="Thời điểm kết thúc thực tế sau khi chống đè giọng")
    isCollisionShifted: bool = Field(False, description="Được dời thời điểm để triệt tiêu đè giọng")
    status: str = Field("pending", description="Trạng thái: pending | ready | error")


class ExportInfo(BaseModel):
    exportedFilePath: str = Field("", description="Đường dẫn tệp video kết quả hoàn chỉnh")
    exportedAt: str = Field("", description="Thời điểm xuất bản ISO-8601")
    exportDurationSec: float = Field(0.0, description="Thời lượng video xuất bản")
    fileSizeBytes: int = Field(0, description="Kích thước tệp xuất bản (bytes)")


class ProjectState(BaseModel):
    version: str = Field("1.0.0", description="Phiên bản định dạng project")
    projectId: str = Field(..., description="Mã định danh duy nhất của dự án")
    name: str = Field(..., description="Tên dự án")
    createdAt: str = Field(..., description="Thời điểm tạo ISO-8601")
    updatedAt: str = Field(..., description="Thời điểm cập nhật gần nhất ISO-8601")
    currentStep: int = Field(1, description="Bước hiện tại trong quy trình 4 bước (1-4)")
    videoInfo: VideoInfo = Field(default_factory=VideoInfo)
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    speakers: List[SpeakerProfile] = Field(default_factory=list)
    cues: List[CueItem] = Field(default_factory=list)
    exportInfo: Optional[ExportInfo] = None


# ==============================================================================
# 2. REQUEST & RESPONSE MODELS CHO CÁC REST ENDPOINTS
# ==============================================================================

# 4.1 GET /api/health
class SystemHardwareInfo(BaseModel):
    os: str
    python: str
    cuda_available: bool
    device_name: str
    total_vram_mb: int
    free_vram_mb: int

class ModuleStatus(BaseModel):
    available: bool
    path: str

class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str = "1.0.0"
    timestamp: str
    system: SystemHardwareInfo
    modules: Dict[str, ModuleStatus]


# 4.2 POST /api/project/create
class ProjectCreateRequest(BaseModel):
    name: str
    existing_path: Optional[str] = None

class ProjectCreateResponse(BaseModel):
    success: bool = True
    projectId: str
    projectPath: str
    project: ProjectState


# 4.4 POST /api/project/save
class ProjectSaveRequest(BaseModel):
    projectId: str
    project: ProjectState

class ProjectSaveResponse(BaseModel):
    success: bool = True
    updatedAt: str


# 4.6 POST /api/step1/recognize
class Step1RecognizeRequest(BaseModel):
    projectId: str
    mode: str = Field("asr", description="asr | ocr")
    model: str = Field("small", description="tiny | base | small | medium")
    beamSize: int = Field(2, description="Beam size")
    lang: str = Field("zh", description="zh | en | vi | auto")
    vad: bool = Field(True, description="Bật Silero VAD")
    vadThreshold: float = Field(0.45, description="Ngưỡng nhạy VAD")
    smartSplit: bool = Field(True, description="Tách câu theo khoảng lặng")
    maxPause: float = Field(0.4, description="Khoảng lặng tối đa trước khi tách câu")
    maxDuration: float = Field(5.0, description="Thời lượng tối đa mỗi câu")
    ocrRegion: Optional[OCRRegion] = None


# 4.7 POST /api/step1/update-cues
class CueUpdateItem(BaseModel):
    id: int
    startTime: float
    endTime: float
    originalText: str
    speakerId: Optional[str] = "SPEAKER_00"
    translatedText: Optional[str] = ""

class Step1UpdateCuesRequest(BaseModel):
    projectId: str
    cues: List[CueUpdateItem]

class Step1UpdateCuesResponse(BaseModel):
    success: bool = True
    totalCues: int


# 4.8 POST /api/step2/translate
class Step2TranslateRequest(BaseModel):
    projectId: str
    genre: str = Field("tech_tutorial", description="Thể loại video")
    persona: str = Field("neutral", description="Sắc thái: neutral | informal | polite | intimate")
    srcLang: str = Field("zh", description="Ngôn ngữ nguồn")
    tgtLang: str = Field("vi", description="Ngôn ngữ đích")
    reconstruct: bool = Field(True, description="Tái cấu trúc ghép câu ngữ pháp")
    stylePrompt: str = Field("", description="Prompt tùy biến văn phong")
    modelEngine: str = Field("auto", description="Mô hình dịch: auto | lmstudio | qwen")


# 4.9 POST /api/step2/translate-single
class Step2TranslateSingleRequest(BaseModel):
    projectId: str
    cueId: int
    sourceText: str
    targetLang: str = Field("vi", description="Ngôn ngữ dịch")
    persona: str = Field("neutral", description="Sắc thái")
    customInstruction: str = Field("", description="Chỉ dẫn bổ sung")
    modelEngine: str = Field("auto", description="Mô hình dịch: auto | lmstudio | qwen")

class Step2TranslateSingleResponse(BaseModel):
    cueId: int
    translatedText: str
    recommendedSpeedRate: float = 1.0


# 4.10 GET /api/tts/voices
class VoiceItem(BaseModel):
    id: str = Field(..., description="ID giọng đọc")
    name: str = Field(..., description="Tên hiển thị kèm sắc thái")
    region: str = Field("Bắc", description="Vùng miền: Bắc | Trung | Nam")
    gender: str = Field("female", description="female | male")
    style: str = Field("Tin tức / Diễn thuyết", description="Phong cách đọc")
    description: str = Field("", description="Mô tả chi tiết")

class VoicesResponse(BaseModel):
    voices: List[VoiceItem]
    defaultVoiceId: str = "Mai Anh"
    maxSpeedRate: float = 5.0
    minSpeedRate: float = 0.5


# 4.10 POST /api/step3/synthesize
class Step3SynthesizeRequest(BaseModel):
    projectId: str
    voiceId: str = Field("Mai Anh", description="Tên giọng đọc")
    device: str = Field("cpu", description="cuda | cpu (VieNeu v3-Turbo tối ưu ONNX INT8 trên CPU)")
    autoMatchDuration: bool = Field(True, description="Khớp thời lượng")
    borrowGap: bool = Field(True, description="Mượn khoảng lặng giữa các câu")
    speed: float = Field(1.0, description="Tốc độ mặc định")
    speakers: Optional[List[SpeakerProfile]] = Field(None, description="Danh sách cấu hình nhân vật kèm giọng và tốc độ riêng")


# 4.11 POST /api/step3/synthesize-single
class Step3SynthesizeSingleRequest(BaseModel):
    projectId: str
    cueId: int
    text: str
    voiceId: str = Field("Mai Anh", description="Giọng đọc")
    speed: float = Field(1.0, description="Tốc độ đọc")

class Step3SynthesizeSingleResponse(BaseModel):
    cueId: int
    audioFile: str
    audioDuration: float
    audioUrl: str
    synthesisTimeSec: float


# 4.11b POST /api/step3/sync-subtitles
class Step3SyncSubtitlesRequest(BaseModel):
    projectId: str
    breathGapSeconds: float = Field(0.08, description="Đệm lấy hơi giữa 2 câu nối tiếp")
    minCollisionGapSeconds: float = Field(0.05, description="Đệm an toàn chống đè giọng giữa 2 câu độc lập")

class Step3SyncSubtitlesResponse(BaseModel):
    success: bool = True
    syncedCount: int
    cues: List[CueItem]
    message: str = "Đã đồng bộ mốc thời gian phụ đề khớp 100% theo giọng đọc AI trên Timeline."


# 4.11c POST /api/step3/timing-offset
class Step3TimingOffsetRequest(BaseModel):
    projectId: str
    leadOffsetSeconds: float = Field(0.0, description="Bù thời gian trước câu (± giây)")
    tailOffsetSeconds: float = Field(0.0, description="Bù thời gian sau câu (± giây)")

class Step3TimingOffsetResponse(BaseModel):
    success: bool = True
    cues: List[CueItem]
    message: str = "Đã cập nhật bù trễ thời gian cho phụ đề."


# 4.12 POST /api/step4/export
class Step4ExportRequest(BaseModel):
    projectId: str
    autoDucking: bool = Field(True, description="Tự động ducking nhạc nền")
    duckingVolume: float = Field(0.15, description="Hệ số âm lượng khi duck")
    duckAttackMs: int = Field(150, description="Attack ms")
    duckReleaseMs: int = Field(400, description="Release ms")
    sourceVolumeDb: float = Field(-12.0, description="Âm lượng nhạc nền dB")
    ttsVolumeDb: float = Field(0.0, description="Âm lượng TTS dB")
    exportSubtitleType: str = Field("soft", description="soft | hard | none")
    resolution: str = Field("original", description="original | 1080p | 720p")
    videoCodec: str = Field("h264_nvenc", description="h264_nvenc | libx264")


# ==============================================================================
# 3. RFC 7807 ERROR RESPONSE MODELS
# ==============================================================================

class ErrorDetail(BaseModel):
    code: str = Field(..., description="Mã lỗi chuẩn: TASK_ALREADY_RUNNING, CUDA_OUT_OF_MEMORY...")
    message: str = Field(..., description="Mô tả thông báo lỗi cho người dùng")
    step: Optional[int] = Field(None, description="Bước xảy ra lỗi (1-4)")
    details: Optional[Dict[str, Any]] = Field(None, description="Thông số chi tiết kỹ thuật")

class RFC7807Error(BaseModel):
    error: ErrorDetail
