"""
dream.py — Dream cycle engine for wiki-recall nightly enrichment.

Provides four phases that scripts/dream.ps1 invokes:

Phase 1: Entity Sweep — scan recent sessions for new people/project names not
          in the wiki and create tier-3 stub pages.
Phase 2: Timeline Updates — append dated entries to existing project and people
          pages from session activity.
Phase 3: Citation Fix — scan compiled truth sections for uncited claims and add
          [Source: ...] attribution where possible.
Phase 4: Consolidation — rewrite stale compiled truth sections from newer
          timeline entries. Uses .raw/ sidecar files as source material.
          Only rewrites for tier:1 and tier:2 pages; skips tier:3 stubs.

Usage:
    python -m engine.dream --phase 1          # entity sweep only
    python -m engine.dream --phase 2          # timeline updates
    python -m engine.dream --phase 3          # citation fix
    python -m engine.dream --phase 4          # consolidation
    python -m engine.dream --all              # run all phases
    python -m engine.dream --all --dry-run    # preview without writing
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────────────

GRAIN_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))
STORE_PATH = Path(os.environ.get(
    "SESSION_STORE_PATH",
    Path.home() / ".copilot" / "session-store.db",
))


# ── Phase 1: Entity Sweep ───────────────────────────────────────────────────

def phase_entity_sweep(
    grain_root: Optional[Path] = None,
    store_path: Optional[Path] = None,
    since: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Scan recent sessions for new people/project names and create stubs.

    Returns:
        Dict with 'people_created' and 'projects_created' lists.
    """
    from engine.harvest import (
        get_human_sessions,
        get_turns,
        extract_people_mentions,
        load_known_people,
        load_known_projects,
        create_people_page,
        read_last_harvested,
        slugify_name,
    )

    _grain = grain_root or GRAIN_ROOT
    _store = store_path or STORE_PATH
    _people_path = _grain / "wiki" / "people"
    _projects_path = _grain / "wiki" / "projects"

    result = {"people_created": [], "projects_created": []}

    if not _store.exists():
        logger.warning("Session store not found: %s", _store)
        return result

    # Load known entities
    known_people = set()
    if _people_path.exists():
        known_people = {md.stem for md in _people_path.glob("*.md")
                        if md.stem != "README" and not md.stem.startswith(".")}

    # Determine since timestamp
    if since is None:
        since = read_last_harvested()

    conn = sqlite3.connect(str(_store), timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        sessions = get_human_sessions(conn, since)

        discovered_people: dict[str, str] = {}  # name -> first session_id

        for sess in sessions:
            sid = sess["id"]
            turns = get_turns(conn, sid)
            if not turns:
                continue

            for name in extract_people_mentions(turns):
                slug = slugify_name(name)
                if slug not in known_people and name not in discovered_people:
                    discovered_people[name] = sid

    finally:
        conn.close()

    # Create stub pages for newly discovered people
    for name, sid in discovered_people.items():
        if dry_run:
            print(f"  [entity-sweep] Would create people stub: {name}")
            result["people_created"].append(name)
        else:
            created = create_people_page(
                name=name,
                session_id=sid,
                people_path=_people_path,
            )
            if created:
                result["people_created"].append(name)
                print(f"  [entity-sweep] Created people stub: {name}")

    count = len(result["people_created"])
    print(f"\n  Phase 1 complete: {count} people stub(s) {'would be ' if dry_run else ''}created")
    return result


# ── Phase 2: Timeline Updates ────────────────────────────────────────────────

def phase_timeline_updates(
    grain_root: Optional[Path] = None,
    store_path: Optional[Path] = None,
    since: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Append dated timeline entries to existing project and people pages.

    Returns:
        Dict with 'people_entries' and 'project_entries' counts.
    """
    from engine.harvest import (
        get_human_sessions,
        get_turns,
        extract_people_mentions,
        extract_project_mentions,
        load_known_projects,
        append_people_timeline,
        update_last_verified,
        read_last_harvested,
        slugify_name,
    )

    _grain = grain_root or GRAIN_ROOT
    _store = store_path or STORE_PATH
    _people_path = _grain / "wiki" / "people"
    _projects_path = _grain / "wiki" / "projects"

    result = {"people_entries": 0, "project_entries": 0}

    if not _store.exists():
        logger.warning("Session store not found: %s", _store)
        return result

    known_projects = []
    if _projects_path.exists():
        known_projects = [md.stem for md in _projects_path.glob("*.md")]

    if since is None:
        since = read_last_harvested()

    conn = sqlite3.connect(str(_store), timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        sessions = get_human_sessions(conn, since)

        for sess in sessions:
            sid = sess["id"]
            summary = sess.get("summary") or ""
            turns = get_turns(conn, sid)
            if not turns:
                continue

            # Timeline for people pages
            for name in extract_people_mentions(turns):
                slug = slugify_name(name)
                page = _people_path / f"{slug}.md"
                if not page.exists():
                    continue

                entry_text = ""
                for t in turns:
                    msg = t.get("user_message") or ""
                    if name.lower() in msg.lower() and len(msg) > 20:
                        entry_text = f"Mentioned: {msg[:120]}"
                        break

                if entry_text:
                    if dry_run:
                        print(f"  [timeline] Would append to {name}: {entry_text[:60]}...")
                        result["people_entries"] += 1
                    else:
                        appended = append_people_timeline(
                            name=name,
                            entry=entry_text,
                            session_id=sid,
                            people_path=_people_path,
                        )
                        if appended:
                            result["people_entries"] += 1

            # Timeline for project pages
            mentioned = extract_project_mentions(summary, known_projects)
            for proj in mentioned:
                slug = slugify_name(proj)
                page = _projects_path / f"{slug}.md"
                if not page.exists():
                    continue

                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                timeline_line = f"- [{today}] {summary[:120]} (session: {sid[:8]})"

                if dry_run:
                    print(f"  [timeline] Would append to {proj}: {summary[:60]}...")
                    result["project_entries"] += 1
                else:
                    content = page.read_text(encoding="utf-8", errors="replace")
                    if sid[:8] in content:
                        continue
                    if "## Timeline" in content:
                        content = content.rstrip("\n") + "\n" + timeline_line + "\n"
                    else:
                        content = content.rstrip("\n") + "\n\n## Timeline (append-only, never delete)\n" + timeline_line + "\n"
                    page.write_text(content, encoding="utf-8")
                    update_last_verified(page)
                    result["project_entries"] += 1

    finally:
        conn.close()

    total = result["people_entries"] + result["project_entries"]
    action = "would be " if dry_run else ""
    print(f"\n  Phase 2 complete: {total} timeline entries {action}appended "
          f"({result['people_entries']} people, {result['project_entries']} projects)")
    return result


# ── Phase 3: Citation Fix ────────────────────────────────────────────────────

def phase_citation_fix(
    grain_root: Optional[Path] = None,
    dry_run: bool = False,
) -> dict:
    """Scan compiled truth sections for uncited claims and add source attribution.

    Returns:
        Dict with 'citations_added' count and 'files_scanned' count.
    """
    _grain = grain_root or GRAIN_ROOT
    wiki_path = _grain / "wiki"

    result = {"citations_added": 0, "files_scanned": 0}

    if not wiki_path.exists():
        return result

    for md_file in wiki_path.rglob("*.md"):
        # Skip .raw/ directories, index, README
        if ".raw" in str(md_file):
            continue
        if md_file.stem in ("index", "README", "log"):
            continue

        content = md_file.read_text(encoding="utf-8", errors="replace")
        result["files_scanned"] += 1

        # Find compiled truth section
        truth_match = re.search(
            r"(## Compiled Truth\n)(.*?)(\n---|\n## )",
            content,
            re.DOTALL,
        )
        if not truth_match:
            continue

        truth_section = truth_match.group(2)

        # Check for lines that lack source attribution
        lines = truth_section.strip().split("\n")
        has_uncited = False
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("[No data"):
                continue
            if "[Source:" not in stripped and "observed:" not in stripped.lower():
                has_uncited = True
                break

        if not has_uncited:
            continue

        # Try to find timeline entries for attribution
        timeline_match = re.search(r"## Timeline.*$", content, re.DOTALL)
        if not timeline_match:
            continue

        timeline_text = timeline_match.group(0)
        session_ids = re.findall(r"\(session:\s*([a-f0-9]{8})\)", timeline_text)

        if not session_ids:
            continue

        latest_session = session_ids[-1]

        if dry_run:
            print(f"  [citation] Would add citation to: {md_file.stem} "
                  f"(source: session {latest_session})")
            result["citations_added"] += 1
        else:
            citation_line = f"\n[Source: observed, session {latest_session}]\n"
            if "\n---\n" in content:
                parts = content.split("\n---\n", 1)
                if "## Compiled Truth" in parts[0]:
                    content = parts[0].rstrip() + "\n" + citation_line + "\n---\n" + parts[1]
                    md_file.write_text(content, encoding="utf-8")
                    result["citations_added"] += 1
                    logger.info("Added citation to %s", md_file.stem)

    action = "would be " if dry_run else ""
    print(f"\n  Phase 3 complete: {result['citations_added']} citations {action}added "
          f"({result['files_scanned']} files scanned)")
    return result


# ── Phase 4: Consolidation ───────────────────────────────────────────────────

_CONSOLIDATION_PROMPT = """\
You are rewriting the "Compiled Truth" section of a wiki page based on newer
timeline entries and raw session excerpts.

The compiled truth should be a concise 5-10 line summary of the CURRENT state.
Do NOT include historical details — those belong in the timeline.
Use source attribution: [Source: observed, session XXXX] for each claim.

Entity: {entity_name}
Type: {entity_type}

Current compiled truth:
{current_truth}

Recent timeline entries:
{timeline_entries}

Raw session excerpts:
{raw_excerpts}

Write ONLY the new compiled truth section content (no headers, no frontmatter).
"""


def phase_consolidation(
    grain_root: Optional[Path] = None,
    dry_run: bool = False,
    use_llm: bool = True,
) -> dict:
    """Rewrite stale compiled truth sections from newer timeline entries.

    Only processes tier:1 and tier:2 pages. Skips tier:3 stubs.

    Returns:
        Dict with 'pages_consolidated' count and 'pages_skipped' count.
    """
    from engine.harvest import read_tier

    _grain = grain_root or GRAIN_ROOT
    wiki_path = _grain / "wiki"

    result = {"pages_consolidated": 0, "pages_skipped": 0, "tier3_skipped": 0}

    if not wiki_path.exists():
        return result

    for subdir_name in ("projects", "people"):
        subdir = wiki_path / subdir_name
        if not subdir.exists():
            continue

        entity_type = "project" if subdir_name == "projects" else "person"
        raw_dir = subdir / ".raw"

        for md_file in subdir.glob("*.md"):
            if md_file.stem in ("README", "index"):
                continue

            tier = read_tier(md_file)

            # Skip tier:3 stubs — they don't get compiled truth rewrites
            if tier == 3:
                result["tier3_skipped"] += 1
                continue

            content = md_file.read_text(encoding="utf-8", errors="replace")
            has_timeline = "## Timeline" in content

            if not has_timeline:
                result["pages_skipped"] += 1
                continue

            # Extract timeline entries
            timeline_match = re.search(r"## Timeline.*$", content, re.DOTALL)
            timeline_text = timeline_match.group(0) if timeline_match else ""

            # Extract current compiled truth
            truth_match = re.search(
                r"## Compiled Truth\n(.*?)(\n---|\n## )",
                content,
                re.DOTALL,
            )
            current_truth = truth_match.group(1).strip() if truth_match else ""

            # Gather raw excerpts
            raw_excerpts = ""
            if raw_dir.exists():
                slug = md_file.stem
                for raw_file in sorted(raw_dir.glob(f"{slug}-*.md")):
                    raw_content = raw_file.read_text(encoding="utf-8", errors="replace")
                    raw_excerpts += raw_content[:3000] + "\n---\n"

            if not timeline_text.strip() and not raw_excerpts.strip():
                result["pages_skipped"] += 1
                continue

            if dry_run:
                tier_label = f"tier:{tier}" if tier else "no tier"
                print(f"  [consolidation] Would rewrite: {md_file.stem} ({tier_label})")
                result["pages_consolidated"] += 1
                continue

            if not use_llm:
                result["pages_skipped"] += 1
                continue

            # Try LLM consolidation
            try:
                prompt = _CONSOLIDATION_PROMPT.format(
                    entity_name=md_file.stem.replace("-", " ").title(),
                    entity_type=entity_type,
                    current_truth=current_truth[:2000],
                    timeline_entries=timeline_text[:3000],
                    raw_excerpts=raw_excerpts[:5000],
                )

                from engine.llm_filter import _call_llm, _get_backend
                backend = _get_backend()
                if backend == "none":
                    logger.warning("No LLM backend — skipping consolidation for %s", md_file.stem)
                    result["pages_skipped"] += 1
                    continue

                new_truth = _call_llm(prompt, backend)
                new_truth = new_truth.strip()

                if new_truth and len(new_truth) > 20:
                    if truth_match:
                        old_section = truth_match.group(0)
                        separator = truth_match.group(2)
                        new_section = f"## Compiled Truth\n{new_truth}\n{separator}"
                        content = content.replace(old_section, new_section)

                        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        content = re.sub(
                            r"^updated:.*$",
                            f"updated: {today}",
                            content,
                            flags=re.MULTILINE,
                        )

                        md_file.write_text(content, encoding="utf-8")
                        result["pages_consolidated"] += 1
                        logger.info("Consolidated: %s", md_file.stem)

            except Exception as e:
                logger.warning("Consolidation failed for %s: %s", md_file.stem, e)
                result["pages_skipped"] += 1

    action = "would be " if dry_run else ""
    print(f"\n  Phase 4 complete: {result['pages_consolidated']} pages {action}consolidated, "
          f"{result['pages_skipped']} skipped, {result['tier3_skipped']} tier:3 stubs skipped")
    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Dream cycle — nightly wiki enrichment engine."
    )
    parser.add_argument(
        "--phase",
        type=int,
        choices=[1, 2, 3, 4],
        help="Run a specific phase (1-4)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all four phases in order",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing",
    )
    parser.add_argument(
        "--since",
        type=str,
        default=None,
        help="Process sessions since this date (ISO format)",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip LLM-based consolidation",
    )
    args = parser.parse_args()

    if not args.phase and not args.all:
        parser.print_help()
        return

    print(f"\n{'='*60}")
    print(f"  Dream Cycle {'(DRY RUN)' if args.dry_run else ''}")
    print(f"{'='*60}")

    if args.all or args.phase == 1:
        print("\n── Phase 1: Entity Sweep ──")
        phase_entity_sweep(since=args.since, dry_run=args.dry_run)

    if args.all or args.phase == 2:
        print("\n── Phase 2: Timeline Updates ──")
        phase_timeline_updates(since=args.since, dry_run=args.dry_run)

    if args.all or args.phase == 3:
        print("\n── Phase 3: Citation Fix ──")
        phase_citation_fix(dry_run=args.dry_run)

    if args.all or args.phase == 4:
        print("\n── Phase 4: Consolidation ──")
        phase_consolidation(dry_run=args.dry_run, use_llm=not args.no_llm)

    print(f"\n{'='*60}")
    print(f"  Dream cycle complete")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
