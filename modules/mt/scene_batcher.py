# -*- coding: utf-8 -*-
"""
Module Scene-Aware Sliding Batcher (Phân Chia Batch Theo Phân Cảnh & Lịch Sử Trượt)
==================================================================================
Lấy cảm hứng từ llm-subtrans và WEIFENG2333/VideoCaptioner:
1. Chia các đơn vị câu thành từng phân cảnh tự nhiên (Scene-Aware Batching):
   - Ngắt cảnh khi khoảng lặng giữa 2 câu > 2.0 giây (2000 ms).
   - Giới hạn từ 8 đến 12 câu trong mỗi phân cảnh.
2. Quản lý cửa sổ trượt lịch sử (Sliding History Window):
   - Luôn đính kèm 3 câu cuối của Batch k-1 (kèm bản dịch tiếng Việt đã chốt)
     để đảm bảo tính liên kết mạch lạc 100% giữa các phân cảnh liền kề.
3. Ràng buộc độ dài âm tiết tối đa (TargetLengthConstraint) phục vụ TTS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional, Sequence, Tuple


@dataclass
class SceneBatch:
    """Một phân cảnh bao gồm danh sách các nhóm câu cần dịch."""
    scene_id: int
    groups: List[Any]  # List[MergedCueGroup]
    start_ms: int
    end_ms: int
    sliding_history: List[Tuple[str, str]] = field(default_factory=list)  # [(source, vi_trans)]
    scene_persona: str = "neutral"

    @property
    def duration_sec(self) -> float:
        return max(0.001, (self.end_ms - self.start_ms) / 1000.0)

    @property
    def num_cues(self) -> int:
        return sum(len(g.cues) for g in self.groups)


class SceneBatcher:
    """Bộ chia phân cảnh & quản lý cửa sổ trượt (Scene Batcher)."""

    def __init__(
        self,
        min_scene_size: int = 6,
        max_scene_size: int = 12,
        scene_gap_threshold_ms: int = 2000,
        history_window_size: int = 3,
    ):
        self.min_scene_size = min_scene_size
        self.max_scene_size = max_scene_size
        self.scene_gap_threshold_ms = scene_gap_threshold_ms
        self.history_window_size = history_window_size

    def partition_scenes(
        self,
        groups: List[Any],
        global_persona: str = "neutral",
        persona_detector_fn: Optional[Any] = None,
        src_lang: str = "zh",
    ) -> List[SceneBatch]:
        """Phân chia danh sách MergedCueGroup thành các SceneBatch tối ưu."""
        if not groups:
            return []

        scenes: List[SceneBatch] = []
        current_scene_groups: List[Any] = []
        scene_id = 1

        for i, group in enumerate(groups):
            if not current_scene_groups:
                current_scene_groups.append(group)
                continue

            prev_group = current_scene_groups[-1]
            # Tính khoảng lặng giữa nhóm trước và nhóm hiện tại
            gap_ms = group.cues[0].start_ms - prev_group.cues[-1].end_ms

            # Điều kiện ngắt sang phân cảnh mới:
            # 1. Khoảng lặng > scene_gap_threshold_ms (2.0s) và đã đủ kích thước tối thiểu
            # 2. Hoặc số lượng nhóm đạt max_scene_size (10-12 nhóm)
            should_split = (
                (gap_ms >= self.scene_gap_threshold_ms and len(current_scene_groups) >= self.min_scene_size)
                or len(current_scene_groups) >= self.max_scene_size
            )

            if should_split:
                scene_start = current_scene_groups[0].cues[0].start_ms
                scene_end = current_scene_groups[-1].cues[-1].end_ms
                
                # Xác định persona riêng cho phân cảnh này nếu có bộ phát hiện
                scene_persona = global_persona
                if persona_detector_fn is not None:
                    texts = [g.merged_source_text for g in current_scene_groups]
                    scene_persona = persona_detector_fn(texts, global_persona, src_lang=src_lang)

                scenes.append(
                    SceneBatch(
                        scene_id=scene_id,
                        groups=current_scene_groups,
                        start_ms=scene_start,
                        end_ms=scene_end,
                        scene_persona=scene_persona,
                    )
                )
                scene_id += 1
                current_scene_groups = [group]
            else:
                current_scene_groups.append(group)

        # Xử lý phân cảnh cuối cùng còn lại
        if current_scene_groups:
            scene_start = current_scene_groups[0].cues[0].start_ms
            scene_end = current_scene_groups[-1].cues[-1].end_ms
            scene_persona = global_persona
            if persona_detector_fn is not None:
                texts = [g.merged_source_text for g in current_scene_groups]
                scene_persona = persona_detector_fn(texts, global_persona, src_lang=src_lang)

            scenes.append(
                SceneBatch(
                    scene_id=scene_id,
                    groups=current_scene_groups,
                    start_ms=scene_start,
                    end_ms=scene_end,
                    scene_persona=scene_persona,
                )
            )

        return scenes

    def attach_sliding_history(
        self,
        scenes: List[SceneBatch],
    ) -> None:
        """Gắn 3 câu cuối của phân cảnh trước (kèm bản dịch) vào phân cảnh kế tiếp."""
        history_buffer: List[Tuple[str, str]] = []

        for scene in scenes:
            scene.sliding_history = list(history_buffer)

            # Cập nhật history buffer từ các câu trong scene này
            new_entries: List[Tuple[str, str]] = []
            for g in scene.groups:
                src_txt = g.merged_source_text.strip()
                trans_txt = g.translated_text.strip()
                if src_txt and trans_txt:
                    new_entries.append((src_txt, trans_txt))

            if new_entries:
                history_buffer = (history_buffer + new_entries)[-self.history_window_size:]

