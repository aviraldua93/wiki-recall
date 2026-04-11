"""
Tests for engine/validate_paths.py — copilot-instructions.md path reference validation.

Tests:
  - Path extraction from various formats (~/grain, backtick, bare paths)
  - Path resolution relative to KB root
  - Broken path detection
  - Valid path detection (no false positives)
  - Fix mode (commenting out broken paths)
  - Edge cases: empty file, no file, skip patterns
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.validate_paths import (
    BrokenPath,
    extract_path_references,
    fix_broken_paths,
    report_broken_paths,
    resolve_path,
    validate_paths,
)


# ── Path Extraction Tests ────────────────────────────────────────────────────

class TestExtractPathReferences(unittest.TestCase):
    """Test extraction of path references from markdown content."""

    def test_grain_path(self):
        content = "Brain: ~/.grain/brain.md (L0+L1, loaded every session)"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("brain.md", paths)

    def test_grain_nested_path(self):
        content = "Wiki: ~/.grain/wiki/ (L2, on-demand)"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertTrue(any("wiki/" in p for p in paths))

    def test_grain_deep_path(self):
        content = "People: ~/.grain/wiki/people/ — per-person pages"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertTrue(any("wiki/people/" in p for p in paths))

    def test_backtick_file_path(self):
        content = "Read `persona.md` before writing."
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("persona.md", paths)

    def test_backtick_dir_path(self):
        content = "Check `wiki/patterns/` for matching files"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("wiki/patterns/", paths)

    def test_backtick_nested_file(self):
        content = "see `templates/RESOLVER.md` — 8 rules"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("templates/RESOLVER.md", paths)

    def test_backtick_domains_file(self):
        content = "read `domains/comms.md` FIRST to resolve"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("domains/comms.md", paths)

    def test_bare_path_with_extension(self):
        content = " scripts/backup.ps1 first."
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertTrue(any("scripts/backup.ps1" in p for p in paths))

    def test_line_numbers_are_correct(self):
        content = "line1\npath: ~/.grain/brain.md\nline3"
        refs = extract_path_references(content)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0][0], 2)  # line 2

    def test_skips_http_urls(self):
        content = "Visit https://example.com/path/file.md"
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        for p in paths:
            self.assertNotIn("example.com", p)

    def test_skips_short_refs(self):
        content = "`a.b`"
        refs = extract_path_references(content)
        # Very short references should be filtered
        self.assertEqual(len(refs), 0)

    def test_dedup_within_line(self):
        content = "Use ~/.grain/brain.md and also ~/.grain/brain.md"
        refs = extract_path_references(content)
        brain_refs = [r for r in refs if "brain.md" in r[2]]
        # Should deduplicate within the same line
        self.assertEqual(len(brain_refs), 1)

    def test_empty_content(self):
        refs = extract_path_references("")
        self.assertEqual(len(refs), 0)

    def test_no_paths(self):
        content = "This is just regular text with no file paths."
        refs = extract_path_references(content)
        self.assertEqual(len(refs), 0)

    def test_multiple_paths_on_one_line(self):
        content = "Check `brain.md` and `persona.md` before starting."
        refs = extract_path_references(content)
        paths = [r[2] for r in refs]
        self.assertIn("brain.md", paths)
        self.assertIn("persona.md", paths)


# ── Path Resolution Tests ────────────────────────────────────────────────────

class TestResolvePath(unittest.TestCase):
    """Test path resolution relative to KB root."""

    def test_grain_prefix_stripped(self):
        kb_root = Path("/test/grain")
        result = resolve_path("~/.grain/brain.md", kb_root)
        self.assertEqual(result, kb_root / "brain.md")

    def test_relative_path(self):
        kb_root = Path("/test/grain")
        result = resolve_path("wiki/patterns/", kb_root)
        self.assertEqual(result, kb_root / "wiki" / "patterns")

    def test_nested_path(self):
        kb_root = Path("/test/grain")
        result = resolve_path("wiki/people/john.md", kb_root)
        self.assertEqual(result, kb_root / "wiki" / "people" / "john.md")


# ── Validation Tests ─────────────────────────────────────────────────────────

class TestValidatePaths(unittest.TestCase):
    """Integration tests for path validation."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.kb_root = self.tmpdir / "grain"
        self.kb_root.mkdir()
        # Create some real files
        (self.kb_root / "brain.md").write_text("# Brain", encoding="utf-8")
        (self.kb_root / "wiki").mkdir()
        (self.kb_root / "wiki" / "patterns").mkdir()
        (self.kb_root / "persona.md").write_text("# Persona", encoding="utf-8")
        (self.kb_root / "decisions.md").write_text("# Decisions", encoding="utf-8")
        # Create copilot-instructions.md
        self.instructions_path = self.kb_root / "copilot-instructions.md"

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_valid_paths_no_broken(self):
        self.instructions_path.write_text(
            "Brain: ~/.grain/brain.md\nPersona: ~/.grain/persona.md\n",
            encoding="utf-8",
        )
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertEqual(len(broken), 0)

    def test_detects_broken_file(self):
        self.instructions_path.write_text(
            "Brain: ~/.grain/brain.md\nSecret: ~/.grain/nonexistent-file.md\n",
            encoding="utf-8",
        )
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertGreater(len(broken), 0)
        broken_paths = [bp.referenced_path for bp in broken]
        self.assertTrue(any("nonexistent-file.md" in p for p in broken_paths))

    def test_detects_broken_directory(self):
        self.instructions_path.write_text(
            "Check `wiki/nonexistent-dir/` for files\n",
            encoding="utf-8",
        )
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertGreater(len(broken), 0)

    def test_valid_directory_not_broken(self):
        self.instructions_path.write_text(
            "Check `wiki/patterns/` for matching files\n",
            encoding="utf-8",
        )
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertEqual(len(broken), 0)

    def test_broken_path_has_line_number(self):
        self.instructions_path.write_text(
            "line1\nline2\nBad: ~/.grain/missing.md\nline4\n",
            encoding="utf-8",
        )
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertEqual(len(broken), 1)
        self.assertEqual(broken[0].line_number, 3)

    def test_no_instructions_file(self):
        broken = validate_paths(
            instructions_path=self.kb_root / "nonexistent.md",
            kb_root=self.kb_root,
        )
        self.assertEqual(len(broken), 0)

    def test_empty_instructions_file(self):
        self.instructions_path.write_text("", encoding="utf-8")
        broken = validate_paths(
            instructions_path=self.instructions_path,
            kb_root=self.kb_root,
        )
        self.assertEqual(len(broken), 0)


# ── Fix Tests ────────────────────────────────────────────────────────────────

class TestFixBrokenPaths(unittest.TestCase):
    """Test the --fix mode for commenting out broken paths."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.instructions_path = self.tmpdir / "copilot-instructions.md"

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_fix_comments_out_broken_line(self):
        self.instructions_path.write_text(
            "line1\nBad: ~/.grain/missing.md\nline3\n",
            encoding="utf-8",
        )
        bp = BrokenPath(
            line_number=2,
            line_text="Bad: ~/.grain/missing.md",
            referenced_path="missing.md",
            resolved_path=self.tmpdir / "missing.md",
        )
        fixed = fix_broken_paths(self.instructions_path, [bp], interactive=False)
        self.assertEqual(fixed, 1)

        content = self.instructions_path.read_text(encoding="utf-8")
        self.assertIn("<!-- BROKEN PATH:", content)
        self.assertIn("line1", content)
        self.assertIn("line3", content)

    def test_fix_no_broken_paths(self):
        self.instructions_path.write_text("line1\nline2\n", encoding="utf-8")
        fixed = fix_broken_paths(self.instructions_path, [], interactive=False)
        self.assertEqual(fixed, 0)

    def test_fix_preserves_valid_lines(self):
        self.instructions_path.write_text(
            "valid line 1\nBroken: ~/.grain/bad.md\nvalid line 3\n",
            encoding="utf-8",
        )
        bp = BrokenPath(
            line_number=2,
            line_text="Broken: ~/.grain/bad.md",
            referenced_path="bad.md",
            resolved_path=self.tmpdir / "bad.md",
        )
        fix_broken_paths(self.instructions_path, [bp], interactive=False)
        content = self.instructions_path.read_text(encoding="utf-8")
        self.assertIn("valid line 1", content)
        self.assertIn("valid line 3", content)


# ── Report Tests ─────────────────────────────────────────────────────────────

class TestReportBrokenPaths(unittest.TestCase):
    """Test the broken paths report formatting."""

    def test_no_broken_paths(self):
        report = report_broken_paths([])
        self.assertIn("✓", report)
        self.assertIn("valid", report.lower())

    def test_broken_paths_report(self):
        bp = BrokenPath(
            line_number=5,
            line_text="Brain: ~/.grain/missing.md",
            referenced_path="missing.md",
            resolved_path=Path("/test/missing.md"),
        )
        report = report_broken_paths([bp])
        self.assertIn("1 broken", report)
        self.assertIn("Line 5", report)
        self.assertIn("missing.md", report)


if __name__ == "__main__":
    unittest.main()
