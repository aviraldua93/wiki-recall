"""
Comprehensive tests for hygiene.py -- the brain hygiene checker.

Tests:
  - Structure checks: root bloat, duplicates, empty dirs, orphans, artifacts
  - Content checks: stubs, missing frontmatter, missing last_verified, stale tiers, noise
  - Depth checks: missing timeline, missing compiled truth, thin pages
  - Duplication checks: content overlap (Jaccard), similar names (Levenshtein)
  - Brain health checks: line budget, token budget, code blocks, L0/L1 sections
  - Fix mode: only safe issues, orphan-to-index fix, no destructive changes
  - Depth grading: percentage-based curve
  - Score calculation (A-F grading)
  - JSON output format
  - CLI interface
  - Edge cases: empty dirs, missing wiki, corrupt content
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

# Add project root so we can import engine modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.hygiene import (
    HygieneIssue,
    HygieneReport,
    apply_fixes,
    check_brain_health,
    check_content,
    check_depth,
    check_duplication,
    check_structure,
    compute_depth_grade,
    compute_grade,
    extract_frontmatter_field,
    has_frontmatter,
    has_section,
    jaccard_similarity,
    levenshtein_distance,
    main,
    parse_date_safe,
    section_has_content,
    _determine_index_section,
    _add_orphan_to_index,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def make_wiki_root(tmp: Path) -> Path:
    """Create a minimal valid knowledge base structure."""
    root = tmp / ".testgrain"
    root.mkdir(parents=True)
    (root / "wiki").mkdir()
    (root / "wiki" / "projects").mkdir()
    (root / "wiki" / "people").mkdir()
    (root / "wiki" / "patterns").mkdir()
    (root / "wiki" / "concepts").mkdir()
    (root / "scripts").mkdir()
    (root / "brain.md").write_text("# Brain\nLast refreshed: 2025-01-01\n")
    (root / "decisions.md").write_text("# Decisions\n")
    return root


def write_page(root: Path, rel_path: str, content: str) -> Path:
    """Write a wiki page at the given relative path."""
    full = root / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    return full


def make_index(root: Path, links: list[str]) -> None:
    """Write index.md with the given wikilinks."""
    content = "# Wiki Index\n\n"
    for link in links:
        content += f"- [[{link}]]\n"
    (root / "wiki" / "index.md").write_text(content, encoding="utf-8")


MINIMAL_FRONTMATTER = """---
title: "Test Page"
type: project
updated: 2025-06-01
tier: 2
---

## Compiled Truth
This is a test project with real content and details.

## Timeline
- 2025-06-01 Created this page (session: abc123)
"""

PEOPLE_PAGE = """---
title: "Test Person"
type: person
updated: 2025-06-01
tier: 2
---

## Compiled Truth
Engineering lead on a core platform team.

## Working Relationship
- Reports to: Lead Architect
- Collaborates on: Platform services
- Communication: Slack, meetings
- Review pattern: Thorough code reviews

---

## Timeline
- 2025-06-01 Initial page (session: abc123)
"""

STUB_PAGE = """---
title: "Stub"
type: project
tier: 3
updated: 2024-01-01
---

stub
"""


# ══════════════════════════════════════════════════════════════════════════════
# Utility function tests
# ══════════════════════════════════════════════════════════════════════════════


class TestLevenshtein(unittest.TestCase):
    def test_identical(self):
        self.assertEqual(levenshtein_distance("hello", "hello"), 0)

    def test_single_edit(self):
        self.assertEqual(levenshtein_distance("cat", "car"), 1)

    def test_insertion(self):
        self.assertEqual(levenshtein_distance("cat", "cats"), 1)

    def test_deletion(self):
        self.assertEqual(levenshtein_distance("cats", "cat"), 1)

    def test_empty(self):
        self.assertEqual(levenshtein_distance("", "abc"), 3)
        self.assertEqual(levenshtein_distance("abc", ""), 3)

    def test_both_empty(self):
        self.assertEqual(levenshtein_distance("", ""), 0)

    def test_completely_different(self):
        self.assertEqual(levenshtein_distance("abc", "xyz"), 3)

    def test_case_sensitive(self):
        self.assertEqual(levenshtein_distance("Hello", "hello"), 1)


class TestJaccard(unittest.TestCase):
    def test_identical(self):
        self.assertAlmostEqual(jaccard_similarity("hello world", "hello world"), 1.0)

    def test_no_overlap(self):
        self.assertAlmostEqual(jaccard_similarity("hello world", "foo bar"), 0.0)

    def test_partial_overlap(self):
        sim = jaccard_similarity("hello world foo", "hello world bar")
        self.assertGreater(sim, 0.3)
        self.assertLess(sim, 0.8)

    def test_empty(self):
        self.assertAlmostEqual(jaccard_similarity("", "hello"), 0.0)

    def test_both_empty(self):
        self.assertAlmostEqual(jaccard_similarity("", ""), 0.0)


class TestFrontmatter(unittest.TestCase):
    def test_has_frontmatter_valid(self):
        self.assertTrue(has_frontmatter("---\ntitle: test\n---\ncontent"))

    def test_has_frontmatter_missing(self):
        self.assertFalse(has_frontmatter("# Just a heading\ncontent"))

    def test_has_frontmatter_empty(self):
        self.assertFalse(has_frontmatter(""))

    def test_extract_field(self):
        content = "---\ntitle: \"My Page\"\ntier: 3\n---\n"
        self.assertEqual(extract_frontmatter_field(content, "title"), "My Page")
        self.assertEqual(extract_frontmatter_field(content, "tier"), "3")

    def test_extract_field_missing(self):
        self.assertIsNone(extract_frontmatter_field("---\ntitle: x\n---\n", "missing"))

    def test_extract_field_quoted(self):
        content = "---\ntitle: 'Single Quoted'\n---\n"
        self.assertEqual(extract_frontmatter_field(content, "title"), "Single Quoted")


class TestDateParsing(unittest.TestCase):
    def test_date_only(self):
        dt = parse_date_safe("2025-06-15")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2025)

    def test_datetime(self):
        dt = parse_date_safe("2025-06-15T10:30:00")
        self.assertIsNotNone(dt)

    def test_invalid(self):
        self.assertIsNone(parse_date_safe("not-a-date"))

    def test_empty(self):
        self.assertIsNone(parse_date_safe(""))


class TestSections(unittest.TestCase):
    def test_has_section(self):
        self.assertTrue(has_section("## Timeline\n- entry", "Timeline"))

    def test_has_section_missing(self):
        self.assertFalse(has_section("## Other\n- entry", "Timeline"))

    def test_section_has_content_yes(self):
        content = "## Compiled Truth\nThis is real content.\n## Other"
        self.assertTrue(section_has_content(content, "Compiled Truth"))

    def test_section_has_content_no_data_yet(self):
        content = "## Compiled Truth\n[No data yet]\n## Other"
        self.assertFalse(section_has_content(content, "Compiled Truth"))

    def test_section_has_content_empty(self):
        content = "## Compiled Truth\n\n## Other"
        self.assertFalse(section_has_content(content, "Compiled Truth"))

    def test_section_has_content_missing(self):
        content = "## Other\nstuff"
        self.assertFalse(section_has_content(content, "Compiled Truth"))


# ══════════════════════════════════════════════════════════════════════════════
# Structure checks
# ══════════════════════════════════════════════════════════════════════════════


class TestStructureChecks(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_clean_root_no_issues(self):
        make_index(self.root, [])
        issues = check_structure(self.root)
        structure_issues = [i for i in issues if i.category == "structure"]
        # May have empty dir warnings — filter those
        errors = [i for i in structure_issues if i.severity == "error"]
        self.assertEqual(len(errors), 0)

    def test_root_file_bloat(self):
        # Create >6 files at root
        for i in range(8):
            (self.root / f"file{i}.txt").write_text(f"content {i}")
        make_index(self.root, [])
        issues = check_structure(self.root)
        bloat = [i for i in issues if "Root has" in i.message]
        self.assertGreater(len(bloat), 0)

    def test_script_duplication(self):
        (self.root / "lint.ps1").write_text("# root lint")
        (self.root / "scripts" / "lint.ps1").write_text("# scripts lint")
        make_index(self.root, [])
        issues = check_structure(self.root)
        dups = [i for i in issues if "exists at both root and scripts" in i.message]
        self.assertEqual(len(dups), 1)
        self.assertTrue(dups[0].fixable)

    def test_empty_directory(self):
        (self.root / "wiki" / "empty_subdir").mkdir()
        make_index(self.root, [])
        issues = check_structure(self.root)
        empties = [i for i in issues if "Empty directory" in i.message]
        self.assertGreater(len(empties), 0)

    def test_orphan_pages(self):
        write_page(self.root, "wiki/projects/my-project.md", MINIMAL_FRONTMATTER)
        make_index(self.root, [])  # empty index
        issues = check_structure(self.root)
        orphans = [i for i in issues if "Orphan page" in i.message]
        self.assertEqual(len(orphans), 1)
        self.assertIn("my-project", orphans[0].message)

    def test_no_orphan_when_indexed(self):
        write_page(self.root, "wiki/projects/my-project.md", MINIMAL_FRONTMATTER)
        make_index(self.root, ["my-project"])
        issues = check_structure(self.root)
        orphans = [i for i in issues if "Orphan page" in i.message]
        self.assertEqual(len(orphans), 0)

    def test_construction_artifacts(self):
        (self.root / ".mining").mkdir()
        (self.root / ".mining" / "data.txt").write_text("mining data")
        make_index(self.root, [])
        issues = check_structure(self.root)
        artifacts = [i for i in issues if "Construction artifact" in i.message]
        self.assertEqual(len(artifacts), 1)
        self.assertTrue(artifacts[0].fixable)

    def test_verification_artifact(self):
        (self.root / ".verification").mkdir()
        make_index(self.root, [])
        issues = check_structure(self.root)
        artifacts = [i for i in issues if ".verification" in i.message]
        self.assertEqual(len(artifacts), 1)

    def test_nonexistent_root(self):
        issues = check_structure(Path("/nonexistent/path/that/should/not/exist"))
        self.assertEqual(len(issues), 0)


# ══════════════════════════════════════════════════════════════════════════════
# Content checks
# ══════════════════════════════════════════════════════════════════════════════


class TestContentChecks(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_stub_detection(self):
        write_page(self.root, "wiki/projects/tiny.md", "---\ntitle: x\n---\nhi")
        issues = check_content(self.root)
        stubs = [i for i in issues if "stub" in i.message.lower()]
        self.assertGreater(len(stubs), 0)

    def test_missing_frontmatter(self):
        write_page(self.root, "wiki/projects/no-fm.md",
                   "# Just a heading\nSome content here that is long enough.")
        issues = check_content(self.root)
        no_fm = [i for i in issues if "frontmatter" in i.message.lower()]
        self.assertGreater(len(no_fm), 0)
        self.assertEqual(no_fm[0].severity, "error")

    def test_missing_last_verified(self):
        write_page(self.root, "wiki/projects/no-date.md",
                   "---\ntitle: \"No Date\"\ntier: 2\n---\n\nSome content here that is long enough to avoid stub detection and pass checks.")
        issues = check_content(self.root)
        no_lv = [i for i in issues if "last_verified" in i.message.lower()]
        self.assertGreater(len(no_lv), 0)
        self.assertTrue(no_lv[0].fixable)

    def test_has_last_verified_no_warning(self):
        write_page(self.root, "wiki/projects/dated.md",
                   "---\ntitle: \"Dated\"\nlast_verified: 2025-06-01\ntier: 2\n---\n\nContent here that is long enough.")
        issues = check_content(self.root)
        no_lv = [i for i in issues if "last_verified" in i.message.lower()]
        self.assertEqual(len(no_lv), 0)

    def test_has_updated_no_missing_warning(self):
        write_page(self.root, "wiki/projects/updated.md",
                   "---\ntitle: \"Updated\"\nupdated: 2025-06-01\ntier: 2\n---\n\nContent here that is long enough.")
        issues = check_content(self.root)
        no_lv = [i for i in issues if "Missing last_verified" in i.message]
        self.assertEqual(len(no_lv), 0)

    def test_stale_tier3(self):
        old_date = (datetime.now() - timedelta(days=45)).strftime("%Y-%m-%d")
        write_page(self.root, "wiki/projects/stale-stub.md",
                   f"---\ntitle: \"Stale\"\ntier: 3\nupdated: {old_date}\n---\n\nSome stub content that is just barely long enough to avoid stub detection threshold.")
        issues = check_content(self.root)
        stale = [i for i in issues if "Tier 3 stub untouched" in i.message]
        self.assertGreater(len(stale), 0)

    def test_fresh_tier3_no_warning(self):
        today = datetime.now().strftime("%Y-%m-%d")
        write_page(self.root, "wiki/projects/fresh-stub.md",
                   f"---\ntitle: \"Fresh\"\ntier: 3\nupdated: {today}\n---\n\nSome stub content that is long enough.")
        issues = check_content(self.root)
        stale = [i for i in issues if "Tier 3 stub untouched" in i.message]
        self.assertEqual(len(stale), 0)

    def test_decisions_noise(self):
        noise_lines = "\n".join(
            f"- [2025-01-{i:02d}] auto-harvested entry session: sess{i}"
            for i in range(1, 15)
        )
        (self.root / "decisions.md").write_text(f"# Decisions\n{noise_lines}\n")
        issues = check_content(self.root)
        noise = [i for i in issues if "harvest dump" in i.message.lower()]
        self.assertGreater(len(noise), 0)

    def test_clean_decisions_no_noise(self):
        (self.root / "decisions.md").write_text("# Decisions\n- [2025-01-01] Real decision about architecture\n")
        issues = check_content(self.root)
        noise = [i for i in issues if "harvest dump" in i.message.lower()]
        self.assertEqual(len(noise), 0)

    def test_skips_raw_dirs(self):
        raw_dir = self.root / "wiki" / "projects" / ".raw"
        raw_dir.mkdir(parents=True)
        write_page(self.root, "wiki/projects/.raw/excerpt.md", "raw excerpt")
        issues = check_content(self.root)
        # Should not flag raw dir contents
        raw_issues = [i for i in issues if ".raw" in str(i.file or "")]
        self.assertEqual(len(raw_issues), 0)

    def test_no_wiki_dir(self):
        empty_root = self.tmpdir / ".empty"
        empty_root.mkdir()
        issues = check_content(empty_root)
        self.assertEqual(len(issues), 0)


# ══════════════════════════════════════════════════════════════════════════════
# Depth checks
# ══════════════════════════════════════════════════════════════════════════════


class TestDepthChecks(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_missing_timeline(self):
        write_page(self.root, "wiki/projects/no-timeline.md",
                   "---\ntitle: \"No TL\"\ntype: project\nupdated: 2025-06-01\n---\n\n## Compiled Truth\nSome content here.")
        issues = check_depth(self.root)
        tl = [i for i in issues if "Timeline" in i.message]
        self.assertGreater(len(tl), 0)

    def test_has_timeline_no_issue(self):
        write_page(self.root, "wiki/projects/with-timeline.md", MINIMAL_FRONTMATTER)
        issues = check_depth(self.root)
        tl = [i for i in issues if "Timeline" in i.message and "with-timeline" in str(i.file or "")]
        self.assertEqual(len(tl), 0)

    def test_missing_compiled_truth(self):
        write_page(self.root, "wiki/projects/no-ct.md",
                   "---\ntitle: \"No CT\"\ntype: project\nupdated: 2025-06-01\n---\n\n## Timeline\n- 2025-01-01 Entry")
        issues = check_depth(self.root)
        ct = [i for i in issues if "Compiled Truth" in i.message]
        self.assertGreater(len(ct), 0)

    def test_person_without_working_relationship(self):
        write_page(self.root, "wiki/people/lonely.md",
                   "---\ntitle: \"Lonely\"\ntype: person\nupdated: 2025-06-01\n---\n\n## Compiled Truth\nSome person.\n\n## Working Relationship\n[No data yet]\n\n## Timeline\n- 2025-01-01 Met them")
        issues = check_depth(self.root)
        wr = [i for i in issues if "working relationship" in i.message.lower()]
        self.assertGreater(len(wr), 0)

    def test_person_with_working_relationship(self):
        write_page(self.root, "wiki/people/connected.md", PEOPLE_PAGE)
        issues = check_depth(self.root)
        wr = [i for i in issues if "working relationship" in i.message.lower() and "connected" in str(i.file or "")]
        self.assertEqual(len(wr), 0)

    def test_pattern_without_incidents(self):
        write_page(self.root, "wiki/patterns/vague-pattern.md",
                   "---\ntitle: \"Vague\"\ntype: pattern\nupdated: 2025-06-01\n---\n\n## Compiled Truth\nSomething about a general pattern that has been observed in the codebase.\n\n## Timeline\nGeneral pattern observed across multiple services without specific details.")
        issues = check_depth(self.root)
        thin = [i for i in issues if "thin" in i.message.lower() or "incident" in i.message.lower()]
        self.assertGreater(len(thin), 0)

    def test_pattern_with_incidents(self):
        write_page(self.root, "wiki/patterns/detailed-pattern.md",
                   "---\ntitle: \"Detailed\"\ntype: pattern\nupdated: 2025-06-01\n---\n\n## Compiled Truth\nBuild failures when cache is stale.\n\n## Timeline\n- 2025-06-01 Hit this in deployment (session: abc123)")
        issues = check_depth(self.root)
        thin = [i for i in issues if "thin" in i.message.lower() and "detailed" in str(i.file or "")]
        self.assertEqual(len(thin), 0)


# ══════════════════════════════════════════════════════════════════════════════
# Duplication checks
# ══════════════════════════════════════════════════════════════════════════════


class TestDuplicationChecks(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_similar_names(self):
        write_page(self.root, "wiki/projects/auth-service.md", MINIMAL_FRONTMATTER)
        write_page(self.root, "wiki/projects/auth-services.md",
                   MINIMAL_FRONTMATTER.replace("Test Page", "Auth Services"))
        issues = check_duplication(self.root)
        similar = [i for i in issues if "Similar page names" in i.message]
        self.assertGreater(len(similar), 0)

    def test_different_names_no_flag(self):
        write_page(self.root, "wiki/projects/frontend.md", MINIMAL_FRONTMATTER)
        write_page(self.root, "wiki/projects/backend.md",
                   MINIMAL_FRONTMATTER.replace("Test Page", "Backend"))
        issues = check_duplication(self.root)
        similar = [i for i in issues if "Similar page names" in i.message]
        self.assertEqual(len(similar), 0)

    def test_content_overlap(self):
        # Create two pages with >60% word overlap — need large shared content
        shared_words = " ".join(f"word{i}" for i in range(100))
        unique_a = " ".join(f"uniqueA{i}" for i in range(10))
        unique_b = " ".join(f"uniqueB{i}" for i in range(10))
        write_page(self.root, "wiki/projects/auth-v1.md",
                   f"---\ntitle: Auth V1\ntype: project\nupdated: 2025-06-01\n---\n\n{shared_words}\n\n{unique_a}")
        write_page(self.root, "wiki/projects/auth-v2.md",
                   f"---\ntitle: Auth V2\ntype: project\nupdated: 2025-06-01\n---\n\n{shared_words}\n\n{unique_b}")
        issues = check_duplication(self.root)
        overlap = [i for i in issues if "content overlap" in i.message.lower()]
        self.assertGreater(len(overlap), 0)

    def test_no_overlap_different_content(self):
        write_page(self.root, "wiki/projects/frontend-app.md",
                   "---\ntitle: Frontend\ntype: project\nupdated: 2025-06-01\n---\n\nReact application with TypeScript using modern hooks and context API for state management. Built with Vite bundler and deployed via CI pipeline to production environments.")
        write_page(self.root, "wiki/projects/data-pipeline.md",
                   "---\ntitle: Pipeline\ntype: project\nupdated: 2025-06-01\n---\n\nPython data processing pipeline using Spark and Kafka for streaming analytics. Deployed on Kubernetes with auto-scaling and monitoring via Grafana dashboards.")
        issues = check_duplication(self.root)
        overlap = [i for i in issues if "content overlap" in i.message.lower()]
        self.assertEqual(len(overlap), 0)

    def test_short_pages_skip_overlap(self):
        # Pages under 300 bytes should not be checked for overlap
        write_page(self.root, "wiki/projects/small-a.md", "---\ntitle: A\n---\nshort")
        write_page(self.root, "wiki/projects/small-b.md", "---\ntitle: B\n---\nshort")
        issues = check_duplication(self.root)
        overlap = [i for i in issues if "content overlap" in i.message.lower()]
        self.assertEqual(len(overlap), 0)


# ══════════════════════════════════════════════════════════════════════════════
# Fix mode
# ══════════════════════════════════════════════════════════════════════════════


class TestFixMode(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_fix_deletes_root_script_duplicates(self):
        (self.root / "lint.ps1").write_text("# root copy")
        (self.root / "scripts" / "lint.ps1").write_text("# scripts copy")
        make_index(self.root, [])

        issues = check_structure(self.root)
        actions = apply_fixes(self.root, issues)

        self.assertFalse((self.root / "lint.ps1").exists())
        self.assertTrue((self.root / "scripts" / "lint.ps1").exists())
        self.assertTrue(any("duplicate root script" in a.lower() for a in actions))

    def test_fix_adds_last_verified(self):
        write_page(self.root, "wiki/projects/no-date.md",
                   "---\ntitle: \"No Date\"\ntier: 2\n---\n\nContent here.\n")
        issues = check_content(self.root)
        actions = apply_fixes(self.root, issues)

        content = (self.root / "wiki" / "projects" / "no-date.md").read_text()
        self.assertIn("last_verified:", content)
        self.assertTrue(any("last_verified" in a.lower() for a in actions))

    def test_fix_archives_construction_artifacts(self):
        mining = self.root / ".mining"
        mining.mkdir()
        (mining / "data.txt").write_text("mining data")
        make_index(self.root, [])

        issues = check_structure(self.root)
        actions = apply_fixes(self.root, issues)

        self.assertFalse(mining.exists())
        self.assertTrue((self.root / ".archive" / ".mining").exists())

    def test_fix_does_not_delete_pages(self):
        write_page(self.root, "wiki/projects/stub.md", STUB_PAGE)
        make_index(self.root, [])

        report = HygieneReport(self.root)
        report.run()
        report.apply_fixes()

        # Stub page should still exist
        self.assertTrue((self.root / "wiki" / "projects" / "stub.md").exists())

    def test_fix_does_not_merge_duplicates(self):
        shared = "Shared content about authentication and login flows and token management."
        write_page(self.root, "wiki/projects/dup-a.md",
                   f"---\ntitle: A\ntype: project\nupdated: 2025-06-01\n---\n\n{shared}\n\nExtra A content for padding to exceed threshold.")
        write_page(self.root, "wiki/projects/dup-b.md",
                   f"---\ntitle: B\ntype: project\nupdated: 2025-06-01\n---\n\n{shared}\n\nExtra B content for padding to exceed threshold.")
        make_index(self.root, ["dup-a", "dup-b"])

        report = HygieneReport(self.root)
        report.run()
        report.apply_fixes()

        # Both pages should still exist
        self.assertTrue((self.root / "wiki" / "projects" / "dup-a.md").exists())
        self.assertTrue((self.root / "wiki" / "projects" / "dup-b.md").exists())

    def test_fix_adds_no_data_yet_to_empty_sections(self):
        write_page(self.root, "wiki/projects/empty-sections.md",
                   "---\ntitle: \"Empty\"\nupdated: 2025-06-01\n---\n\n## Compiled Truth\n\n## Timeline\n- 2025-01-01 Entry")
        make_index(self.root, ["empty-sections"])

        report = HygieneReport(self.root)
        report.run()
        report.apply_fixes()

        content = (self.root / "wiki" / "projects" / "empty-sections.md").read_text()
        self.assertIn("[No data yet]", content)


# ══════════════════════════════════════════════════════════════════════════════
# Score calculation
# ══════════════════════════════════════════════════════════════════════════════


class TestScoreCalculation(unittest.TestCase):
    def test_grade_a(self):
        self.assertEqual(compute_grade(0, 0), "A")
        self.assertEqual(compute_grade(0, 1), "A")
        self.assertEqual(compute_grade(0, 2), "A")

    def test_grade_b(self):
        self.assertEqual(compute_grade(0, 3), "B")
        self.assertEqual(compute_grade(0, 5), "B")

    def test_grade_c(self):
        self.assertEqual(compute_grade(1, 0), "C")
        self.assertEqual(compute_grade(2, 10), "C")

    def test_grade_d(self):
        self.assertEqual(compute_grade(3, 0), "D")
        self.assertEqual(compute_grade(5, 20), "D")

    def test_grade_f(self):
        self.assertEqual(compute_grade(6, 0), "F")
        self.assertEqual(compute_grade(10, 10), "F")


# ══════════════════════════════════════════════════════════════════════════════
# Full report
# ══════════════════════════════════════════════════════════════════════════════


class TestHygieneReport(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_report_runs_all_categories(self):
        make_index(self.root, [])
        report = HygieneReport(self.root)
        report.run()
        self.assertIn("structure", report.scores)
        self.assertIn("content", report.scores)
        self.assertIn("depth", report.scores)
        self.assertIn("duplication", report.scores)
        self.assertIn("brain", report.scores)

    def test_report_to_dict(self):
        make_index(self.root, [])
        report = HygieneReport(self.root)
        report.run()
        d = report.to_dict()
        self.assertIn("scores", d)
        self.assertIn("issues", d)
        self.assertIn("issue_count", d)
        self.assertIn("root", d)
        self.assertIsInstance(d["issues"], list)

    def test_json_output(self):
        make_index(self.root, [])
        report = HygieneReport(self.root)
        report.run()
        json_str = json.dumps(report.to_dict())
        parsed = json.loads(json_str)
        self.assertIn("scores", parsed)

    def test_report_clean_kb_good_grades(self):
        write_page(self.root, "wiki/projects/good.md", MINIMAL_FRONTMATTER)
        make_index(self.root, ["good"])
        report = HygieneReport(self.root)
        report.run()
        # A clean KB should have mostly A/B grades
        for cat, grade in report.scores.items():
            self.assertIn(grade, ("A", "B", "C"), f"Bad grade for {cat}: {grade}")


# ══════════════════════════════════════════════════════════════════════════════
# CLI interface
# ══════════════════════════════════════════════════════════════════════════════


class TestCLI(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)
        make_index(self.root, [])

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_cli_default_run(self):
        with patch("sys.stdout"):
            result = main([str(self.root)])
        self.assertIn(result, (0, 1))

    def test_cli_json_output(self):
        import io
        captured = io.StringIO()
        with patch("sys.stdout", captured):
            main([str(self.root), "--json"])
        output = captured.getvalue()
        parsed = json.loads(output)
        self.assertIn("scores", parsed)

    def test_cli_fix_mode(self):
        (self.root / "lint.ps1").write_text("# dup")
        (self.root / "scripts" / "lint.ps1").write_text("# original")
        with patch("sys.stdout"):
            main([str(self.root), "--fix"])
        self.assertFalse((self.root / "lint.ps1").exists())

    def test_cli_nonexistent_path(self):
        result = main(["/totally/nonexistent/path/xyz"])
        self.assertEqual(result, 1)


# ══════════════════════════════════════════════════════════════════════════════
# Edge cases
# ══════════════════════════════════════════════════════════════════════════════


class TestEdgeCases(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_empty_root(self):
        root = self.tmpdir / ".empty"
        root.mkdir()
        report = HygieneReport(root)
        report.run()
        # Should not crash
        self.assertIn("structure", report.scores)

    def test_root_with_only_wiki(self):
        root = self.tmpdir / ".minimal"
        root.mkdir()
        (root / "wiki").mkdir()
        (root / "wiki" / "index.md").write_text("# Index\n")
        report = HygieneReport(root)
        report.run()
        self.assertIn("structure", report.scores)

    def test_binary_file_in_wiki(self):
        root = make_wiki_root(self.tmpdir)
        # Write a "binary" file that can't be cleanly read as text
        binary_path = root / "wiki" / "projects" / "binary.md"
        binary_path.write_bytes(b"\x00\x01\x02\x03---\ntitle: binary\n---\n")
        make_index(root, [])
        # Should not crash
        report = HygieneReport(root)
        report.run()

    def test_deeply_nested_wiki(self):
        root = make_wiki_root(self.tmpdir)
        deep = root / "wiki" / "projects" / "sub" / "deep"
        deep.mkdir(parents=True)
        write_page(root, "wiki/projects/sub/deep/nested.md", MINIMAL_FRONTMATTER)
        make_index(root, [])
        report = HygieneReport(root)
        report.run()
        # Should detect nested page as orphan (not in index)
        orphans = [i for i in report.issues if "Orphan" in i.message]
        self.assertGreater(len(orphans), 0)

    def test_issue_repr(self):
        issue = HygieneIssue("structure", "error", "Test message", "file.md")
        s = repr(issue)
        self.assertIn("ERROR", s)
        self.assertIn("file.md", s)

    def test_issue_to_dict(self):
        issue = HygieneIssue("content", "warning", "msg", "f.md", fixable=True, fix_action="do_x")
        d = issue.to_dict()
        self.assertEqual(d["category"], "content")
        self.assertEqual(d["severity"], "warning")
        self.assertTrue(d["fixable"])


# ======================================================================
# Brain health checks (Issue #23)
# ======================================================================


class TestBrainHealth(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_missing_brain(self):
        (self.root / "brain.md").unlink()
        issues = check_brain_health(self.root)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].severity, "error")
        self.assertIn("not found", issues[0].message)

    def test_healthy_brain(self):
        (self.root / "brain.md").write_text(
            "# Brain\n## L0 - Identity\nI am a dev.\n## L1 - Active Work\nWorking on stuff.\n"
        )
        issues = check_brain_health(self.root)
        self.assertEqual(len(issues), 0)

    def test_brain_line_warning(self):
        lines = "\n".join([f"Line {i}" for i in range(55)])
        (self.root / "brain.md").write_text(f"# Brain\n## L0\nIdentity\n## L1\nActive\n{lines}\n")
        issues = check_brain_health(self.root)
        warnings = [i for i in issues if i.severity == "warning" and "lines" in i.message]
        self.assertGreater(len(warnings), 0)

    def test_brain_line_error(self):
        lines = "\n".join([f"Line {i}" for i in range(85)])
        (self.root / "brain.md").write_text(f"# Brain\n## L0\nIdentity\n## L1\nActive\n{lines}\n")
        issues = check_brain_health(self.root)
        errors = [i for i in issues if i.severity == "error" and "lines" in i.message]
        self.assertGreater(len(errors), 0)

    def test_brain_token_warning(self):
        # ~650 tokens = ~2600 chars
        content = "## L0\nIdentity\n## L1\nActive\n" + "x " * 1300
        (self.root / "brain.md").write_text(content)
        issues = check_brain_health(self.root)
        warnings = [i for i in issues if i.severity == "warning" and "tokens" in i.message]
        self.assertGreater(len(warnings), 0)

    def test_brain_token_error(self):
        # ~1200 tokens = ~4800 chars
        content = "## L0\nIdentity\n## L1\nActive\n" + "x " * 2400
        (self.root / "brain.md").write_text(content)
        issues = check_brain_health(self.root)
        errors = [i for i in issues if i.severity == "error" and "tokens" in i.message]
        self.assertGreater(len(errors), 0)

    def test_brain_code_blocks(self):
        content = "## L0\nIdentity\n## L1\nActive\n```python\nprint('hi')\n```\n"
        (self.root / "brain.md").write_text(content)
        issues = check_brain_health(self.root)
        code = [i for i in issues if "code blocks" in i.message]
        self.assertGreater(len(code), 0)
        self.assertEqual(code[0].severity, "error")

    def test_brain_missing_l0(self):
        (self.root / "brain.md").write_text("# Brain\n## L1\nActive work.\n")
        issues = check_brain_health(self.root)
        l0 = [i for i in issues if "L0" in i.message or "Identity" in i.message]
        self.assertGreater(len(l0), 0)

    def test_brain_missing_l1(self):
        (self.root / "brain.md").write_text("# Brain\n## L0\nIdentity stuff.\n")
        issues = check_brain_health(self.root)
        l1 = [i for i in issues if "L1" in i.message or "Active" in i.message]
        self.assertGreater(len(l1), 0)

    def test_brain_identity_alias(self):
        """## Identity is accepted as L0 alias."""
        (self.root / "brain.md").write_text("# Brain\n## Identity\nI am dev.\n## Active\nWork.\n")
        issues = check_brain_health(self.root)
        section_issues = [i for i in issues if "L0" in i.message or "L1" in i.message]
        self.assertEqual(len(section_issues), 0)

    def test_brain_in_report_scores(self):
        make_index(self.root, [])
        report = HygieneReport(self.root)
        report.run()
        self.assertIn("brain", report.scores)


# ======================================================================
# Depth grading curve (Issue #22)
# ======================================================================


class TestDepthGrading(unittest.TestCase):
    def test_zero_issues(self):
        self.assertEqual(compute_depth_grade(0, 10), "A")

    def test_ten_percent(self):
        self.assertEqual(compute_depth_grade(1, 10), "A")

    def test_twenty_percent(self):
        self.assertEqual(compute_depth_grade(2, 10), "B")

    def test_thirty_percent(self):
        self.assertEqual(compute_depth_grade(3, 10), "B")

    def test_forty_percent(self):
        self.assertEqual(compute_depth_grade(4, 10), "C")

    def test_sixty_percent(self):
        self.assertEqual(compute_depth_grade(6, 10), "C")

    def test_seventy_percent(self):
        self.assertEqual(compute_depth_grade(7, 10), "D")

    def test_ninety_percent(self):
        self.assertEqual(compute_depth_grade(9, 10), "F")

    def test_all_issues(self):
        self.assertEqual(compute_depth_grade(10, 10), "F")

    def test_zero_pages(self):
        self.assertEqual(compute_depth_grade(0, 0), "A")

    def test_depth_grade_in_report(self):
        """Depth grade uses percentage-based curve, not absolute counts."""
        tmpdir = Path(tempfile.mkdtemp())
        try:
            root = make_wiki_root(tmpdir)
            # Create 10 pages, 2 with depth issues (20% -> B)
            for i in range(8):
                write_page(root, f"wiki/projects/page{i}.md", MINIMAL_FRONTMATTER)
            # These 2 pages are missing timeline -> depth issues
            for i in range(2):
                write_page(root, f"wiki/projects/thin{i}.md",
                           "---\ntitle: Thin\ntype: project\nupdated: 2025-06-01\n---\n\n## Compiled Truth\nContent.")
            make_index(root, [f"page{i}" for i in range(8)] + [f"thin{i}" for i in range(2)])
            report = HygieneReport(root)
            report.run()
            # 20% depth issues -> should be B
            self.assertIn(report.scores["depth"], ("A", "B"))
        finally:
            shutil.rmtree(str(tmpdir), ignore_errors=True)


# ======================================================================
# Orphan fix (Issue #21)
# ======================================================================


class TestOrphanFix(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.root = make_wiki_root(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)

    def test_determine_section_people(self):
        self.assertEqual(_determine_index_section("wiki/people/alice.md"), "People")

    def test_determine_section_projects(self):
        self.assertEqual(_determine_index_section("wiki/projects/foo.md"), "Projects")

    def test_determine_section_patterns(self):
        self.assertEqual(_determine_index_section("wiki/patterns/bug.md"), "Patterns")

    def test_determine_section_concepts(self):
        self.assertEqual(_determine_index_section("wiki/concepts/auth.md"), "Concepts")

    def test_determine_section_unknown(self):
        self.assertEqual(_determine_index_section("wiki/misc/random.md"), "Other")

    def test_fix_adds_orphan_to_index(self):
        write_page(self.root, "wiki/projects/orphan-proj.md", MINIMAL_FRONTMATTER)
        index_content = "# Wiki Index\n\n## Projects\n\n| Page | Status | Description |\n"
        (self.root / "wiki" / "index.md").write_text(index_content, encoding="utf-8")

        issues = check_structure(self.root)
        actions = apply_fixes(self.root, issues)

        idx = (self.root / "wiki" / "index.md").read_text(encoding="utf-8")
        self.assertIn("[[orphan-proj]]", idx)
        self.assertTrue(any("orphan" in a.lower() for a in actions))

    def test_fix_adds_orphan_correct_section(self):
        write_page(self.root, "wiki/people/new-person.md", PEOPLE_PAGE)
        index_content = "# Wiki Index\n\n## Projects\n\n| Page |\n\n## People\n\n| Page |\n"
        (self.root / "wiki" / "index.md").write_text(index_content, encoding="utf-8")

        issues = check_structure(self.root)
        orphans = [i for i in issues if i.fix_action == "add_to_index"]
        actions = apply_fixes(self.root, orphans)

        idx = (self.root / "wiki" / "index.md").read_text(encoding="utf-8")
        # The entry should be in the People section
        people_pos = idx.find("## People")
        entry_pos = idx.find("[[new-person]]")
        self.assertGreater(entry_pos, people_pos)

    def test_fix_creates_section_if_missing(self):
        write_page(self.root, "wiki/concepts/new-concept.md",
                   "---\ntitle: \"Auth Patterns\"\ntype: concept\nupdated: 2025-06-01\n---\n\nContent.")
        index_content = "# Wiki Index\n\n## Projects\n\n| Page |\n"
        (self.root / "wiki" / "index.md").write_text(index_content, encoding="utf-8")

        issues = check_structure(self.root)
        actions = apply_fixes(self.root, issues)

        idx = (self.root / "wiki" / "index.md").read_text(encoding="utf-8")
        self.assertIn("## Concepts", idx)
        self.assertIn("[[new-concept]]", idx)

    def test_fix_includes_frontmatter_description(self):
        write_page(self.root, "wiki/projects/cool-proj.md",
                   '---\ntitle: "Cool Project"\ntype: project\ntier: 2\nupdated: 2025-06-01\n---\n\nContent.')
        index_content = "# Wiki Index\n\n## Projects\n\n| Page | Status | Description |\n"
        (self.root / "wiki" / "index.md").write_text(index_content, encoding="utf-8")

        issues = check_structure(self.root)
        actions = apply_fixes(self.root, issues)

        idx = (self.root / "wiki" / "index.md").read_text(encoding="utf-8")
        self.assertIn("Cool Project", idx)
        self.assertIn("tier-2", idx)

    def test_orphan_is_now_fixable(self):
        write_page(self.root, "wiki/projects/orphan.md", MINIMAL_FRONTMATTER)
        make_index(self.root, [])
        issues = check_structure(self.root)
        orphans = [i for i in issues if "Orphan" in i.message]
        self.assertGreater(len(orphans), 0)
        self.assertTrue(orphans[0].fixable)
        self.assertEqual(orphans[0].fix_action, "add_to_index")


if __name__ == "__main__":
    unittest.main()
