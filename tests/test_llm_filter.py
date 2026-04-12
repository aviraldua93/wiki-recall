"""
Tests for the llm_filter module (protocols architecture, #49).

The filter functions now delegate to LLMClient which is a stub.
All filter functions return candidates unchanged (fail-open).
"""

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.llm_filter import (
    BATCH_SIZE,
    _filter_category,
    _get_backend,
    _parse_llm_response,
    filter_decisions,
    filter_patterns,
    filter_people,
)


class TestBatchSize:
    """BATCH_SIZE constant exists for API compatibility."""

    def test_batch_size_is_positive_integer(self):
        assert isinstance(BATCH_SIZE, int)
        assert BATCH_SIZE > 0


class TestGetBackend:
    """Backend detection returns none (protocols architecture)."""

    def test_returns_none_string(self):
        result = _get_backend()
        assert result == "none"


class TestParseResponse:
    """JSON response parsing still works."""

    def test_parse_clean_json(self):
        raw = '[{"text": "a", "verdict": "REAL"}]'
        result = _parse_llm_response(raw)
        assert len(result) == 1
        assert result[0]["text"] == "a"

    def test_parse_garbage_returns_empty(self):
        result = _parse_llm_response("not json")
        assert result == []


class TestFilterDecisions:
    """filter_decisions returns all candidates (fail-open stub)."""

    def test_returns_all_candidates(self):
        candidates = [{"text": "decided to use Python"}, {"text": "noise"}]
        result = filter_decisions(candidates)
        assert len(result) == len(candidates)

    def test_empty_candidates(self):
        result = filter_decisions([])
        assert result == []


class TestFilterPatterns:
    """filter_patterns returns all candidates (fail-open stub)."""

    def test_returns_all_candidates(self):
        candidates = [{"text": "bug: timeout on Windows"}]
        result = filter_patterns(candidates)
        assert len(result) == len(candidates)


class TestFilterPeople:
    """filter_people returns all candidates (fail-open stub)."""

    def test_returns_all_candidates(self):
        candidates = [{"text": "Sarah"}, {"text": "the"}]
        result = filter_people(candidates)
        assert len(result) == len(candidates)


class TestFilterCategory:
    """_filter_category returns all candidates (fail-open stub)."""

    def test_returns_all_candidates(self):
        candidates = [{"text": "item1"}, {"text": "item2"}]
        result = _filter_category(candidates, "", "decisions")
        assert len(result) == len(candidates)

    def test_empty_input(self):
        result = _filter_category([], "", "decisions")
        assert result == []
