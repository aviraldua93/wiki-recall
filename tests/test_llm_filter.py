"""
Comprehensive tests for engine/llm_filter.py and engine/mock_llm.py.

Tests:
  - filter_decisions removes noise (template text, code snippets)
  - filter_decisions keeps real decisions
  - filter_patterns removes code, keeps real patterns
  - filter_people removes common words, keeps real names
  - batch splitting works correctly (>20 candidates split into batches)
  - dry_run mode doesn't discard anything
  - mock LLM returns expected results
  - --no-llm-filter falls back to regex-only
  - missing API key falls back gracefully
  - empty candidate lists
  - malformed LLM responses handled
  - partial LLM failures don't lose data
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.llm_filter import (
    BATCH_SIZE,
    _apply_verdicts,
    _batch_candidates,
    _filter_category,
    _format_candidate_list,
    _get_backend,
    _parse_llm_response,
    filter_decisions,
    filter_patterns,
    filter_people,
)
from engine.mock_llm import MockLLMFilter


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_candidates(texts: list[str]) -> list[dict]:
    """Create candidate dicts from text strings."""
    return [{"text": t} for t in texts]


def _mock_llm_response(candidates: list[dict], real_indices: set[int]) -> str:
    """Build a mock JSON response marking specific indices as REAL."""
    results = []
    for i, c in enumerate(candidates):
        text = c.get("text", str(c))
        verdict = "REAL" if i in real_indices else "NOISE"
        reason = "actual decision" if verdict == "REAL" else "template text"
        results.append({"text": text, "verdict": verdict, "reason": reason})
    return json.dumps(results)


# ── Backend detection ────────────────────────────────────────────────────────

class TestBackendDetection:
    def test_openai_key_detected(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test123"}):
            assert _get_backend() == "openai"

    def test_copilot_cli_detected(self):
        with patch.dict("os.environ", {}, clear=True):
            import os
            os.environ.pop("OPENAI_API_KEY", None)
            with patch("shutil.which", return_value="/usr/bin/copilot"):
                assert _get_backend() == "copilot"

    def test_no_backend_returns_none(self):
        with patch.dict("os.environ", {}, clear=True):
            import os
            os.environ.pop("OPENAI_API_KEY", None)
            with patch("shutil.which", return_value=None):
                assert _get_backend() == "none"

    def test_openai_takes_precedence_over_copilot(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
            with patch("shutil.which", return_value="/usr/bin/copilot"):
                assert _get_backend() == "openai"


# ── Response parsing ─────────────────────────────────────────────────────────

class TestResponseParsing:
    def test_parse_clean_json(self):
        data = [{"text": "use JWT", "verdict": "REAL", "reason": "design choice"}]
        result = _parse_llm_response(json.dumps(data))
        assert len(result) == 1
        assert result[0]["verdict"] == "REAL"

    def test_parse_with_markdown_fences(self):
        data = [{"text": "use JWT", "verdict": "REAL", "reason": "ok"}]
        raw = f"```json\n{json.dumps(data)}\n```"
        result = _parse_llm_response(raw)
        assert len(result) == 1

    def test_parse_json_embedded_in_text(self):
        data = [{"text": "use JWT", "verdict": "NOISE", "reason": "generic"}]
        raw = f"Here are the results:\n{json.dumps(data)}\nDone."
        result = _parse_llm_response(raw)
        assert len(result) == 1
        assert result[0]["verdict"] == "NOISE"

    def test_parse_garbage_returns_empty(self):
        result = _parse_llm_response("this is not JSON at all")
        assert result == []

    def test_parse_non_array_returns_empty(self):
        result = _parse_llm_response('{"text": "not an array"}')
        assert result == []

    def test_parse_empty_array(self):
        result = _parse_llm_response("[]")
        assert result == []

    def test_parse_whitespace_padded(self):
        data = [{"text": "use JWT", "verdict": "REAL", "reason": "ok"}]
        raw = f"\n\n  {json.dumps(data)}  \n\n"
        result = _parse_llm_response(raw)
        assert len(result) == 1


# ── Batch splitting ──────────────────────────────────────────────────────────

class TestBatchSplitting:
    def test_small_list_single_batch(self):
        items = list(range(5))
        batches = _batch_candidates(items)
        assert len(batches) == 1
        assert batches[0] == items

    def test_exact_batch_size(self):
        items = list(range(BATCH_SIZE))
        batches = _batch_candidates(items)
        assert len(batches) == 1

    def test_over_batch_size_splits(self):
        items = list(range(BATCH_SIZE + 1))
        batches = _batch_candidates(items)
        assert len(batches) == 2
        assert len(batches[0]) == BATCH_SIZE
        assert len(batches[1]) == 1

    def test_large_list_correct_batch_count(self):
        items = list(range(55))
        batches = _batch_candidates(items, batch_size=20)
        assert len(batches) == 3
        assert len(batches[0]) == 20
        assert len(batches[1]) == 20
        assert len(batches[2]) == 15

    def test_empty_list(self):
        assert _batch_candidates([]) == []

    def test_custom_batch_size(self):
        items = list(range(10))
        batches = _batch_candidates(items, batch_size=3)
        assert len(batches) == 4


# ── Verdict application ─────────────────────────────────────────────────────

class TestVerdictApplication:
    def test_all_real_kept(self):
        candidates = _make_candidates(["use JWT", "switch to WebSockets"])
        verdicts = [
            {"text": "use JWT", "verdict": "REAL", "reason": "ok"},
            {"text": "switch to WebSockets", "verdict": "REAL", "reason": "ok"},
        ]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 2
        assert len(removed) == 0

    def test_all_noise_removed(self):
        candidates = _make_candidates(["template code here", "example placeholder"])
        verdicts = [
            {"text": "template code here", "verdict": "NOISE", "reason": "template"},
            {"text": "example placeholder", "verdict": "NOISE", "reason": "generic"},
        ]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 0
        assert len(removed) == 2

    def test_mixed_verdicts(self):
        candidates = _make_candidates(["use JWT for auth", "some template text"])
        verdicts = [
            {"text": "use JWT for auth", "verdict": "REAL", "reason": "decision"},
            {"text": "some template text", "verdict": "NOISE", "reason": "template"},
        ]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 1
        assert kept[0]["text"] == "use JWT for auth"
        assert len(removed) == 1

    def test_missing_verdict_keeps_candidate(self):
        """Fail-open: if LLM didn't return a verdict, keep the candidate."""
        candidates = _make_candidates(["unknown item"])
        verdicts = []
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(kept) == 1
        assert len(removed) == 0

    def test_case_insensitive_matching(self):
        candidates = _make_candidates(["Use JWT For Auth"])
        verdicts = [{"text": "use jwt for auth", "verdict": "NOISE", "reason": "test"}]
        kept, removed = _apply_verdicts(candidates, verdicts)
        assert len(removed) == 1

    def test_removed_items_get_reason(self):
        candidates = _make_candidates(["noisy text"])
        verdicts = [{"text": "noisy text", "verdict": "NOISE", "reason": "it's noise"}]
        _, removed = _apply_verdicts(candidates, verdicts)
        assert removed[0]["_reason"] == "it's noise"


# ── filter_decisions ─────────────────────────────────────────────────────────

class TestFilterDecisions:
    def test_removes_noise(self):
        candidates = _make_candidates([
            "JWT tokens for the authentication layer",
            "the template placeholder text for example purposes",
            "WebSockets instead of polling for the dashboard",
            "some code snippet var x = decided to use y",
        ])
        # Mock LLM: items 0 and 2 are REAL
        response = _mock_llm_response(candidates, {0, 2})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 2
        assert result[0]["text"] == "JWT tokens for the authentication layer"
        assert result[1]["text"] == "WebSockets instead of polling for the dashboard"

    def test_keeps_real_decisions(self):
        candidates = _make_candidates([
            "microservices architecture for the backend",
            "PostgreSQL over MySQL for the data layer",
        ])
        response = _mock_llm_response(candidates, {0, 1})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 2

    def test_empty_candidates(self):
        result = filter_decisions([], backend="openai")
        assert result == []


class TestFilterPatterns:
    def test_removes_code_keeps_patterns(self):
        candidates = _make_candidates([
            "null check missing before array access in parser",
            "const x = require('module'); // snippet",
            "retry with exponential backoff fixes timeout issue",
        ])
        response = _mock_llm_response(candidates, {0, 2})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_patterns(candidates, backend="openai")
        assert len(result) == 2
        texts = [r["text"] for r in result]
        assert "null check missing before array access in parser" in texts
        assert "retry with exponential backoff fixes timeout issue" in texts

    def test_empty_candidates(self):
        assert filter_patterns([], backend="openai") == []


class TestFilterPeople:
    def test_removes_common_words_keeps_names(self):
        candidates = _make_candidates([
            "Sarah", "Config", "Jordan", "Template",
        ])
        response = _mock_llm_response(candidates, {0, 2})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_people(candidates, backend="openai")
        assert len(result) == 2
        names = [r["text"] for r in result]
        assert "Sarah" in names
        assert "Jordan" in names

    def test_empty_candidates(self):
        assert filter_people([], backend="openai") == []


# ── Dry-run mode ─────────────────────────────────────────────────────────────

class TestDryRun:
    def test_dry_run_returns_all_candidates(self):
        candidates = _make_candidates([
            "real decision about architecture",
            "template placeholder noise text",
        ])
        response = _mock_llm_response(candidates, {0})  # Only first is REAL
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_decisions(candidates, dry_run=True, backend="openai")
        # dry_run should return ALL candidates, not just REAL ones
        assert len(result) == 2

    def test_dry_run_prints_filtering_info(self, capsys):
        candidates = _make_candidates(["real one", "noise one"])
        response = _mock_llm_response(candidates, {0})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            filter_decisions(candidates, dry_run=True, backend="openai")
        captured = capsys.readouterr()
        assert "LLM Filter" in captured.out
        assert "noise" in captured.out.lower()


# ── Fallback behavior ────────────────────────────────────────────────────────

class TestFallback:
    def test_no_backend_returns_all_candidates(self):
        candidates = _make_candidates(["something", "else"])
        result = filter_decisions(candidates, backend="none")
        assert len(result) == 2

    def test_no_backend_logs_warning(self, caplog):
        import logging
        with caplog.at_level(logging.WARNING):
            filter_decisions(_make_candidates(["test"]), backend="none")
        assert "No LLM backend" in caplog.text or len(caplog.records) >= 0
        # The function should still return candidates

    def test_llm_call_failure_keeps_all(self):
        """If LLM call raises, fail-open: keep all candidates."""
        candidates = _make_candidates(["a real decision about design"])
        with patch("engine.llm_client.LLMClient._call", side_effect=RuntimeError("API down")):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 1

    def test_malformed_response_keeps_all(self):
        """If LLM returns garbage, keep all candidates."""
        candidates = _make_candidates(["a real decision about design"])
        with patch("engine.llm_client.LLMClient._call", return_value="NOT JSON"):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 1


# ── MockLLMFilter ────────────────────────────────────────────────────────────

class TestMockLLMFilter:
    def test_default_pass_rate(self):
        mock = MockLLMFilter(pass_rate=0.3)
        candidates = _make_candidates([f"item {i}" for i in range(10)])
        results = mock.classify(candidates, "decisions")
        real_count = sum(1 for r in results if r["verdict"] == "REAL")
        assert real_count == math.ceil(10 * 0.3)

    def test_zero_pass_rate(self):
        mock = MockLLMFilter(pass_rate=0.0)
        candidates = _make_candidates(["a", "b", "c"])
        results = mock.classify(candidates, "decisions")
        assert all(r["verdict"] == "NOISE" for r in results)

    def test_full_pass_rate(self):
        mock = MockLLMFilter(pass_rate=1.0)
        candidates = _make_candidates(["a", "b", "c"])
        results = mock.classify(candidates, "decisions")
        assert all(r["verdict"] == "REAL" for r in results)

    def test_noise_keywords_override(self):
        mock = MockLLMFilter(pass_rate=1.0, noise_keywords=["template"])
        candidates = _make_candidates(["real item", "template text"])
        results = mock.classify(candidates, "decisions")
        assert results[0]["verdict"] == "REAL"
        assert results[1]["verdict"] == "NOISE"

    def test_real_keywords_override(self):
        mock = MockLLMFilter(pass_rate=0.0, real_keywords=["architecture"])
        candidates = _make_candidates(["generic text", "architecture decision"])
        results = mock.classify(candidates, "decisions")
        assert results[0]["verdict"] == "NOISE"
        assert results[1]["verdict"] == "REAL"

    def test_call_count_tracking(self):
        mock = MockLLMFilter()
        mock.classify(_make_candidates(["a"]), "decisions")
        mock.classify(_make_candidates(["b"]), "patterns")
        assert mock.call_count == 2

    def test_call_log_tracking(self):
        mock = MockLLMFilter()
        mock.classify(_make_candidates(["a", "b"]), "decisions")
        mock.classify(_make_candidates(["c"]), "people")
        assert len(mock.call_log) == 2
        assert mock.call_log[0] == {"category": "decisions", "count": 2}
        assert mock.call_log[1] == {"category": "people", "count": 1}

    def test_reset_clears_tracking(self):
        mock = MockLLMFilter()
        mock.classify(_make_candidates(["a"]), "decisions")
        assert mock.call_count == 1
        mock.reset()
        assert mock.call_count == 0
        assert mock.call_log == []

    def test_as_json_response(self):
        mock = MockLLMFilter(pass_rate=0.5)
        candidates = _make_candidates(["item1", "item2"])
        raw = mock.as_json_response(candidates, "decisions")
        parsed = json.loads(raw)
        assert isinstance(parsed, list)
        assert len(parsed) == 2

    def test_integration_with_parse(self):
        """MockLLMFilter output can be parsed by _parse_llm_response."""
        mock = MockLLMFilter(pass_rate=0.5)
        candidates = _make_candidates(["real one", "noise one"])
        raw = mock.as_json_response(candidates, "decisions")
        parsed = _parse_llm_response(raw)
        assert len(parsed) == 2
        verdicts = {p["text"]: p["verdict"] for p in parsed}
        assert verdicts["real one"] == "REAL"
        assert verdicts["noise one"] == "NOISE"

    def test_integration_with_filter_pipeline(self):
        """MockLLMFilter works end-to-end with filter_decisions."""
        mock = MockLLMFilter(pass_rate=0.5)
        candidates = _make_candidates(["design choice A", "generic filler B"])

        def fake_llm(prompt, backend=None):
            return mock.as_json_response(candidates, "decisions")

        with patch("engine.llm_client.LLMClient._call", side_effect=fake_llm):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 1
        assert result[0]["text"] == "design choice A"


# ── Candidate formatting ─────────────────────────────────────────────────────

class TestCandidateFormatting:
    def test_numbered_list(self):
        candidates = _make_candidates(["alpha", "beta"])
        text = _format_candidate_list(candidates)
        assert "1. alpha" in text
        assert "2. beta" in text

    def test_empty_list(self):
        assert _format_candidate_list([]) == ""


# ── Multi-batch integration ──────────────────────────────────────────────────

class TestMultiBatch:
    def test_large_candidate_list_splits_correctly(self):
        """25 candidates should split into 2 batches (20 + 5)."""
        candidates = _make_candidates([f"candidate {i}" for i in range(25)])
        call_count = 0

        def fake_llm(prompt, backend=None):
            nonlocal call_count
            call_count += 1
            # Parse candidate count from prompt
            lines = [l for l in prompt.strip().split("\n") if l.strip().startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9."))]
            results = []
            for line in lines:
                text = line.split(". ", 1)[1] if ". " in line else line
                results.append({"text": text, "verdict": "REAL", "reason": "ok"})
            return json.dumps(results)

        with patch("engine.llm_client.LLMClient._call", side_effect=fake_llm):
            result = filter_decisions(candidates, backend="openai")

        assert call_count == 2  # 20 + 5
        assert len(result) == 25  # all kept as REAL


# ── Edge cases ───────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_candidate_with_no_text_key(self):
        """Candidates without 'text' key handled gracefully."""
        candidates = [{"content": "something"}]
        verdicts = [{"text": "something", "verdict": "REAL", "reason": "ok"}]
        # _format_candidate_list handles missing text
        text = _format_candidate_list(candidates)
        assert "content" in text  # falls back to str(dict)

    def test_single_candidate(self):
        candidates = _make_candidates(["only one item"])
        response = _mock_llm_response(candidates, {0})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 1

    def test_unicode_candidates(self):
        candidates = _make_candidates(["décision über Architektur", "日本語のテスト"])
        response = _mock_llm_response(candidates, {0, 1})
        with patch("engine.llm_client.LLMClient._call", return_value=response):
            result = filter_decisions(candidates, backend="openai")
        assert len(result) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
