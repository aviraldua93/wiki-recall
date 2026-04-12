"""
LLM client stub for wiki-recall.

Python scripts do PLUMBING only (diagnosis, backup, file moves).
LLM judgment is done by the user's Copilot session via markdown
protocols (protocols/*.md).

This module exists for API compatibility -- all methods return
empty/fallback responses. See issue #49.

Usage:
    from engine.llm_client import LLMClient

    client = LLMClient()
    # client.available is always False
    # client.ask() always returns ""
    # client.verify() always returns all candidates (fail-open)
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class LLMClient:
    """LLM client stub -- Python scripts do plumbing only.

    All LLM judgment work is done by the user's Copilot session via
    markdown protocols (protocols/*.md). This class exists for API
    compatibility but always returns empty/fallback responses.

    See: https://github.com/aviraldua93/wiki-recall/issues/49
    """

    def __init__(self, fallback_mode: bool = False):
        """
        Args:
            fallback_mode: Ignored -- always in fallback mode.
                           Kept for API compatibility.
        """
        self.fallback_mode = True
        self.backend = "none"

    @property
    def available(self) -> bool:
        """Always False -- LLM judgment is done by protocols, not scripts."""
        return False

    # ── Raw LLM call (removed -- #49) ──────────────────────────────────────
    #
    # _call_openai, _call_copilot, _call have been removed.
    # Python scripts do plumbing only. LLM judgment is done by the user's
    # Copilot session via markdown protocols (protocols/*.md).

    # ── Response parsing ─────────────────────────────────────────────────────

    @staticmethod
    def _parse_json_response(raw: str) -> Any:
        """Parse LLM JSON response, handling markdown fences and quirks."""
        text = raw.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [ln for ln in lines if not ln.strip().startswith("```")]
            text = "\n".join(lines).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON array/object in the response
            for open_ch, close_ch in [("[", "]"), ("{", "}")]:
                start = text.find(open_ch)
                end = text.rfind(close_ch)
                if start != -1 and end != -1 and end > start:
                    try:
                        return json.loads(text[start : end + 1])
                    except json.JSONDecodeError:
                        continue
            logger.warning("Could not parse LLM response as JSON")
            return None

    # ── Public API ───────────────────────────────────────────────────────────

    def ask(self, prompt: str, system: str = "", expect_json: bool = False) -> str:
        """Always returns empty string -- LLM judgment is done by protocols.

        Kept for API compatibility with callers that check the return value.
        """
        return ""

    def classify(
        self,
        items: list[str],
        categories: list[str],
        prompt_context: str = "",
    ) -> list[dict]:
        """Always returns empty list -- LLM judgment is done by protocols."""
        return []

    def summarize(self, text: str, max_words: int = 50) -> str:
        """Always returns empty string -- LLM judgment is done by protocols."""
        return ""

    def verify(
        self,
        candidates: list[dict],
        category: str,
        text_key: str = "text",
        dry_run: bool = False,
    ) -> list[dict]:
        """Always returns all candidates (fail-open) -- LLM judgment is done by protocols."""
        return candidates

    def rewrite(self, text: str, instruction: str) -> str:
        """Always returns empty string -- LLM judgment is done by protocols."""
        return ""

    def consolidate_truth(
        self,
        entity_name: str,
        entity_type: str,
        current_truth: str,
        timeline: str,
        raw_excerpts: str,
    ) -> str | None:
        """Always returns None -- LLM judgment is done by protocols."""
        return None

