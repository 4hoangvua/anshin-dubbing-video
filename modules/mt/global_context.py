# -*- coding: utf-8 -*-
"""
Module Global Context & Persona Harmonization (Quét Toàn Kịch Bản & Khóa Ngữ Cảnh)
================================================================================
Lấy cảm hứng từ llm-subtrans và VideoLingo:
1. Pass-1 Global Synopsis: Quét toàn bộ phụ đề video để rút trích bối cảnh câu chuyện (synopsis).
2. Tự động phát hiện và khóa sắc thái xưng hô (Persona) đồng bộ toàn kịch bản hoặc theo phân cảnh.
3. In-Context Glossary Locking: Khóa và bảo vệ thực thể, danh từ riêng từ data/glossary.json.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass
class GlobalVideoContext:
    """Hồ sơ ngữ cảnh toàn bộ video phục vụ cho dịch thuật hiểu sâu."""
    synopsis: str
    dominant_persona: str
    dominant_persona_label: str
    source_language: str
    target_language: str
    matched_glossary: Dict[str, str] = field(default_factory=dict)
    topic_tags: List[str] = field(default_factory=list)
    genre: str = "general_dialogue"
    genre_label: str = "Hội thoại đời thường / Tổng hợp"

    def to_summary_str(self) -> str:
        tags_str = ", ".join(self.topic_tags) if self.topic_tags else "Tổng hợp"
        glossary_sample = ", ".join(f"{k}➔{v}" for k, v in list(self.matched_glossary.items())[:5])
        return (
            f"[Thể loại: {self.genre_label} | Bối cảnh: {self.synopsis} | Chủ đề: {tags_str} | "
            f"Persona chủ đạo: {self.dominant_persona.upper()} ({self.dominant_persona_label}) | "
            f"Thực thể khóa: {glossary_sample or 'Không có'}]"
        )


class GlobalContextExtractor:
    """Bộ rút trích ngữ cảnh toàn cục lần 1 (Pass-1 Global Context Extractor)."""

    GENRE_LABELS = {
        "ted_speech": "Diễn thuyết TED Talk / Truyền cảm hứng / Kỹ năng",
        "tech_tutorial": "Công nghệ / Khoa học / Hướng dẫn phần mềm",
        "drama_conflict": "Phim ảnh kịch tính / Mâu thuẫn / Cãi vã",
        "romance_daily": "Tình cảm / Đời sống gia đình / Bạn bè",
        "vlog_entertainment": "Vlog du lịch / Ẩm thực / Giải trí",
        "general_dialogue": "Hội thoại đời thường / Tổng hợp",
    }

    PERSONA_LABELS = {
        "informal": "Tranh cãi / Hài hước / Suồng sã (mày - tao)",
        "neutral": "Thân mật / Trung tính (cậu - tôi / bạn - tôi)",
        "polite": "Lịch sự / Xã giao (tôi - anh/chị/quý vị)",
        "intimate": "Thân mật / Tình cảm (cậu - tớ / anh - em)",
        "formal": "Trang trọng / Công vụ (tôi - quý vị)",
        "presentation": "Thuyết trình / Truyền cảm hứng (tôi - các bạn / mọi người)",
        "none": "Giữ nguyên bản dịch thô",
    }

    def __init__(self, glossary: Optional[Dict[str, str]] = None):
        self.glossary = glossary or {}

    def extract(
        self,
        cues_or_texts: Sequence[Any],
        src_lang: str = "zh",
        target_lang: str = "vi",
        requested_persona: str = "auto",
        requested_genre: str = "auto",
    ) -> GlobalVideoContext:
        """Thực hiện quét lần 1 trên toàn bộ phụ đề để rút trích bối cảnh toàn cục."""
        # Trích xuất chuỗi văn bản gốc
        texts: List[str] = []
        for it in cues_or_texts:
            if hasattr(it, "text"):
                texts.append(it.text.strip())
            elif isinstance(it, str):
                texts.append(it.strip())
            elif isinstance(it, dict):
                texts.append(str(it.get("text", it.get("source_text", ""))).strip())

        full_text = " ".join(texts)
        full_text_lower = full_text.lower()
        clean_src = src_lang.lower().strip()

        # 1. Phát hiện chủ đề & Tóm tắt bối cảnh (Synopsis)
        topic_tags: List[str] = []
        synopsis_parts: List[str] = []

        if clean_src.startswith("zh"):
            # Chủ đề xung đột học đường / Bắt nạt
            bullying_keywords = [
                "学渣", "考进", "作弊", "校服", "骚里骚气", "勾引",
                "野种", "教训", "恶心", "没爹没妈", "靠卖"
            ]
            bully_hits = sum(1 for kw in bullying_keywords if kw in full_text)
            if bully_hits >= 2:
                topic_tags.append("Mâu thuẫn học đường")
                synopsis_parts.append("tình huống tranh cãi gay gắt, bắt nạt học đường")

            # Chủ đề thanh xuân / Hồi tưởng
            nostalgia_keywords = ["青春", "秘密", "岁月", "回忆", "远方", "自由", "荒唐"]
            nos_hits = sum(1 for kw in nostalgia_keywords if kw in full_text)
            if nos_hits >= 2:
                topic_tags.append("Thanh xuân & Hồi tưởng")
                synopsis_parts.append("ký ức thanh xuân và những bí mật thời đi học")

            # Chủ đề gia đình / Tình cảm / Bạn cùng phòng
            daily_keywords = ["室友", "对象", "老婆", "老公", "父子", "夏芝茶", "芝芝"]
            daily_hits = sum(1 for kw in daily_keywords if kw in full_text)
            if daily_hits >= 2:
                topic_tags.append("Đời sống tình cảm & Bạn bè")
                synopsis_parts.append("gặp gỡ bạn cùng phòng và người thân")

            # Chủ đề hài hước / Nhân vật hư cấu (Gà Cuồng Phong, Chó Dại...)
            fantasy_keywords = ["狂风鸡", "狂犬鸡", "狂飙鸡", "小鸡精", "念风", "念犬", "三个犬"]
            fantasy_hits = sum(1 for kw in fantasy_keywords if kw in full_text)
            if fantasy_hits >= 1:
                topic_tags.append("Hài hước & Chơi chữ")
                synopsis_parts.append("các nhân vật hài hước cùng màn tranh luận chơi chữ")

        elif clean_src.startswith("en"):
            # Chủ đề học tập / Diễn thuyết / TED Talk
            edu_keywords = ["language", "languages", "polyglot", "fluent", "learning", "secret", "speak", "practice"]
            edu_hits = sum(1 for kw in edu_keywords if kw in full_text_lower)
            if edu_hits >= 2:
                topic_tags.append("Kỹ năng học tập & Ngoại ngữ")
                synopsis_parts.append("bài diễn thuyết chia sẻ kinh nghiệm học ngoại ngữ và phương pháp luyện tập")

            # Chủ đề công nghệ / AI / Hệ thống
            tech_keywords = ["ai", "architecture", "local", "offline", "real-time", "subtitles", "model", "system"]
            tech_hits = sum(1 for kw in tech_keywords if kw in full_text_lower)
            if tech_hits >= 2:
                topic_tags.append("Công nghệ AI & Thuyết minh")
                synopsis_parts.append("giới thiệu kiến trúc hệ thống dịch thuật AI cục bộ ngoại tuyến")

            # Chủ đề tranh cãi
            argue_keywords = ["shut up", "idiot", "damn", "hell", "fight", "hate"]
            if any(kw in full_text_lower for kw in argue_keywords):
                topic_tags.append("Tranh cãi gay gắt")
                synopsis_parts.append("cuộc đối thoại tranh cãi căng thẳng")

        if not synopsis_parts:
            synopsis_parts.append("đoạn hội thoại đa nhân vật tự nhiên trong đời sống")
        if not topic_tags:
            topic_tags.append("Đời sống thường ngày")

        synopsis = "Video gồm " + ", kèm ".join(synopsis_parts) + "."

        # 2. Suy luận Sắc thái & Cặp đại từ chủ đạo (Persona)
        if requested_persona != "auto":
            persona = requested_persona
        else:
            persona = self._detect_smart_persona(full_text, clean_src)

        persona_label = self.PERSONA_LABELS.get(persona, self.PERSONA_LABELS["neutral"])

        # 3. Khóa các thực thể Glossary có mặt trong kịch bản
        matched_glossary: Dict[str, str] = {}
        if self.glossary:
            for term_src, term_tgt in self.glossary.items():
                if clean_src.startswith("zh"):
                    if term_src in full_text:
                        matched_glossary[term_src] = term_tgt
                else:
                    if re.search(r"\b" + re.escape(term_src) + r"\b", full_text, re.IGNORECASE):
                        matched_glossary[term_src] = term_tgt

        # 4. Xác định thể loại video (Genre)
        if requested_genre != "auto" and requested_genre in self.GENRE_LABELS:
            genre = requested_genre
        else:
            genre = self._detect_smart_genre(full_text_lower, clean_src, topic_tags, persona)

        genre_label = self.GENRE_LABELS.get(genre, self.GENRE_LABELS["general_dialogue"])

        return GlobalVideoContext(
            synopsis=synopsis,
            dominant_persona=persona,
            dominant_persona_label=persona_label,
            source_language=clean_src,
            target_language=target_lang,
            matched_glossary=matched_glossary,
            topic_tags=topic_tags,
            genre=genre,
            genre_label=genre_label,
        )

    def _detect_smart_genre(self, text_lower: str, src_lang: str, topic_tags: List[str], persona: str) -> str:
        """Tự động suy luận thể loại video để chọn bộ Prompt và Few-shot chuẩn nhất."""
        if persona == "presentation" or any("học tập" in t.lower() or "ngoại ngữ" in t.lower() for t in topic_tags):
            return "ted_speech"
        if any("công nghệ" in t.lower() or "ai" in t.lower() for t in topic_tags):
            return "tech_tutorial"
        if persona == "informal" or any("tranh cãi" in t.lower() or "mâu thuẫn" in t.lower() for t in topic_tags):
            return "drama_conflict"
        if persona == "intimate" or any("tình cảm" in t.lower() or "bạn bè" in t.lower() for t in topic_tags):
            return "romance_daily"
        if any(kw in text_lower for kw in ["vlog", "travel", "delicious", "food", "explore", "ẩm thực", "du lịch"]):
            return "vlog_entertainment"
        return "general_dialogue"

    def _detect_smart_persona(self, text: str, src_lang: str) -> str:
        """Phân tích sắc thái hội thoại chính xác dựa trên mật độ từ vựng biểu cảm."""
        if src_lang.startswith("zh"):
            # Từ khóa suồng sã / tranh cãi / xúc phạm / bạo lực
            informal_keywords = [
                "学渣", "骚里骚气", "勾引", "野种", "教训", "恶心", "作弊",
                "臭嘴", "疯", "狂", "傻", "蠢", "混蛋", "滚", "闭嘴",
                "狂犬", "狂风", "狂飙", "老子", "老娘", "揍", "靠卖"
            ]
            # Từ khóa lịch sự / xã giao
            polite_keywords = ["您", "请问", "谢谢", "抱歉", "对不起", "先生", "女士", "经理", "合作", "领导"]
            # Từ khóa thân mật
            intimate_keywords = ["宝贝", "亲爱的", "老婆", "老公", "室友", "芝芝"]

            inf_hits = sum(text.count(kw) for kw in informal_keywords)
            pol_hits = sum(text.count(kw) for kw in polite_keywords)
            int_hits = sum(text.count(kw) for kw in intimate_keywords)

            # Nếu có xuất hiện các từ ngữ tranh cãi học đường hoặc chửi bới gay gắt
            if inf_hits >= 2:
                return "informal"
            if int_hits >= 3:
                return "intimate"
            if pol_hits >= 2:
                return "polite"
            return "neutral"

        elif src_lang.startswith("en"):
            text_lower = text.lower()
            inf_hits = sum(1 for kw in ["damn", "shut up", "idiot", "hell", "fool", "trash"] if kw in text_lower)
            pres_hits = sum(1 for kw in ["languages", "polyglot", "secret", "answer", "learn", "talk", "today", "people always ask", "let me tell"] if kw in text_lower)
            pol_hits = sum(1 for kw in ["please", "thank you", "welcome", "sir", "madam", "colleague"] if kw in text_lower)
            int_hits = sum(1 for kw in ["honey", "babe", "darling", "love", "sweetie"] if kw in text_lower)

            if inf_hits >= 1:
                return "informal"
            if pres_hits >= 2:
                return "presentation"
            if pol_hits >= 1:
                return "neutral"
            if int_hits >= 1:
                return "intimate"
            return "neutral"

        return "neutral"

    def detect_scene_local_persona(self, scene_texts: Sequence[str], global_persona: str, src_lang: str = "zh") -> str:
        """Phát hiện sắc thái cục bộ của riêng một phân cảnh (Scene-Level Dynamic Persona)."""
        combined = " ".join(scene_texts)
        if src_lang.startswith("zh"):
            # Nếu phân cảnh này chứa từ ngữ bắt nạt / xúc phạm gay gắt
            bully_cues = ["学渣", "骚里骚气", "勾引", "野种", "教训", "恶心", "作弊", "滚", "混蛋", "靠卖"]
            if any(kw in combined for kw in bully_cues):
                return "informal"
            # Nếu phân cảnh này là bạn bè thân mật / người yêu
            intimate_cues = ["室友", "对象", "老婆", "老公", "亲爱的", "芝芝"]
            if any(kw in combined for kw in intimate_cues):
                return "intimate"
            # Nếu phân cảnh này xã giao lịch sự
            polite_cues = ["您好", "您", "请问", "谢谢", "老师"]
            if any(kw in combined for kw in polite_cues):
                return "polite"
        return global_persona

