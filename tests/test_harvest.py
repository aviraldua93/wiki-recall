"""
Comprehensive tests for harvest.py — the auto-capture engine.

Tests:
  - Decision extraction from session text
  - Bug pattern extraction from session text
  - Project mention detection
  - New topic detection
  - Deduplication against existing content
  - Dry-run vs auto-write modes
  - Timestamp tracking (.last_harvested)
  - Full harvest pipeline with mock session_store
  - Frontmatter last_verified updates
  - Edge cases: empty sessions, no store, corrupt data
"""

import os
import re
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

# Add project root so we can import engine modules
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.harvest import (
    DECISION_PATTERNS,
    BUG_PATTERNS,
    HarvestResult,
    append_bug_patterns,
    append_decisions,
    detect_new_topics,
    extract_bug_patterns,
    extract_decisions,
    extract_people_mentions,
    extract_project_mentions,
    harvest,
    load_existing_decisions,
    load_existing_patterns,
    load_known_pages,
    load_known_people,
    load_known_projects,
    read_last_harvested,
    update_last_verified,
    write_last_harvested,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def create_mock_session_store(db_path: Path, sessions: list[dict]):
    """Create a minimal session_store.db with sessions and turns."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            repository TEXT,
            branch TEXT,
            created_at TEXT,
            updated_at TEXT,
            summary TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE turns (
            session_id TEXT,
            turn_index INTEGER,
            user_message TEXT,
            assistant_response TEXT,
            timestamp TEXT,
            PRIMARY KEY (session_id, turn_index)
        )
    """)

    for sess in sessions:
        conn.execute(
            "INSERT INTO sessions (id, repository, branch, created_at, updated_at, summary) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                sess["id"],
                sess.get("repository", ""),
                sess.get("branch", ""),
                sess.get("created_at", "2026-04-09T00:00:00Z"),
                sess.get("updated_at", "2026-04-09T00:00:00Z"),
                sess.get("summary", ""),
            ),
        )
        for turn in sess.get("turns", []):
            conn.execute(
                "INSERT INTO turns (session_id, turn_index, user_message, assistant_response) "
                "VALUES (?, ?, ?, ?)",
                (
                    sess["id"],
                    turn["turn_index"],
                    turn.get("user_message", ""),
                    turn.get("assistant_response", ""),
                ),
            )

    conn.commit()
    conn.close()


def make_grain_dir(tmpdir: Path):
    """Create a minimal grain directory structure."""
    (tmpdir / "wiki" / "projects").mkdir(parents=True)
    (tmpdir / "wiki" / "patterns").mkdir(parents=True)
    (tmpdir / "wiki" / "concepts").mkdir(parents=True)
    (tmpdir / "domains").mkdir(parents=True)
    (tmpdir / "engine").mkdir(parents=True)
    (tmpdir / "decisions.md").write_text(
        "# Decisions\n\n## Architecture\n\n## Process\n",
        encoding="utf-8",
    )
    return tmpdir


# ── Decision Extraction Tests ────────────────────────────────────────────────

class TestDecisionExtraction(unittest.TestCase):
    """Test that decision patterns match expected phrases."""

    def test_decided_to(self):
        turns = [{"user_message": "I decided to use PostgreSQL for the database", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("PostgreSQL" in d for d in decisions), f"Expected PostgreSQL mention in {decisions}")

    def test_lets_go_with(self):
        turns = [{"user_message": "Let's go with WebSockets instead of polling", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("WebSocket" in d for d in decisions), f"Expected WebSocket mention in {decisions}")

    def test_were_using(self):
        turns = [{"user_message": "", "assistant_response": "We're using Redis for the cache layer now"}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("Redis" in d for d in decisions), f"Expected Redis mention in {decisions}")

    def test_going_with(self):
        turns = [{"user_message": "Going with TypeScript for the CLI module", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("TypeScript" in d for d in decisions))

    def test_settled_on(self):
        turns = [{"user_message": "We settled on JWT tokens for the auth system", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("JWT" in d for d in decisions))

    def test_decision_colon_format(self):
        turns = [{"user_message": "Decision: use monorepo structure for all services", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        self.assertTrue(any("monorepo" in d for d in decisions))

    def test_no_false_positive_short_text(self):
        turns = [{"user_message": "decided to do it", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        # "do it" is too short (<15 chars), should be filtered
        self.assertEqual(len(decisions), 0, f"Short text should be filtered: {decisions}")

    def test_no_decision_in_normal_text(self):
        turns = [{"user_message": "The weather is nice today", "assistant_response": "Sure, let me help."}]
        decisions = extract_decisions(turns)
        self.assertEqual(len(decisions), 0)

    def test_multiple_decisions_in_one_session(self):
        turns = [
            {"user_message": "Let's go with React for the frontend component library", "assistant_response": ""},
            {"user_message": "We're using Tailwind CSS for all styling needs", "assistant_response": ""},
        ]
        decisions = extract_decisions(turns)
        self.assertGreaterEqual(len(decisions), 2)

    def test_dedup_within_session(self):
        turns = [
            {"user_message": "Let's go with React for the frontend", "assistant_response": ""},
            {"user_message": "As I said, let's go with React for the frontend", "assistant_response": ""},
        ]
        decisions = extract_decisions(turns)
        # Should deduplicate within the same extraction
        react_decisions = [d for d in decisions if "React" in d]
        self.assertEqual(len(react_decisions), 1, f"Should dedup: {decisions}")


# ── Bug Pattern Extraction Tests ─────────────────────────────────────────────

class TestBugPatternExtraction(unittest.TestCase):
    """Test that bug pattern phrases match expected text."""

    def test_fixed_by(self):
        turns = [{"user_message": "", "assistant_response": "Fixed by adding a null check before the array access in the parser module"}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("null check" in p for p in patterns))

    def test_the_fix_was(self):
        turns = [{"user_message": "the fix was switching from sync to async file reads in the handler", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("async" in p.lower() for p in patterns))

    def test_workaround_colon(self):
        turns = [{"user_message": "Workaround: disable the cache and call the API directly for now", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("cache" in p for p in patterns))

    def test_gotcha_colon(self):
        turns = [{"user_message": "Gotcha: PowerShell encodes smart quotes differently on Windows vs Linux", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("PowerShell" in p or "smart quotes" in p for p in patterns))

    def test_root_cause_was(self):
        turns = [{"user_message": "Root cause was the missing CORS headers on the API gateway", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("CORS" in p for p in patterns))

    def test_the_issue_was(self):
        turns = [{"user_message": "The issue was stale DNS entries pointing to the old load balancer", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        self.assertTrue(any("DNS" in p or "load balancer" in p for p in patterns))

    def test_no_false_positive(self):
        turns = [{"user_message": "Everything looks good, no bugs found", "assistant_response": "Great work!"}]
        patterns = extract_bug_patterns(turns)
        self.assertEqual(len(patterns), 0)

    def test_short_pattern_filtered(self):
        turns = [{"user_message": "fix: add check", "assistant_response": ""}]
        patterns = extract_bug_patterns(turns)
        # "add check" is too short (<15 chars)
        self.assertEqual(len(patterns), 0)


# ── Project Mention Tests ────────────────────────────────────────────────────

class TestProjectMentions(unittest.TestCase):

    def test_finds_known_project(self):
        result = extract_project_mentions("Working on the conductor CLI tool", ["conductor", "octane"])
        self.assertIn("conductor", result)

    def test_no_match(self):
        result = extract_project_mentions("Just reading documentation", ["conductor", "octane"])
        self.assertEqual(len(result), 0)

    def test_multiple_projects(self):
        result = extract_project_mentions("conductor and octane integration", ["conductor", "octane", "grain"])
        self.assertIn("conductor", result)
        self.assertIn("octane", result)
        self.assertNotIn("grain", result)

    def test_empty_summary(self):
        result = extract_project_mentions("", ["conductor"])
        self.assertEqual(len(result), 0)

    def test_none_summary(self):
        result = extract_project_mentions(None, ["conductor"])
        self.assertEqual(len(result), 0)


# ── New Topic Detection Tests ────────────────────────────────────────────────

class TestNewTopicDetection(unittest.TestCase):

    def test_detects_unknown_topic(self):
        known = {"conductor", "octane", "grain"}
        result = detect_new_topics("Setting up Kubernetes monitoring dashboard", known)
        self.assertIsNotNone(result)
        self.assertIn("Kubernetes", result)

    def test_known_topic_returns_none(self):
        known = {"conductor", "octane", "grain"}
        result = detect_new_topics("Working on conductor CLI improvements", known)
        self.assertIsNone(result)

    def test_short_summary_filtered(self):
        known = {"conductor"}
        result = detect_new_topics("short", known)
        self.assertIsNone(result)

    def test_empty_summary(self):
        result = detect_new_topics("", {"conductor"})
        self.assertIsNone(result)

    def test_none_summary(self):
        result = detect_new_topics(None, {"conductor"})
        self.assertIsNone(result)


# ── Deduplication Tests ──────────────────────────────────────────────────────

class TestDeduplication(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_load_existing_decisions(self):
        decisions_path = self.tmpdir / "decisions.md"
        decisions_path.write_text(
            "# Decisions\n\n## Architecture\n- [2026-04-01] Use PostgreSQL\n- Use Redis for cache\n",
            encoding="utf-8",
        )
        with patch("engine.harvest.DECISIONS_PATH", decisions_path):
            existing = load_existing_decisions()
        self.assertIn("use postgresql", existing)
        self.assertIn("use redis for cache", existing)

    def test_load_existing_patterns(self):
        patterns_dir = self.tmpdir / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "test.md").write_text(
            "# Test\n### Null pointer in parser\n- What: crash\n### CORS headers missing\n",
            encoding="utf-8",
        )
        with patch("engine.harvest.PATTERNS_PATH", patterns_dir):
            existing = load_existing_patterns()
        self.assertIn("null pointer in parser", existing)
        self.assertIn("cors headers missing", existing)

    def test_load_known_projects(self):
        projects_dir = self.tmpdir / "projects"
        projects_dir.mkdir()
        (projects_dir / "conductor.md").write_text("# Conductor", encoding="utf-8")
        (projects_dir / "octane.md").write_text("# Octane", encoding="utf-8")
        with patch("engine.harvest.PROJECTS_PATH", projects_dir):
            projects = load_known_projects()
        self.assertIn("conductor", projects)
        self.assertIn("octane", projects)

    def test_load_known_pages(self):
        wiki_dir = self.tmpdir / "wiki"
        wiki_dir.mkdir()
        (wiki_dir / "foo.md").write_text("# Foo", encoding="utf-8")
        sub = wiki_dir / "sub"
        sub.mkdir()
        (sub / "bar.md").write_text("# Bar", encoding="utf-8")
        with patch("engine.harvest.WIKI_PATH", wiki_dir):
            pages = load_known_pages()
        self.assertIn("foo", pages)
        self.assertIn("bar", pages)


# ── Write Functions Tests ────────────────────────────────────────────────────

class TestWriteFunctions(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_append_decisions_to_existing(self):
        decisions_path = self.tmpdir / "decisions.md"
        decisions_path.write_text("# Decisions\n\n## Architecture\n", encoding="utf-8")
        with patch("engine.harvest.DECISIONS_PATH", decisions_path):
            append_decisions(["Use PostgreSQL for the main database"])
        content = decisions_path.read_text(encoding="utf-8")
        self.assertIn("Use PostgreSQL", content)
        self.assertRegex(content, r"\[20\d{2}-\d{2}-\d{2}\]")

    def test_append_decisions_creates_file(self):
        decisions_path = self.tmpdir / "decisions.md"
        with patch("engine.harvest.DECISIONS_PATH", decisions_path):
            append_decisions(["First decision ever"])
        self.assertTrue(decisions_path.exists())
        content = decisions_path.read_text(encoding="utf-8")
        self.assertIn("First decision ever", content)

    def test_append_decisions_empty_list(self):
        decisions_path = self.tmpdir / "decisions.md"
        decisions_path.write_text("# Decisions\n", encoding="utf-8")
        with patch("engine.harvest.DECISIONS_PATH", decisions_path):
            append_decisions([])
        content = decisions_path.read_text(encoding="utf-8")
        self.assertEqual(content, "# Decisions\n")

    def test_append_bug_patterns(self):
        patterns_dir = self.tmpdir / "patterns"
        patterns_dir.mkdir()
        with patch("engine.harvest.PATTERNS_PATH", patterns_dir):
            append_bug_patterns(["Null check missing in parser"], "abc123")
        harvested = patterns_dir / "harvested.md"
        self.assertTrue(harvested.exists())
        content = harvested.read_text(encoding="utf-8")
        self.assertIn("Null check missing", content)
        self.assertIn("abc123", content)
        self.assertIn("last_verified:", content)

    def test_append_bug_patterns_appends_to_existing(self):
        patterns_dir = self.tmpdir / "patterns"
        patterns_dir.mkdir()
        harvested = patterns_dir / "harvested.md"
        harvested.write_text("---\nlast_verified: 2026-01-01\n---\n\n# Harvested\n\n### Old pattern\n", encoding="utf-8")
        with patch("engine.harvest.PATTERNS_PATH", patterns_dir):
            append_bug_patterns(["New pattern found in the API layer"], "def456")
        content = harvested.read_text(encoding="utf-8")
        self.assertIn("Old pattern", content)
        self.assertIn("New pattern found", content)


# ── Frontmatter Tests ────────────────────────────────────────────────────────

class TestFrontmatterUpdates(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_update_existing_last_verified(self):
        filepath = self.tmpdir / "test.md"
        filepath.write_text("---\nlast_verified: 2025-01-01\ntags: [test]\n---\n\n# Test\n", encoding="utf-8")
        update_last_verified(filepath)
        content = filepath.read_text(encoding="utf-8")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.assertIn(f"last_verified: {today}", content)
        self.assertIn("tags: [test]", content)

    def test_add_last_verified_to_existing_frontmatter(self):
        filepath = self.tmpdir / "test.md"
        filepath.write_text("---\ntags: [test]\n---\n\n# Test\n", encoding="utf-8")
        update_last_verified(filepath)
        content = filepath.read_text(encoding="utf-8")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.assertIn(f"last_verified: {today}", content)

    def test_add_frontmatter_when_none(self):
        filepath = self.tmpdir / "test.md"
        filepath.write_text("# Test\n\nSome content here.\n", encoding="utf-8")
        update_last_verified(filepath)
        content = filepath.read_text(encoding="utf-8")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.assertTrue(content.startswith("---\n"))
        self.assertIn(f"last_verified: {today}", content)
        self.assertIn("# Test", content)

    def test_nonexistent_file_no_error(self):
        filepath = self.tmpdir / "nonexistent.md"
        # Should not raise
        update_last_verified(filepath)


# ── Timestamp Tracking Tests ─────────────────────────────────────────────────

class TestTimestampTracking(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_write_and_read_last_harvested(self):
        path = self.tmpdir / ".last_harvested"
        with patch("engine.harvest.LAST_HARVESTED_PATH", path):
            write_last_harvested()
            result = read_last_harvested()
        self.assertIsNotNone(result)
        self.assertRegex(result, r"20\d{2}-\d{2}-\d{2}T")

    def test_read_nonexistent(self):
        path = self.tmpdir / ".last_harvested"
        with patch("engine.harvest.LAST_HARVESTED_PATH", path):
            result = read_last_harvested()
        self.assertIsNone(result)


# ── Full Pipeline Tests (with mock session_store) ────────────────────────────

class TestHarvestPipeline(unittest.TestCase):
    """Integration tests using a real SQLite session_store mock."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.store_path = self.tmpdir / "session-store.db"
        self.grain_root = make_grain_dir(self.tmpdir / "grain")

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_harvest_finds_decisions(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-001",
                "summary": "Setting up auth system",
                "turns": [
                    {"turn_index": 0, "user_message": "Let's build auth", "assistant_response": "OK"},
                    {"turn_index": 1, "user_message": "Let's go with JWT tokens for the authentication layer", "assistant_response": "Good choice."},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertEqual(result.sessions_scanned, 1)
        self.assertGreater(len(result.decisions), 0)
        self.assertTrue(any("JWT" in d for d in result.decisions))

    def test_harvest_finds_bug_patterns(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-002",
                "summary": "Debugging parser crash",
                "turns": [
                    {"turn_index": 0, "user_message": "parser is crashing", "assistant_response": "Let me look."},
                    {"turn_index": 1, "user_message": "", "assistant_response": "Fixed by adding a null check before accessing the array element in the parser"},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertGreater(len(result.bug_patterns), 0)

    def test_harvest_detects_project_mentions(self):
        # Create a known project
        (self.grain_root / "wiki" / "projects" / "conductor.md").write_text("# Conductor", encoding="utf-8")

        create_mock_session_store(self.store_path, [
            {
                "id": "sess-003",
                "summary": "Working on conductor CLI improvements",
                "turns": [
                    {"turn_index": 0, "user_message": "Working on conductor", "assistant_response": "OK"},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertGreater(len(result.project_updates), 0)

    def test_harvest_detects_new_topics(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-004",
                "summary": "Setting up Kubernetes monitoring with Prometheus and Grafana dashboards",
                "turns": [
                    {"turn_index": 0, "user_message": "Help with k8s monitoring", "assistant_response": "Sure."},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertGreater(len(result.new_topics), 0)

    def test_harvest_filters_agent_sessions(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-agent",
                "summary": "Agent task",
                "turns": [
                    {"turn_index": 0, "user_message": "You are the coding agent. Implement X.", "assistant_response": "OK"},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertEqual(result.sessions_scanned, 0)

    def test_harvest_with_since_filter(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-old",
                "summary": "Old session",
                "created_at": "2025-01-01T00:00:00Z",
                "turns": [
                    {"turn_index": 0, "user_message": "Let's go with MongoDB for the old project", "assistant_response": "OK"},
                ],
            },
            {
                "id": "sess-new",
                "summary": "New session",
                "created_at": "2026-04-09T00:00:00Z",
                "turns": [
                    {"turn_index": 0, "user_message": "Let's go with PostgreSQL for the new project", "assistant_response": "OK"},
                ],
            },
        ])

        result = harvest(since="2026-01-01", store_path=self.store_path, grain_root=self.grain_root)
        self.assertEqual(result.sessions_scanned, 1)

    def test_harvest_deduplicates_existing_decisions(self):
        # Pre-populate decisions
        (self.grain_root / "decisions.md").write_text(
            "# Decisions\n\n## Architecture\n- [2026-04-01] Use PostgreSQL for everything\n",
            encoding="utf-8",
        )

        create_mock_session_store(self.store_path, [
            {
                "id": "sess-dup",
                "summary": "Discussing database",
                "turns": [
                    {"turn_index": 0, "user_message": "We decided to use PostgreSQL for everything", "assistant_response": "OK"},
                ],
            }
        ])

        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        # The decision should be deduped
        pg_decisions = [d for d in result.decisions if "postgresql" in d.lower()]
        self.assertEqual(len(pg_decisions), 0, f"Should have been deduped: {result.decisions}")

    def test_harvest_empty_store(self):
        create_mock_session_store(self.store_path, [])
        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertEqual(result.sessions_scanned, 0)
        self.assertEqual(result.total_findings, 0)

    def test_harvest_no_store_file(self):
        fake_path = self.tmpdir / "nonexistent.db"
        result = harvest(store_path=fake_path, grain_root=self.grain_root)
        self.assertEqual(result.sessions_scanned, 0)

    def test_harvest_result_display(self):
        """Verify display doesn't crash with various result states."""
        result = HarvestResult()
        result.display(dry_run=True)

        result.decisions = ["Use PostgreSQL"]
        result.bug_patterns = [("null check fix", "abc")]
        result.project_updates = [("summary", ["conductor"])]
        result.new_topics = ["Kubernetes monitoring"]
        result.sessions_scanned = 5
        result.display(dry_run=False)

    def test_total_findings_count(self):
        result = HarvestResult()
        self.assertEqual(result.total_findings, 0)

        result.decisions = ["a", "b"]
        result.bug_patterns = [("c", "x")]
        result.project_updates = [("d", ["e"])]
        result.new_topics = ["f"]
        result.people_mentioned = {"Sarah": 2}
        self.assertEqual(result.total_findings, 6)


# ── Backup Script Tests ─────────────────────────────────────────────────────

class TestBackupScript(unittest.TestCase):
    """Test that backup.ps1 exists and is well-formed."""

    def test_backup_script_exists(self):
        backup_path = PROJECT_ROOT / "scripts" / "backup.ps1"
        self.assertTrue(backup_path.exists(), "scripts/backup.ps1 should exist")

    def test_backup_script_creates_backups_dir(self):
        content = (PROJECT_ROOT / "scripts" / "backup.ps1").read_text(encoding="utf-8")
        self.assertIn(".backups", content)

    def test_backup_script_prunes_old(self):
        content = (PROJECT_ROOT / "scripts" / "backup.ps1").read_text(encoding="utf-8")
        self.assertIn("maxBackups", content)


# ── Staleness Detection Tests ────────────────────────────────────────────────

class TestStalenessDetection(unittest.TestCase):
    """Test that lint.ps1 has staleness detection for last_verified."""

    def test_lint_checks_last_verified(self):
        lint_path = PROJECT_ROOT / "scripts" / "lint.ps1"
        content = lint_path.read_text(encoding="utf-8")
        self.assertIn("last_verified", content)

    def test_lint_uses_60_day_threshold(self):
        lint_path = PROJECT_ROOT / "scripts" / "lint.ps1"
        content = lint_path.read_text(encoding="utf-8")
        self.assertIn("60", content)

    def test_lint_reports_unverified_pages(self):
        lint_path = PROJECT_ROOT / "scripts" / "lint.ps1"
        content = lint_path.read_text(encoding="utf-8")
        self.assertIn("unverifiedPages", content)


# ── Template Tests ───────────────────────────────────────────────────────────

class TestTemplates(unittest.TestCase):
    """Test that templates include the new A+ features."""

    def test_copilot_instructions_has_auto_backup(self):
        path = PROJECT_ROOT / "templates" / "copilot-instructions.md"
        content = path.read_text(encoding="utf-8")
        self.assertIn("Auto-Backup", content)
        self.assertIn("backup.ps1", content)

    def test_copilot_instructions_has_proactive_surfacing(self):
        path = PROJECT_ROOT / "templates" / "copilot-instructions.md"
        content = path.read_text(encoding="utf-8")
        self.assertIn("Proactive Pattern Surfacing", content)
        self.assertIn("wiki/patterns/", content)

    def test_domain_template_has_last_verified(self):
        path = PROJECT_ROOT / "templates" / "domain-template.md"
        content = path.read_text(encoding="utf-8")
        self.assertIn("last_verified:", content)

    def test_brain_template_mentions_harvest(self):
        path = PROJECT_ROOT / "templates" / "brain.md"
        content = path.read_text(encoding="utf-8")
        self.assertIn("harvest", content)


# ── Setup Wizard Tests ───────────────────────────────────────────────────────

class TestSetupWizard(unittest.TestCase):
    """Test setup.ps1 includes harvest initialization."""

    def test_setup_creates_last_harvested(self):
        path = PROJECT_ROOT / "scripts" / "setup.ps1"
        content = path.read_text(encoding="utf-8")
        self.assertIn(".last_harvested", content)

    def test_setup_has_harvest_in_next_steps(self):
        path = PROJECT_ROOT / "scripts" / "setup.ps1"
        content = path.read_text(encoding="utf-8")
        self.assertIn("harvest", content.lower())

    def test_setup_creates_last_verified_in_domains(self):
        path = PROJECT_ROOT / "scripts" / "setup.ps1"
        content = path.read_text(encoding="utf-8")
        self.assertIn("last_verified", content)


# ── No Forbidden Strings ────────────────────────────────────────────────────

class TestHarvestNoForbiddenStrings(unittest.TestCase):
    """Verify no PII in harvest.py."""

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

    def test_harvest_clean(self):
        content = (PROJECT_ROOT / "engine" / "harvest.py").read_text(encoding="utf-8")
        for term in self.FORBIDDEN:
            self.assertNotIn(term, content, f"Forbidden string '{term}' found in harvest.py")


# ── Edge Cases ───────────────────────────────────────────────────────────────

class TestEdgeCases(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_session_with_no_turns(self):
        store_path = self.tmpdir / "store.db"
        grain_root = make_grain_dir(self.tmpdir / "grain")
        create_mock_session_store(store_path, [
            {"id": "sess-empty", "summary": "Empty session", "turns": []}
        ])
        result = harvest(store_path=store_path, grain_root=grain_root)
        # Should not crash
        self.assertEqual(result.sessions_scanned, 0)

    def test_session_with_none_fields(self):
        store_path = self.tmpdir / "store.db"
        grain_root = make_grain_dir(self.tmpdir / "grain")
        create_mock_session_store(store_path, [
            {
                "id": "sess-none",
                "summary": None,
                "turns": [
                    {"turn_index": 0, "user_message": None, "assistant_response": None},
                ],
            }
        ])
        result = harvest(store_path=store_path, grain_root=grain_root)
        # Should not crash
        self.assertIsNotNone(result)

    def test_very_long_decision_text(self):
        long_text = "decided to " + "x" * 500
        turns = [{"user_message": long_text, "assistant_response": ""}]
        decisions = extract_decisions(turns)
        for d in decisions:
            # Pattern captures up to 200 chars
            self.assertLessEqual(len(d), 200)

    def test_unicode_in_session(self):
        turns = [{"user_message": "Let's go with the café-style API → using émojis 🎉", "assistant_response": ""}]
        decisions = extract_decisions(turns)
        # Should not crash on unicode
        self.assertIsInstance(decisions, list)

    def test_harvest_result_zero_findings(self):
        result = HarvestResult()
        self.assertEqual(result.total_findings, 0)
        # Should not crash
        result.display(dry_run=True)


# ── People Name Extraction Tests ─────────────────────────────────────────────

class TestPeopleExtraction(unittest.TestCase):
    """Test people name detection from user messages."""

    def test_message_pattern(self):
        turns = [{"user_message": "Message Sarah about the deployment", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Sarah", names)

    def test_reply_to_pattern(self):
        turns = [{"user_message": "Reply to Jake with an update", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Jake", names)

    def test_possessive_pattern(self):
        turns = [{"user_message": "Look at Pramod's PR for the auth fix", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Pramod", names)

    def test_with_about_pattern(self):
        turns = [{"user_message": "I talked with Marcus about the architecture", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Marcus", names)

    def test_ping_pattern(self):
        turns = [{"user_message": "Ping Daniel about the review", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Daniel", names)

    def test_filters_common_words(self):
        turns = [{"user_message": "Check with the team about this issue", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        # "the" should be filtered even if capitalized in other contexts
        self.assertNotIn("The", names)

    def test_no_names_in_normal_text(self):
        turns = [{"user_message": "Run the tests and check the output", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertEqual(len(names), 0)

    def test_only_scans_user_messages(self):
        turns = [{"user_message": "", "assistant_response": "Message Sarah about deployment"}]
        names = extract_people_mentions(turns)
        # Should NOT extract from assistant responses
        self.assertEqual(len(names), 0)

    def test_dedup_within_session(self):
        turns = [
            {"user_message": "Message Sarah about X", "assistant_response": ""},
            {"user_message": "Also tell Sarah about Y", "assistant_response": ""},
        ]
        names = extract_people_mentions(turns)
        sarah_count = sum(1 for n in names if n == "Sarah")
        self.assertEqual(sarah_count, 1)

    def test_multiple_names(self):
        turns = [
            {"user_message": "Email Sarah about the review", "assistant_response": ""},
            {"user_message": "Check with Jake on the timeline", "assistant_response": ""},
        ]
        names = extract_people_mentions(turns)
        self.assertIn("Sarah", names)
        self.assertIn("Jake", names)

    def test_short_name_filtered(self):
        turns = [{"user_message": "Ask Bo about it", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        # "Bo" is only 2 chars, should be filtered
        self.assertNotIn("Bo", names)

    def test_cc_pattern(self):
        turns = [{"user_message": "CC Amanda on the thread", "assistant_response": ""}]
        names = extract_people_mentions(turns)
        self.assertIn("Amanda", names)


class TestLoadKnownPeople(unittest.TestCase):

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_loads_people_files(self):
        people_dir = self.tmpdir / "people"
        people_dir.mkdir()
        (people_dir / "sarah.md").write_text("# Sarah", encoding="utf-8")
        (people_dir / "jake.md").write_text("# Jake", encoding="utf-8")
        (people_dir / "README.md").write_text("# People", encoding="utf-8")
        with patch("engine.harvest.PEOPLE_PATH", people_dir):
            people = load_known_people()
        self.assertIn("sarah", people)
        self.assertIn("jake", people)
        self.assertNotIn("readme", people)

    def test_empty_dir(self):
        people_dir = self.tmpdir / "people"
        people_dir.mkdir()
        with patch("engine.harvest.PEOPLE_PATH", people_dir):
            people = load_known_people()
        self.assertEqual(len(people), 0)

    def test_nonexistent_dir(self):
        people_dir = self.tmpdir / "nonexistent"
        with patch("engine.harvest.PEOPLE_PATH", people_dir):
            people = load_known_people()
        self.assertEqual(len(people), 0)


class TestHarvestPeoplePipeline(unittest.TestCase):
    """Integration: harvest detects people mentions across sessions."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.store_path = self.tmpdir / "session-store.db"
        self.grain_root = make_grain_dir(self.tmpdir / "grain")
        # Create wiki/people/ dir
        (self.grain_root / "wiki" / "people").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir)

    def test_harvest_finds_new_people(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-people-1",
                "summary": "Code review",
                "turns": [
                    {"turn_index": 0, "user_message": "Reply to Sarah about the deployment plan", "assistant_response": "OK"},
                ],
            }
        ])
        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertIn("Sarah", result.people_mentioned)

    def test_harvest_skips_known_people(self):
        # Create an existing people page
        (self.grain_root / "wiki" / "people" / "sarah.md").write_text("# Sarah", encoding="utf-8")

        create_mock_session_store(self.store_path, [
            {
                "id": "sess-people-2",
                "summary": "Code review",
                "turns": [
                    {"turn_index": 0, "user_message": "Reply to Sarah about the fix", "assistant_response": "OK"},
                ],
            }
        ])
        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertNotIn("Sarah", result.people_mentioned)

    def test_harvest_counts_across_sessions(self):
        create_mock_session_store(self.store_path, [
            {
                "id": "sess-people-3a",
                "summary": "Sprint planning",
                "turns": [
                    {"turn_index": 0, "user_message": "Message Jake about the sprint", "assistant_response": "OK"},
                ],
            },
            {
                "id": "sess-people-3b",
                "summary": "Architecture review",
                "turns": [
                    {"turn_index": 0, "user_message": "Ask Jake about the design doc", "assistant_response": "OK"},
                ],
            },
        ])
        result = harvest(store_path=self.store_path, grain_root=self.grain_root)
        self.assertIn("Jake", result.people_mentioned)
        self.assertEqual(result.people_mentioned["Jake"], 2)

    def test_people_in_display(self):
        """Verify display includes people section."""
        result = HarvestResult()
        result.people_mentioned = {"Sarah": 3, "Jake": 1}
        result.sessions_scanned = 5
        # Should not crash
        result.display(dry_run=True)


# ── Persona Template Tests ───────────────────────────────────────────────────

class TestPersonaTemplates(unittest.TestCase):
    """Test that persona templates exist and contain required sections."""

    def test_persona_template_exists(self):
        path = PROJECT_ROOT / "templates" / "persona.md"
        self.assertTrue(path.exists())

    def test_persona_has_self_training(self):
        content = (PROJECT_ROOT / "templates" / "persona.md").read_text(encoding="utf-8")
        self.assertIn("SELF-TRAINING", content)

    def test_persona_has_honesty_gate(self):
        content = (PROJECT_ROOT / "templates" / "persona.md").read_text(encoding="utf-8")
        self.assertIn("Honesty Gate", content)

    def test_persona_has_style_sections(self):
        content = (PROJECT_ROOT / "templates" / "persona.md").read_text(encoding="utf-8")
        self.assertIn("Writing Style — Emails", content)
        self.assertIn("Writing Style — PRs", content)
        self.assertIn("Writing Style — Teams", content)
        self.assertIn("Writing Style — Technical Docs", content)

    def test_persona_has_placeholders(self):
        content = (PROJECT_ROOT / "templates" / "persona.md").read_text(encoding="utf-8")
        self.assertIn("[YOUR_NAME]", content)
        self.assertIn("[COMM_STYLE]", content)
        self.assertIn("[GREETING]", content)
        self.assertIn("[SIGNOFF]", content)

    def test_comms_template_exists(self):
        path = PROJECT_ROOT / "templates" / "domains" / "comms.md"
        self.assertTrue(path.exists())

    def test_comms_has_quick_resolve_table(self):
        content = (PROJECT_ROOT / "templates" / "domains" / "comms.md").read_text(encoding="utf-8")
        self.assertIn("Quick Resolve", content)
        self.assertIn("First name", content)
        self.assertIn("Full name", content)

    def test_comms_has_rules(self):
        content = (PROJECT_ROOT / "templates" / "domains" / "comms.md").read_text(encoding="utf-8")
        self.assertIn("persona.md", content)
        self.assertIn("Self-trains", content)

    def test_people_readme_exists(self):
        path = PROJECT_ROOT / "templates" / "people-readme.md"
        self.assertTrue(path.exists())

    def test_people_readme_has_format(self):
        content = (PROJECT_ROOT / "templates" / "people-readme.md").read_text(encoding="utf-8")
        self.assertIn("harvest.py", content)

    def test_copilot_instructions_has_persona(self):
        content = (PROJECT_ROOT / "templates" / "copilot-instructions.md").read_text(encoding="utf-8")
        self.assertIn("persona.md", content)
        self.assertIn("voice", content.lower())

    def test_copilot_instructions_has_comms_routing(self):
        content = (PROJECT_ROOT / "templates" / "copilot-instructions.md").read_text(encoding="utf-8")
        self.assertIn("comms.md", content)
        self.assertIn("Comms routing", content)

    def test_copilot_instructions_has_people_routing(self):
        content = (PROJECT_ROOT / "templates" / "copilot-instructions.md").read_text(encoding="utf-8")
        self.assertIn("wiki/people/", content)

    def test_setup_asks_persona_questions(self):
        content = (PROJECT_ROOT / "scripts" / "setup.ps1").read_text(encoding="utf-8")
        self.assertIn("communication style", content.lower())
        self.assertIn("greeting", content.lower())
        self.assertIn("sign off", content.lower())

    def test_setup_generates_persona(self):
        content = (PROJECT_ROOT / "scripts" / "setup.ps1").read_text(encoding="utf-8")
        self.assertIn("persona.md", content)

    def test_setup_copies_comms(self):
        content = (PROJECT_ROOT / "scripts" / "setup.ps1").read_text(encoding="utf-8")
        self.assertIn("comms.md", content)

    def test_setup_creates_people_dir(self):
        content = (PROJECT_ROOT / "scripts" / "setup.ps1").read_text(encoding="utf-8")
        self.assertIn("people", content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
