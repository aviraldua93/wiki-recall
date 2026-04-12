"""
harvest.py — Auto-capture script for wiki-recall.

Mines recent Copilot CLI sessions from session_store.db and extracts:
  - Decisions (phrases: "decided to", "let's go with", "we're using", etc.)
  - Bug patterns (phrases: "fixed by", "the fix was", "workaround:", "gotcha:", etc.)
  - Project updates (session summaries mentioning known projects)
  - New topics (sessions about things not in the wiki)

Interface:
    python harvest.py                    # dry-run since last harvest
    python harvest.py --auto             # actually write changes
    python harvest.py --since 2026-04-08 # harvest since date
    python harvest.py --status           # show last harvest time

Safety: dry-run by default, dedup against existing content, human sessions only,
backup runs before any writes.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ── Paths ──────────────────────────────────────────────────────────────────────
GRAIN_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))
STORE_PATH = Path(os.environ.get(
    "SESSION_STORE_PATH",
    Path.home() / ".copilot" / "session-store.db",
))
WIKI_PATH = GRAIN_ROOT / "wiki"
DECISIONS_PATH = GRAIN_ROOT / "decisions.md"
PATTERNS_PATH = WIKI_PATH / "patterns"
PROJECTS_PATH = WIKI_PATH / "projects"
PEOPLE_PATH = WIKI_PATH / "people"
LAST_HARVESTED_PATH = GRAIN_ROOT / "engine" / ".last_harvested"
PROJECTS_RAW_PATH = PROJECTS_PATH / ".raw"
PEOPLE_RAW_PATH = PEOPLE_PATH / ".raw"

# Resolve templates from repo or embedded fallback
def _resolve_template_dir() -> Path | None:
    """Find the templates directory relative to this file's repo location."""
    repo_path = Path(__file__).resolve().parent.parent / "templates"
    if repo_path.exists():
        return repo_path
    grain_templates = GRAIN_ROOT / "templates"
    if grain_templates.exists():
        return grain_templates
    return None


TEMPLATE_DIR = _resolve_template_dir()


# ── Slugify ────────────────────────────────────────────────────────────────────

def slugify_name(name: str) -> str:
    """Convert a name to a kebab-case filename slug.

    Examples:
        "Mary Jane" -> "mary-jane"
        "O'Brien" -> "obrien"
        "John" -> "john"
    """
    slug = name.lower().strip()
    slug = re.sub(r"[''`]", "", slug)          # remove apostrophes
    slug = re.sub(r"[^a-z0-9]+", "-", slug)    # non-alphanum -> hyphens
    slug = slug.strip("-")
    return slug or "unknown"
def _resolve_backup_script() -> Path | None:
    """Resolve backup.ps1 location with multiple fallbacks.

    Search order:
    1. WIKIRECALL_BACKUP_SCRIPT environment variable
    2. ~/.grain/scripts/backup.ps1 (where setup.ps1 may have placed it)
    3. Relative to this file's repo location (scripts/backup.ps1)
    """
    # 1. Environment variable override
    env_path = os.environ.get("WIKIRECALL_BACKUP_SCRIPT")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p

    # 2. User's grain scripts directory
    grain_scripts = Path.home() / ".grain" / "scripts" / "backup.ps1"
    if grain_scripts.exists():
        return grain_scripts

    # 3. Repo-relative location (next to this file)
    repo_path = Path(__file__).resolve().parent.parent / "scripts" / "backup.ps1"
    if repo_path.exists():
        return repo_path

    return None


BACKUP_SCRIPT = _resolve_backup_script()


# ── Extraction patterns ──────────────────────────────────────────────────────

DECISION_PATTERNS = [
    re.compile(r"(?:decided to|let'?s go with|we'?re using|going with|chose|choosing|settled on|picking)\s+(.{10,200})", re.IGNORECASE),
    re.compile(r"(?:decision|decided):\s*(.{10,200})", re.IGNORECASE),
]

BUG_PATTERNS = [
    re.compile(r"(?:fixed by|the fix was|the fix is|workaround:|gotcha:|the issue was|root cause was|bug was)\s+(.{10,200})", re.IGNORECASE),
    re.compile(r"(?:fix|workaround|gotcha):\s*(.{10,200})", re.IGNORECASE),
]

# Patterns that mention a person by name in user messages
PEOPLE_MENTION_PATTERNS = [
    re.compile(r"(?:message|email|reply to|ask|ping|check with|talk to|meet with|sync with|tell|cc|loop in)\s+([A-Z][a-z]{2,15})", re.IGNORECASE),
    re.compile(r"([A-Z][a-z]{2,15})'s\s+(?:PR|email|message|review|feedback|code|branch|comment|suggestion)", re.IGNORECASE),
    re.compile(r"(?:from|with|and)\s+([A-Z][a-z]{2,15})\s+(?:about|on|regarding|for|said|thinks|suggested|mentioned)", re.IGNORECASE),
]

# Common words that match the capitalized-name pattern but aren't names
_NOT_NAMES = frozenset({
    "the", "this", "that", "what", "when", "where", "which", "while", "with",
    "from", "have", "here", "help", "how", "just", "let", "like", "make",
    "more", "need", "not", "now", "only", "our", "out", "over", "run",
    "see", "set", "some", "sure", "take", "than", "them", "then", "they",
    "too", "try", "use", "very", "want", "was", "way", "well", "will",
    "yes", "yet", "you", "your", "also", "been", "but", "can", "did",
    "does", "done", "each", "for", "get", "got", "had", "has", "its",
    "may", "much", "must", "new", "one", "per", "put", "say", "she",
    "should", "still", "such", "tell", "all", "and", "any", "are",
    "copilot", "github", "error", "fixed", "check", "using", "could",
    "would", "should", "about", "after", "before", "being", "between",
    "both", "could", "during", "every", "first", "found", "going",
    "great", "issue", "looks", "never", "other", "right", "since",
    "something", "start", "still", "thing", "think", "those", "under",
    "until", "working", "already", "because", "getting",
    "hey", "dear", "thanks", "best", "cheers",
    # Common English words that appear capitalized at sentence start
    "testing", "experts", "maybe", "loaded", "prompt", "why", "dom", "dev",
    "clicks", "note", "notes", "please", "also", "team", "build", "file",
    "code", "test", "data", "type", "pull", "push", "read", "show",
    "save", "move", "look", "find", "open", "close", "next", "last",
    "true", "false", "null", "none", "many", "most", "same", "real",
    "full", "auto", "main", "base", "core", "spec", "plan", "fast",
    "long", "hard", "free", "safe", "stop", "skip", "left", "keep",
    "drop", "pass", "fail", "warn", "info", "nice", "good", "fine",
    "cool", "sure", "wait", "call", "send", "load", "dump", "sort",
    "copy", "edit", "view", "list", "link", "sync", "diff", "grep",
    "merge", "patch", "debug", "reset", "clean", "setup", "refactor",
    "deploy", "query", "fetch", "parse", "cache", "proxy", "batch",
    "async", "await", "yield", "super", "class", "const", "model",
    "table", "field", "index", "route", "scope", "token", "agent",
    "brain", "grain", "vault", "stack", "layer", "state", "store",
    "queue", "event", "input", "print", "write", "added", "tried",
    "given", "known", "asked", "said", "based", "below", "above",
})


# ── Timestamp tracking ────────────────────────────────────────────────────────

def read_last_harvested() -> Optional[str]:
    """Read the timestamp of the last harvest run."""
    if LAST_HARVESTED_PATH.exists():
        try:
            return LAST_HARVESTED_PATH.read_text(encoding="utf-8").strip()
        except Exception:
            return None
    return None


def write_last_harvested():
    """Write the current timestamp as last harvest time."""
    LAST_HARVESTED_PATH.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    LAST_HARVESTED_PATH.write_text(ts, encoding="utf-8")


# ── Session fetching ─────────────────────────────────────────────────────────

def get_human_sessions(conn: sqlite3.Connection, since: Optional[str] = None) -> list[dict]:
    """Fetch non-agent-spawned sessions, optionally filtered by date."""
    query = """
        SELECT s.id, s.repository, s.branch, s.created_at, s.updated_at, s.summary
        FROM sessions s
        WHERE EXISTS (
            SELECT 1 FROM turns t
            WHERE t.session_id = s.id AND t.turn_index = 0
              AND t.user_message NOT LIKE 'You are the%'
              AND t.user_message NOT LIKE 'You are an AI%'
        )
    """
    params: list = []
    if since:
        query += " AND s.created_at > ?"
        params.append(since)

    query += " ORDER BY s.created_at"

    cursor = conn.execute(query, params)
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def get_turns(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    """Fetch all turns for a session."""
    cursor = conn.execute(
        "SELECT turn_index, user_message, assistant_response FROM turns "
        "WHERE session_id = ? ORDER BY turn_index",
        (session_id,),
    )
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


# ── Extraction functions ─────────────────────────────────────────────────────

# Words that indicate template/meta-language rather than real decisions
_DECISION_META_WORDS = frozenset({
    "decisions.md", "brain.md", "actions.md", "persona.md",
    "saved automatically", "template", "placeholder", "example",
    "copilot-instructions", "last_verified", "frontmatter",
    "wiki-recall", "session_store", "auto-captured",
})


def _is_template_decision(text: str) -> bool:
    """Check if a decision looks like template or meta-language."""
    text_lower = text.lower()
    return any(meta in text_lower for meta in _DECISION_META_WORDS)


def extract_decisions(turns: list[dict]) -> list[str]:
    """Extract decision statements from conversation turns."""
    decisions = []
    for turn in turns:
        for field in ("user_message", "assistant_response"):
            text = turn.get(field) or ""
            for pattern in DECISION_PATTERNS:
                for match in pattern.finditer(text):
                    decision = match.group(1).strip().rstrip(".,;")
                    if len(decision) < 20:
                        continue
                    if _is_template_decision(decision):
                        continue
                    if decision not in decisions:
                        decisions.append(decision)
    return decisions


def extract_bug_patterns(turns: list[dict]) -> list[str]:
    """Extract bug pattern descriptions from conversation turns."""
    patterns = []
    for turn in turns:
        for field in ("user_message", "assistant_response"):
            text = turn.get(field) or ""
            for pattern in BUG_PATTERNS:
                for match in pattern.finditer(text):
                    bug = match.group(1).strip().rstrip(".,;")
                    if len(bug) >= 15 and bug not in patterns:
                        patterns.append(bug)
    return patterns


def _has_name_context(text: str, name: str) -> bool:
    """Check if a name appears near contextual signals (@mention, verbs, prepositions)."""
    # Context keywords that strongly indicate a person reference
    context_signals = [
        f"@{name.lower()}", f"@{name}",
        f"{name} said", f"{name} asked", f"{name} thinks",
        f"{name} suggested", f"{name} mentioned", f"{name} wants",
        f"with {name}", f"from {name}", f"tell {name}",
        f"ask {name}", f"ping {name}", f"cc {name}",
    ]
    text_lower = text.lower()
    return any(sig.lower() in text_lower for sig in context_signals)


def extract_people_mentions(turns: list[dict]) -> list[str]:
    """Extract people names mentioned in user messages.

    Only scans user_message (not assistant responses) to avoid
    false positives from LLM-generated text.
    Applies multiple confidence filters:
    - Minimum 3 characters
    - Not in common-word exclusion list
    - Context heuristics boost confidence
    Returns deduplicated list of capitalized first names.
    """
    names: list[str] = []
    seen: set[str] = set()
    for turn in turns:
        text = turn.get("user_message") or ""
        if not text:
            continue
        for pattern in PEOPLE_MENTION_PATTERNS:
            for match in pattern.finditer(text):
                name = match.group(1).strip()
                name_lower = name.lower()
                if len(name) < 3:
                    continue
                if name_lower in _NOT_NAMES:
                    continue
                if name_lower in seen:
                    continue
                names.append(name.capitalize())
                seen.add(name_lower)
    return names


def load_known_people() -> set[str]:
    """Load known people names from wiki/people/ as slugified stems."""
    if not PEOPLE_PATH.exists():
        return set()
    return {md.stem for md in PEOPLE_PATH.glob("*.md") if md.stem != "README" and not md.stem.startswith(".")}


def extract_project_mentions(
    summary: str,
    known_projects: list[str],
) -> list[str]:
    """Find which known projects are mentioned in a session summary."""
    if not summary:
        return []
    summary_lower = summary.lower()
    return [p for p in known_projects if p.lower() in summary_lower]


def detect_new_topics(
    summary: str,
    known_pages: set[str],
) -> Optional[str]:
    """Detect if a session is about something not in the wiki.

    Returns the summary if it doesn't match any known page, None otherwise.
    """
    if not summary or len(summary) < 20:
        return None
    summary_lower = summary.lower()
    for page in known_pages:
        if page.lower() in summary_lower:
            return None
    return summary


# ── Deduplication ────────────────────────────────────────────────────────────

def load_existing_decisions() -> set[str]:
    """Load existing decision text from decisions.md for dedup."""
    if not DECISIONS_PATH.exists():
        return set()
    try:
        content = DECISIONS_PATH.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return set()
    existing = set()
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("- "):
            # Normalize: strip date prefix like [2026-04-01]
            text = re.sub(r"^\[[\d-]+\]\s*", "", stripped[2:])
            existing.add(text.lower().strip())
    return existing


def load_existing_patterns() -> set[str]:
    """Load existing pattern titles from wiki/patterns/ for dedup."""
    if not PATTERNS_PATH.exists():
        return set()
    existing = set()
    for md in PATTERNS_PATH.glob("*.md"):
        try:
            content = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for line in content.split("\n"):
            if line.startswith("### "):
                existing.add(line[4:].strip().lower())
    return existing


def load_known_projects() -> list[str]:
    """Load known project names from wiki/projects/."""
    if not PROJECTS_PATH.exists():
        return []
    return [md.stem for md in PROJECTS_PATH.glob("*.md")]


def load_known_pages() -> set[str]:
    """Load all known wiki page stems for new-topic detection."""
    pages: set[str] = set()
    if WIKI_PATH.exists():
        for md in WIKI_PATH.rglob("*.md"):
            pages.add(md.stem)
    return pages


# ── Checkpoint mining (#71) ──────────────────────────────────────────────────

def get_checkpoints(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    """Fetch all checkpoints for a session."""
    try:
        cursor = conn.execute(
            "SELECT checkpoint_number, title, overview, history, work_done, "
            "technical_details, important_files, next_steps "
            "FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number",
            (session_id,),
        )
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    except Exception:
        return []


def get_session_files(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    """Fetch all file operations for a session."""
    try:
        cursor = conn.execute(
            "SELECT file_path, tool_name, turn_index FROM session_files "
            "WHERE session_id = ? ORDER BY turn_index",
            (session_id,),
        )
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    except Exception:
        return []


def get_session_refs(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    """Fetch all refs (PRs, issues, commits) for a session."""
    try:
        cursor = conn.execute(
            "SELECT ref_type, ref_value, turn_index FROM session_refs "
            "WHERE session_id = ? ORDER BY turn_index",
            (session_id,),
        )
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    except Exception:
        return []


def extract_from_checkpoints(checkpoints: list[dict]) -> dict:
    """Extract decisions, patterns, and project updates from checkpoint data.

    Returns dict with keys: decisions, patterns, project_updates.
    Uses regex extraction on the rich checkpoint fields.
    """
    decisions: list[str] = []
    patterns: list[str] = []
    project_updates: list[str] = []

    decision_triggers = re.compile(
        r"(decided to|going with|settled on|chose|switched to|"
        r"architecture:|design decision|convention:)",
        re.I,
    )
    pattern_triggers = re.compile(
        r"(bug:|fix:|workaround:|gotcha:|pattern:|issue:|"
        r"root cause|the fix was|solved by)",
        re.I,
    )

    for cp in checkpoints:
        # Mine the richest fields: work_done, technical_details, overview
        for field in ("work_done", "technical_details", "overview", "history"):
            text = cp.get(field, "") or ""
            if not text:
                continue
            for line in text.split("\n"):
                stripped = line.strip().lstrip("- ")
                if not stripped or len(stripped) < 15:
                    continue
                if decision_triggers.search(stripped):
                    decisions.append(stripped)
                if pattern_triggers.search(stripped):
                    patterns.append(stripped)

        # Extract project updates from overview + title
        title = cp.get("title", "") or ""
        overview = cp.get("overview", "") or ""
        if title and len(title) > 10:
            project_updates.append(title)
        if overview and len(overview) > 30:
            project_updates.append(overview[:200])

    return {
        "decisions": decisions,
        "patterns": patterns,
        "project_updates": project_updates,
    }


# ── New project detection (#72) ──────────────────────────────────────────────

def detect_new_projects(
    session_repo: str,
    session_files: list[dict],
    known_projects: list[str],
) -> list[dict]:
    """Detect new projects from repository name and file paths.

    Returns list of dicts: [{name, source, evidence_count}]
    """
    known_lower = {p.lower() for p in known_projects}
    candidates: dict[str, dict] = {}

    # Method 1: Extract repo name from sessions.repository
    if session_repo:
        repo_name = session_repo.split("/")[-1] if "/" in session_repo else session_repo
        # Clean common prefixes/suffixes
        repo_name = repo_name.strip()
        if repo_name and repo_name.lower() not in known_lower:
            candidates[repo_name.lower()] = {
                "name": repo_name,
                "source": "repository",
                "evidence_count": 1,
            }

    # Method 2: Extract project roots from file paths
    for sf in session_files:
        fp = sf.get("file_path", "")
        if not fp:
            continue
        # Normalize path separators
        fp = fp.replace("\\", "/")
        parts = fp.split("/")
        # Look for common project root patterns
        for i, part in enumerate(parts):
            if part.lower() in ("src", "lib", "engine", "scripts", "tests", "docs"):
                # The directory before src/lib/etc is likely the project root
                if i > 0:
                    proj = parts[i - 1]
                    if proj.lower() not in known_lower and len(proj) > 2:
                        key = proj.lower()
                        if key in candidates:
                            candidates[key]["evidence_count"] += 1
                        else:
                            candidates[key] = {
                                "name": proj,
                                "source": "file_path",
                                "evidence_count": 1,
                            }
                break

    return list(candidates.values())


def create_project_page(
    name: str,
    repo: str,
    session_files: list[dict],
    session_refs: list[dict],
    session_date: str,
    session_summary: str,
    grain_root: Path | None = None,
) -> Path | None:
    """Create a new project page from template with pre-filled data.

    Returns the created file path, or None if creation failed.
    """
    _grain = grain_root or GRAIN_ROOT
    _projects = _grain / "wiki" / "projects"
    _projects.mkdir(parents=True, exist_ok=True)

    slug = slugify_name(name)
    page_path = _projects / f"{slug}.md"
    if page_path.exists():
        return None  # Already exists

    template_dir = _resolve_template_dir()
    template_content = ""
    if template_dir:
        template_file = template_dir / "project-template.md"
        if template_file.exists():
            template_content = template_file.read_text(encoding="utf-8", errors="replace")

    if not template_content:
        template_content = (
            "---\ntitle: \"[PROJECT_NAME]\"\ntype: project\n"
            "updated: [DATE]\ntier: 3\n---\n\n"
            "## Compiled Truth\n[Auto-generated -- needs review]\n\n"
            "## Decisions\n\n## Gates\n\n## Patterns\n\n---\n\n"
            "## Timeline (append-only, never delete)\n"
        )

    today = datetime.now().strftime("%Y-%m-%d")
    content = template_content.replace("[PROJECT_NAME]", name)
    content = content.replace("[DATE]", today)

    # Add timeline entry
    timeline_entry = f"- [{today}] Project detected by harvest (auto-generated)"
    if session_summary:
        timeline_entry += f" -- {session_summary[:100]}"

    # Add repo info to compiled truth if available
    if repo:
        content = content.replace(
            "[Auto-generated -- needs review]",
            f"Repository: {repo}. Auto-generated from session data -- needs review.",
        )
        content = content.replace(
            "[No data yet -- rewrite this section on every update, max 5-10 lines summarizing current state]",
            f"Repository: {repo}. Auto-generated from session data -- needs review.",
        )

    # Append timeline
    if "## Timeline" in content:
        content = content.rstrip() + f"\n{timeline_entry}\n"
    else:
        content += f"\n## Timeline\n{timeline_entry}\n"

    page_path.write_text(content, encoding="utf-8")
    return page_path


# ── Frontmatter helpers ──────────────────────────────────────────────────────

VALID_TIERS = {1, 2, 3}


def read_tier(filepath: Path) -> int | None:
    """Read the tier value (1, 2, or 3) from YAML frontmatter.

    Returns the tier as an int, or None if not found or invalid.
    """
    if not filepath.exists():
        return None
    content = filepath.read_text(encoding="utf-8", errors="replace")
    if not content.startswith("---"):
        return None
    end = content.find("---", 3)
    if end == -1:
        return None
    frontmatter = content[3:end]
    match = re.search(r"^tier:\s*(\d+)", frontmatter, re.MULTILINE)
    if match:
        val = int(match.group(1))
        return val if val in VALID_TIERS else None
    return None


def write_tier(filepath: Path, tier: int):
    """Set the tier value in YAML frontmatter. Creates frontmatter if missing.

    Args:
        filepath: Path to a Markdown file with YAML frontmatter.
        tier: Enrichment tier (1=deep, 2=notable, 3=stub).
    """
    if tier not in VALID_TIERS:
        raise ValueError(f"Invalid tier {tier}, must be one of {VALID_TIERS}")
    if not filepath.exists():
        return
    content = filepath.read_text(encoding="utf-8", errors="replace")

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            frontmatter = content[3:end]
            body = content[end:]
            if re.search(r"^tier:", frontmatter, re.MULTILINE):
                frontmatter = re.sub(
                    r"^tier:\s*\S+",
                    f"tier: {tier}",
                    frontmatter,
                    flags=re.MULTILINE,
                )
            else:
                frontmatter = frontmatter.rstrip("\n") + f"\ntier: {tier}\n"
            content = "---" + frontmatter + body
            filepath.write_text(content, encoding="utf-8")
            return

    # No frontmatter — prepend it
    content = f"---\ntier: {tier}\n---\n\n{content}"
    filepath.write_text(content, encoding="utf-8")


def update_last_verified(filepath: Path):
    """Update or add last_verified in YAML frontmatter."""
    if not filepath.exists():
        return
    content = filepath.read_text(encoding="utf-8", errors="replace")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            frontmatter = content[3:end]
            body = content[end:]
            if "last_verified:" in frontmatter:
                frontmatter = re.sub(
                    r"last_verified:\s*\S+",
                    f"last_verified: {today}",
                    frontmatter,
                )
            else:
                frontmatter = frontmatter.rstrip("\n") + f"\nlast_verified: {today}\n"
            content = "---" + frontmatter + body
            filepath.write_text(content, encoding="utf-8")
            return

    # No frontmatter — prepend it
    content = f"---\nlast_verified: {today}\n---\n\n{content}"
    filepath.write_text(content, encoding="utf-8")


# ── Embedded template fallback ───────────────────────────────────────────────

_PEOPLE_TEMPLATE_FALLBACK = """\
---
title: "[PERSON_NAME]"
type: person
updated: [DATE]
tags: []
tier: 3
---

## Compiled Truth
[No data yet — rewrite this section on updates with who they are, role, key context]

## Working Relationship
- Reports to: [No data yet]
- Collaborates on: [No data yet]
- Communication: [No data yet]
- Review pattern: [No data yet]

---

## Timeline (append-only, never delete)
"""


def _load_people_template() -> str:
    """Load people-template.md from templates dir, or use embedded fallback."""
    if TEMPLATE_DIR:
        tmpl_path = TEMPLATE_DIR / "people-template.md"
        if tmpl_path.exists():
            return tmpl_path.read_text(encoding="utf-8")
    return _PEOPLE_TEMPLATE_FALLBACK


# ── People page creation ─────────────────────────────────────────────────────

def create_people_page(
    name: str,
    session_id: str,
    people_path: Path | None = None,
) -> bool:
    """Create a new wiki/people/{slug}.md page from the people template.

    Args:
        name: The person's display name (e.g., "Sarah").
        session_id: The session ID that first mentioned this person.
        people_path: Override people directory path (for testing).

    Returns:
        True if page was created, False if it already existed.
    """
    _people = people_path or PEOPLE_PATH
    _people.mkdir(parents=True, exist_ok=True)

    slug = slugify_name(name)
    filepath = _people / f"{slug}.md"
    if filepath.exists():
        return False

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    template = _load_people_template()
    content = template.replace("[PERSON_NAME]", name.capitalize())
    content = content.replace("[DATE]", today)
    content = content.replace(
        "- [YYYY-MM-DD] What happened (session: session-id)",
        f"- [{today}] First mentioned in session (session: {session_id[:8]})",
    )

    filepath.write_text(content, encoding="utf-8")
    logger.info("Created people page: %s -> %s", name, filepath)
    return True


def append_people_timeline(
    name: str,
    entry: str,
    session_id: str,
    people_path: Path | None = None,
) -> bool:
    """Append a timeline entry to an existing people page.

    Only appends — never rewrites compiled truth (that's dream's job).

    Returns:
        True if entry was appended, False if page doesn't exist.
    """
    _people = people_path or PEOPLE_PATH
    slug = slugify_name(name)
    filepath = _people / f"{slug}.md"
    if not filepath.exists():
        return False

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    timeline_line = f"- [{today}] {entry} (session: {session_id[:8]})"

    content = filepath.read_text(encoding="utf-8", errors="replace")
    # Dedup: skip if this session + entry already logged
    if session_id[:8] in content and entry[:40] in content:
        return False

    if "## Timeline" in content:
        content = content.rstrip("\n") + "\n" + timeline_line + "\n"
    else:
        content = content.rstrip("\n") + "\n\n## Timeline (append-only, never delete)\n" + timeline_line + "\n"

    filepath.write_text(content, encoding="utf-8")
    update_last_verified(filepath)
    return True


# ── Raw sidecar writing ──────────────────────────────────────────────────────

def write_raw_sidecar(
    entity_type: str,
    entity_name: str,
    session_id: str,
    turns: list[dict],
    session_meta: dict,
    base_path: Path | None = None,
) -> Path | None:
    """Write raw session excerpts to .raw/ sidecar directory.

    Args:
        entity_type: "project" or "person".
        entity_name: Display name of the entity.
        session_id: Session ID.
        turns: List of turn dicts with user_message/assistant_response.
        session_meta: Dict with date, repository, branch for the header.
        base_path: Override wiki base path (for testing).

    Returns:
        Path of written file, or None if no relevant content.
    """
    _wiki = base_path or WIKI_PATH
    if entity_type == "project":
        raw_dir = _wiki / "projects" / ".raw"
    elif entity_type == "person":
        raw_dir = _wiki / "people" / ".raw"
    else:
        return None

    raw_dir.mkdir(parents=True, exist_ok=True)

    slug = slugify_name(entity_name)
    filename = f"{slug}-{session_id[:8]}.md"
    filepath = raw_dir / filename

    date = session_meta.get("date", session_meta.get("created_at", "unknown"))
    repo = session_meta.get("repository", "unknown")
    branch = session_meta.get("branch", "unknown")

    lines = [
        f"# Raw: {entity_name} — session {session_id[:8]}",
        f"",
        f"- Date: {date}",
        f"- Repository: {repo}",
        f"- Branch: {branch}",
        f"- Session: {session_id}",
        f"",
        f"---",
        f"",
    ]

    entity_lower = entity_name.lower()
    relevant_count = 0
    for turn in turns:
        user_msg = turn.get("user_message") or ""
        asst_msg = turn.get("assistant_response") or ""
        if entity_lower in user_msg.lower() or entity_lower in asst_msg.lower():
            relevant_count += 1
            idx = turn.get("turn_index", "?")
            lines.append(f"## Turn {idx}")
            if user_msg:
                lines.append(f"**User:** {user_msg[:2000]}")
                lines.append("")
            if asst_msg:
                lines.append(f"**Assistant:** {asst_msg[:2000]}")
                lines.append("")

    if relevant_count == 0:
        return None

    filepath.write_text("\n".join(lines), encoding="utf-8")
    return filepath


# ── Backup ───────────────────────────────────────────────────────────────────

def run_backup() -> bool:
    """Run backup.ps1 before writing changes. Returns True on success."""
    if BACKUP_SCRIPT is None:
        locations = [
            "  - WIKIRECALL_BACKUP_SCRIPT env var",
            "  - ~/.grain/scripts/backup.ps1",
            "  - <repo>/scripts/backup.ps1",
        ]
        print("  ⚠ backup.ps1 not found in any of these locations:")
        for loc in locations:
            print(loc)
        print("  Skipping backup — set WIKIRECALL_BACKUP_SCRIPT or run setup.ps1")
        return True
    try:
        result = subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(BACKUP_SCRIPT)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            print("  ✓ Backup completed")
            return True
        else:
            print(f"  ⚠ Backup returned exit code {result.returncode}")
            return True  # Don't block on backup failure
    except Exception as e:
        print(f"  ⚠ Backup failed: {e}")
        return True


# ── Write functions ──────────────────────────────────────────────────────────

def append_decisions(decisions: list[str]):
    """Append new decisions to decisions.md."""
    if not decisions:
        return
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [f"- [{today}] {d}" for d in decisions]
    block = "\n".join(lines) + "\n"

    if DECISIONS_PATH.exists():
        content = DECISIONS_PATH.read_text(encoding="utf-8", errors="replace")
        # Append under first ## section or at end
        if "## " in content:
            # Find last section and append there
            content = content.rstrip("\n") + "\n" + block
        else:
            content += "\n" + block
        DECISIONS_PATH.write_text(content, encoding="utf-8")
    else:
        DECISIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
        DECISIONS_PATH.write_text(f"# Decisions\n\n{block}", encoding="utf-8")


def append_bug_patterns(patterns: list[str], session_id: str):
    """Append new bug patterns to wiki/patterns/harvested.md."""
    if not patterns:
        return
    PATTERNS_PATH.mkdir(parents=True, exist_ok=True)
    filepath = PATTERNS_PATH / "harvested.md"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    entries = []
    for p in patterns:
        entries.append(f"### {p[:80]}\n- What: {p}\n- Source: session {session_id[:8]}\n- Date: {today}\n")

    block = "\n".join(entries)

    if filepath.exists():
        content = filepath.read_text(encoding="utf-8", errors="replace")
        content = content.rstrip("\n") + "\n\n" + block
        filepath.write_text(content, encoding="utf-8")
    else:
        header = f"---\nlast_verified: {today}\ntags: [patterns, harvested]\n---\n\n# Harvested Patterns\n\nBug patterns auto-captured by harvest.py.\n\n"
        filepath.write_text(header + block, encoding="utf-8")

    update_last_verified(filepath)


def _find_relevant_turns(
    turns: list[dict],
    entity_name: str,
) -> list[dict]:
    """Find turns that mention a specific entity name.

    Returns turns where user_message or assistant_response contains the name.
    """
    relevant = []
    name_lower = entity_name.lower()
    for turn in turns:
        user_msg = (turn.get("user_message") or "").lower()
        assistant_msg = (turn.get("assistant_response") or "").lower()
        if name_lower in user_msg or name_lower in assistant_msg:
            relevant.append(turn)
    return relevant

class HarvestResult:
    """Collects harvest findings for display or writing."""

    def __init__(self):
        self.decisions: list[str] = []
        self.bug_patterns: list[tuple[str, str]] = []  # (pattern, session_id)
        self.project_updates: list[tuple[str, list[str]]] = []  # (summary, projects)
        self.new_topics: list[str] = []
        self.people_mentioned: dict[str, int] = {}  # name -> session count
        self.people_created: list[str] = []  # names of created people pages
        self.raw_files_written: int = 0  # count of raw sidecar files written
        self.sessions_scanned: int = 0
        # Internal tracking for write phase
        self._people_session_ids: dict[str, str] = {}  # name -> first session_id
        self._raw_sidecar_queue: list[dict] = []  # queued raw sidecar entries

    @property
    def total_findings(self) -> int:
        return (
            len(self.decisions)
            + len(self.bug_patterns)
            + len(self.project_updates)
            + len(self.new_topics)
            + len(self.people_mentioned)
        )

    def display(self, dry_run: bool = True):
        mode = "DRY RUN" if dry_run else "WRITING"
        print(f"\n{'='*60}")
        print(f"  Harvest Results ({mode})")
        print(f"  Sessions scanned: {self.sessions_scanned}")
        print(f"  Total findings: {self.total_findings}")
        print(f"{'='*60}")

        if self.decisions:
            print(f"\n📋 Decisions ({len(self.decisions)}):")
            for d in self.decisions:
                print(f"  + {d[:100]}")

        if self.bug_patterns:
            print(f"\n🐛 Bug Patterns ({len(self.bug_patterns)}):")
            for p, sid in self.bug_patterns:
                print(f"  + {p[:100]} (session: {sid[:8]})")

        if self.project_updates:
            print(f"\n📁 Project Updates ({len(self.project_updates)}):")
            for summary, projects in self.project_updates:
                print(f"  + [{', '.join(projects)}] {summary[:80]}")

        if self.new_topics:
            print(f"\n🆕 New Topics ({len(self.new_topics)}):")
            for t in self.new_topics:
                print(f"  + {t[:100]}")

        if self.people_mentioned:
            print(f"\n🧑 People Mentioned ({len(self.people_mentioned)}):")
            for name, count in sorted(self.people_mentioned.items(), key=lambda x: -x[1]):
                slug = slugify_name(name)
                print(f"  + {name} ({count} session{'s' if count > 1 else ''}) — no wiki/people/{slug}.md yet")

        if self.people_created:
            print(f"\n📄 People Pages Created ({len(self.people_created)}):")
            for name in self.people_created:
                slug = slugify_name(name)
                print(f"  + wiki/people/{slug}.md")

        if dry_run and self.people_mentioned:
            print(f"\n📄 Would Create People Pages ({len(self.people_mentioned)}):")
            for name in self.people_mentioned:
                print(f"  Would create people page: {name}")

        if self.raw_files_written > 0:
            print(f"\n📦 Raw Sidecar Files: {self.raw_files_written}")

        if dry_run and self._raw_sidecar_queue:
            print(f"\n📦 Would Write Raw Sidecars ({len(self._raw_sidecar_queue)}):")
            for entry in self._raw_sidecar_queue[:10]:
                etype = entry["entity_type"]
                ename = entry["entity_name"]
                sid = entry["session_id"][:8]
                slug = slugify_name(ename)
                print(f"  Would write: wiki/{etype}s/.raw/{slug}-{sid}.md")
            if len(self._raw_sidecar_queue) > 10:
                print(f"  ... and {len(self._raw_sidecar_queue) - 10} more")

        if self.total_findings == 0:
            print("\n  (no new findings)")

        print()


class HarvestLLMUnavailableError(RuntimeError):
    """Raised when --auto mode requires LLM but none is available."""
    pass


def _check_llm_available() -> bool:
    """Check if any LLM backend is available for filtering.

    Always returns False since #49 (protocols architecture).
    Regex filtering is used instead.
    """
    return False


def harvest(
    since: Optional[str] = None,
    auto_write: bool = False,
    store_path: Optional[Path] = None,
    grain_root: Optional[Path] = None,
    llm_filter: bool = True,
    dry_run: bool = False,
) -> HarvestResult:
    """Run the harvest pipeline.

    Args:
        since: ISO timestamp — only harvest sessions after this time.
        auto_write: If True, write changes. If False, dry-run only.
        store_path: Override session store path (for testing).
        grain_root: Override grain root path (for testing).
        llm_filter: If True, run LLM verification on candidates.
        dry_run: If True, LLM filter shows what would be filtered but keeps all.

    Returns:
        HarvestResult with all findings.

    Raises:
        HarvestLLMUnavailableError: If auto_write=True and no LLM backend is available.
            In --auto mode, LLM filtering is mandatory to prevent noise from being
            written to decisions.md. Set OPENAI_API_KEY or install copilot CLI.
    """
    # LLM filtering removed in #49 (protocols architecture).
    # Regex filtering is used instead. --auto works without LLM.
    # Allow overrides for testing
    _store = store_path or STORE_PATH
    _grain = grain_root or GRAIN_ROOT
    _decisions_path = _grain / "decisions.md" if grain_root else DECISIONS_PATH
    _patterns_path = _grain / "wiki" / "patterns" if grain_root else PATTERNS_PATH
    _projects_path = _grain / "wiki" / "projects" if grain_root else PROJECTS_PATH
    _people_path = _grain / "wiki" / "people" if grain_root else PEOPLE_PATH
    _wiki_path = _grain / "wiki" if grain_root else WIKI_PATH

    result = HarvestResult()

    if not _store.exists():
        print(f"⚠ Session store not found: {_store}")
        return result

    # Load dedup sets
    existing_decisions = load_existing_decisions() if not grain_root else set()
    existing_patterns = load_existing_patterns() if not grain_root else set()
    known_projects = load_known_projects() if not grain_root else []
    known_pages = load_known_pages() if not grain_root else set()
    known_people = load_known_people() if not grain_root else set()

    # Allow override dedup sets when grain_root is provided (testing)
    if grain_root:
        if _decisions_path.exists():
            content = _decisions_path.read_text(encoding="utf-8", errors="replace")
            for line in content.split("\n"):
                stripped = line.strip()
                if stripped.startswith("- "):
                    text = re.sub(r"^\[[\d-]+\]\s*", "", stripped[2:])
                    existing_decisions.add(text.lower().strip())
        if _patterns_path.exists():
            for md in _patterns_path.glob("*.md"):
                content = md.read_text(encoding="utf-8", errors="replace")
                for line in content.split("\n"):
                    if line.startswith("### "):
                        existing_patterns.add(line[4:].strip().lower())
        if _projects_path.exists():
            known_projects = [md.stem for md in _projects_path.glob("*.md")]
        if _wiki_path.exists():
            known_pages = {md.stem for md in _wiki_path.rglob("*.md")}
        if _people_path.exists():
            known_people = {md.stem for md in _people_path.glob("*.md") if md.stem != "README" and not md.stem.startswith(".")}

    # Connect to session store with retry (#81)
    max_retries = 3
    conn = None
    for attempt in range(max_retries):
        try:
            conn = sqlite3.connect(str(_store), timeout=30)
            conn.execute("PRAGMA journal_mode=WAL")
            break
        except sqlite3.OperationalError as e:
            if attempt < max_retries - 1:
                import time
                time.sleep(2 ** attempt)  # exponential backoff
            else:
                print(f"Failed to connect to session store after {max_retries} attempts: {e}")
                return result
    if conn is None:
        return result

    try:
        sessions = get_human_sessions(conn, since)
        result.sessions_scanned = len(sessions)

        for sess in sessions:
            sid = sess["id"]
            summary = sess.get("summary") or ""
            repo = sess.get("repository") or ""
            turns = get_turns(conn, sid)
            if not turns:
                continue

            # Extract decisions from turns (regex)
            for d in extract_decisions(turns):
                if d.lower().strip() not in existing_decisions:
                    result.decisions.append(d)
                    existing_decisions.add(d.lower().strip())

            # Extract bug patterns from turns (regex)
            for p in extract_bug_patterns(turns):
                short = p[:80].lower().strip()
                if short not in existing_patterns:
                    result.bug_patterns.append((p, sid))
                    existing_patterns.add(short)

            # --- #71: Mine checkpoints for richer extraction ---
            checkpoints = get_checkpoints(conn, sid)
            if checkpoints:
                cp_extracted = extract_from_checkpoints(checkpoints)
                for d in cp_extracted["decisions"]:
                    if d.lower().strip() not in existing_decisions:
                        result.decisions.append(d)
                        existing_decisions.add(d.lower().strip())
                for p in cp_extracted["patterns"]:
                    short = p[:80].lower().strip()
                    if short not in existing_patterns:
                        result.bug_patterns.append((p, sid))
                        existing_patterns.add(short)

            # --- #71: Mine session_files for project detection ---
            sess_files = get_session_files(conn, sid)

            # --- #71: Mine session_refs for PR/issue linking ---
            sess_refs = get_session_refs(conn, sid)

            # Project mentions (existing)
            mentioned = extract_project_mentions(summary, known_projects)
            if mentioned:
                result.project_updates.append((summary, mentioned))

            # --- #72: Detect new projects from repo + file paths ---
            new_projects = detect_new_projects(repo, sess_files, known_projects)
            for np in new_projects:
                if np["name"].lower() not in {t.lower() for t in result.new_topics}:
                    evidence = f"{np['name']} (source: {np['source']}, evidence: {np['evidence_count']} signals)"
                    result.new_topics.append(evidence)
                    # Auto-create page in --auto mode
                    if auto_write:
                        created = create_project_page(
                            name=np["name"],
                            repo=repo,
                            session_files=sess_files,
                            session_refs=sess_refs,
                            session_date=sess.get("created_at", ""),
                            session_summary=summary,
                            grain_root=grain_root,
                        )
                        if created:
                            known_projects.append(np["name"])
                            result.project_updates.append(
                                (f"Auto-created project page: {created.name}", [np["name"]])
                            )

            # New topics (legacy fallback)
            new_topic = detect_new_topics(summary, known_pages)
            if new_topic and new_topic not in result.new_topics:
                result.new_topics.append(new_topic)

            # People mentions (only names without existing people pages)
            for name in extract_people_mentions(turns):
                slug = slugify_name(name)
                if slug not in known_people:
                    result.people_mentioned[name] = result.people_mentioned.get(name, 0) + 1
                    # Track first session ID for this person
                    if name not in result._people_session_ids:
                        result._people_session_ids[name] = sid

            # Queue raw sidecar files for projects mentioned in this session
            session_meta = {
                "created_at": sess.get("created_at", ""),
                "repository": sess.get("repository", ""),
                "branch": sess.get("branch", ""),
            }

            for project_name in mentioned if mentioned else []:
                relevant = _find_relevant_turns(turns, project_name)
                if relevant:
                    result._raw_sidecar_queue.append({
                        "entity_name": project_name,
                        "entity_type": "project",
                        "session_id": sid,
                        "turns": relevant,
                        "session_meta": session_meta,
                    })

            # Queue raw sidecar files for people mentioned in this session
            for name in extract_people_mentions(turns):
                relevant = _find_relevant_turns(turns, name)
                if relevant:
                    result._raw_sidecar_queue.append({
                        "entity_name": name,
                        "entity_type": "person",
                        "session_id": sid,
                        "turns": relevant,
                        "session_meta": session_meta,
                    })

    finally:
        conn.close()

    # ── LLM filtering step ───────────────────────────────────────────
    if llm_filter and result.total_findings > 0:
        try:
            from engine.llm_filter import filter_decisions as llm_filter_decisions
            from engine.llm_filter import filter_patterns as llm_filter_patterns
            from engine.llm_filter import filter_people as llm_filter_people

            raw_decision_count = len(result.decisions)
            raw_pattern_count = len(result.bug_patterns)
            raw_people_count = len(result.people_mentioned)

            # Filter decisions (MANDATORY in --auto mode)
            if result.decisions:
                decision_candidates = [{"text": d} for d in result.decisions]
                filtered = llm_filter_decisions(decision_candidates, dry_run=dry_run)
                if not dry_run:
                    result.decisions = [c["text"] for c in filtered]

            # Filter patterns
            if result.bug_patterns:
                pattern_candidates = [{"text": p} for p, _ in result.bug_patterns]
                filtered = llm_filter_patterns(pattern_candidates, dry_run=dry_run)
                if not dry_run:
                    filtered_texts = {c["text"] for c in filtered}
                    result.bug_patterns = [
                        (p, sid) for p, sid in result.bug_patterns
                        if p in filtered_texts
                    ]

            # Filter people
            if result.people_mentioned:
                people_candidates = [{"text": n} for n in result.people_mentioned]
                filtered = llm_filter_people(people_candidates, dry_run=dry_run)
                if not dry_run:
                    filtered_names = {c["text"] for c in filtered}
                    result.people_mentioned = {
                        n: c for n, c in result.people_mentioned.items()
                        if n in filtered_names
                    }

            # Log stats
            logger.info(
                "LLM filter: decisions %d→%d, patterns %d→%d, people %d→%d",
                raw_decision_count, len(result.decisions),
                raw_pattern_count, len(result.bug_patterns),
                raw_people_count, len(result.people_mentioned),
            )
        except HarvestLLMUnavailableError:
            raise
        except Exception as e:
            if auto_write:
                # In --auto mode, LLM failure is fatal — refuse to write unfiltered noise
                raise HarvestLLMUnavailableError(
                    f"LLM filtering failed during --auto harvest: {e}\n"
                    "Refusing to write unfiltered candidates to decisions.md.\n"
                    "Fix the LLM backend or use dry-run mode to preview candidates."
                ) from e
            logger.warning("LLM filtering failed: %s — using regex-only results", e)

    return result


def write_results(
    result: HarvestResult,
    grain_root: Optional[Path] = None,
):
    """Write harvest results to disk. Runs backup first.

    Args:
        result: HarvestResult with all findings.
        grain_root: Override grain root path (for testing).
    """
    if result.total_findings == 0:
        print("Nothing to write.")
        return

    _grain = grain_root or GRAIN_ROOT
    _people_path = _grain / "wiki" / "people" if grain_root else PEOPLE_PATH

    print("Running backup before writing...")
    run_backup()

    if result.decisions:
        append_decisions(result.decisions)
        print(f"  ✓ {len(result.decisions)} decision(s) appended to decisions.md")

    for pattern, session_id in result.bug_patterns:
        append_bug_patterns([pattern], session_id)
    if result.bug_patterns:
        print(f"  ✓ {len(result.bug_patterns)} pattern(s) written to wiki/patterns/harvested.md")

    if result.new_topics:
        print(f"  ℹ {len(result.new_topics)} new topic(s) detected — review manually:")
        for t in result.new_topics:
            print(f"    - {t[:100]}")

    # Create people pages for newly mentioned people
    if result.people_mentioned:
        for name in result.people_mentioned:
            # Find the first session ID that mentioned this person
            first_sid = result._people_session_ids.get(name)
            created = create_people_page(
                name=name,
                session_id=first_sid or "unknown",
                people_path=_people_path,
            )
            if created:
                result.people_created.append(name)

        if result.people_created:
            print(f"  ✓ {len(result.people_created)} people page(s) created")

    # Append timeline entries to existing people pages (tier-aware)
    _people_sessions = getattr(result, '_people_sessions', {})
    _session_turns = getattr(result, '_session_turns', {})
    timeline_appended = 0
    for name, session_ids in _people_sessions.items():
        slug = slugify_name(name)
        page_path = _people_path / f"{slug}.md"
        if not page_path.exists():
            continue
        tier = read_tier(page_path)
        # Tier 3 stubs only get timeline, no compiled truth rewrite
        # Tier 1 and 2 also get timeline (compiled truth rewrite is dream's job)
        for sid in session_ids:
            turns = _session_turns.get(sid, [])
            summary = ""
            for t in turns:
                msg = t.get("user_message") or ""
                if name.lower() in msg.lower() and len(msg) > 20:
                    summary = msg[:120]
                    break
            if summary:
                appended = append_people_timeline(
                    name=name,
                    people_path=_people_path,
                    entry=f"Mentioned: {summary}",
                    session_id=sid,
                )
                if appended:
                    timeline_appended += 1

    if timeline_appended > 0:
        print(f"  ✓ {timeline_appended} timeline entry/entries appended to existing people pages")

    # Append timeline entries to existing project pages (tier-aware)
    _projects_path = _grain / "wiki" / "projects" if grain_root else PROJECTS_PATH
    _project_sessions = getattr(result, '_project_sessions', {})
    project_timeline_count = 0
    for proj_name, session_ids in _project_sessions.items():
        slug = slugify_name(proj_name)
        page_path = _projects_path / f"{slug}.md"
        if not page_path.exists():
            continue
        tier = read_tier(page_path)
        # All tiers get timeline entries appended
        for sid in session_ids:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            turns = _session_turns.get(sid, [])
            summary_text = ""
            for t in turns:
                msg = t.get("user_message") or ""
                if proj_name.lower() in msg.lower() and len(msg) > 20:
                    summary_text = msg[:120]
                    break
            if not summary_text:
                summary_text = f"Session activity related to {proj_name}"

            timeline_line = f"- [{today}] {summary_text} (session: {sid[:8]})"
            content = page_path.read_text(encoding="utf-8", errors="replace")
            # Skip if this session is already logged
            if sid[:8] in content:
                continue
            if "## Timeline" in content:
                content = content.rstrip("\n") + "\n" + timeline_line + "\n"
            else:
                content = content.rstrip("\n") + "\n\n## Timeline (append-only, never delete)\n" + timeline_line + "\n"
            page_path.write_text(content, encoding="utf-8")
            update_last_verified(page_path)
            project_timeline_count += 1

    if project_timeline_count > 0:
        print(f"  ✓ {project_timeline_count} timeline entry/entries appended to project pages")

    # Write raw sidecar files
    _wiki_path = _grain / "wiki" if grain_root else WIKI_PATH
    if result._raw_sidecar_queue:
        raw_count = 0
        for entry in result._raw_sidecar_queue:
            path = write_raw_sidecar(
                entity_type=entry["entity_type"],
                entity_name=entry["entity_name"],
                session_id=entry["session_id"],
                turns=entry["turns"],
                session_meta=entry["session_meta"],
                base_path=_wiki_path,
            )
            if path:
                raw_count += 1
        result.raw_files_written = raw_count
        if raw_count > 0:
            print(f"  ✓ {raw_count} raw sidecar file(s) written")

    write_last_harvested()
    print(f"  ✓ .last_harvested updated")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Auto-capture decisions, patterns, and topics from Copilot CLI sessions."
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Actually write changes (default is dry-run)",
    )
    parser.add_argument(
        "--since",
        type=str,
        default=None,
        help="Harvest sessions since this date (ISO format, e.g., 2026-04-08)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show last harvest time and exit",
    )
    parser.add_argument(
        "--llm-filter",
        action="store_true",
        default=True,
        dest="llm_filter",
        help="Enable LLM verification of candidates (default: on)",
    )
    parser.add_argument(
        "--no-llm-filter",
        action="store_false",
        dest="llm_filter",
        help="Disable LLM filtering (regex-only, for CI/testing)",
    )
    args = parser.parse_args()

    if args.status:
        last = read_last_harvested()
        if last:
            print(f"Last harvested: {last}")
        else:
            print("Never harvested (run harvest.py to start)")
        return

    # Early LLM availability check for --auto mode
    if args.auto and args.llm_filter and not _check_llm_available():
        print(
            "ERROR: --auto mode requires an LLM backend for decision filtering.\n"
            "No LLM backend found. Please either:\n"
            "  1. Set OPENAI_API_KEY environment variable, or\n"
            "  2. Install the copilot CLI\n"
            "\n"
            "Run without --auto for a dry-run preview of regex-only candidates.\n"
            "Use --no-llm-filter to explicitly bypass (not recommended for production)."
        )
        sys.exit(1)

    since = args.since
    if since is None:
        since = read_last_harvested()
        if since:
            print(f"Harvesting since last run: {since}")
        else:
            print("First harvest — scanning all sessions")

    dry_run = not args.auto
    result = harvest(
        since=since,
        auto_write=args.auto,
        llm_filter=args.llm_filter,
        dry_run=dry_run,
    )
    result.display(dry_run=dry_run)

    if args.auto and result.total_findings > 0:
        write_results(result, grain_root=None)
    elif not args.auto and result.total_findings > 0:
        print("This was a dry run. Use --auto to write changes.")


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        print("Error: Python 3.9+ required. Found:", sys.version, file=sys.stderr)
        sys.exit(1)
    main()
