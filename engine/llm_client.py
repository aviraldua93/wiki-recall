"""
Shared LLM client for wiki-recall.
Python finds candidates -> LLM makes judgment calls.
Graceful fallback when LLM not available.

Usage:
    from engine.llm_client import LLMClient

    client = LLMClient()
    if client.available:
        verified = client.verify(candidates, "decisions")
        summary = client.summarize(long_text, max_words=50)
    else:
        # Fallback: regex-only, reduced quality
        verified = candidates
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

BATCH_SIZE = 20  # max items per LLM call to stay under token limits


class LLMClient:
    """Unified LLM interface. Tries backends in order: OpenAI -> Copilot CLI -> fallback."""

    def __init__(self, fallback_mode: bool = False):
        """
        Args:
            fallback_mode: If True, skip LLM entirely (script-only, reduced quality).
        """
        self.fallback_mode = fallback_mode
        self.backend = "none" if fallback_mode else self._detect_backend()

    # ── Backend detection ────────────────────────────────────────────────────

    @staticmethod
    def _detect_backend() -> str:
        """Detect available LLM backend: 'openai' | 'copilot' | 'none'."""
        if os.environ.get("OPENAI_API_KEY"):
            return "openai"
        if shutil.which("copilot"):
            return "copilot"
        return "none"

    @property
    def available(self) -> bool:
        """True if an LLM backend is available."""
        return not self.fallback_mode and self.backend != "none"

    # ── Raw LLM call ─────────────────────────────────────────────────────────

    def _call_openai(self, prompt: str, system: str = "") -> str:
        """Call OpenAI API with gpt-4o-mini."""
        try:
            import openai
        except ImportError:
            raise RuntimeError("openai package not installed -- pip install openai")

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        client = openai.OpenAI()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.1,
            max_tokens=4096,
        )
        return response.choices[0].message.content or ""

    def _call_copilot(self, prompt: str, system: str = "") -> str:
        """Call Copilot CLI as subprocess."""
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        try:
            result = subprocess.run(
                ["copilot", "-p", full_prompt],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"copilot exited with code {result.returncode}: {result.stderr}"
                )
            return result.stdout
        except FileNotFoundError:
            raise RuntimeError("copilot CLI not found on PATH")
        except subprocess.TimeoutExpired:
            raise RuntimeError("copilot CLI timed out after 120s")

    def _call(self, prompt: str, system: str = "") -> str:
        """Route to the appropriate LLM backend."""
        if self.backend == "openai":
            return self._call_openai(prompt, system)
        elif self.backend == "copilot":
            return self._call_copilot(prompt, system)
        else:
            raise RuntimeError("No LLM backend available")

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
        """Send a prompt to the LLM. Returns response text.

        Returns empty string when LLM unavailable (caller handles as 'skip LLM').
        After a timeout, disables LLM for remaining calls to avoid cascading waits.
        """
        if not self.available:
            return ""
        try:
            response = self._call(prompt, system)
            return response.strip()
        except Exception as e:
            logger.warning("LLM ask failed: %s", e)
            if "timed out" in str(e).lower():
                logger.warning(
                    "LLM unavailable -- falling back to regex-only mode"
                )
                self.fallback_mode = True
                self.backend = "none"
            return ""

    def classify(
        self,
        items: list[str],
        categories: list[str],
        prompt_context: str = "",
    ) -> list[dict]:
        """Classify items into categories. Returns [{item, category, confidence}].

        Returns empty list when LLM unavailable.
        """
        if not self.available or not items:
            return []

        all_results: list[dict] = []
        batches = _batch_items(items)

        cat_list = ", ".join(categories)
        system = (
            "You are a classification assistant. "
            "Classify each item into exactly one category. "
            "Return a JSON array of objects: "
            '[{"item": "...", "category": "...", "confidence": 0.0-1.0}]. '
            "Return ONLY the JSON array."
        )

        for batch in batches:
            numbered = "\n".join(f"{i}. {item}" for i, item in enumerate(batch, 1))
            prompt = (
                f"Categories: {cat_list}\n"
                f"{f'Context: {prompt_context}' + chr(10) if prompt_context else ''}"
                f"Items to classify:\n{numbered}"
            )
            try:
                raw = self._call(prompt, system)
                parsed = self._parse_json_response(raw)
                if isinstance(parsed, list):
                    all_results.extend(parsed)
            except Exception as e:
                logger.warning("LLM classify batch failed: %s", e)
                if "timed out" in str(e).lower():
                    logger.warning(
                        "LLM unavailable -- falling back to regex-only mode"
                    )
                    self.fallback_mode = True
                    self.backend = "none"
                    break

        return all_results

    def summarize(self, text: str, max_words: int = 50) -> str:
        """Summarize text to max_words. Returns empty string when unavailable."""
        if not self.available or not text.strip():
            return ""
        prompt = (
            f"Summarize the following text in at most {max_words} words. "
            f"Return ONLY the summary, no preamble.\n\n{text}"
        )
        return self.ask(prompt)

    def verify(
        self,
        candidates: list[dict],
        category: str,
        text_key: str = "text",
        dry_run: bool = False,
    ) -> list[dict]:
        """Verify candidates (same as llm_filter pattern).

        Returns only REAL items. When LLM unavailable, returns all candidates (fail-open).
        """
        if not self.available or not candidates:
            return candidates if not self.available else []

        prompt_templates = {
            "decisions": _DECISION_VERIFY_PROMPT,
            "patterns": _PATTERN_VERIFY_PROMPT,
            "people": _PEOPLE_VERIFY_PROMPT,
        }
        template = prompt_templates.get(category, _GENERIC_VERIFY_PROMPT)

        batches = _batch_items(candidates, is_dicts=True, text_key=text_key)
        all_kept: list[dict] = []
        all_removed: list[dict] = []

        for batch in batches:
            candidate_text = _format_candidate_list(batch, text_key)
            prompt = template.format(candidates=candidate_text)
            try:
                raw = self._call(prompt)
                parsed = self._parse_json_response(raw)
                if isinstance(parsed, list):
                    kept, removed = _apply_verdicts(batch, parsed, text_key)
                    all_kept.extend(kept)
                    all_removed.extend(removed)
                else:
                    all_kept.extend(batch)
            except Exception as e:
                logger.warning(
                    "LLM verify failed for %s batch: %s -- keeping all", category, e
                )
                all_kept.extend(batch)
                if "timed out" in str(e).lower():
                    logger.warning(
                        "LLM unavailable -- falling back to regex-only mode"
                    )
                    self.fallback_mode = True
                    self.backend = "none"
                    # Keep remaining un-verified batches
                    break

        if dry_run:
            noise = len(all_removed)
            original = len(candidates)
            filtered = len(all_kept)
            print(
                f"\n  LLM Filter ({category}): {original} -> {filtered} ({noise} noise)"
            )
            for item in all_removed:
                reason = item.get("_reason", "noise")
                text = item.get(text_key, str(item))
                print(f"    x {text[:80]} -- {reason}")
            return candidates  # dry_run returns all

        return all_kept

    def rewrite(self, text: str, instruction: str) -> str:
        """Rewrite text according to instruction. Returns empty string when unavailable."""
        if not self.available or not text.strip():
            return ""
        prompt = f"{instruction}\n\nOriginal text:\n{text}"
        return self.ask(prompt)

    def consolidate_truth(
        self,
        entity_name: str,
        entity_type: str,
        current_truth: str,
        timeline: str,
        raw_excerpts: str,
    ) -> str | None:
        """Rewrite compiled truth from timeline and raw excerpts.

        Returns new text, or None if LLM unavailable.
        """
        if not self.available:
            return None

        prompt = _CONSOLIDATION_PROMPT.format(
            entity_name=entity_name,
            entity_type=entity_type,
            current_truth=current_truth,
            timeline=timeline,
            raw_excerpts=raw_excerpts,
        )
        result = self.ask(prompt)
        return result if result else None


# ── Prompt templates ─────────────────────────────────────────────────────────

_DECISION_VERIFY_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "decisions" extracted from coding session transcripts via regex.
Many are noise -- code snippets, template text, generic statements, or tool output.

For EACH candidate, classify it as:
- REAL: an actual design, architecture, or technology decision made by a human
- NOISE: a code snippet, template text, tool output, or generic statement

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_PATTERN_VERIFY_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "bug patterns" extracted from coding session transcripts via regex.
Many are noise -- code snippets, configuration text, or generic statements.

For EACH candidate, classify it as:
- REAL: an actual bug pattern, workaround, or fix worth remembering
- NOISE: a code snippet, configuration fragment, or generic statement

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_PEOPLE_VERIFY_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "person names" extracted from coding session transcripts via regex.
Many are false positives -- common words, variable names, or tool names.

For EACH candidate, classify it as:
- REAL: a real human first name that likely refers to a colleague
- NOISE: a common word, variable name, tool name, or false positive

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_GENERIC_VERIFY_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidates extracted from coding session transcripts via regex.
Many are noise -- code snippets, template text, or generic statements.

For EACH candidate, classify it as:
- REAL: genuinely useful knowledge worth retaining
- NOISE: a code snippet, template text, or generic statement

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_CONSOLIDATION_PROMPT = """\
You are a knowledge base editor for a personal wiki. Rewrite the "Compiled Truth"
section for the entity below using ONLY the raw timeline entries and sidecar excerpts
provided. The compiled truth should be:

- 5-10 lines maximum
- Current and accurate (discard outdated info superseded by newer entries)
- Written in present tense where possible
- Every claim attributed with [Source: session XXXXXXXX]

Entity: {entity_name} (type: {entity_type})

Current compiled truth:
{current_truth}

Timeline entries:
{timeline}

Raw sidecar excerpts:
{raw_excerpts}

Return ONLY the new compiled truth section content (no heading, no fences).
"""


# ── Helpers (module-level, shared) ───────────────────────────────────────────


def _batch_items(
    items: list,
    batch_size: int = BATCH_SIZE,
    is_dicts: bool = False,
    text_key: str = "text",
) -> list[list]:
    """Split items into batches of at most batch_size."""
    return [items[i : i + batch_size] for i in range(0, len(items), batch_size)]


def _format_candidate_list(candidates: list[dict], text_key: str = "text") -> str:
    """Format candidates as numbered list for the prompt."""
    lines = []
    for i, c in enumerate(candidates, 1):
        text = c.get(text_key, str(c)) if isinstance(c, dict) else str(c)
        lines.append(f"{i}. {text}")
    return "\n".join(lines)


def _apply_verdicts(
    candidates: list[dict],
    verdicts: list[dict],
    text_key: str = "text",
) -> tuple[list[dict], list[dict]]:
    """Match verdicts back to candidates. Returns (kept, removed)."""
    verdict_map: dict[str, dict] = {}
    for v in verdicts:
        if isinstance(v, dict) and "text" in v:
            verdict_map[v["text"].lower().strip()] = v

    kept: list[dict] = []
    removed: list[dict] = []
    for c in candidates:
        text = c.get(text_key, str(c)) if isinstance(c, dict) else str(c)
        verdict = verdict_map.get(text.lower().strip(), {})
        if verdict.get("verdict", "").upper() == "NOISE":
            removed.append(
                {**c, "_reason": verdict.get("reason", "classified as noise")}
            )
        else:
            # Default to keeping if no verdict found (fail-open)
            kept.append(c)

    return kept, removed
