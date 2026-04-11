"""
LLM-based filtering for harvest candidates.

Uses the shared LLMClient for backend detection and LLM calls.
Provides filter_decisions, filter_patterns, filter_people, and
consolidate_compiled_truth as the public API consumed by harvest.py.

Fallback chain (via LLMClient):
  1. OPENAI_API_KEY set -> OpenAI API (gpt-4o-mini)
  2. copilot CLI available -> subprocess call
  3. Neither -> skip filtering with warning (regex-only fallback)
"""

from __future__ import annotations

import logging
from typing import Any

from engine.llm_client import LLMClient

logger = logging.getLogger(__name__)

BATCH_SIZE = 20  # max candidates per LLM call to stay under token limits

# Module-level shared client (lazy-init on first use)
_client: LLMClient | None = None


def _get_client(backend: str | None = None) -> LLMClient:
    """Get or create the shared LLMClient instance."""
    global _client
    if backend is not None:
        # Caller wants a specific backend -- create a dedicated client
        client = LLMClient(fallback_mode=(backend == "none"))
        if backend != "none":
            client.backend = backend
        return client
    if _client is None:
        _client = LLMClient()
    return _client


def _get_backend() -> str:
    """Detect available LLM backend. Delegates to LLMClient."""
    return LLMClient._detect_backend()


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
    client = _get_client(backend)
    if not candidates:
        return []
    if not client.available:
        logger.warning(
            "No LLM backend available -- skipping decisions filtering (regex-only fallback). "
            "Set OPENAI_API_KEY or install copilot CLI for better precision.",
        )
        return candidates
    return client.verify(candidates, "decisions", dry_run=dry_run)


def filter_patterns(
    candidates: list[dict],
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Filter bug pattern candidates using LLM verification."""
    client = _get_client(backend)
    if not candidates:
        return []
    if not client.available:
        logger.warning(
            "No LLM backend available -- skipping patterns filtering (regex-only fallback).",
        )
        return candidates
    return client.verify(candidates, "patterns", dry_run=dry_run)


def filter_people(
    candidates: list[dict],
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Filter people name candidates using LLM verification."""
    client = _get_client(backend)
    if not candidates:
        return []
    if not client.available:
        logger.warning(
            "No LLM backend available -- skipping people filtering (regex-only fallback).",
        )
        return candidates
    return client.verify(candidates, "people", dry_run=dry_run)


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
    client = _get_client(backend)
    return client.consolidate_truth(
        entity_name=entity_name,
        entity_type=entity_type,
        current_truth=current_truth,
        timeline=timeline,
        raw_excerpts=raw_excerpts,
    )


# ── Legacy compatibility re-exports ─────────────────────────────────────────
# These were imported by tests; keep them accessible via llm_client module.

from engine.llm_client import (  # noqa: F401, E402
    _apply_verdicts,
    _batch_items as _batch_candidates,
    _format_candidate_list,
    BATCH_SIZE as _BATCH_SIZE,
)


def _parse_llm_response(raw: str) -> list[dict]:
    """Parse LLM JSON response. Delegates to LLMClient."""
    result = LLMClient._parse_json_response(raw)
    if isinstance(result, list):
        return result
    return []


def _filter_category(
    candidates: list[dict],
    prompt_template: str,
    category: str,
    dry_run: bool = False,
    backend: str | None = None,
) -> list[dict]:
    """Generic filter for any extraction category. Delegates to LLMClient.verify()."""
    if category == "decisions":
        return filter_decisions(candidates, dry_run, backend)
    elif category == "patterns":
        return filter_patterns(candidates, dry_run, backend)
    elif category == "people":
        return filter_people(candidates, dry_run, backend)
    # Generic fallback
    client = _get_client(backend)
    if not candidates:
        return []
    if not client.available:
        return candidates
    return client.verify(candidates, category, dry_run=dry_run)
