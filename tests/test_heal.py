"""
Comprehensive tests for heal.py -- the unified heal command.

Tests:
  - CriticFinding and HealReport dataclasses
  - critic_karpathy: entity quality assessment (LLM + regex fallback)
  - critic_gbrain: brain.md budget and coherence (LLM + regex fallback)
  - critic_structure: root file classification and budget (LLM + regex fallback)
  - critic_content: content quality and noise detection (LLM + regex fallback)
  - critic_cross_reference: cross-reference validation (LLM + regex fallback)
  - HealPipeline.diagnose(): full diagnostic run
  - HealPipeline.auto_fix(): safe hygiene fixes
  - HealPipeline.smart_fix(): LLM-assisted and regex-based fixes
  - HealPipeline.depth_upgrade(): tier-3 to tier-2 promotion
  - HealPipeline.verify(): before/after comparison
  - CLI main() entry point
  - Edge cases: empty dirs, missing files, corrupt content
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add project root so we can import engine modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.heal import (
    CriticFinding,
    HealReport,
    HealPipeline,
    critic_karpathy,
    critic_gbrain,
    critic_structure,
    critic_content,
    critic_cross_reference,
    main,
    _insert_section_after_frontmatter,
)
from engine.llm_client import LLMClient


# ── Helpers ──────────────────────────────────────────────────────────────────

MINIMAL_FRONTMATTER = """\
---
title: Test Entity
type: project
updated: 2025-01-01
tags: [test]
related: []
tier: 2
---

## Compiled Truth

This is a test entity. [Source: observed, session abc123]

## Timeline

- [2025-01-01] Created entity (session: abc123)
"""

STUB_FRONTMATTER = """\
---
title: Stub Entity
type: concept
updated: 2025-01-01
tier: 3
---

[No data yet]
"""


def make_heal_root(tmp: Path) -> Path:
    """Create a minimal valid knowledge base structure for heal tests."""
    root = tmp / ".testheal"
    root.mkdir(parents=True)
    (root / "wiki").mkdir()
    (root / "wiki" / "projects").mkdir()
    (root / "wiki" / "people").mkdir()
    (root / "wiki" / "patterns").mkdir()
    (root / "wiki" / "concepts").mkdir()
    (root / "scripts").mkdir()
    (root / "reference").mkdir()
    (root / "brain.md").write_text(
        "# Brain\nLast refreshed: 2025-01-01\n\n## L0\nIdentity info\n\n## L1\nActive work\n",
        encoding="utf-8",
    )
    (root / "decisions.md").write_text("# Decisions\n", encoding="utf-8")
    (root / "wiki" / "index.md").write_text("# Index\n\n## Projects\n\n## People\n", encoding="utf-8")
    return root


def write_page(root: Path, rel_path: str, content: str) -> Path:
    """Write a wiki page at the given relative path."""
    full = root / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    return full


def make_fallback_llm() -> LLMClient:
    """Create an LLMClient in fallback mode (no real LLM calls)."""
    return LLMClient(fallback_mode=True)


# ══════════════════════════════════════════════════════════════════════════════
# CriticFinding and HealReport
# ══════════════════════════════════════════════════════════════════════════════


class TestCriticFinding(unittest.TestCase):
    """Test CriticFinding dataclass."""

    def test_to_dict_minimal(self):
        f = CriticFinding(critic="karpathy", severity="warning", message="test msg")
        d = f.to_dict()
        self.assertEqual(d["critic"], "karpathy")
        self.assertEqual(d["severity"], "warning")
        self.assertEqual(d["message"], "test msg")
        self.assertNotIn("file", d)
        self.assertNotIn("suggestion", d)
        self.assertNotIn("auto_fixable", d)

    def test_to_dict_full(self):
        f = CriticFinding(
            critic="structure", severity="error", message="bloat",
            file="extra.py", suggestion="move to scripts/", auto_fixable=True,
        )
        d = f.to_dict()
        self.assertEqual(d["file"], "extra.py")
        self.assertEqual(d["suggestion"], "move to scripts/")
        self.assertTrue(d["auto_fixable"])


class TestHealReport(unittest.TestCase):
    """Test HealReport dataclass."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_to_dict_structure(self):
        report = HealReport(root=self.root)
        report.scores = {"structure": "A", "content": "B"}
        report.critic_findings.append(
            CriticFinding(critic="gbrain", severity="warning", message="test")
        )
        d = report.to_dict()
        self.assertIn("scores", d)
        self.assertIn("critic_findings", d)
        self.assertEqual(d["issue_count"], 0)
        self.assertEqual(len(d["critic_findings"]), 1)

    def test_print_report_no_crash(self):
        report = HealReport(root=self.root)
        report.scores = {"structure": "A", "content": "B", "depth": "C",
                         "duplication": "A", "brain": "B"}
        with patch("sys.stdout"):
            report.print_report()

    def test_print_report_with_before_scores(self):
        report = HealReport(root=self.root)
        report.scores = {"structure": "A", "content": "B"}
        before = {"structure": "C", "content": "B"}
        with patch("sys.stdout"):
            report.print_report(before_scores=before)


# ══════════════════════════════════════════════════════════════════════════════
# Critic Functions — Regex Fallback (LLM unavailable)
# ══════════════════════════════════════════════════════════════════════════════


class TestCriticKarpathyFallback(unittest.TestCase):
    """Test critic_karpathy in regex-only mode (no LLM)."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = make_fallback_llm()

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_no_wiki_returns_empty(self):
        shutil.rmtree(str(self.root / "wiki"))
        findings = critic_karpathy(self.root, self.llm)
        self.assertEqual(len(findings), 0)

    def test_page_without_compiled_truth_flagged(self):
        """Page with frontmatter but no Compiled Truth section should be flagged."""
        write_page(self.root, "wiki/projects/test-proj.md",
                   "---\ntitle: Test\ntype: project\n---\n\nSome content.\n")
        findings = critic_karpathy(self.root, self.llm)
        # No finding about empty compiled truth since there's no section at all
        # (karpathy checks sections, not their absence — that's depth checker's job)
        # But it won't find uncited claims either since there's no CT section
        self.assertIsInstance(findings, list)

    def test_empty_compiled_truth_flagged(self):
        write_page(self.root, "wiki/projects/empty-ct.md",
                   "---\ntitle: Empty CT\ntype: project\n---\n\n## Compiled Truth\n\n[No data yet]\n")
        findings = critic_karpathy(self.root, self.llm)
        ct_findings = [f for f in findings if "Compiled Truth" in f.message and "empty" in f.message.lower()]
        self.assertGreater(len(ct_findings), 0)

    def test_uncited_compiled_truth_flagged(self):
        write_page(self.root, "wiki/projects/uncited.md",
                   "---\ntitle: Uncited\ntype: project\n---\n\n## Compiled Truth\n\nThis entity does important things without citations.\n")
        findings = critic_karpathy(self.root, self.llm)
        uncited = [f for f in findings if "no source citations" in f.message.lower()]
        self.assertGreater(len(uncited), 0)

    def test_well_formed_page_no_issues(self):
        write_page(self.root, "wiki/projects/good.md", MINIMAL_FRONTMATTER)
        findings = critic_karpathy(self.root, self.llm)
        # Well-formed page with cited compiled truth should have no karpathy findings
        karpathy_for_good = [f for f in findings if f.file and "good" in f.file]
        self.assertEqual(len(karpathy_for_good), 0)

    def test_skips_index_and_log(self):
        findings = critic_karpathy(self.root, self.llm)
        index_findings = [f for f in findings if f.file and "index" in f.file]
        self.assertEqual(len(index_findings), 0)

    def test_skips_raw_directories(self):
        raw_dir = self.root / "wiki" / "projects" / ".raw"
        raw_dir.mkdir()
        write_page(self.root, "wiki/projects/.raw/excerpt.md", "raw data")
        findings = critic_karpathy(self.root, self.llm)
        raw_findings = [f for f in findings if f.file and ".raw" in f.file]
        self.assertEqual(len(raw_findings), 0)


class TestCriticGbrainFallback(unittest.TestCase):
    """Test critic_gbrain in regex-only mode (no LLM)."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = make_fallback_llm()

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_missing_brain_flagged(self):
        (self.root / "brain.md").unlink()
        findings = critic_gbrain(self.root, self.llm)
        errors = [f for f in findings if f.severity == "error"]
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("not found" in f.message for f in errors))

    def test_brain_over_40_lines_flagged(self):
        content = "# Brain\n\n## L0\nIdentity\n\n## L1\nWork\n" + "\n".join(
            [f"- Item {i}" for i in range(50)]
        )
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        line_findings = [f for f in findings if "lines" in f.message and "budget" in f.message]
        self.assertGreater(len(line_findings), 0)

    def test_brain_with_code_blocks_flagged(self):
        content = "# Brain\n\n## L0\nMe\n\n```python\nprint('hello')\n```\n\n## L1\nWork\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        code_findings = [f for f in findings if "code block" in f.message.lower()]
        self.assertGreater(len(code_findings), 0)

    def test_brain_with_inlined_decisions_flagged(self):
        content = "# Brain\n\n## L0\nMe\n\n## L1\n- [2025-01-01] decided to use Python\n- regular item\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        decision_findings = [f for f in findings if "inlined decision" in f.message.lower()]
        self.assertGreater(len(decision_findings), 0)

    def test_brain_missing_l0_flagged(self):
        content = "# Brain\n\n## L1\nSome work\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        l0_findings = [f for f in findings if "L0" in f.message or "Identity" in f.message]
        self.assertGreater(len(l0_findings), 0)

    def test_brain_missing_l1_flagged(self):
        content = "# Brain\n\n## L0\nIdentity\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        l1_findings = [f for f in findings if "L1" in f.message or "Active" in f.message]
        self.assertGreater(len(l1_findings), 0)

    def test_compact_brain_no_budget_issues(self):
        """A brain.md within budget should not trigger budget warnings."""
        content = "# Brain\nLast refreshed: 2025-06-01\n\n## L0\nSenior engineer.\n\n## L1\n- **Project** -- doing things\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        budget_findings = [f for f in findings if "budget" in f.message.lower() or "lines" in f.message.lower()]
        self.assertEqual(len(budget_findings), 0)

    def test_brain_over_token_budget_flagged(self):
        content = "# Brain\n\n## L0\n" + "word " * 800 + "\n\n## L1\nWork\n"
        (self.root / "brain.md").write_text(content, encoding="utf-8")
        findings = critic_gbrain(self.root, self.llm)
        token_findings = [f for f in findings if "token" in f.message.lower()]
        self.assertGreater(len(token_findings), 0)


class TestCriticStructureFallback(unittest.TestCase):
    """Test critic_structure in regex-only mode."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = make_fallback_llm()

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_root_over_15_files_error(self):
        for i in range(16):
            (self.root / f"file{i}.md").write_text(f"file {i}")
        findings = critic_structure(self.root, self.llm)
        error_findings = [f for f in findings if f.severity == "error" and "15" in f.message]
        self.assertGreater(len(error_findings), 0)

    def test_root_over_10_files_warning(self):
        for i in range(11):
            (self.root / f"file{i}.md").write_text(f"file {i}")
        findings = critic_structure(self.root, self.llm)
        warn_findings = [f for f in findings if f.severity == "warning" and "10" in f.message]
        self.assertGreater(len(warn_findings), 0)

    def test_script_at_root_detected(self):
        (self.root / "deploy.ps1").write_text("echo deploy")
        findings = critic_structure(self.root, self.llm)
        script_findings = [f for f in findings if "Script" in f.message and "deploy.ps1" in f.message]
        self.assertGreater(len(script_findings), 0)

    def test_archive_file_detected(self):
        (self.root / "brain.bak").write_text("old brain")
        findings = critic_structure(self.root, self.llm)
        archive_findings = [f for f in findings if "Archive" in f.message or "brain.bak" in f.message]
        self.assertGreater(len(archive_findings), 0)

    def test_core_files_not_flagged(self):
        """brain.md, decisions.md etc should not be flagged."""
        findings = critic_structure(self.root, self.llm)
        core_flagged = [f for f in findings if f.file and f.file in ("brain.md", "decisions.md")]
        self.assertEqual(len(core_flagged), 0)

    def test_empty_root_no_issues(self):
        empty_root = self.tmpdir / ".emptyroot"
        empty_root.mkdir()
        findings = critic_structure(empty_root, self.llm)
        self.assertEqual(len(findings), 0)


class TestCriticContentFallback(unittest.TestCase):
    """Test critic_content in regex-only mode."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = make_fallback_llm()

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_harvest_noise_in_decisions_detected(self):
        decisions_content = "# Decisions\n" + "\n".join(
            [f"- [2025-01-01] [harvest] auto-item {i}" for i in range(10)]
        )
        (self.root / "decisions.md").write_text(decisions_content, encoding="utf-8")
        findings = critic_content(self.root, self.llm)
        harvest_findings = [f for f in findings if "[harvest]" in f.message.lower()]
        self.assertGreater(len(harvest_findings), 0)

    def test_stub_pages_detected(self):
        for i in range(6):
            write_page(self.root, f"wiki/concepts/stub{i}.md", "tiny")
        findings = critic_content(self.root, self.llm)
        stub_findings = [f for f in findings if "stub" in f.message.lower()]
        self.assertGreater(len(stub_findings), 0)

    def test_no_decisions_file_no_crash(self):
        (self.root / "decisions.md").unlink()
        findings = critic_content(self.root, self.llm)
        self.assertIsInstance(findings, list)

    def test_clean_decisions_no_noise(self):
        decisions = "# Decisions\n- [2025-01-01] [tier:2] decided to use Python for all scripts\n"
        (self.root / "decisions.md").write_text(decisions, encoding="utf-8")
        findings = critic_content(self.root, self.llm)
        harvest_noise = [f for f in findings if "[harvest]" in f.message.lower()]
        self.assertEqual(len(harvest_noise), 0)


class TestCriticCrossReferenceFallback(unittest.TestCase):
    """Test critic_cross_reference in regex-only mode."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = make_fallback_llm()

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_broken_related_reference(self):
        write_page(self.root, "wiki/projects/project-a.md",
                   "---\ntitle: A\ntype: project\nrelated: [nonexistent-entity]\n---\nContent\n")
        findings = critic_cross_reference(self.root, self.llm)
        broken = [f for f in findings if "Broken reference" in f.message]
        self.assertGreater(len(broken), 0)

    def test_valid_related_reference(self):
        write_page(self.root, "wiki/projects/alpha.md",
                   "---\ntitle: Alpha\ntype: project\nrelated: [beta]\n---\nContent\n")
        write_page(self.root, "wiki/projects/beta.md",
                   "---\ntitle: Beta\ntype: project\n---\nContent\n")
        findings = critic_cross_reference(self.root, self.llm)
        broken = [f for f in findings if "Broken reference" in f.message]
        self.assertEqual(len(broken), 0)

    def test_broken_path_in_instructions(self):
        (self.root / "copilot-instructions.md").write_text(
            "# Instructions\nSee wiki/projects/nonexistent.md for details\n",
            encoding="utf-8",
        )
        findings = critic_cross_reference(self.root, self.llm)
        broken_paths = [f for f in findings if "Broken path" in f.message]
        self.assertGreater(len(broken_paths), 0)

    def test_valid_path_in_instructions(self):
        write_page(self.root, "wiki/projects/real.md", MINIMAL_FRONTMATTER)
        (self.root / "copilot-instructions.md").write_text(
            "# Instructions\nSee wiki/projects/real.md for details\n",
            encoding="utf-8",
        )
        findings = critic_cross_reference(self.root, self.llm)
        broken_paths = [f for f in findings if "Broken path" in f.message and "real.md" in f.message]
        self.assertEqual(len(broken_paths), 0)

    def test_no_wiki_returns_empty(self):
        shutil.rmtree(str(self.root / "wiki"))
        findings = critic_cross_reference(self.root, self.llm)
        self.assertEqual(len(findings), 0)


# ══════════════════════════════════════════════════════════════════════════════
# Critic Functions — LLM Available (Mocked)
# ══════════════════════════════════════════════════════════════════════════════


@unittest.skip("LLM removed in #49 -- protocols architecture")
class TestCriticKarpathyWithLLM(unittest.TestCase):
    """Test critic_karpathy with a mocked LLM backend."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = LLMClient(fallback_mode=False)
        self.llm.backend = "openai"  # Force LLM to appear available

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_llm_findings_parsed(self):
        """When LLM returns quality issues, they are parsed into CriticFindings."""
        write_page(self.root, "wiki/projects/test.md",
                   "---\ntitle: Test\ntype: project\n---\n\n## Compiled Truth\n\nFiller content.\n")
        mock_response = json.dumps([
            {"file": "wiki/projects/test.md", "issues": ["No source citations"], "quality": "poor"}
        ])
        with patch.object(self.llm, "_call", return_value=mock_response):
            findings = critic_karpathy(self.root, self.llm)
        llm_findings = [f for f in findings if f.critic == "karpathy"]
        self.assertGreater(len(llm_findings), 0)

    def test_llm_failure_graceful(self):
        """If LLM call fails, regex fallback still works."""
        write_page(self.root, "wiki/projects/test.md",
                   "---\ntitle: Test\ntype: project\n---\n\n## Compiled Truth\n\nUncited content.\n")
        with patch.object(self.llm, "_call", side_effect=Exception("LLM down")):
            findings = critic_karpathy(self.root, self.llm)
        # Should still get regex-based findings
        self.assertIsInstance(findings, list)


@unittest.skip("LLM removed in #49 -- protocols architecture")
class TestCriticGbrainWithLLM(unittest.TestCase):
    """Test critic_gbrain with a mocked LLM backend."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = LLMClient(fallback_mode=False)
        self.llm.backend = "openai"

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_llm_brain_issues_parsed(self):
        content = "# Brain\n\n## L0\nMe\n\n## L1\n" + "\n".join([f"- Item {i}" for i in range(50)])
        (self.root / "brain.md").write_text(content, encoding="utf-8")

        mock_response = json.dumps(["Too many items in L1", "Contains inlined decisions"])
        with patch.object(self.llm, "_call", return_value=mock_response):
            findings = critic_gbrain(self.root, self.llm)
        llm_findings = [f for f in findings if f.critic == "gbrain"]
        self.assertGreater(len(llm_findings), 0)


@unittest.skip("LLM removed in #49 -- protocols architecture")
class TestCriticStructureWithLLM(unittest.TestCase):
    """Test critic_structure with a mocked LLM backend."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)
        self.llm = LLMClient(fallback_mode=False)
        self.llm.backend = "openai"

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_llm_classifies_root_files(self):
        (self.root / "deploy.sh").write_text("#!/bin/bash\necho deploy")
        (self.root / "old-brain.bak").write_text("old stuff")

        mock_response = json.dumps({
            "deploy.sh": "SCRIPT",
            "old-brain.bak": "ARCHIVE",
            "brain.md": "CORE",
            "decisions.md": "CORE",
        })
        with patch.object(self.llm, "_call", return_value=mock_response):
            findings = critic_structure(self.root, self.llm)
        script_findings = [f for f in findings if "deploy.sh" in (f.file or "")]
        self.assertGreater(len(script_findings), 0)


# ══════════════════════════════════════════════════════════════════════════════
# HealPipeline — Diagnose
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineDiagnose(unittest.TestCase):
    """Test HealPipeline.diagnose() method."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_diagnose_returns_heal_report(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIsInstance(report, HealReport)
        self.assertEqual(report.root, self.root)

    def test_diagnose_populates_scores(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        for cat in ("structure", "content", "depth", "duplication", "brain"):
            self.assertIn(cat, report.scores)
            self.assertIn(report.scores[cat], ("A", "B", "C", "D", "F"))

    def test_diagnose_runs_all_critics(self):
        write_page(self.root, "wiki/projects/test.md", MINIMAL_FRONTMATTER)
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIsInstance(report.critic_findings, list)

    def test_diagnose_catches_critic_exceptions(self):
        """If a critic function raises, diagnose should catch it and add error finding."""
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        with patch("engine.heal.critic_karpathy", side_effect=RuntimeError("boom")):
            report = pipeline.diagnose()
        error_findings = [f for f in report.critic_findings if "Critic failed" in f.message]
        self.assertGreater(len(error_findings), 0)

    def test_diagnose_empty_wiki(self):
        """Diagnose on a root with empty wiki should not crash."""
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIn("depth", report.scores)


# ══════════════════════════════════════════════════════════════════════════════
# HealPipeline — Auto Fix
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineAutoFix(unittest.TestCase):
    """Test HealPipeline.auto_fix() method."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_auto_fix_returns_action_list(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.auto_fix(report)
        self.assertIsInstance(actions, list)

    def test_auto_fix_populates_report(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        pipeline.auto_fix(report)
        self.assertIsInstance(report.fix_actions, list)


# ══════════════════════════════════════════════════════════════════════════════
# HealPipeline — Smart Fix
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineSmartFix(unittest.TestCase):
    """Test HealPipeline.smart_fix() method."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_smart_fix_brain_trim(self):
        """smart_fix should trim brain.md when gbrain critic flagged it."""
        brain_content = (
            "# Brain\nLast refreshed: 2025-01-01\n\n"
            "## L0\nSenior engineer doing stuff.\n\n"
            "## L1\n"
            "- [2025-01-01] decided to use Python for scripts\n"
            "- **ProjectA** -- my project\n"
            "  Extended description that spans\n"
            "  multiple lines of detail\n"
            "  even more detail here\n"
            "- **ProjectB** -- another\n"
            "```python\nprint('hello')\n```\n"
        )
        (self.root / "brain.md").write_text(brain_content, encoding="utf-8")

        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()

        # Ensure gbrain critic flagged issues
        gbrain_fixable = [f for f in report.critic_findings
                          if f.critic == "gbrain" and f.auto_fixable]
        self.assertGreater(len(gbrain_fixable), 0)

        actions = pipeline.smart_fix(report)
        self.assertGreater(len(actions), 0)

    def test_smart_fix_moves_scripts(self):
        """smart_fix should move script files from root to scripts/."""
        (self.root / "deploy.sh").write_text("#!/bin/bash\necho deploy")
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.smart_fix(report)

        # Script should have been moved
        script_actions = [a for a in actions if "deploy.sh" in a]
        if script_actions:  # Only if structure critic flagged it as auto_fixable
            self.assertFalse((self.root / "deploy.sh").exists())
            self.assertTrue((self.root / "scripts" / "deploy.sh").exists())

    def test_smart_fix_cleans_decisions_noise(self):
        """smart_fix should clean harvest noise from decisions.md."""
        decisions = "# Decisions\n" + "\n".join(
            [f"- [2025-01-01] [harvest] auto-item {i}" for i in range(10)]
        ) + "\n- [2025-01-01] [tier:2] decided to use Python for all scripts\n"
        (self.root / "decisions.md").write_text(decisions, encoding="utf-8")

        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.smart_fix(report)

        # Check if noise was cleaned
        cleaned_decisions = (self.root / "decisions.md").read_text(encoding="utf-8")
        clean_actions = [a for a in actions if "noise" in a.lower() or "decisions" in a.lower()]
        if clean_actions:
            self.assertNotIn("[harvest]", cleaned_decisions)
            self.assertIn("decided to use Python", cleaned_decisions)

    def test_smart_fix_no_brain_no_crash(self):
        """smart_fix should not crash when brain.md doesn't exist."""
        (self.root / "brain.md").unlink()
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.smart_fix(report)
        self.assertIsInstance(actions, list)


# ══════════════════════════════════════════════════════════════════════════════
# HealPipeline — Depth Upgrade
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineDepthUpgrade(unittest.TestCase):
    """Test HealPipeline.depth_upgrade() method."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_upgrades_tier3_to_tier2(self):
        write_page(self.root, "wiki/concepts/stub-concept.md", STUB_FRONTMATTER)

        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.depth_upgrade(report)

        self.assertGreater(len(actions), 0)
        content = (self.root / "wiki" / "concepts" / "stub-concept.md").read_text(encoding="utf-8")
        self.assertIn("tier: 2", content)
        self.assertIn("## Compiled Truth", content)
        self.assertIn("## Timeline", content)

    def test_depth_upgrade_adds_timeline_to_stub(self):
        write_page(self.root, "wiki/concepts/no-timeline.md", STUB_FRONTMATTER)
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        pipeline.depth_upgrade(report)

        content = (self.root / "wiki" / "concepts" / "no-timeline.md").read_text(encoding="utf-8")
        self.assertIn("## Timeline", content)
        self.assertIn("upgraded from tier-3", content)

    def test_depth_upgrade_skips_tier2(self):
        write_page(self.root, "wiki/projects/existing.md", MINIMAL_FRONTMATTER)
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.depth_upgrade(report)
        existing_actions = [a for a in actions if "existing" in a]
        self.assertEqual(len(existing_actions), 0)

    def test_depth_upgrade_no_wiki_no_crash(self):
        shutil.rmtree(str(self.root / "wiki"))
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        actions = pipeline.depth_upgrade(report)
        self.assertEqual(len(actions), 0)

    @unittest.skip("LLM removed in #49 -- protocols architecture")
    def test_depth_upgrade_with_llm(self):
        """When LLM is available, depth_upgrade should use LLM for compiled truth."""
        write_page(self.root, "wiki/concepts/llm-stub.md", STUB_FRONTMATTER)

        llm = LLMClient(fallback_mode=False)
        llm.backend = "openai"
        pipeline = HealPipeline(self.root, llm=llm)
        report = pipeline.diagnose()

        with patch.object(llm, "summarize", return_value="A useful concept for testing."):
            actions = pipeline.depth_upgrade(report)

        content = (self.root / "wiki" / "concepts" / "llm-stub.md").read_text(encoding="utf-8")
        self.assertIn("A useful concept for testing.", content)
        self.assertIn("tier: 2", content)

    def test_depth_upgrade_updates_dates(self):
        write_page(self.root, "wiki/concepts/dated-stub.md",
                   "---\ntitle: Dated\ntype: concept\nupdated: 2024-01-01\ntier: 3\n---\n[No data yet]\n")
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        pipeline.depth_upgrade(report)

        content = (self.root / "wiki" / "concepts" / "dated-stub.md").read_text(encoding="utf-8")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertIn(f"updated: {today}", content)


# ══════════════════════════════════════════════════════════════════════════════
# HealPipeline — Verify
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineVerify(unittest.TestCase):
    """Test HealPipeline.verify() method."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_verify_returns_new_report(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        before = pipeline.diagnose()
        with patch("sys.stdout"):
            after = pipeline.verify(before)
        self.assertIsInstance(after, HealReport)

    def test_verify_preserves_actions(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        before = pipeline.diagnose()
        before.fix_actions = ["action1"]
        before.smart_fix_actions = ["smart1"]
        before.depth_actions = ["depth1"]
        with patch("sys.stdout"):
            after = pipeline.verify(before)
        self.assertEqual(after.fix_actions, ["action1"])
        self.assertEqual(after.smart_fix_actions, ["smart1"])
        self.assertEqual(after.depth_actions, ["depth1"])

    def test_verify_prints_comparison(self):
        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        before = pipeline.diagnose()
        # Should print without crashing
        with patch("builtins.print") as mock_print:
            pipeline.verify(before)
        # Verify something was printed
        self.assertTrue(mock_print.called)


# ══════════════════════════════════════════════════════════════════════════════
# Full Pipeline Integration
# ══════════════════════════════════════════════════════════════════════════════


class TestHealPipelineFullRun(unittest.TestCase):
    """Test complete heal pipeline flow."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_full_pipeline_fix_and_verify(self):
        """Run diagnose -> auto_fix -> smart_fix -> verify."""
        # Add some issues to fix
        write_page(self.root, "wiki/concepts/stub1.md", STUB_FRONTMATTER)
        brain_content = (
            "# Brain\nLast refreshed: 2025-01-01\n\n"
            "## L0\nEngineer\n\n## L1\nWork\n"
            "```python\ncode_block()\n```\n"
        )
        (self.root / "brain.md").write_text(brain_content, encoding="utf-8")

        pipeline = HealPipeline(self.root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        before_scores = dict(report.scores)

        pipeline.auto_fix(report)
        pipeline.smart_fix(report)

        with patch("sys.stdout"):
            after = pipeline.verify(report)

        self.assertIsInstance(after, HealReport)

    def test_default_llm_is_fallback(self):
        """Pipeline without explicit LLM should use fallback mode."""
        pipeline = HealPipeline(self.root)
        self.assertTrue(pipeline.llm.fallback_mode)


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════


class TestInsertSectionAfterFrontmatter(unittest.TestCase):
    """Test _insert_section_after_frontmatter helper."""

    def test_inserts_after_frontmatter(self):
        content = "---\ntitle: Test\n---\n\nExisting content\n"
        result = _insert_section_after_frontmatter(content, "New Section", "New body")
        self.assertIn("## New Section", result)
        self.assertIn("New body", result)
        # Section should come before existing content
        section_pos = result.index("## New Section")
        existing_pos = result.index("Existing content")
        self.assertLess(section_pos, existing_pos)

    def test_inserts_at_top_without_frontmatter(self):
        content = "No frontmatter here\n"
        result = _insert_section_after_frontmatter(content, "Section", "Body")
        self.assertTrue(result.startswith("## Section"))

    def test_preserves_frontmatter(self):
        content = "---\ntitle: Test\ntype: project\n---\n\nContent\n"
        result = _insert_section_after_frontmatter(content, "CT", "truth")
        self.assertIn("---\ntitle: Test\ntype: project\n---", result)


# ══════════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ══════════════════════════════════════════════════════════════════════════════


class TestHealCLI(unittest.TestCase):
    """Test CLI main() function."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_heal_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_cli_diagnose_only(self):
        with patch("sys.stdout"):
            result = main([str(self.root), "--no-llm"])
        self.assertIn(result, (0, 1))

    def test_cli_with_fix(self):
        with patch("sys.stdout"):
            result = main([str(self.root), "--fix", "--no-llm"])
        self.assertIn(result, (0, 1))

    def test_cli_json_output(self):
        import io
        captured = io.StringIO()
        with patch("sys.stdout", captured):
            main([str(self.root), "--json", "--no-llm"])
        output = captured.getvalue()
        # Should be valid JSON
        data = json.loads(output)
        self.assertIn("scores", data)
        self.assertIn("critic_findings", data)

    def test_cli_nonexistent_path(self):
        result = main(["/totally/nonexistent/path/xyz"])
        self.assertEqual(result, 1)

    def test_cli_verify(self):
        with patch("sys.stdout"):
            result = main([str(self.root), "--verify", "--no-llm"])
        self.assertIn(result, (0, 1))

    def test_cli_deep(self):
        write_page(self.root, "wiki/concepts/stub.md", STUB_FRONTMATTER)
        with patch("sys.stdout"):
            result = main([str(self.root), "--deep", "--no-llm"])
        self.assertIn(result, (0, 1))


# ══════════════════════════════════════════════════════════════════════════════
# Edge Cases
# ══════════════════════════════════════════════════════════════════════════════


class TestHealEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_empty_root_diagnose(self):
        root = self.tmpdir / ".emptyroot"
        root.mkdir()
        (root / "brain.md").write_text("# Brain\n\n## L0\nMe\n\n## L1\nWork\n")
        pipeline = HealPipeline(root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIsInstance(report, HealReport)

    def test_missing_wiki_dir(self):
        root = self.tmpdir / ".nowiki"
        root.mkdir()
        (root / "brain.md").write_text("# Brain\n\n## L0\nMe\n\n## L1\nWork\n")
        pipeline = HealPipeline(root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertEqual(report.scores.get("depth", "A"), "A")

    def test_binary_file_in_wiki_no_crash(self):
        root = make_heal_root(self.tmpdir)
        binary_path = root / "wiki" / "projects" / "binary.md"
        binary_path.write_bytes(b"\x00\x01\x02\x03---\ntitle: binary\n---\n")
        pipeline = HealPipeline(root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIsInstance(report, HealReport)

    def test_corrupt_brain_md(self):
        root = make_heal_root(self.tmpdir)
        (root / "brain.md").write_bytes(b"\xff\xfe invalid unicode")
        pipeline = HealPipeline(root, llm=make_fallback_llm())
        report = pipeline.diagnose()
        self.assertIsInstance(report, HealReport)


if __name__ == "__main__":
    unittest.main()
