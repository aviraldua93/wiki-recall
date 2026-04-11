"""
LLM-based filtering for harvest candidates.

Uses OpenAI API or Copilot CLI subprocess to verify that regex-extracted
candidates are real decisions/patterns/people rather than noise (code snippets,
template text, generic statements).

Fallback chain:
  1. OPENAI_API_KEY set → OpenAI API (gpt-4o-mini)
  2. copilot CLI available → subprocess call
  3. Neither → skip filtering with warning (regex-only fallback)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

BATCH_SIZE = 20  # max candidates per LLM call to stay under token limits


# ── Prompt templates ─────────────────────────────────────────────────────────

_DECISION_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "decisions" extracted from coding session transcripts via regex.
Many are noise — code snippets, template text, generic statements, or tool output.

For EACH candidate, classify it as:
- REAL: an actual design, architecture, or technology decision made by a human
- NOISE: a code snippet, template text, tool output, or generic statement

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_PATTERN_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "bug patterns" extracted from coding session transcripts via regex.
Many are noise — code snippets, configuration text, or generic statements.

For EACH candidate, classify it as:
- REAL: an actual bug pattern, workaround, or fix worth remembering
- NOISE: a code snippet, configuration fragment, or generic statement

Return a JSON array of objects: [{{"text": "...", "verdict": "REAL"|"NOISE", "reason": "..."}}]
Return ONLY the JSON array, no markdown fences, no explanation outside the array.

Candidates:
{candidates}
"""

_PEOPLE_PROMPT = """\
You are a precision filter for an automated knowledge-extraction pipeline.

Below are candidate "person names" extracted from coding session transcripts via regex.
Many are false positives — common words, variable names, or tool names.

For EACH candidate, classify it as:
- REAL: a real human first name that likely refers to a colleague
- NOISE: a common word, variable name, tool name, or false positive

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


# ── LLM backend detection ───────────────────────────────────────────────────

def _get_backend() -> str:
    """Detect available LLM backend. Returns 'openai', 'copilot', or 'none'."""
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if shutil.which("copilot"):
        return "copilot"
    return "none"


# ── LLM call implementations ────────────────────────────────────────────────

def _call_openai(prompt: str) -> str:
    """Call OpenAI API with gpt-4o-mini."""
    try:
        import openai
    except ImportError:
        raise RuntimeError("openai package not installed — pip install openai")

    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=4096,
    )
    return response.choices[0].message.content or ""


def _call_copilot(prompt: str) -> str:
    """Call Copilot CLI as subprocess."""
    try:
        result = subprocess.run(
            ["copilot", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"copilot exited with code {result.returncode}: {result.stderr}")
        return result.stdout
    except FileNotFoundError:
        raise RuntimeError("copilot CLI not found on PATH")
    except subprocess.TimeoutExpired:
        raise RuntimeError("copilot CLI timed out after 120s")


def _call_llm(prompt: str, backend: str | None = None) -> str:
    """Route to the appropriate LLM backend."""
    if backend is None:
        backend = _get_backend()

    if backend == "openai":
        return _call_openai(prompt)
    elif backend == "copilot":
        return _call_copilot(prompt)
    else:
        raise RuntimeError("No LLM backend available")


# ── Response parsing ─────────────────────────────────────────────────────────

def _parse_llm_response(raw: str) -> list[dict]:
    """Parse LLM JSON response, handling markdown fences and quirks."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (fences)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON array in the response
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            try:
                parsed = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                logger.warning("Could not parse LLM response as JSON")
                return []
        else:
            logger.warning("No JSON array found in LLM response")
            return []

    if not isinstance(parsed, list):
        logger.warning("LLM response is not a JSON array")
        return []

    return parsed


# ── Batch processing ─────────────────────────────────────────────────────────

def _batch_candidates(candidates: list, batch_size: int = BATCH_SIZE) -> list[list]:
    """Split candidates into batches of at most batch_size."""
    return [candidates[i : i + batch_size] for i in range(0, len(candidates), batch_size)]


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
    # Build verdict lookup by text
    verdict_map: dict[str, dict] = {}
    for v in verdicts:
        if isinstance(v, dict) and "text" in v:
            verdict_map[v["text"].lower().strip()] = v

    kept = []
    removed = []
    for c in candidates:
        text = c.get(text_key, str(c)) if isinstance(c, dict) else str(c)
        verdict = verdict_map.get(text.lower().strip(), {})
        if verdict.get("verdict", "").upper() == "NOISE":
            removed.append({**c, "_reason": verdict.get("reason", "classified as noise")})
        else:
            # Default to keeping if no verdict found (fail-open)
            kept.append(c)

    return kept, removed


# ── Public filter functions ──────────────────────────────────────────────────

def filter_decisions(
    candidates: list[dict],
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """
    Filter decision candidates using LLM verification.

    Args:
        candidates: List of dicts with at least a 'text' key.
        dry_run: If True, print what would be filtered but return all candidates.
        backend: Force a specific backend ('openai', 'copilot', or 'none').

    Returns:
        Filtered list containing only REAL decisions.
    """
    return _filter_category(candidates, _DECISION_PROMPT, "decisions", dry_run, backend)


def filter_patterns(
    candidates: list[dict],
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Filter bug pattern candidates using LLM verification."""
    return _filter_category(candidates, _PATTERN_PROMPT, "patterns", dry_run, backend)


def filter_people(
    candidates: list[dict],
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Filter people name candidates using LLM verification."""
    return _filter_category(candidates, _PEOPLE_PROMPT, "people", dry_run, backend)


def _filter_category(
    candidates: list[dict],
    prompt_template: str,
    category: str,
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Generic filter for any extraction category."""
    if not candidates:
        return []

    resolved_backend = backend if backend is not None else _get_backend()

    if resolved_backend == "none":
        logger.warning(
            "No LLM backend available — skipping %s filtering (regex-only fallback). "
            "Set OPENAI_API_KEY or install copilot CLI for better precision.",
            category,
        )
        return candidates

    batches = _batch_candidates(candidates)
    all_kept: list[dict] = []
    all_removed: list[dict] = []

    for batch in batches:
        candidate_text = _format_candidate_list(batch)
        prompt = prompt_template.format(candidates=candidate_text)

        try:
            raw_response = _call_llm(prompt, resolved_backend)
            verdicts = _parse_llm_response(raw_response)
            kept, removed = _apply_verdicts(batch, verdicts)
            all_kept.extend(kept)
            all_removed.extend(removed)
        except Exception as e:
            logger.warning("LLM filtering failed for %s batch: %s — keeping all candidates", category, e)
            all_kept.extend(batch)

    # Logging
    original = len(candidates)
    filtered = len(all_kept)
    noise = len(all_removed)

    if noise > 0:
        logger.info(
            "Filtered: %d → %d %s (%d noise removed)",
            original, filtered, category, noise,
        )

    if dry_run:
        print(f"\n  🔍 LLM Filter ({category}): {original} → {filtered} ({noise} noise)")
        if all_removed:
            for item in all_removed:
                reason = item.get("_reason", "noise")
                text = item.get("text", str(item))
                print(f"    ✗ {text[:80]} — {reason}")
        # In dry_run, return ALL candidates (don't discard)
        return candidates

    return all_kept


def consolidate_compiled_truth(
    entity_name: str,
    entity_type: str,
    current_truth: str,
    timeline: str,
    raw_excerpts: str,
    backend: str | None = None,
) -> str | None:
    """Use LLM to rewrite compiled truth from timeline and raw excerpts.

    Args:
        entity_name: Name of the entity (person or project).
        entity_type: 'person' or 'project'.
        current_truth: Current compiled truth section text.
        timeline: Timeline entries text.
        raw_excerpts: Raw sidecar excerpt text.
        backend: Force a specific LLM backend.

    Returns:
        New compiled truth text, or None if LLM unavailable.
    """
    resolved_backend = backend if backend is not None else _get_backend()

    if resolved_backend == "none":
        logger.warning("No LLM backend available — skipping consolidation")
        return None

    prompt = _CONSOLIDATION_PROMPT.format(
        entity_name=entity_name,
        entity_type=entity_type,
        current_truth=current_truth,
        timeline=timeline,
        raw_excerpts=raw_excerpts,
    )

    try:
        response = _call_llm(prompt, resolved_backend)
        # Strip any markdown fences
        text = response.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines).strip()
        return text
    except Exception as e:
        logger.warning("Consolidation LLM call failed: %s", e)
        return None
