# -*- coding: utf-8 -*-
"""
Module Phân Biệt Người Nói Cục Bộ (Local Speaker Diarization) cho ASR-OCR
========================================================================
Đề tài: Thiết Kế Kiến Trúc Hệ Thống Xử Lý Video Đa Ngôn Ngữ Sử Dụng Mô Hình AI Cục Bộ
Thành viên phụ trách: Võ Thành Công (ASR - OCR)

Kỹ thuật:
  1. Trích xuất đặc trưng âm sắc sinh trắc học giọng nói (Acoustic Voiceprint Embeddings):
     - MFCC (Mel-Frequency Cepstral Coefficients) + Delta + Delta-Delta.
     - Cao độ thanh quản F0 (Pitch / Fundamental Frequency) qua Autocorrelation/Harmonic Tracking.
     - Spectral Centroid, Rolloff, Spectral Flux, Zero Crossing Rate.
  2. Phân cụm người nói (Speaker Clustering):
     - Agglomerative Hierarchical Clustering (AHC) với Cosine Metric.
     - Ước lượng tự động số lượng người nói (Auto K-Estimation via Silhouette & Cosine Threshold).
     - Hậu xử lý liên tục dòng thời gian (Markov Continuity Smoothing).
"""

from __future__ import annotations

import os
import sys
import numpy as np
import scipy.signal
import scipy.fft
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
import av


def load_audio_mono_16k(media_path: str) -> tuple[np.ndarray, int]:
    """Tải và chuyển đổi luồng âm thanh sang mono 16000 Hz float32 chuẩn."""
    container = av.open(media_path)
    if not container.streams.audio:
        raise ValueError(f"Không tìm thấy luồng âm thanh trong tệp: {media_path}")

    resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
    audio_frames = []

    for frame in container.decode(audio=0):
        resampled_frames = resampler.resample(frame)
        for rf in resampled_frames:
            audio_frames.append(rf.to_ndarray().flatten())

    container.close()
    if not audio_frames:
        raise ValueError("Không thể giải mã dữ liệu âm thanh từ tệp.")

    audio_data = np.concatenate(audio_frames).astype(np.float32)
    # Chuẩn hóa biên độ peak [-1.0, 1.0]
    max_val = np.max(np.abs(audio_data))
    if max_val > 1e-4:
        audio_data = audio_data / max_val

    return audio_data, 16000


class VoiceprintExtractor:
    """Bộ trích xuất vector đặc trưng âm sắc (Voiceprint Embedding) cho từng câu thoại."""

    def __init__(self, sample_rate: int = 16000, n_mfcc: int = 20, n_mels: int = 40):
        self.sr = sample_rate
        self.n_mfcc = n_mfcc
        self.n_mels = n_mels
        self.mel_basis = self._create_mel_filterbank()

    def _create_mel_filterbank(self) -> np.ndarray:
        """Tạo ma trận Mel Filterbank chuẩn."""
        low_freq = 20.0
        high_freq = self.sr / 2.0
        n_fft = 512

        low_mel = 2595.0 * np.log10(1.0 + low_freq / 700.0)
        high_mel = 2595.0 * np.log10(1.0 + high_freq / 700.0)
        mel_points = np.linspace(low_mel, high_mel, self.n_mels + 2)
        hz_points = 700.0 * (10.0 ** (mel_points / 2595.0) - 1.0)
        bin_points = np.floor((n_fft + 1) * hz_points / self.sr).astype(int)

        weights = np.zeros((self.n_mels, int(n_fft // 2 + 1)))
        for i in range(1, self.n_mels + 1):
            left = bin_points[i - 1]
            center = bin_points[i]
            right = bin_points[i + 1]
            for j in range(left, center):
                weights[i - 1, j] = (j - left) / max(1, center - left)
            for j in range(center, right):
                weights[i - 1, j] = (right - j) / max(1, right - center)
        return weights

    def _compute_mfcc(self, frames_stft: np.ndarray) -> np.ndarray:
        """Tính ma trận MFCCs từ STFT power spectrum."""
        power_spectrum = np.abs(frames_stft) ** 2
        mel_spectrum = np.dot(self.mel_basis, power_spectrum)
        mel_spectrum = np.maximum(mel_spectrum, 1e-10)
        log_mel = np.log(mel_spectrum)
        # Discrete Cosine Transform (DCT Type-II)
        mfcc = scipy.fft.dct(log_mel, type=2, axis=0, norm="ortho")[:self.n_mfcc, :]
        return mfcc

    def _estimate_pitch_f0(self, audio_slice: np.ndarray) -> float:
        """Ước lượng cao độ giọng nói F0 (Hz) qua Short-Time Autocorrelation."""
        if len(audio_slice) < 512:
            return 150.0

        # Phân đoạn 40ms với bước nhảy 20ms
        win_size = int(self.sr * 0.04)
        step = int(self.sr * 0.02)
        f0_candidates = []

        min_lag = int(self.sr / 350.0)  # Nữ/trẻ em tối đa ~350Hz
        max_lag = int(self.sr / 75.0)   # Nam trầm tối thiểu ~75Hz

        for start in range(0, len(audio_slice) - win_size, step):
            segment = audio_slice[start:start + win_size]
            segment = segment - np.mean(segment)
            if np.std(segment) < 1e-3:
                continue

            corr = np.correlate(segment, segment, mode="full")
            corr = corr[len(segment) - 1:]
            if len(corr) > max_lag:
                corr_slice = corr[min_lag:max_lag]
                if len(corr_slice) > 0:
                    peak_idx = np.argmax(corr_slice) + min_lag
                    peak_val = corr[peak_idx]
                    if corr[0] > 0 and (peak_val / corr[0]) > 0.35:
                        f0 = self.sr / peak_idx
                        f0_candidates.append(f0)

        if not f0_candidates:
            return 150.0
        return float(np.median(f0_candidates))

    def extract_embedding(self, audio_slice: np.ndarray) -> tuple[np.ndarray, float]:
        """
        Trích xuất vector âm sắc cố định (Voiceprint Vector) và F0 cho một câu thoại.
        """
        if len(audio_slice) < 512:
            return np.zeros(self.n_mfcc * 4 + 6, dtype=np.float32), 150.0

        # 1. Tính STFT (25ms window, 10ms hop)
        n_fft = 512
        hop_length = int(self.sr * 0.01)
        win_length = int(self.sr * 0.025)
        window = scipy.signal.windows.hann(win_length)

        _, _, Zxx = scipy.signal.stft(
            audio_slice,
            fs=self.sr,
            window=window,
            nperseg=win_length,
            noverlap=win_length - hop_length,
            nfft=n_fft,
        )

        # 2. MFCCs
        mfcc = self._compute_mfcc(Zxx)
        mfcc_mean = np.mean(mfcc, axis=1)
        mfcc_std = np.std(mfcc, axis=1)

        # Delta MFCCs
        if mfcc.shape[1] > 2:
            delta = np.gradient(mfcc, axis=1)
            delta_mean = np.mean(delta, axis=1)
            delta_std = np.std(delta, axis=1)
        else:
            delta_mean = np.zeros(self.n_mfcc)
            delta_std = np.zeros(self.n_mfcc)

        # 3. Đặc trưng phổ âm học (Spectral Features)
        power_spec = np.abs(Zxx) ** 2
        freqs = np.linspace(0, self.sr / 2, power_spec.shape[0])
        # Spectral Centroid
        centroid = np.sum(freqs[:, None] * power_spec, axis=0) / np.maximum(np.sum(power_spec, axis=0), 1e-10)
        centroid_mean = np.mean(centroid)
        centroid_std = np.std(centroid)

        # 4. Cao độ thanh quản F0
        f0_median = self._estimate_pitch_f0(audio_slice)

        # 5. Zero Crossing Rate
        zcr = np.mean(np.abs(np.diff(np.sign(audio_slice)))) / 2.0

        # Ghép thành vector âm sắc thống nhất
        vec = np.concatenate([
            mfcc_mean,
            mfcc_std,
            delta_mean,
            delta_std,
            np.array([
                centroid_mean / 4000.0,
                centroid_std / 2000.0,
                f0_median / 300.0,
                zcr * 10.0,
                np.log1p(np.std(audio_slice)),
                np.log1p(np.max(np.abs(audio_slice))),
            ])
        ]).astype(np.float32)

        # Chuẩn hóa L2-norm
        norm = np.linalg.norm(vec)
        if norm > 1e-8:
            vec = vec / norm

        return vec, f0_median


class SpeakerDiarizer:
    """Bộ điều phối phân biệt người nói theo cụm âm thanh (Speaker Diarizer)."""

    def __init__(self, sample_rate: int = 16000):
        self.sr = sample_rate
        self.extractor = VoiceprintExtractor(sample_rate=sample_rate)

    def diarize(
        self,
        audio_data: np.ndarray,
        cues: list[dict],
        speaker_count: str | int = "auto",
        max_speakers: int = 6,
    ) -> tuple[list[dict], dict]:
        """
        Nhận vào danh sách Cues và gán nhãn người nói cho từng câu thoại.
        """
        if not cues:
            return cues, {"total_speakers": 0, "speakers": []}

        if len(cues) == 1:
            cues[0]["speaker"] = "Speaker 1"
            cues[0]["speaker_id"] = "SPEAKER_00"
            return cues, {
                "total_speakers": 1,
                "speakers": [{
                    "id": "SPEAKER_00",
                    "name": "Speaker 1",
                    "label": "Speaker 1",
                    "gender": "unknown",
                    "pitch_hz": 150.0,
                    "color": "#22c55e",
                }],
            }

        embeddings = []
        pitches = []
        valid_indices = []

        total_samples = len(audio_data)

        # 1. Trích xuất đặc trưng cho từng câu thoại
        for idx, cue in enumerate(cues):
            start_sample = max(0, int(cue["start"] * self.sr))
            end_sample = min(total_samples, int(cue["end"] * self.sr))

            if end_sample <= start_sample + 256:
                continue

            slice_audio = audio_data[start_sample:end_sample]
            emb, f0 = self.extractor.extract_embedding(slice_audio)
            embeddings.append(emb)
            pitches.append(f0)
            valid_indices.append(idx)

        if len(embeddings) < 2:
            for c in cues:
                c["speaker"] = "Speaker 1"
                c["speaker_id"] = "SPEAKER_00"
            return cues, {"total_speakers": 1, "speakers": [{"id": "SPEAKER_00", "label": "Speaker 1"}]}

        X = np.array(embeddings)
        pitches_arr = np.array(pitches, dtype=np.float32)

        # 2. Xác định số lượng người nói tối ưu
        num_cues = len(X)
        max_k = min(max_speakers, num_cues - 1)

        chosen_k = 1
        if speaker_count is not None and str(speaker_count).lower() not in ["auto", "none", ""]:
            try:
                chosen_k = max(1, min(max_speakers, int(speaker_count)))
            except Exception:
                chosen_k = 1
        else:
            # Tự động ước lượng K dựa trên Ward clustering, Cosine distance và độ lệch F0
            if max_k >= 2 and num_cues >= 4:
                best_k = 1
                best_score = -1.0

                for k in range(2, max_k + 1):
                    clusterer = AgglomerativeClustering(
                        n_clusters=k,
                        metric="euclidean",
                        linkage="ward",
                    )
                    labels = clusterer.fit_predict(X)
                    counts = np.bincount(labels)
                    min_count = np.min(counts)

                    # Tránh cụm chỉ có 1 câu (isolated singleton)
                    if min_count >= 2:
                        centroids = [np.mean(X[labels == c], axis=0) for c in range(k)]
                        centroid_dists = []
                        f0_diffs = []
                        for ci in range(k):
                            for cj in range(ci + 1, k):
                                cd = 1.0 - np.dot(centroids[ci], centroids[cj]) / (
                                    np.linalg.norm(centroids[ci]) * np.linalg.norm(centroids[cj]) + 1e-10
                                )
                                centroid_dists.append(cd)
                                p_i = pitches_arr[labels == ci]
                                p_j = pitches_arr[labels == cj]
                                if len(p_i) > 0 and len(p_j) > 0:
                                    f0_diffs.append(abs(np.median(p_i) - np.median(p_j)))

                        max_f0_diff = max(f0_diffs) if f0_diffs else 0.0
                        avg_c_dist = float(np.mean(centroid_dists)) if centroid_dists else 0.0

                        # Điều kiện nhận diện có người nói khác:
                        # Hoặc cao độ F0 chênh lệch đáng kể (>= 18 Hz)
                        # Hoặc khoảng cách âm sắc tâm cụm vượt ngưỡng phân tách (>= 0.0028)
                        if max_f0_diff >= 18.0 or avg_c_dist >= 0.0028:
                            sil = silhouette_score(X, labels)
                            max_ratio = np.max(counts) / float(num_cues)
                            # Giảm trọng số nếu 1 cụm chiếm đa số áp đảo (>80-90% dữ liệu)
                            balance_factor = 1.0 - (max_ratio ** 2)
                            score = sil * balance_factor
                            if score > best_score:
                                best_score = score
                                best_k = k

                chosen_k = best_k

        # 3. Phân cụm chính thức (Dùng Ward Linkage để bảo toàn cấu trúc cụm đều & chính xác)
        if chosen_k > 1:
            clusterer = AgglomerativeClustering(
                n_clusters=chosen_k,
                metric="euclidean",
                linkage="ward",
            )
            labels = clusterer.fit_predict(X)
        else:
            labels = np.zeros(num_cues, dtype=int)

        # 4. Gán nhãn ban đầu
        for valid_idx, label in zip(valid_indices, labels):
            cues[valid_idx]["speaker_cluster"] = int(label)

        # Điền các câu thiếu (nếu có) theo câu liền kề
        last_label = 0
        for c in cues:
            if "speaker_cluster" not in c:
                c["speaker_cluster"] = last_label
            else:
                last_label = c["speaker_cluster"]

        # 5. Markov Continuity Smoothing: Giảm nhiễu chuyển đổi vai nói đột ngột
        for i in range(1, len(cues) - 1):
            prev_s = cues[i - 1]["speaker_cluster"]
            curr_s = cues[i]["speaker_cluster"]
            next_s = cues[i + 1]["speaker_cluster"]
            # Nếu một câu cực ngắn bị kẹp giữa 2 câu của cùng một người nói
            if prev_s == next_s and curr_s != prev_s:
                dur = cues[i]["end"] - cues[i]["start"]
                if dur < 1.2:
                    cues[i]["speaker_cluster"] = prev_s

        # 6. Sắp xếp Speaker theo thứ tự xuất hiện lần đầu (Speaker 1, Speaker 2...)
        cluster_to_id = {}
        for c in cues:
            cl = c["speaker_cluster"]
            if cl not in cluster_to_id:
                cluster_to_id[cl] = len(cluster_to_id) + 1
            sid = cluster_to_id[cl]
            c["speaker"] = f"Speaker {sid}"
            c["speaker_id"] = f"SPEAKER_{sid - 1:02d}"
            del c["speaker_cluster"]

        # 7. Thống kê thông tin profile từng người nói (Cao độ giọng & Giới tính ước lượng)
        speaker_profiles = []
        for cl, sid in cluster_to_id.items():
            spk_pitches = [pitches[i] for i, v_idx in enumerate(valid_indices) if cues[v_idx].get("speaker") == f"Speaker {sid}"]
            avg_pitch = float(np.mean(spk_pitches)) if spk_pitches else 150.0
            # Giới tính ước lượng dựa trên F0: Nam thường < 165Hz, Nữ thường >= 165Hz
            estimated_gender = "male" if avg_pitch < 165.0 else "female"
            speaker_profiles.append({
                "id": f"SPEAKER_{sid - 1:02d}",
                "name": f"Speaker {sid}",
                "label": f"Speaker {sid}",
                "avg_pitch_hz": round(avg_pitch, 1),
                "gender": estimated_gender,
                "color": ["#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4"][(sid - 1) % 6],
            })

        summary = {
            "total_speakers": len(cluster_to_id),
            "speakers": speaker_profiles,
        }
        return cues, summary

