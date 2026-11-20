# -*- coding: utf-8 -*-
"""
Automated Unit & Integration Tests for Video Dubbing AI Local Backend
"""

import os
import sys
from pathlib import Path
from fastapi.testclient import TestClient

# Thêm thư mục hiện tại vào sys.path
sys.path.insert(0, str(Path(__file__).parent))

from audio_mixer import (
    calculate_playback_rate,
    expand_cues_into_silence_gaps,
    generate_ducking_envelope,
    is_incomplete_sentence,
    merge_duck_windows,
)
from server import app


def test_incomplete_sentence():
    # Câu có dấu chấm kết thúc -> False
    assert not is_incomplete_sentence("Hôm nay trời rất đẹp.", "Chúng ta cùng đi dạo nhé.")
    assert not is_incomplete_sentence("Hello world!", "How are you?")

    # Câu có dấu phẩy -> True
    assert is_incomplete_sentence("Trong bài học hôm nay,", "chúng ta sẽ tìm hiểu về Python.")

    # Câu kết thúc bằng từ nối tiếng Việt -> True
    assert is_incomplete_sentence("Mô hình này rất tốt và", "độ chính xác rất cao.")
    assert is_incomplete_sentence("Chúng ta cần phải", "lưu ý điều này.")

    # Câu sau viết thường -> True
    assert is_incomplete_sentence("Đây là ví dụ", "về một câu tiếp nối.")

    # Câu sau mở đầu bằng liên từ -> True
    assert is_incomplete_sentence("Anh ấy rất chăm chỉ", "nhưng điểm số chưa cao.")
    print("[✓] test_incomplete_sentence: PASSED")


def test_borrow_gap_algorithm():
    cues = [
        {"id": 1, "start": 0.0, "end": 2.0, "text": "Chào mừng các bạn đến với khóa học lập trình Python hôm nay,"},
        {"id": 2, "start": 4.0, "end": 5.5, "text": "chúng ta sẽ bắt đầu từ những khái niệm cơ bản nhất."},
    ]
    expanded = expand_cues_into_silence_gaps(cues)
    assert len(expanded) == 2
    # Câu 1 kết thúc bằng dấu phẩy, có khoảng lặng 2.0s đến câu 2 -> thời gian kết thúc của câu 1 phải được nới ra
    assert expanded[0]["end"] > 2.0
    # Đảm bảo không chồng lấn lên câu 2
    assert expanded[0]["end"] <= expanded[1]["start"]
    print(f"[✓] test_borrow_gap_algorithm: PASSED (Cue 1 end: 2.0 -> {expanded[0]['end']})")


def test_playback_rate():
    # Thoại ngắn hơn thời gian cho phép: speed = 1.0, needsReview = False
    rate, dur, rev = calculate_playback_rate(1.5, 2.5, auto_match_duration=True)
    assert rate == 1.0
    assert not rev

    # Thoại dài hơn trong dải an toàn (<= 5.0x): speed = 1.2x, 1.5x, 2.1x, needsReview = False
    rate, dur, rev = calculate_playback_rate(2.4, 2.0, auto_match_duration=True)
    assert rate == 1.2
    assert not rev

    rate, dur, rev = calculate_playback_rate(3.0, 2.0, auto_match_duration=True)
    assert rate == 1.5
    assert not rev

    # Bỏ giới hạn 2.0x, câu 4.2s / 2.0s = 2.1x vẫn tăng tốc mượt mà
    rate, dur, rev = calculate_playback_rate(4.2, 2.0, auto_match_duration=True)
    assert rate == 2.1
    assert not rev

    # Thoại vượt ngưỡng 5.0x: kẹp trần ở 5.0x, needsReview = True
    rate, dur, rev = calculate_playback_rate(12.0, 2.0, auto_match_duration=True)
    assert rate == 5.0
    assert rev
    print("[✓] test_playback_rate (Expanded > 2.0x): PASSED")


def test_ducking_envelope():
    sr = 1000  # 1kHz test
    total_samples = 5000  # 5s
    windows = [(1.0, 3.0)]  # duck from 1.0s to 3.0s

    env = generate_ducking_envelope(
        total_samples=total_samples,
        sr=sr,
        duck_windows=windows,
        duck_volume=0.15,
        attack_ms=200,
        release_ms=400,
    )
    assert len(env) == total_samples
    # Trước 1.0s: âm lượng = 1.0
    assert abs(env[500] - 1.0) < 0.01
    # Trong khoảng 1.5s - 2.5s: âm lượng bị hạ xuống 0.15
    assert abs(env[2000] - 0.15) < 0.01
    # Sau khi release (sau 3.4s): âm lượng trở lại 1.0
    assert abs(env[4000] - 1.0) < 0.01
    print("[✓] test_ducking_envelope: PASSED")


def test_api_endpoints():
    client = TestClient(app)

    # 1. GET /api/health
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "system" in data
    assert "modules" in data
    print(f"[✓] GET /api/health: PASSED (VRAM free: {data['system']['free_vram_mb']}MB)")

    # 1b. GET /api/tts/voices (18 VieNeu-TTS Voices & Max Speed 5.0x)
    res = client.get("/api/tts/voices")
    assert res.status_code == 200
    voices_data = res.json()
    assert len(voices_data["voices"]) >= 18
    assert voices_data["maxSpeedRate"] == 5.0
    assert voices_data["defaultVoiceId"] == "Mai Anh"
    print(f"[✓] GET /api/tts/voices: PASSED ({len(voices_data['voices'])} voices, max speed: {voices_data['maxSpeedRate']}x)")

    # 2. POST /api/project/create
    res = client.post("/api/project/create", data={"name": "Test Project Dubbing"})
    assert res.status_code == 201
    proj_data = res.json()
    assert proj_data["success"] is True
    project_id = proj_data["projectId"]
    print(f"[✓] POST /api/project/create: PASSED (ID: {project_id})")

    # 3. GET /api/project/load
    res = client.get(f"/api/project/load?projectId={project_id}")
    assert res.status_code == 200
    loaded = res.json()
    assert loaded["projectId"] == project_id
    assert loaded["name"] == "Test Project Dubbing"
    print(f"[✓] GET /api/project/load: PASSED")

    # 4. POST /api/step1/update-cues
    update_payload = {
        "projectId": project_id,
        "cues": [
            {
                "id": 1,
                "startTime": 0.5,
                "endTime": 3.0,
                "originalText": "Hello world from test",
                "speakerId": "SPEAKER_00",
            }
        ]
    }
    res = client.post("/api/step1/update-cues", json=update_payload)
    assert res.status_code == 200
    assert res.json()["totalCues"] == 1
    print(f"[✓] POST /api/step1/update-cues: PASSED")

    # 5. POST /api/project/save
    res = client.get(f"/api/project/load?projectId={project_id}")
    loaded = res.json()
    loaded["cues"][0]["translatedText"] = "Xin chào thế giới từ bài test"
    res = client.post("/api/project/save", json={"projectId": project_id, "project": loaded})
    assert res.status_code == 200
    assert res.json()["success"] is True
    print(f"[✓] POST /api/project/save: PASSED")

    # Re-load check
    res = client.get(f"/api/project/load?projectId={project_id}")
    assert res.json()["cues"][0]["translatedText"] == "Xin chào thế giới từ bài test"
    print(f"[✓] Verification of saved state: PASSED")

    # 6. GET /api/media/stream (HTTP 206 Partial Content)
    dummy_wav = Path(__file__).parent / "dummy_test.wav"
    dummy_wav.write_bytes(b"RIFF" + b"\x00" * 1024)
    try:
        # Full content request
        res_full = client.get(f"/api/media/stream?path={dummy_wav.as_posix()}")
        assert res_full.status_code == 200
        assert res_full.headers["Accept-Ranges"] == "bytes"
        assert len(res_full.content) == 1028

        # Partial Range request
        res_part = client.get(
            f"/api/media/stream?path={dummy_wav.as_posix()}",
            headers={"Range": "bytes=0-99"}
        )
        assert res_part.status_code == 206
        assert res_part.headers["Content-Range"] == "bytes 0-99/1028"
        assert len(res_part.content) == 100
        print(f"[✓] GET /api/media/stream (206 Partial Content): PASSED")
    finally:
        if dummy_wav.exists():
            dummy_wav.unlink()


def test_gpu_status_and_surrogates():
    from utils.subprocess_runner import clean_surrogates, get_gpu_vram_status
    client = TestClient(app)

    # Test surrogate cleaning with chr(0xD800)
    bad_char = chr(0xD800)
    bad_str = "Xin chào " + bad_char + " thế giới lỗi!"
    cleaned = clean_surrogates(bad_str)
    assert bad_char not in cleaned
    assert "Xin chào  thế giới lỗi!" == cleaned

    # Test API endpoint
    res = client.get("/api/system/gpu-status")
    assert res.status_code == 200
    data = res.json()
    assert "available" in data
    assert "isSlotLocked" in data
    print(f"[✓] GET /api/system/gpu-status: PASSED ({data['deviceName']}, free: {data['freeMb']} MB)")


def test_waveform_endpoint():
    import wave
    import numpy as np

    client = TestClient(app)
    test_wav = Path(__file__).parent / "test_waveform_sample.wav"
    try:
        with wave.open(str(test_wav), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            t = np.linspace(0, 1, 16000, False)
            audio = (np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
            wf.writeframes(audio.tobytes())

        res = client.get(f"/api/media/waveform?path={test_wav.as_posix()}&points_per_second=20")
        assert res.status_code == 200
        data = res.json()
        assert "peaks" in data
        assert len(data["peaks"]) > 0
        assert data["pointsPerSecond"] == 20
        assert data["duration"] == 1.0
        print(f"[✓] GET /api/media/waveform: PASSED ({len(data['peaks'])} points)")
    finally:
        if test_wav.exists():
            test_wav.unlink()
        cache = Path(__file__).parent / "test_waveform_sample_waveform.json"
        if cache.exists():
            cache.unlink()


def test_filmstrip_endpoint():
    client = TestClient(app)
    # Test 404 on non-existent file
    res = client.get("/api/media/filmstrip?path=non_existent_video.mp4")
    assert res.status_code == 404
    print("[✓] GET /api/media/filmstrip (404 guard): PASSED")


if __name__ == "__main__":
    print("=" * 60)
    print("RUNNING BACKEND TEST SUITE")
    print("=" * 60)
    test_incomplete_sentence()
    test_borrow_gap_algorithm()
    test_playback_rate()
    test_ducking_envelope()
    test_gpu_status_and_surrogates()
    test_waveform_endpoint()
    test_filmstrip_endpoint()
    test_api_endpoints()
    print("=" * 60)
    print("ALL TESTS PASSED SUCCESSFULLY! 🚀")
    print("=" * 60)
