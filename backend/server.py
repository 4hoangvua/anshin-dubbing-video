# -*- coding: utf-8 -*-
"""
FastAPI Backend Server for Video Dubbing AI Local
- Host: 127.0.0.1:8765
- CORS: All origins allowed (*)
- Single Source of Truth: project.json
- HTTP REST + SSE Streaming + HTTP 206 Partial Content (Media Streaming)
- 12 Endpoints compliant with API_CONTRACT.md and RFC 7807 Error Standard
"""

from __future__ import annotations
import asyncio
import sys

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from datetime import datetime, timezone
import json
import mimetypes
import os
from pathlib import Path
import shutil
import sys
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from schemas import (
    CueItem,
    CueUpdateItem,
    ExportInfo,
    HealthResponse,
    ModuleStatus,
    OCRRegion,
    ProjectCreateRequest,
    ProjectCreateResponse,
    ProjectSaveRequest,
    ProjectSaveResponse,
    ProjectSettings,
    ProjectState,
    RFC7807Error,
    SpeakerProfile,
    Step1RecognizeRequest,
    Step1UpdateCuesRequest,
    Step1UpdateCuesResponse,
    Step2TranslateRequest,
    Step2TranslateSingleRequest,
    Step2TranslateSingleResponse,
    Step3SynthesizeRequest,
    Step3SynthesizeSingleRequest,
    Step3SynthesizeSingleResponse,
    Step3SyncSubtitlesRequest,
    Step3SyncSubtitlesResponse,
    Step3TimingOffsetRequest,
    Step3TimingOffsetResponse,
    Step4ExportRequest,
    SystemHardwareInfo,
    VideoInfo,
    VoiceItem,
    VoicesResponse,
)
from audio_mixer import (
    DEFAULT_SAMPLE_RATE,
    build_narration_track,
    extract_audio_from_video,
    get_media_info_via_ffprobe,
    mix_audio_with_ducking,
    mux_final_video,
    plan_chained_narration_placements,
    save_cues_to_srt,
)
from model_hub import (
    get_hardware_info,
    get_models_status,
    stream_download_model,
)
from model_manager import (
    ASR_PYTHON,
    ASR_SCRIPT,
    MT_PYTHON,
    MT_SCRIPT,
    MODULES_DIR,
    MODELS_DIR,
    PROJECTS_DIR,
    TTS_SCRIPT,
    get_gpu_vram_info,
    get_tts_python,
    is_local_llm_running,
    manager,
    release_vram_forcefully,
    stream_step1_recognize,
    stream_step2_translate,
    stream_step3_synthesize,
    synthesize_single_cue,
    translate_single_cue,
)


# ==============================================================================
# KHỞI TẠO FASTAPI APP & CORS
# ==============================================================================

app = FastAPI(
    title="Video Dubbing AI Local Backend",
    version="1.0.0",
    description="Backend Server điều phối quy trình 4 bước lồng tiếng Video AI Local",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================================================================
# TIỆN ÍCH DỰ ÁN & PROJECT.JSON
# ==============================================================================

def get_project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def get_project_file(project_id: str) -> Path:
    return get_project_dir(project_id) / "project.json"


def load_project_state(project_id: str) -> ProjectState:
    p_file = get_project_file(project_id)
    if not p_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy dự án với ID: {project_id}",
        )
    with open(p_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    return ProjectState(**data)


def save_project_state(project: ProjectState) -> None:
    p_file = get_project_file(project.projectId)
    p_file.parent.mkdir(parents=True, exist_ok=True)
    project.updatedAt = datetime.now(timezone.utc).isoformat()
    with open(p_file, "w", encoding="utf-8") as f:
        f.write(project.model_dump_json(indent=2))


async def sse_generator_wrapper(gen: AsyncGenerator[Dict[str, Any], None]) -> AsyncGenerator[str, None]:
    """Chuyển đổi generator dữ liệu sang định dạng Server-Sent Events tiêu chuẩn."""
    try:
        async for event in gen:
            event_name = event.get("event", "message")
            data_payload = event.get("data", {})
            data_json = json.dumps(data_payload, ensure_ascii=False)
            yield f"event: {event_name}\ndata: {data_json}\n\n"
    except Exception as ex:
        err_payload = json.dumps({
            "error": {
                "code": "STREAMING_ERROR",
                "message": str(ex),
            }
        }, ensure_ascii=False)
        yield f"event: error\ndata: {err_payload}\n\n"


# ==============================================================================
# 4.1. GET /api/health
# ==============================================================================

@app.get("/api/health", response_model=HealthResponse)
async def check_health():
    """Kiểm tra tình trạng server, GPU, VRAM và các môi trường AI Local."""
    vram = get_gpu_vram_info()
    now_iso = datetime.now(timezone.utc).isoformat()

    asr_ok = os.path.exists(ASR_PYTHON) and os.path.exists(ASR_SCRIPT)
    mt_ok = os.path.exists(MT_PYTHON) and os.path.exists(MT_SCRIPT)
    tts_py = get_tts_python()
    tts_ok = os.path.exists(tts_py) and os.path.exists(TTS_SCRIPT)

    return HealthResponse(
        status="healthy",
        version="1.0.0",
        timestamp=now_iso,
        system=SystemHardwareInfo(
            os=sys.platform,
            python=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            cuda_available=vram["cuda_available"],
            device_name=vram["device_name"],
            total_vram_mb=vram["total_vram_mb"],
            free_vram_mb=vram["free_vram_mb"],
        ),
        modules={
            "asr": ModuleStatus(available=asr_ok, path=str(MODULES_DIR / "asr")),
            "mt": ModuleStatus(available=mt_ok, path=str(MODULES_DIR / "mt")),
            "tts": ModuleStatus(available=tts_ok, path=str(MODULES_DIR / "tts")),
        },
    )


# ==============================================================================
# 4.2. POST /api/project/create & GET /api/project/list
# ==============================================================================

@app.get("/api/project/list")
async def list_projects():
    """
    Liệt kê danh sách các dự án có sẵn trong thư mục projects.
    """
    projects = []
    projects_root = Path(__file__).resolve().parent.parent / "projects"
    if projects_root.exists():
        for item in sorted(projects_root.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if item.is_dir():
                pj_file = item / "project.json"
                if pj_file.exists():
                    try:
                        with open(pj_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            projects.append({
                                "projectId": data.get("projectId", item.name),
                                "name": data.get("name", item.name),
                                "updatedAt": data.get("updatedAt", ""),
                                "cueCount": len(data.get("cues", [])),
                                "currentStep": data.get("currentStep", 1),
                                "videoName": data.get("videoInfo", {}).get("fileName", ""),
                                "duration": data.get("videoInfo", {}).get("duration", 0.0),
                            })
                    except Exception:
                        continue
    return {"projects": projects}


@app.post("/api/system/browse-file")
async def browse_file(title: str = "Chọn tệp Video gốc", file_type: str = "video"):
    """
    Mở hộp thoại Windows File Explorer native để người dùng chọn tệp trực tiếp từ máy tính.
    """
    def _open():
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.focus_force()
        if file_type == "video":
            filetypes = [
                ("Video Files", "*.mp4;*.mkv;*.mov;*.avi;*.webm;*.flv;*.wmv;*.ts;*.m4v"),
                ("Audio Files", "*.wav;*.mp3;*.m4a;*.flac;*.aac;*.ogg"),
                ("All Files", "*.*")
            ]
        elif file_type == "audio":
            filetypes = [
                ("Audio Files", "*.wav;*.mp3;*.m4a;*.flac;*.aac;*.ogg"),
                ("All Files", "*.*")
            ]
        else:
            filetypes = [("All Files", "*.*")]
        
        selected = filedialog.askopenfilename(
            title=title,
            filetypes=filetypes
        )
        root.destroy()
        return selected

    selected_path = await asyncio.to_thread(_open)
    if not selected_path:
        return {"cancelled": True, "filePath": "", "fileName": "", "fileSizeMb": 0}
    
    p = Path(selected_path)
    file_size_mb = round(p.stat().st_size / (1024 * 1024), 2) if p.exists() else 0
    return {
        "cancelled": False,
        "filePath": p.as_posix(),
        "fileName": p.name,
        "fileSizeMb": file_size_mb,
    }


@app.post("/api/system/browse-folder")
async def browse_folder(title: str = "Chọn thư mục"):
    """
    Mở hộp thoại Windows File Explorer native để người dùng chọn thư mục từ máy tính.
    """
    def _open():
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.focus_force()
        selected = filedialog.askdirectory(title=title)
        root.destroy()
        return selected

    selected_path = await asyncio.to_thread(_open)
    if not selected_path:
        return {"cancelled": True, "folderPath": "", "folderName": ""}
    
    p = Path(selected_path)
    return {
        "cancelled": False,
        "folderPath": p.as_posix(),
        "folderName": p.name,
    }


@app.post("/api/project/create", response_model=ProjectCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_project(request: Request):
    """
    Khởi tạo dự án mới từ tệp video tải lên hoặc đường dẫn có sẵn (hỗ trợ cả FormData và JSON).
    """
    content_type = request.headers.get("content-type", "")
    name: Optional[str] = None
    existing_path: Optional[str] = None
    file: Optional[UploadFile] = None

    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        name = form.get("name")
        existing_path = form.get("existing_path")
        raw_file = form.get("file")
        if raw_file and hasattr(raw_file, "filename") and raw_file.filename:
            file = raw_file
    else:
        try:
            body = await request.json()
            name = body.get("name")
            existing_path = body.get("existing_path")
        except Exception:
            pass

    if not name or not str(name).strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tên dự án là bắt buộc (name field is required)"
        )

    name = str(name).strip()
    existing_path = str(existing_path).strip() if existing_path else None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    project_id = f"prj_{timestamp}"
    project_dir = get_project_dir(project_id)

    media_dir = project_dir / "media"
    steps_dir = project_dir / "steps"
    clips_dir = project_dir / "clips"
    export_dir = project_dir / "export"

    for d in [media_dir, steps_dir, clips_dir, export_dir]:
        d.mkdir(parents=True, exist_ok=True)

    target_video_file = media_dir / "input.mp4"

    # Sao chép tệp video vào thư mục media
    if file and file.filename:
        async with aiofiles.open(target_video_file, "wb") as out_f:
            while content := await file.read(1024 * 1024):
                await out_f.write(content)
    elif existing_path and os.path.exists(existing_path):
        shutil.copy2(existing_path, target_video_file)
    else:
        # Tạo placeholder rỗng nếu chưa có tệp
        target_video_file.touch()

    # Trích xuất thông số media bằng ffprobe
    media_meta = get_media_info_via_ffprobe(str(target_video_file))

    # Tách âm thanh gốc source_audio.wav ở chuẩn 48 kHz
    source_audio_wav = media_dir / "source_audio.wav"
    if media_meta.get("hasAudio", True) and target_video_file.stat().st_size > 0:
        extract_audio_from_video(str(target_video_file), str(source_audio_wav), sample_rate=48000)

    now_iso = datetime.now(timezone.utc).isoformat()
    project = ProjectState(
        version="1.0.0",
        projectId=project_id,
        name=name,
        createdAt=now_iso,
        updatedAt=now_iso,
        currentStep=1,
        videoInfo=VideoInfo(
            filePath=target_video_file.as_posix(),
            fileName=target_video_file.name,
            duration=media_meta.get("duration", 0.0),
            fps=media_meta.get("fps", 30.0),
            width=media_meta.get("width", 1920),
            height=media_meta.get("height", 1080),
            hasAudio=media_meta.get("hasAudio", True),
            audioSampleRate=media_meta.get("audioSampleRate", 44100),
            audioChannels=media_meta.get("audioChannels", 2),
        ),
        settings=ProjectSettings(),
        speakers=[
            SpeakerProfile(
                id="SPEAKER_00",
                name="Người thuyết minh",
                color="#22c55e",
                gender="female",
                voiceId="Mai Anh",
                pitch=0.0,
                speed=1.0,
                selfPronoun="tôi",
                addressPronoun="các bạn",
            )
        ],
        cues=[],
    )

    save_project_state(project)

    return ProjectCreateResponse(
        success=True,
        projectId=project_id,
        projectPath=project_dir.as_posix(),
        project=project,
    )


# ==============================================================================
# 4.3. GET /api/project/load
# ==============================================================================

@app.get("/api/project/load", response_model=ProjectState)
async def load_project(projectId: str = Query(..., description="Mã định danh dự án")):
    """Đọc dữ liệu đầy đủ của một dự án."""
    return load_project_state(projectId)


# ==============================================================================
# 4.4. POST /api/project/save
# ==============================================================================

@app.post("/api/project/save", response_model=ProjectSaveResponse)
async def save_project(req: ProjectSaveRequest):
    """Lưu cập nhật trạng thái project.json."""
    save_project_state(req.project)
    now_iso = datetime.now(timezone.utc).isoformat()
    return ProjectSaveResponse(success=True, updatedAt=now_iso)


# ==============================================================================
# 4.5. GET /api/media/stream (HTTP 206 PARTIAL CONTENT)
# ==============================================================================

@app.get("/api/media/stream")
async def stream_media(request: Request, path: str = Query(..., description="Đường dẫn file media")):
    """
    Stream video .mp4 hoặc audio .wav với hỗ trợ HTTP Range Requests (Status Code 206).
    Cho phép trình duyệt tua nhanh và phát mượt mà không nạp toàn bộ file vào RAM.
    """
    file_path = Path(path).resolve()
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy tệp media tại: {path}",
        )

    file_size = file_path.stat().st_size
    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        ext = file_path.suffix.lower()
        if ext in [".mp4", ".m4v"]:
            content_type = "video/mp4"
        elif ext in [".wav"]:
            content_type = "audio/wav"
        elif ext in [".mp3"]:
            content_type = "audio/mpeg"
        else:
            content_type = "application/octet-stream"

    range_header = request.headers.get("Range")
    if not range_header:
        # Không có Range: Phục vụ toàn bộ tệp (200 OK)
        async def file_sender():
            async with aiofiles.open(file_path, mode="rb") as f:
                while chunk := await f.read(1024 * 1024):
                    yield chunk

        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": content_type,
        }
        return StreamingResponse(file_sender(), status_code=200, headers=headers)

    # Xử lý Range header: bytes=start-end
    try:
        range_val = range_header.strip().lower().replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end = min(end, file_size - 1)
        if start > end:
            start = end
        content_length = end - start + 1
    except Exception:
        raise HTTPException(status_code=416, detail="Phạm vi Range không hợp lệ.")

    async def partial_sender(offset: int, limit: int):
        chunk_size = 256 * 1024
        remaining = limit
        async with aiofiles.open(file_path, mode="rb") as f:
            await f.seek(offset)
            while remaining > 0:
                to_read = min(chunk_size, remaining)
                data = await f.read(to_read)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": content_type,
    }
    return StreamingResponse(partial_sender(start, content_length), status_code=206, headers=headers)


# ==============================================================================
# 4.6. POST /api/step1/recognize (SSE STREAMING)
# ==============================================================================

@app.post("/api/step1/recognize")
async def recognize_step1(req: Step1RecognizeRequest):
    """Khởi chạy nhận diện giọng nói Faster-Whisper hoặc OCR phụ đề cứng."""
    project = load_project_state(req.projectId)
    p_dir = get_project_dir(req.projectId)

    media_path = project.videoInfo.filePath
    if not os.path.exists(media_path):
        media_path = str(p_dir / "media" / "input.mp4")

    # Cập nhật cài đặt nhận dạng
    project.settings.recognitionMode = req.mode
    project.settings.asrModel = req.model
    project.settings.sourceLang = req.lang
    project.currentStep = 1
    save_project_state(project)

    ocr_dict = req.ocrRegion.model_dump() if req.ocrRegion else None

    async def event_generator():
        async for sse_event in stream_step1_recognize(
            project_id=req.projectId,
            project_path=str(p_dir),
            media_path=media_path,
            mode=req.mode,
            model_size=req.model,
            beam_size=req.beamSize,
            lang=req.lang,
            vad=req.vad,
            vad_threshold=req.vadThreshold,
            smart_split=req.smartSplit,
            max_pause=req.maxPause,
            max_duration=req.maxDuration,
            ocr_region=ocr_dict,
        ):
            # Tự động đồng bộ cues mới nhận diện vào project.json khi hoàn tất
            if sse_event.get("event") == "complete":
                cues_data = sse_event.get("data", {}).get("cues", [])
                if cues_data:
                    project.cues = [CueItem(**c) for c in cues_data]
                    save_project_state(project)

            yield sse_event

    return StreamingResponse(
        sse_generator_wrapper(event_generator()),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ==============================================================================
# 4.7. POST /api/step1/update-cues
# ==============================================================================

@app.post("/api/step1/update-cues", response_model=Step1UpdateCuesResponse)
async def update_cues_step1(req: Step1UpdateCuesRequest):
    """Cập nhật danh sách cues sau khi người dùng tinh chỉnh trên UI."""
    project = load_project_state(req.projectId)

    # Cập nhật danh sách câu thoại
    existing_cues = {c.id: c for c in project.cues}
    updated_list: List[CueItem] = []

    for item in req.cues:
        cid = item.id
        dur = round(item.endTime - item.startTime, 2)
        old_cue = existing_cues.get(cid)

        new_cue = CueItem(
            id=cid,
            startTime=item.startTime,
            endTime=item.endTime,
            duration=dur,
            originalText=item.originalText,
            translatedText=item.translatedText if item.translatedText else (old_cue.translatedText if old_cue else ""),
            speakerId=item.speakerId or (old_cue.speakerId if old_cue else "SPEAKER_00"),
            confidence=old_cue.confidence if old_cue else 1.0,
            isContinuation=old_cue.isContinuation if old_cue else False,
            audioFile=old_cue.audioFile if old_cue else None,
            audioDuration=old_cue.audioDuration if old_cue else None,
            playbackRate=old_cue.playbackRate if old_cue else 1.0,
            needsReview=old_cue.needsReview if old_cue else False,
            status=old_cue.status if old_cue else "pending",
        )
        updated_list.append(new_cue)

    project.cues = updated_list
    save_project_state(project)

    return Step1UpdateCuesResponse(success=True, totalCues=len(updated_list))


# ==============================================================================
# 4.8. POST /api/step2/translate (SSE STREAMING)
# ==============================================================================

@app.post("/api/step2/translate")
async def translate_step2(req: Step2TranslateRequest):
    """Khởi chạy Module Dịch máy Ngữ cảnh VideoLingo Qwen 2.5."""
    project = load_project_state(req.projectId)
    p_dir = get_project_dir(req.projectId)

    if not project.cues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dự án chưa có câu thoại nào để dịch. Vui lòng hoàn thành Step 1 trước.",
        )

    # Cập nhật cài đặt dịch
    project.settings.translationGenre = req.genre
    project.settings.translationPersona = req.persona
    project.settings.sourceLang = req.srcLang
    project.settings.targetLang = req.tgtLang
    project.currentStep = 2
    save_project_state(project)

    cues_data = [c.model_dump() for c in project.cues]

    async def event_generator():
        async for sse_event in stream_step2_translate(
            project_id=req.projectId,
            project_path=str(p_dir),
            cues=cues_data,
            genre=req.genre,
            persona=req.persona,
            src_lang=req.srcLang,
            tgt_lang=req.tgtLang,
            reconstruct=req.reconstruct,
            style_prompt=req.stylePrompt,
            model_engine=req.modelEngine,
        ):
            # Cập nhật bản dịch vào project.json khi hoàn thành
            if sse_event.get("event") == "complete":
                translated_cues = sse_event.get("data", {}).get("cues", [])
                cue_map = {c["id"]: c for c in translated_cues}
                for orig_cue in project.cues:
                    if orig_cue.id in cue_map:
                        orig_cue.translatedText = cue_map[orig_cue.id].get("translatedText", "")
                        orig_cue.isContinuation = cue_map[orig_cue.id].get("isContinuation", False)
                        orig_cue.playbackRate = cue_map[orig_cue.id].get("recommendedTtsSpeedRate", 1.0)
                save_project_state(project)

            yield sse_event

    return StreamingResponse(
        sse_generator_wrapper(event_generator()),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ==============================================================================
# 4.9. POST /api/step2/translate-single
# ==============================================================================

@app.post("/api/step2/translate-single", response_model=Step2TranslateSingleResponse)
async def translate_single_step2(req: Step2TranslateSingleRequest):
    """Dịch lại một câu cue lẻ với phong cách hoặc chỉ dẫn riêng."""
    project = load_project_state(req.projectId)

    loop = asyncio.get_running_loop()
    trans_text, speed = await loop.run_in_executor(
        manager.executor,
        translate_single_cue,
        req.sourceText,
        req.targetLang,
        req.persona,
        req.customInstruction,
        req.modelEngine,
    )

    # Cập nhật câu trong project
    for c in project.cues:
        if c.id == req.cueId:
            c.translatedText = trans_text
            c.playbackRate = speed
            break

    save_project_state(project)

    return Step2TranslateSingleResponse(
        cueId=req.cueId,
        translatedText=trans_text,
        recommendedSpeedRate=speed,
    )


# Danh sách 18 giọng đọc bản địa VieNeu-TTS v3 Turbo chuẩn NCKH
ALL_VIENEU_VOICES: List[VoiceItem] = [
    VoiceItem(id="Mai Anh", name="Mai Anh (Nữ · Bắc)", region="Bắc", gender="female", style="Tin tức / Diễn thuyết", description="Giọng nữ truyền cảm, chuẩn phát thanh viên miền Bắc (Mặc định)"),
    VoiceItem(id="Minh Đức", name="Minh Đức (Nam · Bắc)", region="Bắc", gender="male", style="Tin tức / Diễn thuyết", description="Giọng nam trầm ấm, đĩnh đạc, chuyên nghiệp miền Bắc"),
    VoiceItem(id="Trúc Ly", name="Trúc Ly (Nữ · Bắc)", region="Bắc", gender="female", style="Tự nhiên / Đời thường", description="Giọng nữ thanh thoát, tự nhiên miền Bắc"),
    VoiceItem(id="Đoan Trang", name="Đoan Trang (Nữ · Bắc)", region="Bắc", gender="female", style="Tự nhiên / Nhẹ nhàng", description="Giọng nữ dịu dàng, trong trẻo miền Bắc"),
    VoiceItem(id="Thanh Bình", name="Thanh Bình (Nam · Bắc)", region="Bắc", gender="male", style="Kể chuyện / Review", description="Giọng nam kể chuyện sâu lắng, ấm áp miền Bắc"),
    VoiceItem(id="Quỳnh Anh", name="Quỳnh Anh (Nữ · Bắc)", region="Bắc", gender="female", style="Đọc truyện / Cảm xúc", description="Giọng nữ biểu cảm, phù hợp đọc truyện miền Bắc"),
    VoiceItem(id="Ngọc Huyền", name="Ngọc Huyền (Nữ · Bắc)", region="Bắc", gender="female", style="Tự nhiên", description="Giọng nữ trẻ trung, hoạt bát miền Bắc"),
    VoiceItem(id="Quang Sơn", name="Quang Sơn (Nam · Trung)", region="Trung", gender="male", style="Tự nhiên / Đời thường", description="Giọng nam mộc mạc, gần gũi miền Trung"),
    VoiceItem(id="Ngọc Trân", name="Ngọc Trân (Nữ · Trung)", region="Trung", gender="female", style="Tự nhiên / Dịu dàng", description="Giọng nữ nhẹ nhàng, tình cảm miền Trung"),
    VoiceItem(id="Thái Sơn", name="Thái Sơn (Nam · Nam)", region="Nam", gender="male", style="Kể chuyện / Truyền cảm", description="Giọng nam hào sảng, truyền cảm miền Nam"),
    VoiceItem(id="Xuân Vĩnh", name="Xuân Vĩnh (Nam · Nam)", region="Nam", gender="male", style="Tự nhiên / Đời thường", description="Giọng nam hóm hỉnh, tự nhiên miền Nam"),
    VoiceItem(id="Thục Đoan", name="Thục Đoan (Nữ · Nam)", region="Nam", gender="female", style="Kể chuyện", description="Giọng nữ ấm áp, kể chuyện lôi cuốn miền Nam"),
    VoiceItem(id="Minh Triết", name="Minh Triết (Nam · Nam)", region="Nam", gender="male", style="Tin tức / Phóng sự", description="Giọng nam rõ ràng, chuẩn tin tức miền Nam"),
    VoiceItem(id="Thùy Dung", name="Thùy Dung (Nữ · Nam)", region="Nam", gender="female", style="Tin tức", description="Giọng nữ phát thanh viên miền Nam"),
    VoiceItem(id="Mỹ Duyên", name="Mỹ Duyên (Nữ · Nam)", region="Nam", gender="female", style="Đọc truyện / Ngọt ngào", description="Giọng nữ dịu dàng, ngọt ngào miền Nam"),
    VoiceItem(id="Đức Trí", name="Đức Trí (Nam · Nam)", region="Nam", gender="male", style="Đọc truyện", description="Giọng nam trẻ trung, đọc truyện miền Nam"),
    VoiceItem(id="Kim Thanh", name="Kim Thanh (Nữ · Nam)", region="Nam", gender="female", style="Đọc truyện", description="Giọng nữ giàu cảm xúc miền Nam"),
    VoiceItem(id="Adam", name="Adam (Nam · Nam)", region="Nam", gender="male", style="Tự nhiên / Hiện đại", description="Giọng nam hiện đại, phong cách tự nhiên miền Nam"),
]


@app.get("/api/tts/voices", response_model=VoicesResponse)
async def get_preset_voices():
    """
    Trả về danh sách toàn bộ các giọng đọc VieNeu-TTS v3 Turbo theo vùng miền và giới tính.
    Kèm theo giới hạn tốc độ mở rộng không giới hạn trần 2.0x (lên đến 5.0x).
    """
    return VoicesResponse(
        voices=ALL_VIENEU_VOICES,
        defaultVoiceId="Mai Anh",
        maxSpeedRate=5.0,
        minSpeedRate=0.5,
    )


# ==============================================================================
# 4.10. POST /api/step3/synthesize (SSE STREAMING)
# ==============================================================================

@app.post("/api/step3/synthesize")
async def synthesize_step3(req: Step3SynthesizeRequest):
    """Khởi chạy tổng hợp giọng đọc toàn bộ video bằng VieNeu-TTS."""
    project = load_project_state(req.projectId)
    p_dir = get_project_dir(req.projectId)

    if not project.cues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dự án chưa có câu thoại nào để tổng hợp giọng nói.",
        )

    # Phục hồi translatedText từ steps/mt_output.json nếu project.cues bị trống bản dịch
    mt_out_file = p_dir / "steps" / "mt_output.json"
    if mt_out_file.exists():
        try:
            with open(mt_out_file, "r", encoding="utf-8") as f:
                mt_data = json.load(f)
            mt_cues = mt_data.get("cues", [])
            mt_map = {c.get("id"): c for c in mt_cues}
            cues_repaired = False
            for cue in project.cues:
                if not (cue.translatedText or "").strip() and cue.id in mt_map:
                    mt_c = mt_map[cue.id]
                    cue.translatedText = mt_c.get("target_text") or mt_c.get("text") or ""
                    if not cue.playbackRate or cue.playbackRate == 1.0:
                        cue.playbackRate = mt_c.get("recommended_tts_speed_rate") or mt_c.get("recommendedTtsSpeedRate") or 1.0
                    cues_repaired = True
            if cues_repaired:
                logger.info(f"Đã tự động phục hồi {len(mt_map)} câu dịch từ mt_output.json vào project.json.")
                save_project_state(project)
        except Exception as ex:
            logger.warning(f"Lỗi khi đọc fallback từ mt_output.json: {ex}")

    # Cập nhật cài đặt thuyết minh & speakers
    project.settings.defaultVoiceId = req.voiceId
    project.settings.autoMatchDuration = req.autoMatchDuration
    project.settings.borrowGap = req.borrowGap
    project.currentStep = 3
    if req.speakers:
        project.speakers = req.speakers
    elif req.speed and project.speakers:
        project.speakers[0].speed = req.speed
    save_project_state(project)

    speakers_data = [s.model_dump() for s in project.speakers]
    cues_data = [c.model_dump() for c in project.cues]

    async def event_generator():
        async for sse_event in stream_step3_synthesize(
            project_id=req.projectId,
            project_path=str(p_dir),
            cues=cues_data,
            voice_id=req.voiceId,
            device=req.device,
            auto_match_duration=req.autoMatchDuration,
            borrow_gap=req.borrowGap,
            speed=req.speed,
            speakers=speakers_data,
        ):
            # Cập nhật danh sách clip âm thanh vào project.json
            if sse_event.get("event") == "complete":
                synth_cues = sse_event.get("data", {}).get("cues", [])
                synth_map = {c["id"]: c for c in synth_cues}
                for orig in project.cues:
                    if orig.id in synth_map:
                        sc = synth_map[orig.id]
                        orig.audioFile = sc.get("audioFile")
                        orig.audioDuration = sc.get("audioDuration")
                        orig.speed = sc.get("speed", req.speed)
                        orig.playbackRate = sc.get("playbackRate", 1.0)
                        orig.needsReview = sc.get("needsReview", False)
                        orig.status = "ready"
                save_project_state(project)

            yield sse_event

    return StreamingResponse(
        sse_generator_wrapper(event_generator()),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ==============================================================================
# 4.11. POST /api/step3/synthesize-single
# ==============================================================================

@app.post("/api/step3/synthesize-single", response_model=Step3SynthesizeSingleResponse)
async def synthesize_single_step3(req: Step3SynthesizeSingleRequest):
    """Tạo lại clip âm thanh cho 1 câu cue lẻ."""
    project = load_project_state(req.projectId)
    p_dir = get_project_dir(req.projectId)

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        manager.executor,
        synthesize_single_cue,
        str(p_dir),
        req.cueId,
        req.text,
        req.voiceId,
        req.speed,
    )

    # Cập nhật lại cue trong project
    for c in project.cues:
        if c.id == req.cueId:
            c.audioFile = result["audioFile"]
            c.audioDuration = result["audioDuration"]
            c.speed = req.speed
            c.status = "ready"
            break

    save_project_state(project)

    return Step3SynthesizeSingleResponse(**result)


# ==============================================================================
# 4.11b. POST /api/step3/sync-subtitles (KHÓA & ĐỒNG BỘ PHỤ ĐỀ THEO GIỌNG ĐỌC)
# ==============================================================================

@app.post("/api/step3/sync-subtitles", response_model=Step3SyncSubtitlesResponse)
async def sync_subtitles_to_narration(req: Step3SyncSubtitlesRequest):
    """
    Tự động căn chỉnh và khóa lại mốc timeline của toàn bộ phụ đề
    khớp 100% theo thời lượng phát thực tế của các clip giọng đọc AI đã sinh.
    Triệt tiêu hoàn toàn hiện tượng giọng đọc một đằng, phụ đề chạy một nẻo,
    và đảm bảo giọng đọc không bao giờ bị đè lên nhau.
    """
    project = load_project_state(req.projectId)
    if not project.cues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dự án chưa có câu thoại nào để đồng bộ phụ đề.",
        )

    cues_dicts = [c.model_dump() for c in project.cues]
    placed = plan_chained_narration_placements(
        cues=cues_dicts,
        breath_gap_sec=req.breathGapSeconds,
        min_collision_gap_sec=req.minCollisionGapSeconds,
    )

    synced_count = 0
    for idx, c in enumerate(project.cues):
        if idx < len(placed):
            p = placed[idx]
            new_start = p["placedStartTime"]
            new_end = p["placedEndTime"]
            if abs(c.startTime - new_start) > 0.01 or abs(c.endTime - new_end) > 0.01:
                synced_count += 1
            c.startTime = new_start
            c.endTime = new_end
            c.duration = round(new_end - new_start, 3)
            c.placedStartTime = new_start
            c.placedEndTime = new_end
            c.isCollisionShifted = p.get("isCollisionShifted", False)

    save_project_state(project)

    return Step3SyncSubtitlesResponse(
        success=True,
        syncedCount=synced_count,
        cues=project.cues,
        message=f"Đã đồng bộ {synced_count}/{len(project.cues)} câu phụ đề khớp 100% theo giọng đọc AI trên Timeline (Zero Collision)."
    )


# ==============================================================================
# 4.11c. POST /api/step3/timing-offset (BÙ THỜI GIAN PHỤ ĐỀ / AUDIO LEAD-TAIL)
# ==============================================================================

@app.post("/api/step3/timing-offset", response_model=Step3TimingOffsetResponse)
async def adjust_timing_offset(req: Step3TimingOffsetRequest):
    """
    Bù thời gian hiển thị (Lead/Tail Offset ± giây) cho phụ đề và lời thoại.
    Tương tự tính năng 'Bù thời gian' của lemyloi-dichvideos.
    """
    project = load_project_state(req.projectId)
    lead = req.leadOffsetSeconds
    tail = req.tailOffsetSeconds

    for c in project.cues:
        new_start = max(0.0, round(c.startTime + lead, 3))
        new_end = max(new_start + 0.3, round(c.endTime + tail, 3))
        c.startTime = new_start
        c.endTime = new_end
        c.duration = round(new_end - new_start, 3)

    save_project_state(project)

    return Step3TimingOffsetResponse(
        success=True,
        cues=project.cues,
        message=f"Đã áp dụng bù thời gian (Trước: {lead:+.2f}s, Sau: {tail:+.2f}s) cho toàn bộ phụ đề."
    )


# ==============================================================================
# 4.12. POST /api/step4/export (SSE STREAMING)
# ==============================================================================

@app.post("/api/step4/export")
async def export_step4(req: Step4ExportRequest):
    """
    Thực thi trộn âm thanh đa kênh (Audio Ducking), tạo timeline và xuất video hoàn chỉnh.
    """
    project = load_project_state(req.projectId)
    p_dir = get_project_dir(req.projectId)

    # Cập nhật cài đặt export
    project.settings.autoDucking = req.autoDucking
    project.settings.duckingVolume = req.duckingVolume
    project.settings.duckAttackMs = req.duckAttackMs
    project.settings.duckReleaseMs = req.duckReleaseMs
    project.settings.sourceVolumeDb = req.sourceVolumeDb
    project.settings.ttsVolumeDb = req.ttsVolumeDb
    project.settings.exportSubtitleType = req.exportSubtitleType
    project.currentStep = 4
    save_project_state(project)

    async def event_generator():
        yield {
            "event": "start",
            "data": {
                "step": 4,
                "task": "Exporting Video & Audio Mixing",
            }
        }

        # 1. Ghép nối các clip âm thanh thành Narration Track (Chống đè giọng 100%)
        yield {
            "event": "progress",
            "data": {
                "percent": 25,
                "stage": "Building Narration Track",
                "message": f"Đang định vị {len(project.cues)} clip âm thanh với thuật toán chống đè giọng (Zero Collision)...",
            }
        }

        total_dur = project.videoInfo.duration or 60.0
        cues_dicts = [c.model_dump() for c in project.cues]
        sample_rate = DEFAULT_SAMPLE_RATE

        timeline, duck_wins, placed_cues = build_narration_track(
            cues=cues_dicts,
            total_duration_sec=total_dur,
            sample_rate=sample_rate,
        )

        # 2. Hòa âm với Audio Ducking
        yield {
            "event": "progress",
            "data": {
                "percent": 60,
                "stage": "Applying Audio Ducking",
                "message": f"Đang hạ âm lượng BGM với Attack {req.duckAttackMs}ms / Release {req.duckReleaseMs}ms...",
            }
        }

        media_dir = p_dir / "media"
        export_dir = p_dir / "export"
        export_dir.mkdir(parents=True, exist_ok=True)

        bgm_wav = media_dir / "source_audio.wav"
        if not bgm_wav.exists():
            # Tách lại nếu chưa có
            extract_audio_from_video(project.videoInfo.filePath, str(bgm_wav), sample_rate=sample_rate)

        mixed_wav = export_dir / "mixed_audio.wav"
        narration_wav = export_dir / "narration_track.wav"

        mix_audio_with_ducking(
            bgm_path=str(bgm_wav),
            narration_audio=timeline,
            duck_windows=duck_wins,
            output_mixed_path=str(mixed_wav),
            output_narration_path=str(narration_wav),
            sample_rate=sample_rate,
            duck_volume=req.duckingVolume,
            attack_ms=req.duckAttackMs,
            release_ms=req.duckReleaseMs,
            bgm_gain_db=req.sourceVolumeDb,
            narration_gain_db=req.ttsVolumeDb,
        )

        # Lưu phụ đề SRT cho soft/hardsub khớp 100% theo các mốc đã chống đè giọng
        sub_srt = export_dir / "final_subtitles.srt"
        save_cues_to_srt(placed_cues, str(sub_srt))

        # 3. Mux Video bằng FFmpeg CLI
        yield {
            "event": "progress",
            "data": {
                "percent": 85,
                "stage": "Rendering Video",
                "message": f"FFmpeg {req.videoCodec} encoding...",
            }
        }

        out_video = export_dir / "dubbed_video.mp4"
        mux_info = mux_final_video(
            video_path=project.videoInfo.filePath,
            mixed_audio_path=str(mixed_wav),
            output_video_path=str(out_video),
            subtitle_path=str(sub_srt) if req.exportSubtitleType != "none" else None,
            subtitle_type=req.exportSubtitleType,
            video_codec=req.videoCodec,
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        project.exportInfo = ExportInfo(
            exportedFilePath=out_video.as_posix(),
            exportedAt=now_iso,
            exportDurationSec=mux_info.get("duration_sec", total_dur),
            fileSizeBytes=mux_info.get("file_size_bytes", 0),
        )
        save_project_state(project)

        yield {
            "event": "complete",
            "data": {
                "percent": 100,
                "outputVideoPath": out_video.as_posix(),
                "outputVideoUrl": f"/api/media/stream?path={out_video.as_posix()}",
                "fileSizeBytes": mux_info.get("file_size_bytes", 0),
                "durationSec": mux_info.get("duration_sec", total_dur),
            }
        }

    return StreamingResponse(
        sse_generator_wrapper(event_generator()),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ==============================================================================
# 5. MODEL HUB & HARDWARE RECOMMENDATIONS (ZERO-CONFIG)
# ==============================================================================

@app.get("/api/models/status")
async def check_models_status():
    """Kiểm tra danh sách các model AI đã tải trong thư mục models/."""
    models = get_models_status()
    hw = get_hardware_info()
    return {
        "hardware": hw,
        "models": models,
    }


@app.get("/api/models/recommendations")
async def recommend_models():
    """Gợi ý các model tối ưu nhất theo cấu hình GPU/RAM của máy."""
    hw = get_hardware_info()
    tier = hw["suggested_tier"]
    
    # Lựa chọn model theo tier
    if tier == "cpu":
        rec_asr = "whisper-tiny"
        rec_mt = "hy-mt2-1.8b-q125"
    elif tier == "recommended":
        rec_asr = "whisper-small"
        rec_mt = "hy-mt2-1.8b-q8"
    else:
        rec_asr = "whisper-medium"
        rec_mt = "hy-mt2-1.8b-q8"

    return {
        "hardware": hw,
        "recommended": {
            "tier": tier,
            "asrModel": rec_asr,
            "mtModel": rec_mt,
            "ttsModel": "vieneu-v3-turbo",
        }
    }


@app.post("/api/models/download")
async def download_model_endpoint(request: Request):
    """Kích hoạt tải model từ HuggingFace về thư mục models/ qua SSE stream."""
    body = await request.json()
    model_id = body.get("modelId", "")
    
    async def event_generator():
        async for sse_event in stream_download_model(model_id):
            yield sse_event

    return StreamingResponse(
        sse_generator_wrapper(event_generator()),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ==============================================================================
# HÀM CHẠY SERVER QUA UVICORN
# ==============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False)
