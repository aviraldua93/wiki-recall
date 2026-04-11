"""
validate_paths.py — Validate file/directory path references in copilot-instructions.md.

Parses copilot-instructions.md for path-like references (e.g., ~/.grain/brain.md,
wiki/patterns/, scripts/backup.ps1) and checks each against the knowledge base root
directory on disk.

Usage:
    python -m engine.validate_paths                     # report broken paths
    python -m engine.validate_paths --fix               # remove broken path lines
    python -m engine.validate_paths --root /path/to/kb  # custom KB root
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default grain root
GRAIN_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))

# Patterns to extract path references from copilot-instructions.md
# Matches things like: ~/.grain/brain.md, wiki/patterns/, scripts/backup.ps1,
# domains/comms.md, templates/RESOLVER.md, etc.
_PATH_PATTERNS = [
    # ~/.grain/... paths (absolute grain paths)
    re.compile(r"~/.grain/([^\s,)}\]\"'`]+)"),
    # Backtick-wrapped paths that look like file/dir references
    re.compile(r"`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`"),
    re.compile(r"`([a-zA-Z0-9_./-]+/)`"),
    # Bare paths in the form dir/file.ext or dir/subdir/
    re.compile(r"(?:^|\s)([a-zA-Z0-9_-]+/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?:\s|$|[,)\]\"'`])"),
    re.compile(r"(?:^|\s)([a-zA-Z0-9_-]+/[a-zA-Z0-9_./-]+/)(?:\s|$|[,)\]\"'`])"),
]

# Paths to skip (not actual file references)
_SKIP_PATTERNS = {
    "gpt-4o-mini",
    "http://",
    "https://",
    "0.0-1.0",
    "YYYY-MM-DD",
}

# Known non-filesystem path segments to skip
_SKIP_PREFIXES = ("http://", "https://", "#", "//")


class BrokenPath:
    """Represents a broken path reference found in copilot-instructions.md."""

    def __init__(self, line_number: int, line_text: str, referenced_path: str, resolved_path: Path):
        self.line_number = line_number
        self.line_text = line_text.rstrip("\n")
        self.referenced_path = referenced_path
        self.resolved_path = resolved_path

    def __repr__(self) -> str:
        return f"BrokenPath(line={self.line_number}, path='{self.referenced_path}')"


def extract_path_references(content: str) -> list[tuple[int, str, str]]:
    """Extract file/directory path references from copilot-instructions.md content.

    Returns list of (line_number, line_text, path_reference) tuples.
    Line numbers are 1-based.
    """
    results: list[tuple[int, str, str]] = []
    seen: set[tuple[int, str]] = set()  # (line_number, path) dedup

    for line_num, line in enumerate(content.split("\n"), 1):
        for pattern in _PATH_PATTERNS:
            for match in pattern.finditer(line):
                path_ref = match.group(1).strip().rstrip(".,;:)")
                # Skip non-path references
                if any(skip in path_ref for skip in _SKIP_PATTERNS):
                    continue
                if any(path_ref.startswith(prefix) for prefix in _SKIP_PREFIXES):
                    continue
                # Skip very short references (likely not paths)
                if len(path_ref) < 4:
                    continue
                # Dedup within same line
                key = (line_num, path_ref)
                if key not in seen:
                    seen.add(key)
                    results.append((line_num, line, path_ref))

    return results


def resolve_path(path_ref: str, kb_root: Path) -> Path:
    """Resolve a path reference relative to the knowledge base root.

    Handles:
    - ~/.grain/X -> kb_root/X (strip the grain prefix)
    - Relative paths -> kb_root/path
    """
    # Strip ~/.grain/ prefix since we resolve relative to kb_root
    cleaned = path_ref
    if cleaned.startswith("~/.grain/"):
        cleaned = cleaned[len("~/.grain/"):]

    # Normalize to forward slashes, then resolve
    cleaned = cleaned.replace("\\", "/")
    return kb_root / cleaned


def validate_paths(
    instructions_path: Optional[Path] = None,
    kb_root: Optional[Path] = None,
) -> list[BrokenPath]:
    """Validate path references in copilot-instructions.md.

    Args:
        instructions_path: Path to copilot-instructions.md. If None, looks in
            kb_root/copilot-instructions.md and ~/.github/copilot-instructions.md.
        kb_root: Knowledge base root directory. Defaults to GRAIN_ROOT.

    Returns:
        List of BrokenPath objects for paths that don't exist on disk.
    """
    root = kb_root or GRAIN_ROOT

    # Find the instructions file
    if instructions_path is None:
        candidates = [
            root / "copilot-instructions.md",
            Path.home() / ".github" / "copilot-instructions.md",
        ]
        instructions_path = next((p for p in candidates if p.exists()), None)
        if instructions_path is None:
            logger.warning("No copilot-instructions.md found")
            return []

    if not instructions_path.exists():
        logger.warning("copilot-instructions.md not found at %s", instructions_path)
        return []

    content = instructions_path.read_text(encoding="utf-8", errors="replace")
    path_refs = extract_path_references(content)

    broken: list[BrokenPath] = []
    for line_num, line_text, path_ref in path_refs:
        resolved = resolve_path(path_ref, root)
        if not resolved.exists():
            broken.append(BrokenPath(
                line_number=line_num,
                line_text=line_text,
                referenced_path=path_ref,
                resolved_path=resolved,
            ))

    return broken


def fix_broken_paths(
    instructions_path: Path,
    broken_paths: list[BrokenPath],
    interactive: bool = True,
) -> int:
    """Remove or comment out lines with broken path references.

    Args:
        instructions_path: Path to copilot-instructions.md.
        broken_paths: List of BrokenPath objects to fix.
        interactive: If True, ask for confirmation before each removal.

    Returns:
        Number of lines modified.
    """
    if not broken_paths or not instructions_path.exists():
        return 0

    content = instructions_path.read_text(encoding="utf-8", errors="replace")
    lines = content.split("\n")
    modified_count = 0

    # Group broken paths by line number
    broken_by_line: dict[int, list[BrokenPath]] = {}
    for bp in broken_paths:
        broken_by_line.setdefault(bp.line_number, []).append(bp)

    # Process from bottom to top to preserve line numbers
    for line_num in sorted(broken_by_line.keys(), reverse=True):
        bps = broken_by_line[line_num]
        idx = line_num - 1  # 0-based
        if idx < 0 or idx >= len(lines):
            continue

        paths_str = ", ".join(bp.referenced_path for bp in bps)
        if interactive:
            print(f"\nLine {line_num}: {lines[idx].strip()}")
            print(f"  Broken path(s): {paths_str}")
            response = input("  Remove this line? [y/N] ").strip().lower()
            if response != "y":
                continue

        # Comment out the line instead of deleting (safer)
        lines[idx] = f"<!-- BROKEN PATH: {lines[idx]} -->"
        modified_count += 1

    if modified_count > 0:
        instructions_path.write_text("\n".join(lines), encoding="utf-8")

    return modified_count


def report_broken_paths(broken_paths: list[BrokenPath]) -> str:
    """Format a report of broken paths.

    Returns human-readable report string.
    """
    if not broken_paths:
        return "✓ All path references in copilot-instructions.md are valid."

    lines = [
        f"⚠ Found {len(broken_paths)} broken path reference(s) in copilot-instructions.md:\n"
    ]
    for bp in broken_paths:
        lines.append(f"  Line {bp.line_number}: {bp.referenced_path}")
        lines.append(f"    → Expected at: {bp.resolved_path}")
        lines.append(f"    → Line: {bp.line_text.strip()[:100]}")
        lines.append("")

    return "\n".join(lines)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Validate file/directory path references in copilot-instructions.md."
    )
    parser.add_argument(
        "--root",
        type=str,
        default=None,
        help="Knowledge base root directory (default: ~/.grain or $GRAIN_ROOT)",
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="Path to copilot-instructions.md (auto-detected if not specified)",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Comment out lines with broken path references (interactive)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )
    args = parser.parse_args()

    kb_root = Path(args.root) if args.root else None
    instructions_path = Path(args.file) if args.file else None

    broken = validate_paths(
        instructions_path=instructions_path,
        kb_root=kb_root,
    )

    if args.json:
        import json
        data = [
            {
                "line": bp.line_number,
                "path": bp.referenced_path,
                "resolved": str(bp.resolved_path),
                "line_text": bp.line_text,
            }
            for bp in broken
        ]
        print(json.dumps(data, indent=2))
    else:
        print(report_broken_paths(broken))

    if args.fix and broken:
        if instructions_path is None:
            root = kb_root or GRAIN_ROOT
            candidates = [
                root / "copilot-instructions.md",
                Path.home() / ".github" / "copilot-instructions.md",
            ]
            instructions_path = next((p for p in candidates if p.exists()), None)

        if instructions_path:
            fixed = fix_broken_paths(instructions_path, broken, interactive=True)
            print(f"\n✓ {fixed} line(s) commented out.")
        else:
            print("Cannot fix: copilot-instructions.md not found.")

    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()
