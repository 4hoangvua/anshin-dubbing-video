# -*- coding: utf-8 -*-
"""
Module Sentence Reconstruction & Proportional Re-splitting (Tầng Gộp Câu & Phân Bổ Tỷ Lệ)
========================================================================================
Lấy cảm hứng từ Huanshere/VideoLingo và llm-subtrans:
1. Gộp các cues bị ASR cắt vụn giữa chừng thành câu ngữ pháp hoàn chỉnh.
2. Dịch cả khối câu để trọn vẹn nghĩa và trật tự từ tiếng Việt.
3. Tách chuỗi dịch tiếng Việt trả về đúng từng cue gốc theo tỷ lệ thời lượng/độ dài,
   giữ nguyên 100% start_ms và end_ms để đảm bảo chuẩn bàn giao cho TTS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, List, Optional, Sequence, Tuple


# Các ký tự đánh dấu kết thúc câu hoàn chỉnh
SENTENCE_END_PUNCTUATION = {
    ".", "?", "!", ";", "…",
    "。", "？", "！", "；", "…", "～", "~"
}

# Các tiền tố chuyển lượt người nói hoặc phản bác (Speaker Turn / Retort Starters)
# Tuyệt đối không gộp các câu này với câu trước vì thuộc về nhân vật khác hoặc hành vi thoại mới
SPEAKER_TURN_STARTERS_ZH = [
    "我没有", "我不是", "我看", "没错", "别忘了", "跟他废", "给他", "不要", "干嘛",
    "你干嘛", "你怎么", "怎么可能", "闭嘴", "滚", "您好", "老婆", "老公", "芝芝",
    "等一下", "不好意思", "师傅", "美女", "帅哥"
]

SPEAKER_TURN_STARTERS_EN = [
    "i didn't", "i am not", "i'm not", "no i", "shut up", "don't", "what are you doing",
    "come on", "hello", "hi", "hey", "well i", "well,", "and what", "what do you",
    "are you", "how do you", "would you", "right now i'm", "looking for", "no, we're",
    "excuse me", "pardon me", "by the way", "let me tell you"
]

# Các câu cảm thán / phản hồi độc lập không được gộp với câu kế tiếp
STANDALONE_EXCLAMATIONS_ZH = {
    "我没有", "我不是", "没错", "不要", "干嘛", "你干嘛", "怎么可能",
    "算了", "闭嘴", "滚", "您好", "您好 您好", "也可以", "孟亲",
    "好的", "没问题", "行", "可以", "救命", "快跑"
}

STANDALONE_EXCLAMATIONS_EN = {
    "yeah", "yes", "yep", "no", "nope", "okay", "ok", "right", "alright", "all right",
    "good for you", "that's great", "great", "sure", "cool", "well", "exactly",
    "fine", "oh really", "really", "wow", "come on", "hello", "hi", "hey",
    "thank you", "thanks", "good luck", "congratulations", "of course"
}

# Các hư từ / liên từ tiếng Việt thích hợp để ngắt vế câu tự nhiên
VI_SPLIT_CONJUNCTIONS = {
    "thì", "mà", "nhưng", "và", "để", "vì", "do", "nên",
    "khi", "lúc", "nếu", "hay", "hoặc", "còn", "rồi",
    "cho", "với", "tại", "bởi", "trong", "trên"
}


@dataclass
class MergedCueGroup:
    """Đại diện cho một nhóm cue được gộp lại (hoặc 1 cue độc lập)."""
    cue_indices: List[int]
    cues: List[Any]  # List[SrtItem]
    merged_source_text: str
    translated_text: str = ""
    durations_sec: List[float] = field(default_factory=list)
    total_duration_sec: float = 0.0

    @property
    def is_merged(self) -> bool:
        return len(self.cues) > 1


class SentenceReconstructor:
    """Tầng gộp câu bị ngắt dòng & phân bổ tỷ lệ thời gian."""

    def __init__(
        self,
        max_gap_ms: int = 1000,
        max_cues_per_group: int = 4,
        max_group_duration_sec: float = 9.0,
    ):
        self.max_gap_ms = max_gap_ms
        self.max_cues_per_group = max_cues_per_group
        self.max_group_duration_sec = max_group_duration_sec

    def is_sentence_terminal(self, text: str, is_cjk: bool = True) -> bool:
        """Kiểm tra xem câu đã kết thúc bằng dấu ngắt câu hay là câu độc lập hay chưa."""
        cleaned = text.strip()
        if not cleaned:
            return True

        # Bỏ dấu câu ở cuối để so khớp cụm từ cảm thán độc lập
        core = re.sub(r"[.?!;,:…~～\s]+$", "", cleaned).strip().lower()

        if is_cjk:
            if cleaned in STANDALONE_EXCLAMATIONS_ZH or core in STANDALONE_EXCLAMATIONS_ZH:
                return True
        else:
            if core in STANDALONE_EXCLAMATIONS_EN:
                return True

        last_char = cleaned[-1]
        return last_char in SENTENCE_END_PUNCTUATION

    def is_speaker_turn_starter(self, text: str, is_cjk: bool = True) -> bool:
        """Kiểm tra xem câu có phải là khởi đầu lượt thoại mới / phản bác hay không."""
        cleaned = text.strip().lower()
        starters = SPEAKER_TURN_STARTERS_ZH if is_cjk else SPEAKER_TURN_STARTERS_EN
        for s in starters:
            if cleaned.startswith(s.lower()):
                return True
        return False

    def group_cues(self, items: List[Any], src_lang: str = "zh") -> List[MergedCueGroup]:
        """Quét danh sách cues và gộp các câu bị ngắt vụn."""
        if not items:
            return []

        is_cjk = src_lang.lower().startswith("zh") or src_lang.lower() in ("ja", "ko")
        groups: List[MergedCueGroup] = []
        n = len(items)
        i = 0

        while i < n:
            curr_item = items[i]
            group_items = [curr_item]
            group_durations = [curr_item.duration_sec]
            total_dur = curr_item.duration_sec

            # Kiểm tra xem có thể gộp với các câu kế tiếp không
            j = i + 1
            while j < n and len(group_items) < self.max_cues_per_group:
                prev_in_group = group_items[-1]
                next_item = items[j]

                # Điều kiện gộp:
                # 1. Câu trước chưa kết thúc bằng dấu ngắt câu
                # 2. Khoảng lặng tới câu kế tiếp nhỏ hơn max_gap_ms (mặc định 600ms)
                # 3. Tổng thời lượng nhóm không vượt quá max_group_duration_sec
                # 4. Câu tiếp theo KHÔNG PHẢI là lượt thoại mới / phản bác của nhân vật khác
                # 5. Phải cùng speaker / speaker_id (tuyệt đối không gộp 2 người nói khác nhau)
                gap_ms = next_item.start_ms - prev_in_group.end_ms
                has_dummy_time = (next_item.start_ms <= prev_in_group.start_ms)
                valid_gap = (has_dummy_time) or (0 <= gap_ms <= self.max_gap_ms)
                prev_spk = (getattr(prev_in_group, "speaker", None) or getattr(prev_in_group, "speaker_id", "") or "").strip()
                next_spk = (getattr(next_item, "speaker", None) or getattr(next_item, "speaker_id", "") or "").strip()
                same_speaker = (not prev_spk or not next_spk or prev_spk == next_spk)

                if (
                    not self.is_sentence_terminal(prev_in_group.text, is_cjk=is_cjk)
                    and valid_gap
                    and (total_dur + next_item.duration_sec) <= self.max_group_duration_sec
                    and not self.is_speaker_turn_starter(next_item.text, is_cjk=is_cjk)
                    and same_speaker
                ):
                    group_items.append(next_item)
                    group_durations.append(next_item.duration_sec)
                    total_dur += next_item.duration_sec
                    j += 1
                else:
                    break

            # Tạo văn bản gộp
            if is_cjk:
                merged_text = "".join(it.text.strip() for it in group_items)
            else:
                merged_text = " ".join(it.text.strip() for it in group_items)

            cue_indices = [it.index for it in group_items]
            group = MergedCueGroup(
                cue_indices=cue_indices,
                cues=group_items,
                merged_source_text=merged_text,
                durations_sec=group_durations,
                total_duration_sec=total_dur,
            )
            groups.append(group)
            i = j

        return groups

    def proportional_resplit(self, group: MergedCueGroup, translated_text: str) -> List[str]:
        """Tách văn bản tiếng Việt trả về đúng từng cue gốc theo tỷ lệ thời lượng."""
        cleaned_trans = translated_text.strip()
        num_cues = len(group.cues)
        if num_cues == 1 or not cleaned_trans:
            return [cleaned_trans]

        words = cleaned_trans.split()
        total_words = len(words)
        if total_words <= num_cues:
            # Quá ít từ để phân chia phức tạp: chia đều mỗi cue ít nhất 1 từ
            res = []
            for k in range(num_cues):
                if k < total_words:
                    res.append(words[k])
                else:
                    res.append("")
            if total_words > num_cues:
                res[-1] = " ".join(words[num_cues - 1:])
            # Đảm bảo không có cue rỗng bằng cách san sẻ từ
            for k in range(len(res)):
                if not res[k] and k > 0 and len(res[k-1].split()) > 1:
                    prev_words = res[k-1].split()
                    res[k] = prev_words[-1]
                    res[k-1] = " ".join(prev_words[:-1])
            return res

        # Tính tỷ lệ thời lượng của từng cue
        total_dur = max(0.001, group.total_duration_sec)
        dur_ratios = [d / total_dur for d in group.durations_sec]

        # Tìm các điểm ngắt từ lý tưởng theo tỷ lệ
        ideal_cuts = []
        cum = 0.0
        for r in dur_ratios[:-1]:
            cum += r
            ideal_cuts.append(int(round(cum * total_words)))

        # Tinh chỉnh điểm ngắt tại các dấu câu (, ; -) hoặc liên từ tự nhiên
        actual_cuts = []
        prev_cut = 0
        for cut in ideal_cuts:
            best_cut = cut
            best_score = -999.0
            # Tìm trong lân cận [-2, +2] từ
            search_start = max(prev_cut + 1, cut - 2)
            search_end = min(total_words - 1, cut + 3)

            for cand in range(search_start, search_end):
                score = 0.0
                dist = abs(cand - cut)
                score -= dist * 1.5

                # Ưu tiên ngắt sau dấu phẩy / dấu câu
                word_before = words[cand - 1]
                if word_before.endswith((",", ";", "-", "—")):
                    score += 5.0

                # Ưu tiên ngắt trước một liên từ (thì, mà, nhưng, và...)
                word_at = words[cand].lower()
                if word_at in VI_SPLIT_CONJUNCTIONS:
                    score += 3.5

                if score > best_score:
                    best_score = score
                    best_cut = cand

            actual_cuts.append(best_cut)
            prev_cut = best_cut

        # Cắt thành các phần chuỗi
        parts = []
        start_idx = 0
        for cut in actual_cuts:
            sub = " ".join(words[start_idx:cut]).strip()
            # Xóa dấu chấm hoặc ký tự kết thúc ở các vế lửng trung gian
            sub = re.sub(r"[.?!;—\-]\s*$", "", sub).strip()
            if sub:
                # Viết hoa chữ cái đầu cho vế câu tự nhiên
                sub = sub[0].upper() + sub[1:] if len(sub) > 1 else sub.upper()
            parts.append(sub)
            start_idx = cut

        # Phần còn lại cho cue cuối cùng
        last_sub = " ".join(words[start_idx:]).strip()
        if last_sub:
            last_sub = last_sub[0].upper() + last_sub[1:] if len(last_sub) > 1 else last_sub.upper()
        parts.append(last_sub)

        return parts

    def apply_translations_to_items(
        self,
        groups: List[MergedCueGroup],
        translated_texts: List[str],
    ) -> None:
        """Gán các câu dịch đã tách về từng SrtItem gốc kèm cờ liền mạch (continuity)."""
        for group, trans_text in zip(groups, translated_texts):
            group.translated_text = trans_text
            split_parts = self.proportional_resplit(group, trans_text)
            num_cues = len(group.cues)
            for idx, (cue, sub_trans) in enumerate(zip(group.cues, split_parts)):
                cue.translated_text = sub_trans
                cue.is_continuation = (idx < num_cues - 1)
                cue.group_full_text = trans_text
                cue.group_start_ms = group.cues[0].start_ms
                cue.group_end_ms = group.cues[-1].end_ms
