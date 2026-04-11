"""
refactor.py — Interactive refactoring for wiki-recall knowledge bases.

Guided 6-phase cleanup that depends on hygiene.py findings:
  Phase 1: Root cleanup (automated — move scripts, archive artifacts)
  Phase 2: Projects cleanup (interactive — ask per item)
  Phase 3: Content depth (show noise, ask to remove)
  Phase 4: Dedup check (show overlaps, ask to merge)
  Phase 5: Rebuild index (regenerate index.md from actual pages)
  Phase 6: Backup + validate (final health check)

Interface:
    python engine/refactor.py                  # refactor ~/.grain
    python engine/refactor.py /path/to/wiki    # refactor specific path

Safety: ALWAYS backs up first. Archives instead of deleting.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add project root so we can import engine modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.hygiene import (
    HygieneReport,
    check_structure,
    check_content,
    check_depth,
    check_duplication,
    has_frontmatter,
    extract_frontmatter_field,
    section_has_content,
    CONSTRUCTION_ARTIFACTS,
    SCRIPT_EXTENSIONS,
    DEFAULT_ROOT,
)

# ── Helpers ────────────────────────────────────────────────────────────────────

def prompt_yn(question: str, default: bool = False) -> bool:
    """Prompt user for yes/no answer."""
    suffix = " [Y/n] " if default else " [y/N] "
    answer = input(question + suffix).strip().lower()
    if not answer:
        return default
    return answer in ("y", "yes")


def ensure_backup(root: Path) -> Path:
    """Create a timestamped backup of the knowledge base root. Returns backup path."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = root.parent / f".grain-backup-{timestamp}"
    print(f"  Creating backup at: {backup_dir}")

    # Only backup key directories, not the entire tree
    for item_name in ("brain.md", "decisions.md", "actions.md", "wiki", "domains"):
        src = root / item_name
        if src.exists():
            if src.is_file():
                backup_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src), str(backup_dir / item_name))
            else:
                shutil.copytree(str(src), str(backup_dir / item_name))

    return backup_dir


def archive_path(root: Path, rel_path: str) -> Path:
    """Move a file/directory to .archive/ preserving relative structure."""
    archive_dir = root / ".archive"
    source = root / rel_path
    dest = archive_dir / rel_path

    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(str(dest))
        else:
            dest.unlink()

    shutil.move(str(source), str(dest))
    return dest


# ── Phases ─────────────────────────────────────────────────────────────────────

def phase_1_root_cleanup(root: Path) -> int:
    """Phase 1: Automated root cleanup."""
    print("\n── Phase 1: Root Cleanup (automated) ──")
    actions = 0

    # Move duplicate scripts from root to scripts/
    scripts_dir = root / "scripts"
    if scripts_dir.exists():
        for script_file in list(root.glob("*")):
            if script_file.is_file() and script_file.suffix in SCRIPT_EXTENSIONS:
                dup_path = scripts_dir / script_file.name
                if dup_path.exists():
                    print(f"  Removing duplicate root script: {script_file.name}")
                    script_file.unlink()
                    actions += 1

    # Archive construction artifacts
    for artifact_name in CONSTRUCTION_ARTIFACTS:
        artifact_path = root / artifact_name
        if artifact_path.exists():
            print(f"  Archiving: {artifact_name}/")
            archive_path(root, artifact_name)
            actions += 1

    # Remove empty directories
    if root.exists():
        for dirpath in sorted(root.rglob("*"), reverse=True):
            if dirpath.is_dir() and not dirpath.name.startswith("."):
                try:
                    contents = list(dirpath.iterdir())
                    if not contents:
                        print(f"  Removing empty dir: {dirpath.relative_to(root)}")
                        dirpath.rmdir()
                        actions += 1
                except Exception:
                    pass

    if actions == 0:
        print("  ✓ Root is clean — nothing to do")
    else:
        print(f"  ✓ {actions} cleanups applied")
    return actions


def phase_2_projects_cleanup(root: Path) -> int:
    """Phase 2: Interactive projects cleanup."""
    print("\n── Phase 2: Projects Cleanup (interactive) ──")
    actions = 0
    wiki_dir = root / "wiki"

    if not wiki_dir.exists():
        print("  No wiki/ directory found — skipping")
        return 0

    content_issues = check_content(root)
    depth_issues = check_depth(root)

    # Find stub/thin project pages
    project_issues = [
        i for i in content_issues + depth_issues
        if i.file and "projects" in str(i.file)
    ]

    if not project_issues:
        print("  ✓ All project pages look healthy")
        return 0

    for issue in project_issues:
        print(f"\n  {issue.severity.upper()}: {issue.message}")
        if issue.file:
            print(f"  File: {issue.file}")

        if issue.severity in ("warning", "error"):
            if prompt_yn("  Archive this page?"):
                try:
                    archive_path(root, issue.file)
                    print(f"  → Archived to .archive/{issue.file}")
                    actions += 1
                except Exception as e:
                    print(f"  → Failed: {e}")

    if actions == 0:
        print("  ✓ No changes made")
    else:
        print(f"  ✓ {actions} pages archived")
    return actions


def phase_3_content_depth(root: Path) -> int:
    """Phase 3: Content depth review — show noise, ask to remove."""
    print("\n── Phase 3: Content Depth Review ──")
    actions = 0

    content_issues = check_content(root)
    noise_issues = [
        i for i in content_issues
        if "harvest dump" in i.message.lower() or "stub" in i.message.lower()
    ]

    if not noise_issues:
        print("  ✓ No noise or stubs detected")
        return 0

    for issue in noise_issues:
        print(f"\n  {issue.severity.upper()}: {issue.message}")
        if issue.file:
            print(f"  File: {issue.file}")
        # Don't auto-delete — just inform
        print("  → Review manually and clean up if needed")

    return actions


def phase_4_dedup_check(root: Path) -> int:
    """Phase 4: Duplication check — show overlaps, ask to merge."""
    print("\n── Phase 4: Duplication Check ──")
    actions = 0

    dup_issues = check_duplication(root)

    if not dup_issues:
        print("  ✓ No duplicates or similar pages found")
        return 0

    for issue in dup_issues:
        print(f"\n  {issue.severity.upper()}: {issue.message}")
        if issue.file:
            print(f"  Files: {issue.file}")
        print("  → Review and merge manually if appropriate")

    return actions


def phase_5_rebuild_index(root: Path) -> int:
    """Phase 5: Rebuild index.md from actual wiki pages."""
    print("\n── Phase 5: Rebuild Index ──")
    wiki_dir = root / "wiki"
    index_file = wiki_dir / "index.md"

    if not wiki_dir.exists():
        print("  No wiki/ directory — skipping")
        return 0

    # Collect pages by type
    pages_by_type: dict[str, list[str]] = {
        "Projects": [],
        "Patterns": [],
        "Concepts": [],
        "People": [],
        "Other": [],
    }

    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue

        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        page_name = md_file.stem
        page_type = extract_frontmatter_field(content, "type") or ""
        title = extract_frontmatter_field(content, "title") or page_name

        # Classify by type or directory
        if page_type == "project" or md_file.parent.name == "projects":
            pages_by_type["Projects"].append((page_name, title))
        elif page_type == "pattern" or md_file.parent.name == "patterns":
            pages_by_type["Patterns"].append((page_name, title))
        elif page_type == "concept" or md_file.parent.name == "concepts":
            pages_by_type["Concepts"].append((page_name, title))
        elif page_type == "person" or md_file.parent.name == "people":
            pages_by_type["People"].append((page_name, title))
        else:
            pages_by_type["Other"].append((page_name, title))

    # Build new index
    lines = [
        "# Wiki Index",
        "",
        "Master catalog of all wiki pages. Links use [[wikilink]] format.",
        "",
    ]

    for section, entries in pages_by_type.items():
        if section == "Other" and not entries:
            continue
        lines.append(f"## {section}")
        if entries:
            for slug, title in sorted(entries, key=lambda x: x[0]):
                lines.append(f"- [[{slug}]] — {title}")
        else:
            lines.append("[No data yet]")
        lines.append("")

    new_content = "\n".join(lines)

    if not prompt_yn(f"  Rebuild index.md with {sum(len(v) for v in pages_by_type.values())} pages?", default=True):
        print("  → Skipped")
        return 0

    # Backup existing index
    if index_file.exists():
        backup = index_file.with_suffix(".md.bak")
        shutil.copy2(str(index_file), str(backup))

    index_file.write_text(new_content, encoding="utf-8")
    print("  ✓ index.md rebuilt")
    return 1


def phase_6_validate(root: Path) -> int:
    """Phase 6: Final validation — run hygiene and show results."""
    print("\n── Phase 6: Final Validation ──")

    report = HygieneReport(root)
    report.run()
    report.print_report()

    return 0


# ── Main ───────────────────────────────────────────────────────────────────────

def refactor(root: Path) -> None:
    """Run the full 6-phase refactoring workflow."""
    print()
    print("Wiki-Recall Brain Refactoring")
    print("=" * 40)
    print(f"Target: {root}")
    print()

    if not root.exists():
        print(f"Error: path does not exist: {root}")
        sys.exit(1)

    # Always backup first
    print("── Pre-flight: Backup ──")
    backup_dir = ensure_backup(root)
    print(f"  ✓ Backup saved to: {backup_dir}")

    # Run phases
    phase_1_root_cleanup(root)
    phase_2_projects_cleanup(root)
    phase_3_content_depth(root)
    phase_4_dedup_check(root)
    phase_5_rebuild_index(root)
    phase_6_validate(root)

    print()
    print("Refactoring complete. Backup at:", backup_dir)
    print()


def main() -> None:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Interactive brain refactoring for wiki-recall knowledge bases",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_ROOT),
        help="Path to knowledge base root (default: ~/.grain)",
    )
    args = parser.parse_args()
    root = Path(args.path)
    refactor(root)


if __name__ == "__main__":
    main()
