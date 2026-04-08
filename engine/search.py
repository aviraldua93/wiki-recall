"""
search.py — Hybrid search across compiled wiki + ChromaDB verbatim store

4 search modes:
  1. wiki_search(query) — grep wiki pages, rank by relevance
  2. semantic_search(query) — ChromaDB embedding search
  3. decision_search(query) — search decisions.md
  4. hybrid_search(query) — combine all three, deduplicate

Usage:
    from engine.search import GrainSearcher

    s = GrainSearcher()
    results = s.hybrid_search("why did we switch auth approach?")
    # Returns: [{"text": "...", "source": "wiki/projects/foo.md", "score": 0.95}, ...]
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

# Paths
GRAIN_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))
WIKI_PATH = GRAIN_ROOT / "wiki"
DECISIONS_PATH = GRAIN_ROOT / "decisions.md"
DOMAINS_PATH = GRAIN_ROOT / "domains"
CHROMADB_PATH = GRAIN_ROOT / "engine" / "chromadb"
COLLECTION_NAME = "grain_memory"


def _tokenize(text: str) -> list[str]:
    """Split text into lowercase word tokens for keyword matching."""
    return re.findall(r"[a-z0-9]+", text.lower())


def _keyword_score(query_tokens: list[str], text: str) -> float:
    """Score text against query tokens using term frequency.

    Returns a 0-1 score based on fraction of query tokens found,
    weighted by how many times they appear.
    """
    if not query_tokens:
        return 0.0
    text_lower = text.lower()
    text_tokens = set(_tokenize(text_lower))

    hits = 0
    total_weight = 0.0
    for qt in query_tokens:
        if qt in text_tokens:
            hits += 1
            count = text_lower.count(qt)
            total_weight += min(count, 5) / 5.0

    token_coverage = hits / len(query_tokens)
    density = total_weight / len(query_tokens)
    return 0.6 * token_coverage + 0.4 * density


def _extract_context(text: str, query_tokens: list[str], context_chars: int = 300) -> str:
    """Extract the most relevant snippet from text around query token matches."""
    text_lower = text.lower()
    best_pos = 0
    best_density = 0

    window = context_chars
    for i in range(0, max(1, len(text) - window), window // 4):
        chunk = text_lower[i : i + window]
        density = sum(1 for t in query_tokens if t in chunk)
        if density > best_density:
            best_density = density
            best_pos = i

    start = max(0, best_pos - 50)
    end = min(len(text), best_pos + context_chars)
    snippet = text[start:end].strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet


class GrainSearcher:
    """Hybrid searcher across wiki, decisions, and ChromaDB."""

    def __init__(
        self,
        wiki_path: Optional[Path] = None,
        decisions_path: Optional[Path] = None,
        domains_path: Optional[Path] = None,
        chromadb_path: Optional[Path] = None,
    ):
        self.wiki_path = wiki_path or WIKI_PATH
        self.decisions_path = decisions_path or DECISIONS_PATH
        self.domains_path = domains_path or DOMAINS_PATH
        self.chromadb_path = chromadb_path or CHROMADB_PATH
        self._chroma_collection = None

    # -- ChromaDB setup --

    def _get_chroma_collection(self):
        """Lazily connect to ChromaDB collection. Returns None if unavailable."""
        if self._chroma_collection is not None:
            return self._chroma_collection
        try:
            import chromadb

            client = chromadb.PersistentClient(path=str(self.chromadb_path))
            self._chroma_collection = client.get_collection(COLLECTION_NAME)
            return self._chroma_collection
        except Exception:
            return None

    # -- File helpers --

    def _walk_md_files(self, root: Path) -> list[Path]:
        """Recursively find all .md files under root."""
        if not root.exists():
            return []
        return sorted(root.rglob("*.md"))

    def _read_file(self, path: Path) -> str:
        """Read a file, returning empty string on failure."""
        try:
            return path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return ""

    def _relative_source(self, path: Path) -> str:
        """Convert absolute path to a source label relative to GRAIN_ROOT."""
        try:
            return str(path.relative_to(GRAIN_ROOT)).replace("\\", "/")
        except ValueError:
            return str(path)

    # -- Search modes --

    def wiki_search(self, query: str, max_results: int = 10) -> list[dict]:
        """Search wiki markdown files by keyword relevance.

        Searches all .md files under wiki/ and domains/.
        Returns results sorted by relevance score.
        """
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        results = []
        md_files = self._walk_md_files(self.wiki_path) + self._walk_md_files(self.domains_path)

        for fpath in md_files:
            text = self._read_file(fpath)
            if not text:
                continue

            score = _keyword_score(query_tokens, text)
            if score > 0.05:
                fname = fpath.stem.lower()
                if any(t in fname for t in query_tokens):
                    score = min(1.0, score + 0.2)

                results.append(
                    {
                        "text": _extract_context(text, query_tokens),
                        "source": self._relative_source(fpath),
                        "score": round(score, 4),
                        "mode": "wiki",
                    }
                )

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:max_results]

    def semantic_search(self, query: str, max_results: int = 10) -> list[dict]:
        """Search ChromaDB embeddings for semantic similarity.

        Returns results from the grain_memory collection.
        Falls back gracefully if ChromaDB is not indexed yet.
        """
        collection = self._get_chroma_collection()
        if collection is None:
            return []

        try:
            results = collection.query(query_texts=[query], n_results=max_results)
        except Exception:
            return []

        output = []
        if results and results.get("documents"):
            docs = results["documents"][0]
            metadatas = results.get("metadatas", [[]])[0]
            distances = results.get("distances", [[]])[0]

            for i, doc in enumerate(docs):
                meta = metadatas[i] if i < len(metadatas) else {}
                dist = distances[i] if i < len(distances) else 1.0
                score = max(0.0, 1.0 - dist / 2.0)
                source = meta.get("source", "chromadb")

                output.append(
                    {
                        "text": doc[:500],
                        "source": source,
                        "score": round(score, 4),
                        "mode": "semantic",
                    }
                )

        return output

    def decision_search(self, query: str, max_results: int = 10) -> list[dict]:
        """Search decisions.md for matching decision entries.

        Parses decisions.md into individual entries (lines starting with -)
        and scores each against the query.
        """
        if not self.decisions_path.exists():
            return []

        text = self._read_file(self.decisions_path)
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        results = []
        current_section = ""
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped.startswith("##"):
                current_section = stripped.lstrip("#").strip()
                continue
            if stripped.startswith("- "):
                entry_text = stripped[2:]
                score = _keyword_score(query_tokens, entry_text)
                if score > 0.05:
                    results.append(
                        {
                            "text": f"[{current_section}] {entry_text}",
                            "source": "decisions.md",
                            "score": round(score, 4),
                            "mode": "decision",
                        }
                    )

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:max_results]

    def hybrid_search(self, query: str, max_results: int = 10) -> list[dict]:
        """Combine wiki, semantic, and decision search with deduplication.

        Merges results from all three modes, deduplicates by source,
        and returns the top results by score.
        """
        wiki_results = self.wiki_search(query, max_results=max_results)
        semantic_results = self.semantic_search(query, max_results=max_results)
        decision_results = self.decision_search(query, max_results=max_results)

        all_results = wiki_results + semantic_results + decision_results

        seen: dict[str, dict] = {}
        for r in all_results:
            key = r["source"]
            if key not in seen or r["score"] > seen[key]["score"]:
                seen[key] = r

        merged = sorted(seen.values(), key=lambda r: r["score"], reverse=True)
        return merged[:max_results]


# -- CLI test --
if __name__ == "__main__":
    searcher = GrainSearcher()
    test_queries = [
        "why did we switch auth approach?",
        "agent orchestration patterns",
        "multi-agent coordination",
    ]

    for q in test_queries:
        print(f"\n{'='*60}")
        print(f"Query: {q}")
        print(f"{'='*60}")
        results = searcher.hybrid_search(q)
        if not results:
            print("  (no results)")
        for i, r in enumerate(results, 1):
            print(f"  [{i}] score={r['score']:.3f} mode={r['mode']} source={r['source']}")
            preview = r["text"][:120].replace("\n", " ")
            print(f"      {preview}")
