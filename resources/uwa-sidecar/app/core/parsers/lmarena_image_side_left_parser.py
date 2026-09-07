"""
lmarena_image_side_left_parser.py - Arena.ai image battle left-side parser.

Purpose:
- Reuse Arena side-by-side left channel parsing semantics.
- Prefer quick DOM fallback when the network stream carries little or no
  user-visible text, which is common for image-generation flows where the
  rendered images are the real result.
"""

from __future__ import annotations

from typing import List

from .lmarena_side_left_parser import LmarenaSideLeftParser


class LmarenaImageSideLeftParser(LmarenaSideLeftParser):
    """
    Arena.ai image battle parser for the left/modelA channel.

    The underlying stream protocol may still look like the standard Arena
    side-by-side SSE frames, but image flows often produce no visible text.
    In that case we prefer to fall back to DOM/image extraction quickly
    instead of treating an empty stream as success.
    """

    def should_fallback_to_dom_when_no_visible_content(self) -> bool:
        return True

    @classmethod
    def get_id(cls) -> str:
        return "lmarena_image_side_left"

    @classmethod
    def get_name(cls) -> str:
        return "Arena.ai Image Side Left"

    @classmethod
    def get_description(cls) -> str:
        return "Parse Arena.ai image battle stream, keep left(modelA) and fall back to DOM when text is absent"

    @classmethod
    def get_supported_patterns(cls) -> List[str]:
        return [
            "nextjs-api/stream/post-to-evaluation",
            "nextjs-api/stream/create-evaluation",
        ]


__all__ = ["LmarenaImageSideLeftParser"]
