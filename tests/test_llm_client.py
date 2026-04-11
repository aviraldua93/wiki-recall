"""
Comprehensive tests for engine/llm_client.py -- the shared LLM utility.

Tests:
  - Backend detection (OpenAI key, copilot available, neither)
  - Fallback mode returns empty responses
  - classify returns correct format
  - summarize respects max_words
  - verify filters candidates
  - rewrite returns transformed text
  - ask routes correctly
  - consolidate_truth delegates properly
  - JSON parsing handles edge cases
  - Batch splitting
  - Error handling / graceful degradation
  - Contract: llm_filter.py uses LLMClient (not ad-hoc detection)
  - Mock backend for all tests (no real API calls)

Target: 40+ tests
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.llm_client import (
    LLMClient,
    BATCH_SIZE,
    _batch_items,
    _format_candidate_list,
    _apply_verdicts,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_candidates(texts: list[str]) -> list[dict]:
    """Create candidate dicts from text strings."""
    return [{"text": t} for t in texts]


def _mock_verify_response(candidates: list[dict], real_indices: set[int]) -> str:
    """Build a mock JSON response marking specific indices as REAL."""
    results = []
    for i, c in enumerate(candidates):
        text = c.get("text", str(c))
        verdict = "REAL" if i in real_indices else "NOISE"
        reason = "actual content" if verdict == "REAL" else "template text"
        results.append({"text": text, "verdict": verdict, "reason": reason})
    return json.dumps(results)


def _mock_classify_response(items: list[str], category: str = "A") -> str:
    """Build a mock classify JSON response."""
    return json.dumps([
        {"item": item, "category": category, "confidence": 0.9}
        for item in items
    ])


# ── Backend Detection ────────────────────────────────────────────────────────


class TestBackendDetection:
    """Test LLMClient backend detection logic."""

    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"})
    def test_detect_openai_when_key_present(self):
        client = LLMClient()
        assert client.backend == "openai"

    @patch.dict("os.environ", {}, clear=True)
    @patch("shutil.which", return_value="/usr/bin/copilot")
    def test_detect_copilot_when_cli_available(self, mock_which):
        # Ensure OPENAI_API_KEY is not set
        import os
        os.environ.pop("OPENAI_API_KEY", None)
        client = LLMClient()
        assert client.backend == "copilot"

    @patch.dict("os.environ", {}, clear=True)
    @patch("shutil.which", return_value=None)
    def test_detect_none_when_nothing_available(self, mock_which):
        import os
        os.environ.pop("OPENAI_API_KEY", None)
        client = LLMClient()
        assert client.backend == "none"

    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"})
    @patch("shutil.which", return_value="/usr/bin/copilot")
    def test_openai_takes_priority_over_copilot(self, mock_which):
        client = LLMClient()
        assert client.backend == "openai"

    def test_fallback_mode_overrides_detection(self):
        client = LLMClient(fallback_mode=True)
        assert client.backend == "none"
        assert not client.available

    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"})
    def test_available_property_true_when_backend_exists(self):
        client = LLMClient()
        assert client.available is True

    @patch.dict("os.environ", {}, clear=True)
    @patch("shutil.which", return_value=None)
    def test_available_property_false_when_no_backend(self, mock_which):
        import os
        os.environ.pop("OPENAI_API_KEY", None)
        client = LLMClient()
        assert client.available is False

    def test_static_detect_backend_method(self):
        """_detect_backend is a static method callable without instance."""
        result = LLMClient._detect_backend()
        assert result in ("openai", "copilot", "none")


# ── Fallback Mode ────────────────────────────────────────────────────────────


class TestFallbackMode:
    """Test that all methods return empty/passthrough in fallback mode."""

    def test_ask_returns_empty(self):
        client = LLMClient(fallback_mode=True)
        assert client.ask("hello") == ""

    def test_classify_returns_empty_list(self):
        client = LLMClient(fallback_mode=True)
        assert client.classify(["a", "b"], ["X", "Y"]) == []

    def test_summarize_returns_empty(self):
        client = LLMClient(fallback_mode=True)
        assert client.summarize("long text here") == ""

    def test_verify_returns_all_candidates(self):
        client = LLMClient(fallback_mode=True)
        candidates = _make_candidates(["a", "b", "c"])
        result = client.verify(candidates, "decisions")
        assert result == candidates

    def test_rewrite_returns_empty(self):
        client = LLMClient(fallback_mode=True)
        assert client.rewrite("text", "make shorter") == ""

    def test_consolidate_truth_returns_none(self):
        client = LLMClient(fallback_mode=True)
        result = client.consolidate_truth("entity", "project", "truth", "timeline", "excerpts")
        assert result is None


# ── ask() ────────────────────────────────────────────────────────────────────


class TestAsk:
    """Test the ask() method."""

    def test_ask_routes_to_openai(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call_openai", return_value="response text"):
            result = client.ask("hello")
            assert result == "response text"

    def test_ask_routes_to_copilot(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "copilot"
        with patch.object(client, "_call_copilot", return_value="copilot response"):
            result = client.ask("hello")
            assert result == "copilot response"

    def test_ask_with_system_prompt(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call_openai", return_value="ok") as mock:
            client.ask("hello", system="be brief")
            mock.assert_called_once_with("hello", "be brief")

    def test_ask_handles_exception_gracefully(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call_openai", side_effect=RuntimeError("fail")):
            result = client.ask("hello")
            assert result == ""

    def test_ask_strips_whitespace(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call_openai", return_value="  answer  \n"):
            result = client.ask("hello")
            assert result == "answer"


# ── classify() ───────────────────────────────────────────────────────────────


class TestClassify:
    """Test the classify() method."""

    def test_classify_returns_correct_format(self):
        items = ["file1.md", "backup.zip", "brain.md"]
        mock_response = json.dumps([
            {"item": "file1.md", "category": "CORE", "confidence": 0.9},
            {"item": "backup.zip", "category": "BACKUP", "confidence": 0.95},
            {"item": "brain.md", "category": "CORE", "confidence": 0.99},
        ])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response):
            results = client.classify(items, ["CORE", "BACKUP", "MOVE"])
            assert len(results) == 3
            assert all("item" in r for r in results)
            assert all("category" in r for r in results)
            assert all("confidence" in r for r in results)

    def test_classify_empty_items(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        assert client.classify([], ["A", "B"]) == []

    def test_classify_handles_llm_error(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", side_effect=RuntimeError("fail")):
            result = client.classify(["x"], ["A"])
            assert result == []

    def test_classify_batches_large_lists(self):
        items = [f"item_{i}" for i in range(BATCH_SIZE + 5)]
        mock_response = json.dumps([
            {"item": f"item_{i}", "category": "A", "confidence": 0.8}
            for i in range(BATCH_SIZE)
        ])
        mock_response2 = json.dumps([
            {"item": f"item_{i}", "category": "B", "confidence": 0.7}
            for i in range(BATCH_SIZE, BATCH_SIZE + 5)
        ])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", side_effect=[mock_response, mock_response2]):
            results = client.classify(items, ["A", "B"])
            assert len(results) == BATCH_SIZE + 5

    def test_classify_with_context(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        mock_resp = json.dumps([{"item": "x", "category": "A", "confidence": 0.9}])
        with patch.object(client, "_call", return_value=mock_resp) as mock:
            client.classify(["x"], ["A", "B"], prompt_context="test context")
            call_args = mock.call_args[0][0]
            assert "test context" in call_args


# ── summarize() ──────────────────────────────────────────────────────────────


class TestSummarize:
    """Test the summarize() method."""

    def test_summarize_calls_ask_with_max_words(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "ask", return_value="short summary") as mock:
            result = client.summarize("very long text " * 100, max_words=30)
            assert result == "short summary"
            prompt = mock.call_args[0][0]
            assert "30 words" in prompt

    def test_summarize_empty_text(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        assert client.summarize("") == ""
        assert client.summarize("   ") == ""

    def test_summarize_default_max_words(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "ask", return_value="summary") as mock:
            client.summarize("some text")
            prompt = mock.call_args[0][0]
            assert "50 words" in prompt


# ── verify() ─────────────────────────────────────────────────────────────────


class TestVerify:
    """Test the verify() method."""

    def test_verify_filters_noise(self):
        candidates = _make_candidates(["real decision", "template text", "another real one"])
        mock_response = json.dumps([
            {"text": "real decision", "verdict": "REAL", "reason": "actual"},
            {"text": "template text", "verdict": "NOISE", "reason": "template"},
            {"text": "another real one", "verdict": "REAL", "reason": "actual"},
        ])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response):
            result = client.verify(candidates, "decisions")
            assert len(result) == 2
            assert result[0]["text"] == "real decision"
            assert result[1]["text"] == "another real one"

    def test_verify_empty_candidates(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        assert client.verify([], "decisions") == []

    def test_verify_dry_run_returns_all(self):
        candidates = _make_candidates(["a", "b"])
        mock_response = json.dumps([
            {"text": "a", "verdict": "REAL", "reason": "ok"},
            {"text": "b", "verdict": "NOISE", "reason": "noise"},
        ])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response):
            result = client.verify(candidates, "decisions", dry_run=True)
            assert len(result) == 2  # dry_run keeps all

    def test_verify_handles_llm_error_keeps_all(self):
        candidates = _make_candidates(["a", "b"])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", side_effect=RuntimeError("fail")):
            result = client.verify(candidates, "decisions")
            assert len(result) == 2  # fail-open

    def test_verify_uses_correct_prompt_for_decisions(self):
        candidates = _make_candidates(["test"])
        mock_response = json.dumps([{"text": "test", "verdict": "REAL", "reason": "ok"}])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response) as mock:
            client.verify(candidates, "decisions")
            prompt = mock.call_args[0][0]
            assert "decisions" in prompt.lower()

    def test_verify_uses_correct_prompt_for_patterns(self):
        candidates = _make_candidates(["test"])
        mock_response = json.dumps([{"text": "test", "verdict": "REAL", "reason": "ok"}])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response) as mock:
            client.verify(candidates, "patterns")
            prompt = mock.call_args[0][0]
            assert "bug pattern" in prompt.lower()

    def test_verify_uses_correct_prompt_for_people(self):
        candidates = _make_candidates(["test"])
        mock_response = json.dumps([{"text": "test", "verdict": "REAL", "reason": "ok"}])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response) as mock:
            client.verify(candidates, "people")
            prompt = mock.call_args[0][0]
            assert "person name" in prompt.lower()

    def test_verify_generic_category_fallback(self):
        candidates = _make_candidates(["test"])
        mock_response = json.dumps([{"text": "test", "verdict": "REAL", "reason": "ok"}])
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "_call", return_value=mock_response):
            result = client.verify(candidates, "unknown_category")
            assert len(result) == 1


# ── rewrite() ────────────────────────────────────────────────────────────────


class TestRewrite:
    """Test the rewrite() method."""

    def test_rewrite_calls_ask(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "ask", return_value="rewritten") as mock:
            result = client.rewrite("original", "make shorter")
            assert result == "rewritten"
            prompt = mock.call_args[0][0]
            assert "make shorter" in prompt
            assert "original" in prompt

    def test_rewrite_empty_text(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        assert client.rewrite("", "instruction") == ""


# ── consolidate_truth() ──────────────────────────────────────────────────────


class TestConsolidateTruth:
    """Test the consolidate_truth() method."""

    def test_consolidate_truth_calls_ask(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "ask", return_value="new truth text"):
            result = client.consolidate_truth("proj", "project", "old truth", "timeline", "excerpts")
            assert result == "new truth text"

    def test_consolidate_truth_returns_none_on_empty(self):
        client = LLMClient(fallback_mode=True)
        client.fallback_mode = False
        client.backend = "openai"
        with patch.object(client, "ask", return_value=""):
            result = client.consolidate_truth("proj", "project", "old", "tl", "ex")
            assert result is None

    def test_consolidate_truth_unavailable_returns_none(self):
        client = LLMClient(fallback_mode=True)
        result = client.consolidate_truth("proj", "project", "old", "tl", "ex")
        assert result is None


# ── JSON Parsing ─────────────────────────────────────────────────────────────


class TestJsonParsing:
    """Test _parse_json_response edge cases."""

    def test_parse_clean_json_array(self):
        raw = '[{"text": "a", "verdict": "REAL"}]'
        result = LLMClient._parse_json_response(raw)
        assert isinstance(result, list)
        assert len(result) == 1

    def test_parse_json_with_markdown_fences(self):
        raw = '```json\n[{"text": "a"}]\n```'
        result = LLMClient._parse_json_response(raw)
        assert isinstance(result, list)

    def test_parse_json_with_surrounding_text(self):
        raw = 'Here is the result:\n[{"x": 1}]\nDone!'
        result = LLMClient._parse_json_response(raw)
        assert isinstance(result, list)
        assert result[0]["x"] == 1

    def test_parse_json_object(self):
        raw = '{"key": "value"}'
        result = LLMClient._parse_json_response(raw)
        assert isinstance(result, dict)
        assert result["key"] == "value"

    def test_parse_invalid_json(self):
        raw = "not json at all"
        result = LLMClient._parse_json_response(raw)
        assert result is None

    def test_parse_empty_string(self):
        result = LLMClient._parse_json_response("")
        assert result is None

    def test_parse_nested_fences(self):
        raw = "```\n```json\n[]\n```\n```"
        result = LLMClient._parse_json_response(raw)
        assert result == []


# ── Batch Processing ─────────────────────────────────────────────────────────


class TestBatchProcessing:
    """Test batch splitting logic."""

    def test_batch_items_under_limit(self):
        items = list(range(5))
        batches = _batch_items(items)
        assert len(batches) == 1
        assert batches[0] == items

    def test_batch_items_at_limit(self):
        items = list(range(BATCH_SIZE))
        batches = _batch_items(items)
        assert len(batches) == 1

    def test_batch_items_over_limit(self):
        items = list(range(BATCH_SIZE + 1))
        batches = _batch_items(items)
        assert len(batches) == 2
        assert len(batches[0]) == BATCH_SIZE
        assert len(batches[1]) == 1

    def test_batch_items_empty(self):
        assert _batch_items([]) == []

    def test_batch_items_custom_size(self):
        items = list(range(10))
        batches = _batch_items(items, batch_size=3)
        assert len(batches) == 4  # 3, 3, 3, 1

    def test_format_candidate_list(self):
        candidates = _make_candidates(["first", "second"])
        result = _format_candidate_list(candidates)
        assert "1. first" in result
        assert "2. second" in result


# ── Apply Verdicts ───────────────────────────────────────────────────────────


class TestApplyVerdicts:
    """Test verdict matching logic."""

    def test_apply_verdicts_keeps_real(self):
        candidates = _make_candidates(["good", "bad"])
        verdicts = [
            {"text": "good", "verdict": "REAL", "reason": "ok"},
            {"text": "bad", "verdict": "NOISE", "reason": "noise"},
        ]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 1
        assert kept[0]["text"] == "good"
        assert len(removed) == 1
        assert removed[0]["text"] == "bad"

    def test_apply_verdicts_fail_open(self):
        """Candidates without a matching verdict are kept (fail-open)."""
        candidates = _make_candidates(["unknown"])
        verdicts = []
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 1
        assert len(removed) == 0

    def test_apply_verdicts_case_insensitive(self):
        candidates = _make_candidates(["Hello World"])
        verdicts = [{"text": "hello world", "verdict": "NOISE", "reason": "test"}]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(removed) == 1

    def test_apply_verdicts_custom_text_key(self):
        candidates = [{"name": "Alice"}, {"name": "Config"}]
        verdicts = [
            {"text": "Alice", "verdict": "REAL", "reason": "person"},
            {"text": "Config", "verdict": "NOISE", "reason": "not a person"},
        ]
        kept, removed = _apply_verdicts(candidates, verdicts, text_key="name")
        assert len(kept) == 1
        assert kept[0]["name"] == "Alice"


# ── Contract: llm_filter uses LLMClient ──────────────────────────────────────


class TestLLMFilterContract:
    """Verify that llm_filter.py uses LLMClient instead of ad-hoc detection."""

    def test_llm_filter_imports_llm_client(self):
        """llm_filter.py should import from engine.llm_client."""
        import importlib
        source_path = PROJECT_ROOT / "engine" / "llm_filter.py"
        source = source_path.read_text(encoding="utf-8")
        assert "from engine.llm_client import LLMClient" in source

    def test_llm_filter_no_direct_openai_import(self):
        """llm_filter.py should NOT directly import openai anymore."""
        source_path = PROJECT_ROOT / "engine" / "llm_filter.py"
        source = source_path.read_text(encoding="utf-8")
        assert "import openai" not in source

    def test_llm_filter_no_direct_subprocess(self):
        """llm_filter.py should NOT directly call subprocess."""
        source_path = PROJECT_ROOT / "engine" / "llm_filter.py"
        source = source_path.read_text(encoding="utf-8")
        assert "import subprocess" not in source

    def test_llm_filter_get_backend_delegates(self):
        """_get_backend in llm_filter delegates to LLMClient."""
        from engine.llm_filter import _get_backend
        result = _get_backend()
        assert result in ("openai", "copilot", "none")

    def test_retrofit_imports_llm_client(self):
        """retrofit.py should import LLMClient."""
        source_path = PROJECT_ROOT / "engine" / "retrofit.py"
        source = source_path.read_text(encoding="utf-8")
        assert "from engine.llm_client import LLMClient" in source

    def test_hygiene_imports_llm_client(self):
        """hygiene.py should import LLMClient."""
        source_path = PROJECT_ROOT / "engine" / "hygiene.py"
        source = source_path.read_text(encoding="utf-8")
        assert "from engine.llm_client import LLMClient" in source
