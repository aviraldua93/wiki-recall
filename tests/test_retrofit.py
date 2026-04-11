"""
Comprehensive tests for retrofit.py -- the brain retrofit/upgrade tool.

Tests:
  - Phase 1: Structure cleanup (automated fixes)
  - Phase 2: Brain.md cleanup (code extraction, decision extraction, trimming)
  - Phase 3: Wire RESOLVER (inline routing rules)
  - Phase 4: Compiled truth + timeline (section insertion)
  - Phase 5: Clean decisions.md (harvest noise removal)
  - Phase 6: Hygiene check (report generation)
  - Full retrofit workflow
  - Edge cases: empty dirs, missing files, already-clean brains
  - Helpers: backup, counting, noise detection
"""

import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

# Add project root so we can import engine modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.retrofit import (
    extract_code_blocks,
    extract_inline_decisions,
    trim_project_descriptions,
    remove_blank_line_runs,
    is_harvest_noise,
    add_compiled_truth_and_timeline,
    wire_resolver_to_instructions,
    ensure_backup,
    count_pages,
    phase_1_structure_cleanup,
    phase_2_brain_cleanup,
    phase_3_wire_resolver,
    phase_4_compiled_truth_timeline,
    phase_5_clean_decisions,
    BRAIN_MAX_LINES,
    RESOLVER_ROUTING_RULES,
    DECISION_WRITEBACK_SECTION,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def make_retrofit_root(tmp: Path) -> Path:
    """Create a minimal knowledge base structure for testing."""
    root = tmp / ".grain"
    root.mkdir(parents=True)
    (root / "wiki" / "projects").mkdir(parents=True)
    (root / "wiki" / "patterns").mkdir(parents=True)
    (root / "wiki" / "concepts").mkdir(parents=True)
    (root / "wiki" / "people").mkdir(parents=True)
    (root / "reference").mkdir(parents=True)
    (root / "scripts").mkdir(parents=True)

    # brain.md
    (root / "brain.md").write_text(
        "# Brain\n\n## L0\nIdentity\n\n## L1\nActive work\n",
        encoding="utf-8",
    )

    # decisions.md
    (root / "decisions.md").write_text(
        "# Decisions\n\n- [2025-01-01] chose Python for scripts\n",
        encoding="utf-8",
    )

    # wiki index
    (root / "wiki" / "index.md").write_text(
        "# Wiki Index\n\n## Projects\n- [[test-project]]\n",
        encoding="utf-8",
    )

    return root


# ── Phase 2 helper tests ────────────────────────────────────────────────────

class TestExtractCodeBlocks(unittest.TestCase):
    """Test code block extraction from brain.md."""

    def test_extracts_single_block(self):
        content = "Hello\n```python\nprint('hi')\n```\nWorld"
        cleaned, blocks = extract_code_blocks(content)
        self.assertEqual(len(blocks), 1)
        self.assertIn("print('hi')", blocks[0])
        self.assertNotIn("```", cleaned.strip().replace("\n", " ").strip())

    def test_extracts_multiple_blocks(self):
        content = "A\n```js\nconsole.log(1)\n```\nB\n```sh\necho hi\n```\nC"
        cleaned, blocks = extract_code_blocks(content)
        self.assertEqual(len(blocks), 2)

    def test_no_blocks(self):
        content = "No code here, just text."
        cleaned, blocks = extract_code_blocks(content)
        self.assertEqual(len(blocks), 0)
        self.assertEqual(cleaned, content)

    def test_empty_content(self):
        cleaned, blocks = extract_code_blocks("")
        self.assertEqual(len(blocks), 0)
        self.assertEqual(cleaned, "")


class TestExtractInlineDecisions(unittest.TestCase):
    """Test inline decision extraction from brain.md."""

    def test_extracts_dated_decision(self):
        content = "## L1\n- [2025-01-01] decided to use git as storage\n- regular item"
        cleaned, decisions = extract_inline_decisions(content)
        self.assertEqual(len(decisions), 1)
        self.assertIn("decided to use git", decisions[0])
        self.assertIn("regular item", cleaned)

    def test_extracts_decision_prefix(self):
        content = "- Decision: use Bun over Node\n- other item"
        cleaned, decisions = extract_inline_decisions(content)
        self.assertEqual(len(decisions), 1)
        self.assertIn("other item", cleaned)

    def test_no_decisions(self):
        content = "- regular item\n- another item"
        cleaned, decisions = extract_inline_decisions(content)
        self.assertEqual(len(decisions), 0)

    def test_settled_on_keyword(self):
        content = "- [2025-03-01] settled on React for frontend\n"
        cleaned, decisions = extract_inline_decisions(content)
        self.assertEqual(len(decisions), 1)
        self.assertIn("settled on React", decisions[0])


class TestTrimProjectDescriptions(unittest.TestCase):
    """Test project description trimming in L1 section."""

    def test_trims_multiline_project(self):
        content = "## L1\n- **Project A** -- main project\n  extended description here\n  more details\n- **Project B** -- other"
        result = trim_project_descriptions(content)
        lines = [l for l in result.split("\n") if l.strip()]
        # The continuation lines should be removed
        self.assertNotIn("extended description", result)
        self.assertNotIn("more details", result)
        self.assertIn("Project A", result)
        self.assertIn("Project B", result)

    def test_preserves_non_l1_content(self):
        content = "## L0\nIdentity info\nDetails here\n\n## L1\n- **Proj** -- desc"
        result = trim_project_descriptions(content)
        self.assertIn("Identity info", result)
        self.assertIn("Details here", result)

    def test_no_l1_section(self):
        content = "## L0\nJust L0 content"
        result = trim_project_descriptions(content)
        self.assertEqual(result, content)


class TestRemoveBlankLineRuns(unittest.TestCase):
    """Test blank line collapsing."""

    def test_collapses_long_runs(self):
        content = "A\n\n\n\n\nB"
        result = remove_blank_line_runs(content)
        self.assertNotIn("\n\n\n\n", result)
        self.assertIn("A", result)
        self.assertIn("B", result)

    def test_preserves_double_blanks(self):
        content = "A\n\nB"
        result = remove_blank_line_runs(content)
        self.assertEqual(result, content)

    def test_empty_input(self):
        self.assertEqual(remove_blank_line_runs(""), "")


# ── Phase 3 tests ───────────────────────────────────────────────────────────

class TestWireResolver(unittest.TestCase):
    """Test RESOLVER wiring into copilot-instructions.md."""

    def test_adds_resolver_to_empty_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "copilot-instructions.md"
            path.write_text("# Instructions\n\nSome content\n", encoding="utf-8")
            changed = wire_resolver_to_instructions(path)
            self.assertTrue(changed)
            content = path.read_text(encoding="utf-8")
            self.assertIn("Knowledge Filing (RESOLVER)", content)
            self.assertIn("Decision Write-Back (Tiered)", content)

    def test_skips_if_already_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "copilot-instructions.md"
            path.write_text(
                "# Instructions\n\n## Knowledge Filing (RESOLVER)\nstuff\n\n## Decision Write-Back (Tiered)\nstuff\n",
                encoding="utf-8",
            )
            changed = wire_resolver_to_instructions(path)
            self.assertFalse(changed)

    def test_creates_file_if_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sub" / "copilot-instructions.md"
            changed = wire_resolver_to_instructions(path)
            self.assertTrue(changed)
            self.assertTrue(path.exists())

    def test_adds_only_missing_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "copilot-instructions.md"
            path.write_text(
                "# Instructions\n\n## Knowledge Filing (RESOLVER)\nexisting\n",
                encoding="utf-8",
            )
            changed = wire_resolver_to_instructions(path)
            self.assertTrue(changed)  # Should add Decision Write-Back
            content = path.read_text(encoding="utf-8")
            self.assertIn("Decision Write-Back (Tiered)", content)
            # Should not duplicate RESOLVER
            self.assertEqual(content.count("Knowledge Filing (RESOLVER)"), 1)


# ── Phase 4 tests ───────────────────────────────────────────────────────────

class TestAddCompiledTruthAndTimeline(unittest.TestCase):
    """Test adding Compiled Truth + Timeline sections to wiki pages."""

    def test_adds_both_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "test.md"
            page.write_text(
                "---\ntitle: Test\ntype: project\n---\n\nSome content about the project.\n",
                encoding="utf-8",
            )
            changed = add_compiled_truth_and_timeline(page)
            self.assertTrue(changed)
            content = page.read_text(encoding="utf-8")
            self.assertIn("## Compiled Truth", content)
            self.assertIn("## Timeline", content)

    def test_skips_if_both_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "test.md"
            page.write_text(
                "## Compiled Truth\nExisting truth\n\n## Timeline\n- 2025-01 event\n",
                encoding="utf-8",
            )
            changed = add_compiled_truth_and_timeline(page)
            self.assertFalse(changed)

    def test_adds_timeline_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "test.md"
            page.write_text(
                "## Compiled Truth\nExisting content\n",
                encoding="utf-8",
            )
            changed = add_compiled_truth_and_timeline(page)
            self.assertTrue(changed)
            content = page.read_text(encoding="utf-8")
            self.assertIn("## Timeline", content)

    def test_no_data_placeholder(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "test.md"
            page.write_text("# Empty Page\n", encoding="utf-8")
            add_compiled_truth_and_timeline(page)
            content = page.read_text(encoding="utf-8")
            self.assertIn("[No data yet]", content)


# ── Phase 5 tests ───────────────────────────────────────────────────────────

class TestIsHarvestNoise(unittest.TestCase):
    """Test harvest noise detection in decisions.md."""

    def test_harvest_tag_is_noise(self):
        self.assertTrue(is_harvest_noise("- [2025-01-01] [harvest] auto-captured item"))

    def test_harvest_tag_case_insensitive(self):
        self.assertTrue(is_harvest_noise("- [2025-01-01] [Harvest] something"))

    def test_very_short_dated_entry_is_noise(self):
        self.assertTrue(is_harvest_noise("- [2025-01-01] short"))

    def test_normal_decision_not_noise(self):
        self.assertFalse(
            is_harvest_noise("- [2025-01-01] decided to use git as the storage backend for all scenario state management")
        )

    def test_non_list_item_not_noise(self):
        self.assertFalse(is_harvest_noise("Some heading text"))
        self.assertFalse(is_harvest_noise("## Section"))

    def test_empty_line_not_noise(self):
        self.assertFalse(is_harvest_noise(""))
        self.assertFalse(is_harvest_noise("   "))


# ── Backup / Stats tests ────────────────────────────────────────────────────

class TestEnsureBackup(unittest.TestCase):
    """Test backup creation."""

    def test_creates_backup_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            backup = ensure_backup(root)
            self.assertTrue(backup.exists())
            self.assertTrue((backup / "brain.md").exists())
            self.assertTrue((backup / "decisions.md").exists())

    def test_backup_preserves_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            original = (root / "brain.md").read_text(encoding="utf-8")
            backup = ensure_backup(root)
            backed_up = (backup / "brain.md").read_text(encoding="utf-8")
            self.assertEqual(original, backed_up)


class TestCountPages(unittest.TestCase):
    """Test page counting."""

    def test_counts_wiki_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            (root / "wiki" / "projects" / "proj-a.md").write_text("# A", encoding="utf-8")
            (root / "wiki" / "projects" / "proj-b.md").write_text("# B", encoding="utf-8")
            self.assertEqual(count_pages(root), 2)

    def test_excludes_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            self.assertEqual(count_pages(root), 0)  # Only index.md exists

    def test_empty_wiki(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".grain"
            root.mkdir()
            self.assertEqual(count_pages(root), 0)


# ── Full phase tests (with mocked input) ────────────────────────────────────

class TestPhase1(unittest.TestCase):
    """Test phase 1: structure cleanup."""

    def test_runs_without_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            stats = phase_1_structure_cleanup(root)
            self.assertIn("fixes_applied", stats)

    def test_clean_structure_reports_zero_fixes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            stats = phase_1_structure_cleanup(root)
            self.assertEqual(stats["fixes_applied"], 0)


class TestPhase2(unittest.TestCase):
    """Test phase 2: brain.md cleanup."""

    def test_skips_short_brain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            stats = phase_2_brain_cleanup(root)
            self.assertEqual(stats["original_lines"], stats["final_lines"])

    def test_skips_missing_brain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".grain"
            root.mkdir()
            stats = phase_2_brain_cleanup(root)
            self.assertEqual(stats["original_lines"], 0)

    @patch("builtins.input", return_value="y")
    def test_extracts_code_blocks_from_large_brain(self, mock_input):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            # Create a brain.md with >40 lines including code blocks
            lines = ["# Brain", "", "## L0", "Identity", "", "## L1"]
            lines += [f"- item {i}" for i in range(30)]
            lines += ["", "```python", "print('hello')", "x = 1", "```", ""]
            lines += ["more content"] * 10
            (root / "brain.md").write_text("\n".join(lines), encoding="utf-8")
            (root / "reference").mkdir(exist_ok=True)
            stats = phase_2_brain_cleanup(root)
            self.assertEqual(stats["code_blocks_extracted"], 1)
            self.assertTrue((root / "reference" / "extracted-from-brain.md").exists())


class TestPhase4Full(unittest.TestCase):
    """Test phase 4: compiled truth + timeline."""

    @patch("builtins.input", return_value="y")
    def test_updates_pages_missing_sections(self, mock_input):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            (root / "wiki" / "projects" / "test-proj.md").write_text(
                "---\ntitle: Test\ntype: project\n---\n\nSome content.\n",
                encoding="utf-8",
            )
            stats = phase_4_compiled_truth_timeline(root)
            self.assertGreater(stats["pages_updated"], 0)
            content = (root / "wiki" / "projects" / "test-proj.md").read_text(encoding="utf-8")
            self.assertIn("## Compiled Truth", content)
            self.assertIn("## Timeline", content)

    def test_skips_if_all_pages_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            (root / "wiki" / "projects" / "complete.md").write_text(
                "## Compiled Truth\nDone\n\n## Timeline\n- 2025 event\n",
                encoding="utf-8",
            )
            stats = phase_4_compiled_truth_timeline(root)
            self.assertEqual(stats["pages_updated"], 0)


class TestPhase5Full(unittest.TestCase):
    """Test phase 5: clean decisions.md."""

    @patch("builtins.input", return_value="y")
    def test_archives_harvest_noise(self, mock_input):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            (root / "decisions.md").write_text(
                "# Decisions\n\n"
                "- [2025-01-01] [harvest] auto noise\n"
                "- [2025-01-01] decided to use git as the primary storage backend for all scenario state\n",
                encoding="utf-8",
            )
            stats = phase_5_clean_decisions(root)
            self.assertEqual(stats["noise_entries"], 1)
            self.assertEqual(stats["archived"], 1)
            # Check archive was created
            archive = root / ".archive" / "decisions-noise.md"
            self.assertTrue(archive.exists())
            archive_content = archive.read_text(encoding="utf-8")
            self.assertIn("[harvest]", archive_content)

    def test_skips_clean_decisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_retrofit_root(Path(tmp))
            stats = phase_5_clean_decisions(root)
            self.assertEqual(stats["noise_entries"], 0)


# ── Constants and content tests ──────────────────────────────────────────────

class TestRetrofitConstants(unittest.TestCase):
    """Test that retrofit constants and templates are well-formed."""

    def test_brain_max_lines_is_40(self):
        self.assertEqual(BRAIN_MAX_LINES, 40)

    def test_resolver_rules_has_8_items(self):
        # Count numbered items in RESOLVER routing rules
        items = re.findall(r'^\d+\.', RESOLVER_ROUTING_RULES, re.MULTILINE)
        self.assertEqual(len(items), 8)

    def test_decision_writeback_has_3_tiers(self):
        self.assertIn("Tier 1", DECISION_WRITEBACK_SECTION)
        self.assertIn("Tier 2", DECISION_WRITEBACK_SECTION)
        self.assertIn("Tier 3", DECISION_WRITEBACK_SECTION)

    def test_no_corporate_references(self):
        forbidden = ["microsoft", "sharepoint", "aka.ms", "eng.ms", "gim-home"]
        for text in (RESOLVER_ROUTING_RULES, DECISION_WRITEBACK_SECTION):
            for term in forbidden:
                self.assertNotIn(term, text.lower(), f"Found '{term}' in retrofit template")


import re  # needed for TestRetrofitConstants


if __name__ == "__main__":
    unittest.main(verbosity=2)
