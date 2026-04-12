"""
Tests for the LLMClient stub (protocols architecture, #49).

LLMClient is now a stub -- all methods return empty/fallback responses.
Python scripts do plumbing only. LLM judgment is done by protocols.
"""

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.llm_client import LLMClient


class TestStubBehavior:
    """LLMClient always returns fallback responses (#49)."""

    def test_available_always_false(self):
        client = LLMClient()
        assert client.available is False

    def test_available_false_even_without_fallback_flag(self):
        client = LLMClient(fallback_mode=False)
        assert client.available is False

    def test_backend_always_none(self):
        client = LLMClient()
        assert client.backend == "none"

    def test_fallback_mode_always_true(self):
        client = LLMClient()
        assert client.fallback_mode is True

    def test_ask_returns_empty_string(self):
        client = LLMClient()
        assert client.ask("test prompt") == ""

    def test_ask_with_system_returns_empty(self):
        client = LLMClient()
        assert client.ask("test", system="system prompt") == ""

    def test_classify_returns_empty_list(self):
        client = LLMClient()
        result = client.classify(["item1", "item2"], ["cat1", "cat2"])
        assert result == []

    def test_summarize_returns_empty_string(self):
        client = LLMClient()
        assert client.summarize("some long text to summarize") == ""

    def test_verify_returns_all_candidates(self):
        client = LLMClient()
        candidates = [{"text": "a"}, {"text": "b"}]
        result = client.verify(candidates, "decisions")
        assert result == candidates

    def test_verify_empty_candidates(self):
        client = LLMClient()
        result = client.verify([], "decisions")
        assert result == []

    def test_rewrite_returns_empty_string(self):
        client = LLMClient()
        assert client.rewrite("some text", "make it better") == ""

    def test_consolidate_truth_returns_none(self):
        client = LLMClient()
        result = client.consolidate_truth(
            entity_name="test",
            entity_type="project",
            current_truth="old truth",
            timeline="- [2024-01-01] event",
            raw_excerpts="raw data",
        )
        assert result is None


class TestApiCompatibility:
    """LLMClient maintains the same API surface for callers."""

    def test_init_accepts_fallback_mode(self):
        client = LLMClient(fallback_mode=True)
        assert client is not None

    def test_has_available_property(self):
        client = LLMClient()
        assert hasattr(client, "available")

    def test_has_ask_method(self):
        client = LLMClient()
        assert callable(client.ask)

    def test_has_classify_method(self):
        client = LLMClient()
        assert callable(client.classify)

    def test_has_summarize_method(self):
        client = LLMClient()
        assert callable(client.summarize)

    def test_has_verify_method(self):
        client = LLMClient()
        assert callable(client.verify)

    def test_has_rewrite_method(self):
        client = LLMClient()
        assert callable(client.rewrite)

    def test_has_consolidate_truth_method(self):
        client = LLMClient()
        assert callable(client.consolidate_truth)

    def test_has_parse_json_response(self):
        # Used by external modules (heal.py, page_quality.py)
        assert callable(LLMClient._parse_json_response)


class TestParseJsonResponse:
    """_parse_json_response utility is still available."""

    def test_parse_plain_json(self):
        result = LLMClient._parse_json_response('[{"key": "val"}]')
        assert result == [{"key": "val"}]

    def test_parse_json_with_fences(self):
        raw = '```json\n[{"key": "val"}]\n```'
        result = LLMClient._parse_json_response(raw)
        assert result == [{"key": "val"}]

    def test_parse_invalid_returns_none(self):
        result = LLMClient._parse_json_response("not json at all")
        assert result is None


class TestNoSubprocessCalls:
    """Verify zero subprocess LLM calls in the module."""

    def test_no_subprocess_import(self):
        source = Path(PROJECT_ROOT / "engine" / "llm_client.py").read_text()
        assert "import subprocess" not in source

    def test_no_call_copilot_method(self):
        assert not hasattr(LLMClient, "_call_copilot")

    def test_no_call_openai_method(self):
        assert not hasattr(LLMClient, "_call_openai")

    def test_no_detect_backend_method(self):
        assert not hasattr(LLMClient, "_detect_backend")
