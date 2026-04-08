"""
mcp_server.py — MCP server for wiki-recall knowledge base

Tools:
  1. grain_wake_up() → L0+L1 text (~550 tokens)
  2. grain_search(query, mode="hybrid") → search results
  3. grain_recall(topic) → wiki page content for a topic
  4. grain_domains() → list all domains
  5. grain_domain(name) → read a specific domain file
  6. grain_decisions(query?) → search or list decisions
  7. grain_projects() → list all project wiki pages
  8. grain_patterns() → list all pattern pages
  9. grain_session(session_id) → get session details from session_store
  10. grain_status() → system health (page count, last indexed, brain age)

Start: python -m engine
Or: python mcp_server.py
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

# Paths
GRAIN_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))
WIKI_PATH = GRAIN_ROOT / "wiki"
DECISIONS_PATH = GRAIN_ROOT / "decisions.md"
DOMAINS_PATH = GRAIN_ROOT / "domains"
BRAIN_PATH = GRAIN_ROOT / "brain.md"
CHROMADB_PATH = GRAIN_ROOT / "engine" / "chromadb"

# Copilot CLI session store path
SESSION_STORE_PATH = Path.home() / ".copilot" / "session-store" / "session_store.db"

# Initialize MCP server
mcp = FastMCP(
    "grain",
    instructions=(
        "Grain is a personal knowledge base. "
        "Use grain_wake_up first to load identity context, "
        "then grain_search for queries, grain_recall for specific topics."
    ),
)

# Lazy import searcher
_searcher = None


def _get_searcher():
    global _searcher
    if _searcher is None:
        try:
            from engine.search import GrainSearcher
        except ImportError:
            import sys

            sys.path.insert(0, str(Path(__file__).parent))
            from search import GrainSearcher

        _searcher = GrainSearcher()
    return _searcher


def _read_file(path: Path) -> str:
    """Read a file, returning empty string on failure."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _list_md_files(directory: Path) -> list[str]:
    """List .md file stems in a directory (non-recursive)."""
    if not directory.exists():
        return []
    return sorted(f.stem for f in directory.glob("*.md"))


def _extract_section(lines: list[str], header_match: str) -> list[str]:
    """Extract lines between a ## header and the next ## header."""
    section_lines = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## ") or stripped.startswith("### "):
            if in_section:
                if stripped.startswith("## "):
                    break
            if header_match.lower() in stripped.lower():
                in_section = True
                continue
        if in_section and stripped:
            section_lines.append(stripped)
    return section_lines


def _compress_brain(brain_text: str) -> str:
    """Extract L0 (~50 tokens) + L1 (~500 tokens) from brain.md."""
    lines = brain_text.split("\n")

    l0_lines = _extract_section(lines, "L0")
    l0 = "L0 (Identity):\n" + "\n".join(l0_lines) if l0_lines else ""

    l1_lines = _extract_section(lines, "L1")
    l1 = "L1 (Active Work):\n" + "\n".join(l1_lines) if l1_lines else ""

    routing_lines = _extract_section(lines, "Routing")
    routing = "Routing:\n" + "\n".join(routing_lines) if routing_lines else ""

    parts = [p for p in [l0, l1, routing] if p]
    return "\n\n".join(parts)


# ─── Tools ───────────────────────────────────────────────────────────────────


@mcp.tool()
def grain_wake_up() -> str:
    """Load identity and key context from brain.md.

    Returns L0 (~50 tokens: identity, auth) + L1 (~500 tokens: top projects,
    recent decisions, work style). Call this first in any session to prime
    the agent with who-am-I context.
    """
    brain_text = _read_file(BRAIN_PATH)
    if not brain_text:
        return "ERROR: brain.md not found at " + str(BRAIN_PATH)

    return _compress_brain(brain_text)


@mcp.tool()
def grain_search(query: str, mode: str = "hybrid") -> str:
    """Search the knowledge base.

    Args:
        query: Natural language search query
        mode: One of "hybrid" (default), "wiki", "semantic", "decision"

    Returns JSON array of results with text, source, score, and mode.
    """
    searcher = _get_searcher()
    mode = mode.lower()

    if mode == "wiki":
        results = searcher.wiki_search(query)
    elif mode == "semantic":
        results = searcher.semantic_search(query)
    elif mode == "decision":
        results = searcher.decision_search(query)
    else:
        results = searcher.hybrid_search(query)

    if not results:
        return json.dumps({"results": [], "message": f"No results for '{query}' in mode={mode}"})

    return json.dumps({"results": results, "count": len(results)}, indent=2)


@mcp.tool()
def grain_recall(topic: str) -> str:
    """Read a specific wiki page by topic name.

    Searches for {topic}.md across wiki/projects/, wiki/patterns/,
    wiki/concepts/, wiki/domains/, and domains/.

    Args:
        topic: Topic name (e.g., "agent-orchestration", "a2a-protocol")
    """
    topic_slug = topic.lower().strip().replace(" ", "-").replace(".md", "")

    search_dirs = [
        WIKI_PATH / "projects",
        WIKI_PATH / "patterns",
        WIKI_PATH / "concepts",
        WIKI_PATH / "domains",
        DOMAINS_PATH,
        WIKI_PATH,
    ]

    for d in search_dirs:
        candidate = d / f"{topic_slug}.md"
        if candidate.exists():
            content = _read_file(candidate)
            source = str(candidate.relative_to(GRAIN_ROOT)).replace("\\", "/")
            return f"# {topic_slug}\nSource: {source}\n\n{content}"

    for d in search_dirs:
        if not d.exists():
            continue
        for f in d.glob("*.md"):
            if topic_slug in f.stem.lower():
                content = _read_file(f)
                source = str(f.relative_to(GRAIN_ROOT)).replace("\\", "/")
                return f"# {f.stem}\nSource: {source} (fuzzy match for '{topic}')\n\n{content}"

    return f"No wiki page found for '{topic}'. Try grain_search('{topic}') for broader results."


@mcp.tool()
def grain_domains() -> str:
    """List all domain files in the knowledge base.

    Returns the list of domains with file sizes.
    """
    if not DOMAINS_PATH.exists():
        return "No domains directory found."

    domains = []
    for f in sorted(DOMAINS_PATH.glob("*.md")):
        size_kb = f.stat().st_size / 1024
        domains.append({"name": f.stem, "file": f"domains/{f.name}", "size_kb": round(size_kb, 1)})

    return json.dumps({"domains": domains, "count": len(domains)}, indent=2)


@mcp.tool()
def grain_domain(name: str) -> str:
    """Read a specific domain file.

    Args:
        name: Domain name (e.g., "frontend", "backend", "infrastructure")
    """
    slug = name.lower().strip().replace(" ", "-").replace(".md", "")
    fpath = DOMAINS_PATH / f"{slug}.md"

    if not fpath.exists():
        available = _list_md_files(DOMAINS_PATH)
        return f"Domain '{name}' not found. Available: {', '.join(available)}"

    content = _read_file(fpath)
    return f"# Domain: {slug}\n\n{content}"


@mcp.tool()
def grain_decisions(query: Optional[str] = None) -> str:
    """Search or list all decisions from decisions.md.

    Args:
        query: Optional search query. If omitted, returns all decisions.
    """
    if not DECISIONS_PATH.exists():
        return "decisions.md not found."

    if query:
        searcher = _get_searcher()
        results = searcher.decision_search(query, max_results=15)
        return json.dumps({"query": query, "results": results, "count": len(results)}, indent=2)

    return _read_file(DECISIONS_PATH)


@mcp.tool()
def grain_projects() -> str:
    """List all project wiki pages.

    Returns names of all .md files in wiki/projects/.
    """
    projects_dir = WIKI_PATH / "projects"
    pages = _list_md_files(projects_dir)
    return json.dumps({"projects": pages, "count": len(pages)}, indent=2)


@mcp.tool()
def grain_patterns() -> str:
    """List all pattern wiki pages.

    Returns names of all .md files in wiki/patterns/.
    """
    patterns_dir = WIKI_PATH / "patterns"
    pages = _list_md_files(patterns_dir)
    return json.dumps({"patterns": pages, "count": len(pages)}, indent=2)


@mcp.tool()
def grain_session(session_id: str) -> str:
    """Get session details from the Copilot CLI session store.

    Args:
        session_id: The session ID to look up.

    Returns session metadata and first few turns.
    """
    if not SESSION_STORE_PATH.exists():
        return f"Session store not found at {SESSION_STORE_PATH}"

    try:
        conn = sqlite3.connect(str(SESSION_STORE_PATH))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        session = cur.fetchone()
        if not session:
            cur.execute("SELECT * FROM sessions WHERE id LIKE ?", (f"%{session_id}%",))
            session = cur.fetchone()

        if not session:
            conn.close()
            return f"Session '{session_id}' not found."

        session_data = dict(session)

        cur.execute(
            "SELECT turn_index, substr(user_message, 1, 200) as user_msg, "
            "substr(assistant_response, 1, 200) as assistant_resp "
            "FROM turns WHERE session_id = ? ORDER BY turn_index LIMIT 5",
            (session_data["id"],),
        )
        turns = [dict(row) for row in cur.fetchall()]

        conn.close()

        return json.dumps({"session": session_data, "turns_preview": turns}, indent=2, default=str)
    except Exception as e:
        return f"Error reading session store: {e}"


@mcp.tool()
def grain_status() -> str:
    """Get system health: page counts, brain age, ChromaDB status.

    Returns a status summary with:
    - Wiki page counts by category
    - Domain file count
    - Brain.md last modified date and age
    - ChromaDB collection size
    - Decisions count
    """
    status: dict = {}

    for subdir in ["projects", "patterns", "concepts", "domains"]:
        d = WIKI_PATH / subdir
        if d.exists():
            count = len(list(d.glob("*.md")))
            status[f"wiki_{subdir}"] = count

    if DOMAINS_PATH.exists():
        status["domain_files"] = len(list(DOMAINS_PATH.glob("*.md")))

    if BRAIN_PATH.exists():
        mtime = datetime.fromtimestamp(BRAIN_PATH.stat().st_mtime, tz=timezone.utc)
        age_days = (datetime.now(tz=timezone.utc) - mtime).days
        status["brain_last_modified"] = mtime.isoformat()
        status["brain_age_days"] = age_days

        brain_text = _read_file(BRAIN_PATH)
        match = re.search(r"Last refreshed:\s*(\S+)", brain_text)
        if match:
            status["brain_last_refreshed"] = match.group(1)

    try:
        import chromadb

        client = chromadb.PersistentClient(path=str(CHROMADB_PATH))
        col = client.get_collection("grain_memory")
        status["chromadb_documents"] = col.count()
        status["chromadb_status"] = "indexed"
    except Exception:
        status["chromadb_documents"] = 0
        status["chromadb_status"] = "not_indexed"

    if DECISIONS_PATH.exists():
        text = _read_file(DECISIONS_PATH)
        decision_count = len([l for l in text.split("\n") if l.strip().startswith("- [")])
        status["decision_count"] = decision_count

    if SESSION_STORE_PATH.exists():
        try:
            conn = sqlite3.connect(str(SESSION_STORE_PATH))
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM sessions")
            status["session_count"] = cur.fetchone()[0]
            conn.close()
        except Exception:
            status["session_count"] = "error"

    return json.dumps(status, indent=2)


# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
