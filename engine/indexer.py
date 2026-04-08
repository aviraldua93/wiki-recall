"""
Wiki-Recall Memory Indexer — indexes Copilot CLI sessions, wiki pages, and decisions into ChromaDB.

Usage:
    python indexer.py                # Full reindex
    python indexer.py --incremental  # Only new sessions since last run
    python indexer.py --stats        # Show collection stats
"""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import chromadb

# ── Paths ──────────────────────────────────────────────────────────────────────
STORE_PATH = Path.home() / ".copilot" / "session-store.db"
CHROMA_PATH = Path.home() / ".grain" / "engine" / "chromadb"
WIKI_PATH = Path.home() / ".grain" / "wiki"
DECISIONS_PATH = Path.home() / ".grain" / "decisions.md"
LAST_INDEXED_PATH = Path.home() / ".grain" / "engine" / ".last_indexed"

COLLECTION_NAME = "grain_memory"
APPROX_TOKEN_LIMIT = 500  # target chunk size in approximate tokens


# ── Sanitization ───────────────────────────────────────────────────────────────
_INTERNAL_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.(?:com|org|net|io)", re.IGNORECASE)
_INTERNAL_URL_PATTERNS = [
    re.compile(r"https?://[a-zA-Z0-9.-]*\.visualstudio\.com[^\s)*\"']*", re.IGNORECASE),
    re.compile(r"https?://dev\.azure\.com/[^\s)*\"']*", re.IGNORECASE),
]


def sanitize(text: str) -> str:
    """Strip emails and internal URLs from text before indexing."""
    if not text:
        return text
    text = _INTERNAL_EMAIL_RE.sub("[EMAIL_REDACTED]", text)
    for pattern in _INTERNAL_URL_PATTERNS:
        text = pattern.sub("[INTERNAL_URL_REDACTED]", text)
    return text


# ── Token estimation ──────────────────────────────────────────────────────────
def estimate_tokens(text: str) -> int:
    """Rough token count: ~4 chars per token for English text."""
    return len(text) // 4 if text else 0


# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_turns(turns: list[dict], limit: int = APPROX_TOKEN_LIMIT) -> list[str]:
    """
    Chunk a list of turn dicts into text segments of ~`limit` tokens.
    Splits on turn boundaries — never mid-turn.
    Each turn dict has keys: turn_index, user_message, assistant_response.
    """
    chunks = []
    current_parts: list[str] = []
    current_tokens = 0

    for t in turns:
        turn_text = _format_turn(t)
        turn_tokens = estimate_tokens(turn_text)

        if turn_tokens > limit and current_parts:
            chunks.append("\n".join(current_parts))
            current_parts = [turn_text]
            current_tokens = turn_tokens
        elif current_tokens + turn_tokens > limit and current_parts:
            chunks.append("\n".join(current_parts))
            current_parts = [turn_text]
            current_tokens = turn_tokens
        else:
            current_parts.append(turn_text)
            current_tokens += turn_tokens

    if current_parts:
        chunks.append("\n".join(current_parts))

    return chunks if chunks else [""]


def _format_turn(t: dict) -> str:
    parts = []
    if t.get("user_message"):
        parts.append(f"Human: {t['user_message']}")
    if t.get("assistant_response"):
        resp = t["assistant_response"]
        if len(resp) > 3000:
            resp = resp[:3000] + "…[truncated]"
        parts.append(f"Assistant: {resp}")
    return "\n".join(parts)


def chunk_text(text: str, limit: int = APPROX_TOKEN_LIMIT) -> list[str]:
    """Chunk plain text (wiki/decisions) into ~limit-token segments on paragraph boundaries."""
    if not text or estimate_tokens(text) <= limit:
        return [text] if text else [""]

    paragraphs = text.split("\n\n")
    chunks = []
    current_parts: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = estimate_tokens(para)
        if current_tokens + para_tokens > limit and current_parts:
            chunks.append("\n\n".join(current_parts))
            current_parts = [para]
            current_tokens = para_tokens
        else:
            current_parts.append(para)
            current_tokens += para_tokens

    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks if chunks else [""]


# ── Document ID generation ────────────────────────────────────────────────────
def doc_id(prefix: str, key: str, chunk_idx: int = 0) -> str:
    """Deterministic document ID for dedup on rerun."""
    raw = f"{prefix}:{key}:{chunk_idx}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ── Database helpers ──────────────────────────────────────────────────────────
def get_human_sessions(conn: sqlite3.Connection, since: str | None = None) -> list[dict]:
    """Fetch non-agent-spawned sessions, optionally filtered by created_at > since."""
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
    cursor = conn.execute(
        "SELECT turn_index, user_message, assistant_response FROM turns "
        "WHERE session_id = ? ORDER BY turn_index",
        (session_id,),
    )
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def get_checkpoints(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    cursor = conn.execute(
        "SELECT checkpoint_number, title, overview, work_done, technical_details "
        "FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number",
        (session_id,),
    )
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


# ── Indexing functions ────────────────────────────────────────────────────────
def index_sessions(
    collection: chromadb.Collection,
    conn: sqlite3.Connection,
    since: str | None = None,
) -> int:
    """Index human sessions into ChromaDB. Returns count of documents added."""
    sessions = get_human_sessions(conn, since)
    total_docs = 0

    for sess in sessions:
        sid = sess["id"]
        turns = get_turns(conn, sid)
        if not turns:
            continue

        checkpoints = get_checkpoints(conn, sid)

        cp_summary = ""
        if checkpoints:
            cp_parts = [
                f"[CP{cp['checkpoint_number']}] {cp.get('title', '')}: {cp.get('overview', '')}"
                for cp in checkpoints
                if cp.get("title") or cp.get("overview")
            ]
            cp_summary = "\n".join(cp_parts)

        chunks = chunk_turns(turns)

        base_meta = {
            "type": "session",
            "session_id": sid,
            "repository": sess.get("repository") or "",
            "branch": sess.get("branch") or "",
            "created_at": sess.get("created_at") or "",
            "summary": sanitize(sess.get("summary") or ""),
            "turn_count": len(turns),
        }

        ids = []
        documents = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            content = sanitize(chunk)
            if i == 0 and cp_summary:
                content = f"[Checkpoints]\n{sanitize(cp_summary)}\n\n[Conversation]\n{content}"

            d_id = doc_id("session", sid, i)
            meta = {**base_meta, "chunk_index": i, "total_chunks": len(chunks)}

            ids.append(d_id)
            documents.append(content)
            metadatas.append(meta)

        if ids:
            collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
            total_docs += len(ids)

    return total_docs


def _classify_wiki_category(path: Path) -> str:
    """Determine wiki category from path: projects, patterns, concepts, or other."""
    parts = [p.lower() for p in path.parts]
    for category in ("projects", "patterns", "concepts"):
        if category in parts:
            return category
    if ".mining" in parts:
        return "mining"
    if ".verification" in parts:
        return "verification"
    return "other"


def index_wiki(collection: chromadb.Collection) -> int:
    """Index all wiki markdown files. Returns count of documents added."""
    if not WIKI_PATH.exists():
        print(f"  Wiki path not found: {WIKI_PATH}")
        return 0

    total_docs = 0
    md_files = sorted(WIKI_PATH.rglob("*.md"))

    for md_file in md_files:
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"  ⚠ Could not read {md_file}: {e}")
            continue

        if not content.strip():
            continue

        rel_path = str(md_file.relative_to(WIKI_PATH)).replace("\\", "/")
        category = _classify_wiki_category(md_file)

        chunks = chunk_text(sanitize(content))
        ids = []
        documents = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            d_id = doc_id("wiki", rel_path, i)
            meta = {
                "type": "wiki",
                "path": rel_path,
                "category": category,
                "chunk_index": i,
                "total_chunks": len(chunks),
            }
            ids.append(d_id)
            documents.append(chunk)
            metadatas.append(meta)

        if ids:
            collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
            total_docs += len(ids)

    return total_docs


def index_decisions(collection: chromadb.Collection) -> int:
    """Index each decision from decisions.md as a separate document."""
    if not DECISIONS_PATH.exists():
        print(f"  Decisions file not found: {DECISIONS_PATH}")
        return 0

    try:
        content = DECISIONS_PATH.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"  ⚠ Could not read {DECISIONS_PATH}: {e}")
        return 0

    content = sanitize(content)
    if not content.strip():
        return 0

    sections = re.split(r"^## (.+)$", content, flags=re.MULTILINE)

    decisions: list[dict] = []
    current_section = "General"

    for i in range(1, len(sections), 2):
        heading = sections[i].strip()
        body = sections[i + 1].strip() if i + 1 < len(sections) else ""

        for line in body.split("\n"):
            line = line.strip()
            if line.startswith("- "):
                decisions.append({"section": heading, "text": line[2:]})

    if not decisions:
        d_id = doc_id("decision", "all", 0)
        collection.upsert(
            ids=[d_id],
            documents=[content],
            metadatas=[{"type": "decision", "section": "all"}],
        )
        return 1

    ids = []
    documents = []
    metadatas = []

    for idx, dec in enumerate(decisions):
        d_id = doc_id("decision", f"{dec['section']}_{idx}", 0)
        text = f"[{dec['section']}] {dec['text']}"
        meta = {"type": "decision", "section": dec["section"], "decision_index": idx}
        ids.append(d_id)
        documents.append(text)
        metadatas.append(meta)

    collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    return len(ids)


# ── Timestamp tracking ────────────────────────────────────────────────────────
def read_last_indexed() -> str | None:
    if LAST_INDEXED_PATH.exists():
        try:
            return LAST_INDEXED_PATH.read_text(encoding="utf-8").strip()
        except Exception:
            return None
    return None


def write_last_indexed():
    LAST_INDEXED_PATH.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    LAST_INDEXED_PATH.write_text(ts, encoding="utf-8")


# ── Stats ─────────────────────────────────────────────────────────────────────
def show_stats(collection: chromadb.Collection):
    count = collection.count()
    print(f"\nCollection: {COLLECTION_NAME}")
    print(f"Total documents: {count}")

    if count == 0:
        return

    result = collection.get(limit=count, include=["metadatas"])
    type_counts: dict[str, int] = {}
    repo_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}

    for meta in result["metadatas"]:
        doc_type = meta.get("type", "unknown")
        type_counts[doc_type] = type_counts.get(doc_type, 0) + 1

        if doc_type == "session" and meta.get("repository"):
            repo = meta["repository"]
            repo_counts[repo] = repo_counts.get(repo, 0) + 1

        if doc_type == "wiki" and meta.get("category"):
            cat = meta["category"]
            category_counts[cat] = category_counts.get(cat, 0) + 1

    print("\nBy type:")
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")

    if repo_counts:
        print(f"\nTop repositories ({len(repo_counts)} total):")
        for repo, c in sorted(repo_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"  {repo}: {c}")

    if category_counts:
        print("\nWiki categories:")
        for cat, c in sorted(category_counts.items()):
            print(f"  {cat}: {c}")

    last = read_last_indexed()
    if last:
        print(f"\nLast indexed: {last}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Wiki-Recall Memory Indexer")
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Only index sessions created since last run",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show collection statistics",
    )
    args = parser.parse_args()

    CHROMA_PATH.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(path=str(CHROMA_PATH))

    if args.stats:
        try:
            collection = client.get_collection(COLLECTION_NAME)
        except Exception:
            print(f"Collection '{COLLECTION_NAME}' does not exist yet. Run indexer first.")
            return
        show_stats(collection)
        return

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    since = None
    if args.incremental:
        since = read_last_indexed()
        if since:
            print(f"Incremental mode — indexing sessions since {since}")
        else:
            print("No previous run found — doing full reindex")

    if not STORE_PATH.exists():
        print(f"⚠ Session store not found: {STORE_PATH}")
        session_count = 0
    else:
        print(f"Indexing sessions from {STORE_PATH}...")
        conn = sqlite3.connect(str(STORE_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            session_count = index_sessions(collection, conn, since)
            print(f"  ✓ {session_count} session document(s) indexed")
        finally:
            conn.close()

    if not args.incremental:
        print(f"Indexing wiki from {WIKI_PATH}...")
        wiki_count = index_wiki(collection)
        print(f"  ✓ {wiki_count} wiki document(s) indexed")

        print(f"Indexing decisions from {DECISIONS_PATH}...")
        dec_count = index_decisions(collection)
        print(f"  ✓ {dec_count} decision document(s) indexed")
    else:
        wiki_count = 0
        dec_count = 0

    write_last_indexed()

    total = session_count + wiki_count + dec_count
    print(f"\nDone. {total} total document(s) in collection.")
    show_stats(collection)


if __name__ == "__main__":
    main()
