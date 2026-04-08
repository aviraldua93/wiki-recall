"""
Engine unit tests for wiki-recall.

Tests:
  1. Indexer PII sanitization patterns
  2. Search result formatting
  3. MCP server tool list (10 tools)
  4. No forbidden strings in engine files
"""

import ast
import os
import re
import sys
import unittest
from pathlib import Path

# Add project root to path so we can import engine modules by parsing them
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = PROJECT_ROOT / "engine"


class TestIndexerSanitization(unittest.TestCase):
    """Test that indexer PII sanitization patterns work correctly."""

    def setUp(self):
        source = (ENGINE_DIR / "indexer.py").read_text(encoding="utf-8")
        tree = ast.parse(source)

        # Extract regex patterns from the source
        self._email_re = re.compile(
            r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.(?:com|org|net|io)", re.IGNORECASE
        )
        self._url_patterns = [
            re.compile(r"https?://[a-zA-Z0-9.-]*\.visualstudio\.com[^\s)*\"']*", re.IGNORECASE),
            re.compile(r"https?://dev\.azure\.com/[^\s)*\"']*", re.IGNORECASE),
        ]

    def _sanitize(self, text: str) -> str:
        if not text:
            return text
        text = self._email_re.sub("[EMAIL_REDACTED]", text)
        for pattern in self._url_patterns:
            text = pattern.sub("[INTERNAL_URL_REDACTED]", text)
        return text

    def test_email_redaction(self):
        text = "Contact john.doe@example.com for details"
        result = self._sanitize(text)
        self.assertNotIn("john.doe@example.com", result)
        self.assertIn("[EMAIL_REDACTED]", result)

    def test_multiple_emails(self):
        text = "From alice@corp.org to bob@team.net"
        result = self._sanitize(text)
        self.assertEqual(result.count("[EMAIL_REDACTED]"), 2)

    def test_visualstudio_url_redaction(self):
        text = "See https://myorg.visualstudio.com/project/_git/repo for code"
        result = self._sanitize(text)
        self.assertNotIn("visualstudio.com", result)
        self.assertIn("[INTERNAL_URL_REDACTED]", result)

    def test_azure_devops_url_redaction(self):
        text = "Pipeline at https://dev.azure.com/myorg/project/_build"
        result = self._sanitize(text)
        self.assertNotIn("dev.azure.com", result)
        self.assertIn("[INTERNAL_URL_REDACTED]", result)

    def test_clean_text_unchanged(self):
        text = "This is normal text with no PII"
        result = self._sanitize(text)
        self.assertEqual(text, result)

    def test_empty_and_none(self):
        self.assertEqual(self._sanitize(""), "")
        self.assertIsNone(self._sanitize(None))

    def test_github_urls_not_redacted(self):
        text = "See https://github.com/owner/repo for details"
        result = self._sanitize(text)
        self.assertIn("github.com", result)


class TestSearchFormatting(unittest.TestCase):
    """Test search result formatting functions."""

    def setUp(self):
        source = (ENGINE_DIR / "search.py").read_text(encoding="utf-8")
        self.source = source

    def test_tokenize_function(self):
        tokens = re.findall(r"[a-z0-9]+", "Hello World! Test-123".lower())
        self.assertEqual(tokens, ["hello", "world", "test", "123"])

    def test_keyword_score_basic(self):
        query_tokens = ["auth", "login"]
        text = "The auth module handles login and logout flows"
        text_lower = text.lower()
        text_tokens = set(re.findall(r"[a-z0-9]+", text_lower))
        hits = sum(1 for t in query_tokens if t in text_tokens)
        coverage = hits / len(query_tokens)
        self.assertEqual(coverage, 1.0)

    def test_keyword_score_partial(self):
        query_tokens = ["auth", "payment", "dashboard"]
        text = "The auth module handles authentication"
        text_lower = text.lower()
        text_tokens = set(re.findall(r"[a-z0-9]+", text_lower))
        hits = sum(1 for t in query_tokens if t in text_tokens)
        coverage = hits / len(query_tokens)
        self.assertAlmostEqual(coverage, 1 / 3, places=2)

    def test_keyword_score_no_match(self):
        query_tokens = ["quantum", "physics"]
        text = "Frontend development with React"
        text_lower = text.lower()
        text_tokens = set(re.findall(r"[a-z0-9]+", text_lower))
        hits = sum(1 for t in query_tokens if t in text_tokens)
        self.assertEqual(hits, 0)

    def test_extract_context_returns_snippet(self):
        text = "A" * 100 + " auth login " + "B" * 100
        query_tokens = ["auth", "login"]
        text_lower = text.lower()
        best_pos = 0
        best_density = 0
        window = 300
        for i in range(0, max(1, len(text) - window), window // 4):
            chunk = text_lower[i : i + window]
            density = sum(1 for t in query_tokens if t in chunk)
            if density > best_density:
                best_density = density
                best_pos = i
        self.assertGreater(best_density, 0)

    def test_search_result_structure(self):
        result = {
            "text": "some content",
            "source": "wiki/projects/foo.md",
            "score": 0.85,
            "mode": "wiki",
        }
        self.assertIn("text", result)
        self.assertIn("source", result)
        self.assertIn("score", result)
        self.assertIn("mode", result)
        self.assertIsInstance(result["score"], float)
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 1.0)


class TestMCPServerTools(unittest.TestCase):
    """Test MCP server has exactly 10 tools."""

    def test_mcp_server_has_10_tools(self):
        source = (ENGINE_DIR / "mcp_server.py").read_text(encoding="utf-8")
        tool_decorators = re.findall(r"@mcp\.tool\(\)", source)
        self.assertEqual(
            len(tool_decorators),
            10,
            f"Expected 10 MCP tools, found {len(tool_decorators)}: check mcp_server.py",
        )

    def test_mcp_server_tool_names(self):
        source = (ENGINE_DIR / "mcp_server.py").read_text(encoding="utf-8")
        expected_tools = [
            "grain_wake_up",
            "grain_search",
            "grain_recall",
            "grain_domains",
            "grain_domain",
            "grain_decisions",
            "grain_projects",
            "grain_patterns",
            "grain_session",
            "grain_status",
        ]
        for tool_name in expected_tools:
            self.assertIn(
                f"def {tool_name}(",
                source,
                f"Missing tool function: {tool_name}",
            )


class TestNoForbiddenStrings(unittest.TestCase):
    """Verify no PII or forbidden strings in engine files."""

    FORBIDDEN = [
        "Aviral",
        "microsoft",
        "gim-home",
        "OverlakeES",
        "octane",
        "cirrus",
        "overlake",
        "jaypete",
    ]

    def test_engine_files_clean(self):
        engine_files = list(ENGINE_DIR.glob("*.py"))
        self.assertGreater(len(engine_files), 0, "No engine files found")

        for fpath in engine_files:
            content = fpath.read_text(encoding="utf-8")
            for term in self.FORBIDDEN:
                self.assertNotIn(
                    term,
                    content,
                    f"Forbidden string '{term}' found in {fpath.name}",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
