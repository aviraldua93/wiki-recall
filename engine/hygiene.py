"""
hygiene.py -- Brain hygiene system for wiki-recall.

Performs 5-category health checks on a knowledge base directory:
  1. Structure -- root bloat, script duplication, empty dirs, orphan pages, artifacts
  2. Content  -- stubs, missing frontmatter, missing last_verified, stale tiers, noise
  3. Depth    -- missing timeline/compiled truth, thin people/pattern pages
  4. Duplication -- content overlap (Jaccard), similar names (Levenshtein)
  5. Brain    -- brain.md format budget (lines, tokens, code blocks, L0/L1 sections)

Interface:
    python engine/hygiene.py                        # check ~/.grain
    python engine/hygiene.py /path/to/wiki          # check specific path
    python engine/hygiene.py --fix                   # auto-fix safe issues
    python engine/hygiene.py --json                  # structured JSON output

Safety: --fix only touches safe, reversible changes. No deletes, merges, or rewrites.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULT_ROOT = Path(os.environ.get("GRAIN_ROOT", Path.home() / ".grain"))
ROOT_FILE_WARN_THRESHOLD = 6
STUB_SIZE_BYTES = 200
STALE_TIER3_DAYS = 30
LEVENSHTEIN_THRESHOLD = 3
JACCARD_OVERLAP_THRESHOLD = 0.60

# Known construction artifacts that should be archived
CONSTRUCTION_ARTIFACTS = [".mining", ".verification"]

# Script extensions to check for duplication
SCRIPT_EXTENSIONS = {".ps1", ".sh", ".py"}


# ── Utility functions ──────────────────────────────────────────────────────────

def levenshtein_distance(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


def jaccard_similarity(text1: str, text2: str) -> float:
    """Compute Jaccard similarity on word sets of two texts."""
    words1 = set(re.findall(r'\w+', text1.lower()))
    words2 = set(re.findall(r'\w+', text2.lower()))
    if not words1 or not words2:
        return 0.0
    intersection = words1 & words2
    union = words1 | words2
    return len(intersection) / len(union) if union else 0.0


def has_frontmatter(content: str) -> bool:
    """Check if content starts with YAML frontmatter (--- block)."""
    return bool(re.match(r'^---\s*\r?\n.*?\r?\n---', content, re.DOTALL))


def extract_frontmatter_field(content: str, field: str) -> Optional[str]:
    """Extract a field value from YAML frontmatter."""
    match = re.search(rf'^{field}:\s*(.+)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip().strip('"').strip("'")
    return None


def parse_date_safe(date_str: str) -> Optional[datetime]:
    """Try to parse a date string, return None on failure."""
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def has_section(content: str, heading: str) -> bool:
    """Check if content has a markdown section with the given heading."""
    pattern = rf'^##\s+{re.escape(heading)}\b'
    return bool(re.search(pattern, content, re.MULTILINE))


def section_has_content(content: str, heading: str) -> bool:
    """Check if a section exists AND has real content (not just placeholders)."""
    pattern = rf'^##\s+{re.escape(heading)}\b(.+?)(?=^##\s|\Z)'
    match = re.search(pattern, content, re.MULTILINE | re.DOTALL)
    if not match:
        return False
    body = match.group(1).strip()
    # Consider "no data yet" and empty as no content
    if not body or body.lower().startswith("[no data yet"):
        return False
    return True


# ── Issue model ────────────────────────────────────────────────────────────────

class HygieneIssue:
    """Represents a single hygiene finding."""

    def __init__(
        self,
        category: str,  # structure | content | depth | duplication
        severity: str,  # error | warning | info
        message: str,
        file: Optional[str] = None,
        fixable: bool = False,
        fix_action: Optional[str] = None,
    ):
        self.category = category
        self.severity = severity
        self.message = message
        self.file = file
        self.fixable = fixable
        self.fix_action = fix_action

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "category": self.category,
            "severity": self.severity,
            "message": self.message,
        }
        if self.file:
            d["file"] = self.file
        if self.fixable:
            d["fixable"] = True
        if self.fix_action:
            d["fix_action"] = self.fix_action
        return d

    def __repr__(self) -> str:
        prefix = f"[{self.severity.upper()}]"
        loc = f" ({self.file})" if self.file else ""
        return f"{prefix} {self.category}: {self.message}{loc}"


# ── Category scores ────────────────────────────────────────────────────────────

def compute_grade(errors: int, warnings: int) -> str:
    """Compute a letter grade from error and warning counts.

    A: 0 errors, <=2 warnings
    B: 0 errors, <=5 warnings
    C: <=2 errors, any warnings
    D: <=5 errors
    F: >5 errors
    """
    if errors == 0 and warnings <= 2:
        return "A"
    if errors == 0 and warnings <= 5:
        return "B"
    if errors <= 2:
        return "C"
    if errors <= 5:
        return "D"
    return "F"


def compute_depth_grade(issue_count: int, total_pages: int) -> str:
    """Compute depth grade based on issue percentage relative to total pages.

    0-10% issues  -> A
    10-30% issues -> B
    30-60% issues -> C
    60%+ issues   -> D/F
    """
    if total_pages == 0:
        return "A"
    pct = issue_count / total_pages
    if pct <= 0.10:
        return "A"
    if pct <= 0.30:
        return "B"
    if pct <= 0.60:
        return "C"
    if pct <= 0.80:
        return "D"
    return "F"


# ── Checkers ───────────────────────────────────────────────────────────────────

def check_structure(root: Path) -> list[HygieneIssue]:
    """Check structural health of the knowledge base."""
    issues: list[HygieneIssue] = []

    # 1. Root file count
    root_files = [f for f in root.iterdir() if f.is_file()] if root.exists() else []
    if len(root_files) > ROOT_FILE_WARN_THRESHOLD:
        issues.append(HygieneIssue(
            "structure", "warning",
            f"Root has {len(root_files)} files (threshold: {ROOT_FILE_WARN_THRESHOLD})",
            fixable=False,
        ))

    # 2. Script duplication (same script at root AND scripts/)
    scripts_dir = root / "scripts"
    if scripts_dir.exists():
        for script_file in root.glob("*"):
            if script_file.is_file() and script_file.suffix in SCRIPT_EXTENSIONS:
                dup_path = scripts_dir / script_file.name
                if dup_path.exists():
                    issues.append(HygieneIssue(
                        "structure", "warning",
                        f"Script '{script_file.name}' exists at both root and scripts/",
                        file=str(script_file.name),
                        fixable=True,
                        fix_action="delete_root_script",
                    ))

    # 3. Empty directories
    if root.exists():
        for dirpath in root.rglob("*"):
            if dirpath.is_dir() and not dirpath.name.startswith("."):
                contents = list(dirpath.iterdir())
                if not contents:
                    rel = dirpath.relative_to(root)
                    issues.append(HygieneIssue(
                        "structure", "info",
                        f"Empty directory: {rel}",
                        file=str(rel),
                    ))

    # 4. Orphan pages (in wiki/ but not in index.md)
    wiki_dir = root / "wiki"
    index_file = wiki_dir / "index.md"
    if wiki_dir.exists() and index_file.exists():
        index_content = index_file.read_text(encoding="utf-8", errors="replace")
        index_links = set(re.findall(r'\[\[([^\]]+)\]\]', index_content))

        for md_file in wiki_dir.rglob("*.md"):
            if md_file.name in ("index.md", "log.md"):
                continue
            if md_file.parent.name.startswith("."):
                continue
            page_name = md_file.stem
            if page_name not in index_links:
                rel = md_file.relative_to(root)
                issues.append(HygieneIssue(
                    "structure", "warning",
                    f"Orphan page not in index.md: {page_name}",
                    file=str(rel),
                    fixable=True,
                    fix_action="add_to_index",
                ))

    # 5. Construction artifacts
    for artifact_name in CONSTRUCTION_ARTIFACTS:
        artifact_path = root / artifact_name
        if artifact_path.exists():
            issues.append(HygieneIssue(
                "structure", "warning",
                f"Construction artifact found: {artifact_name}/",
                file=artifact_name,
                fixable=True,
                fix_action="archive_artifact",
            ))

    return issues


def check_content(root: Path) -> list[HygieneIssue]:
    """Check content quality of wiki pages."""
    issues: list[HygieneIssue] = []
    wiki_dir = root / "wiki"
    now = datetime.now()

    if not wiki_dir.exists():
        return issues

    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue

        rel = md_file.relative_to(root)
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        file_size = md_file.stat().st_size

        # Stub check
        if file_size < STUB_SIZE_BYTES:
            issues.append(HygieneIssue(
                "content", "warning",
                f"Page under {STUB_SIZE_BYTES} bytes ({file_size}B) — likely a stub",
                file=str(rel),
            ))

        # Missing frontmatter
        if not has_frontmatter(content):
            issues.append(HygieneIssue(
                "content", "error",
                "Missing YAML frontmatter",
                file=str(rel),
            ))

        # Missing last_verified
        if has_frontmatter(content):
            lv = extract_frontmatter_field(content, "last_verified")
            updated = extract_frontmatter_field(content, "updated")
            if not lv and not updated:
                issues.append(HygieneIssue(
                    "content", "warning",
                    "Missing last_verified date",
                    file=str(rel),
                    fixable=True,
                    fix_action="add_last_verified",
                ))

        # Tier 3 pages untouched 30+ days
        tier = extract_frontmatter_field(content, "tier")
        if tier == "3":
            date_str = (
                extract_frontmatter_field(content, "last_verified")
                or extract_frontmatter_field(content, "updated")
            )
            if date_str:
                dt = parse_date_safe(date_str)
                if dt and (now - dt).days > STALE_TIER3_DAYS:
                    issues.append(HygieneIssue(
                        "content", "info",
                        f"Tier 3 stub untouched for {(now - dt).days} days — consider deleting",
                        file=str(rel),
                    ))

    # decisions.md noise detection
    decisions_file = root / "decisions.md"
    if decisions_file.exists():
        try:
            dec_content = decisions_file.read_text(encoding="utf-8", errors="replace")
            lines = dec_content.splitlines()
            noise_count = 0
            for line in lines:
                stripped = line.strip()
                # Harvest dumps are lines with "session:" references but no context
                if re.match(r'^\s*-\s*\[\d{4}-\d{2}-\d{2}\].*session:\s*\S+\s*$', stripped):
                    noise_count += 1
            if noise_count > 10:
                issues.append(HygieneIssue(
                    "content", "warning",
                    f"decisions.md has {noise_count} entries that look like harvest dumps",
                    file="decisions.md",
                ))
        except Exception:
            pass

    return issues


def check_depth(root: Path) -> list[HygieneIssue]:
    """Check content depth of wiki pages."""
    issues: list[HygieneIssue] = []
    wiki_dir = root / "wiki"

    if not wiki_dir.exists():
        return issues

    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue

        rel = md_file.relative_to(root)
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        page_type = extract_frontmatter_field(content, "type")

        # Timeline check — applies to all pages with frontmatter
        if has_frontmatter(content) and not has_section(content, "Timeline"):
            # Only suggest if it's a project/person/domain page
            if page_type in ("project", "person", "domain", None):
                issues.append(HygieneIssue(
                    "depth", "info",
                    "Missing ## Timeline section",
                    file=str(rel),
                ))

        # Compiled Truth check
        if has_frontmatter(content) and not has_section(content, "Compiled Truth"):
            if page_type in ("project", "person", "domain", "concept", None):
                issues.append(HygieneIssue(
                    "depth", "info",
                    "Missing ## Compiled Truth section",
                    file=str(rel),
                ))

        # People pages without working relationship
        if page_type == "person":
            if not section_has_content(content, "Working Relationship"):
                issues.append(HygieneIssue(
                    "depth", "warning",
                    "Person page without working relationship detail — stub quality",
                    file=str(rel),
                ))

        # Pattern pages without specific incidents
        if page_type == "pattern" or (
            md_file.parent.name == "patterns" and page_type is None
        ):
            # Strip frontmatter before checking for incident references
            body = re.sub(r'^---\s*\n.*?\n---\s*\n?', '', content, count=1, flags=re.DOTALL)
            # Check for incident references (dates, session IDs)
            has_incidents = bool(re.search(
                r'\d{4}-\d{2}-\d{2}|session:\s*\S+', body
            ))
            if not has_incidents:
                issues.append(HygieneIssue(
                    "depth", "warning",
                    "Pattern page without specific incident details — thin",
                    file=str(rel),
                ))

    return issues


def check_duplication(root: Path) -> list[HygieneIssue]:
    """Check for content duplication across wiki pages."""
    issues: list[HygieneIssue] = []
    wiki_dir = root / "wiki"

    if not wiki_dir.exists():
        return issues

    # Collect all page names and content
    pages: list[tuple[str, str, Path]] = []
    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        rel = md_file.relative_to(root)
        pages.append((md_file.stem, content, rel))

    # Similar page names (Levenshtein)
    checked_pairs: set[tuple[str, str]] = set()
    for i, (name1, _, rel1) in enumerate(pages):
        for j, (name2, _, rel2) in enumerate(pages):
            if i >= j:
                continue
            pair = (min(name1, name2), max(name1, name2))
            if pair in checked_pairs:
                continue
            checked_pairs.add(pair)

            dist = levenshtein_distance(name1.lower(), name2.lower())
            if 0 < dist < LEVENSHTEIN_THRESHOLD:
                issues.append(HygieneIssue(
                    "duplication", "warning",
                    f"Similar page names: '{name1}' and '{name2}' (edit distance: {dist})",
                    file=f"{rel1} vs {rel2}",
                ))

    # Content overlap (Jaccard)
    for i, (name1, content1, rel1) in enumerate(pages):
        for j, (name2, content2, rel2) in enumerate(pages):
            if i >= j:
                continue
            # Skip very short pages — they'll match on boilerplate
            if len(content1) < 300 or len(content2) < 300:
                continue
            sim = jaccard_similarity(content1, content2)
            if sim > JACCARD_OVERLAP_THRESHOLD:
                issues.append(HygieneIssue(
                    "duplication", "warning",
                    f"High content overlap ({sim:.0%}) — consider merging",
                    file=f"{rel1} vs {rel2}",
                ))

    return issues


def check_brain_health(root: Path) -> list[HygieneIssue]:
    """Check brain.md against format budget constraints."""
    issues: list[HygieneIssue] = []
    brain_path = root / "brain.md"

    if not brain_path.exists():
        issues.append(HygieneIssue(
            "brain", "error",
            "brain.md not found",
        ))
        return issues

    try:
        content = brain_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        issues.append(HygieneIssue(
            "brain", "error",
            "brain.md unreadable",
            file="brain.md",
        ))
        return issues

    lines = content.split('\n')
    line_count = len(lines)

    # Line count budget: 40
    if line_count > 80:
        issues.append(HygieneIssue(
            "brain", "error",
            f"brain.md: {line_count} lines, budget 40",
            file="brain.md",
        ))
    elif line_count > 50:
        issues.append(HygieneIssue(
            "brain", "warning",
            f"brain.md: {line_count} lines, budget 40",
            file="brain.md",
        ))

    # Token estimate budget: 550
    tokens = len(content) // 4
    if tokens > 1000:
        issues.append(HygieneIssue(
            "brain", "error",
            f"brain.md: ~{tokens} tokens, budget 550",
            file="brain.md",
        ))
    elif tokens > 600:
        issues.append(HygieneIssue(
            "brain", "warning",
            f"brain.md: ~{tokens} tokens, budget 550",
            file="brain.md",
        ))

    # Code blocks are a violation
    if '```' in content:
        issues.append(HygieneIssue(
            "brain", "error",
            "brain.md contains code blocks -- move to reference/",
            file="brain.md",
        ))

    # L0/L1 sections present
    if '## L0' not in content and '## Identity' not in content:
        issues.append(HygieneIssue(
            "brain", "error",
            "brain.md missing L0/Identity section",
            file="brain.md",
        ))

    if '## L1' not in content and '## Active' not in content:
        issues.append(HygieneIssue(
            "brain", "error",
            "brain.md missing L1/Active Work section",
            file="brain.md",
        ))

    return issues


# Index section mapping for orphan fix
INDEX_SECTION_MAP = {
    "people": "People",
    "projects": "Projects",
    "patterns": "Patterns",
    "concepts": "Concepts",
    "domains": "Domains",
}


def _determine_index_section(file_rel_path: str) -> str:
    """Determine which index.md section an orphan page belongs to."""
    parts = Path(file_rel_path).parts
    # wiki/<section>/page.md -> section
    if len(parts) >= 2:
        section_dir = parts[1] if parts[0] == "wiki" else parts[0]
        return INDEX_SECTION_MAP.get(section_dir, "Other")
    return "Other"


def _add_orphan_to_index(index_path: Path, page_name: str, section: str,
                          page_path: Path) -> bool:
    """Append an orphan page entry to the correct section in index.md."""
    if not index_path.exists():
        return False

    # Try to read description from page frontmatter
    description = ""
    status = ""
    if page_path.exists():
        try:
            page_content = page_path.read_text(encoding="utf-8", errors="replace")
            title = extract_frontmatter_field(page_content, "title")
            if title:
                description = title
            tier = extract_frontmatter_field(page_content, "tier")
            page_type = extract_frontmatter_field(page_content, "type")
            if tier:
                status = f"tier-{tier}"
            elif page_type:
                status = page_type
        except Exception:
            pass

    entry_line = f"| [[{page_name}]] | {status} | {description} |"

    index_content = index_path.read_text(encoding="utf-8", errors="replace")

    # Find the section heading and insert after the table
    section_pattern = rf'^(#+\s+{re.escape(section)}\b.*?)$'
    match = re.search(section_pattern, index_content, re.MULTILINE | re.IGNORECASE)

    if match:
        # Insert after last table row in this section (find next heading or EOF)
        section_start = match.end()
        next_heading = re.search(r'^#+\s+', index_content[section_start:], re.MULTILINE)
        if next_heading:
            insert_pos = section_start + next_heading.start()
        else:
            insert_pos = len(index_content)

        # Find the last non-empty line before insert_pos
        before = index_content[:insert_pos].rstrip()
        after = index_content[insert_pos:]
        new_content = before + "\n" + entry_line + "\n" + after
    else:
        # No matching section -- append a new section at the end
        new_content = index_content.rstrip() + f"\n\n## {section}\n\n{entry_line}\n"

    index_path.write_text(new_content, encoding="utf-8")
    return True


# ── Fix actions ────────────────────────────────────────────────────────────────

def apply_fixes(root: Path, issues: list[HygieneIssue]) -> list[str]:
    """Apply safe auto-fixes. Returns list of actions taken."""
    actions: list[str] = []
    today = datetime.now().strftime("%Y-%m-%d")

    for issue in issues:
        if not issue.fixable:
            continue

        if issue.fix_action == "delete_root_script" and issue.file:
            script_path = root / issue.file
            if script_path.exists():
                script_path.unlink()
                actions.append(f"Deleted duplicate root script: {issue.file}")

        elif issue.fix_action == "add_last_verified" and issue.file:
            file_path = root / issue.file
            if file_path.exists():
                content = file_path.read_text(encoding="utf-8", errors="replace")
                # Insert last_verified after the opening ---
                if content.startswith("---"):
                    # Find end of frontmatter
                    end_match = re.search(r'\n---', content[3:])
                    if end_match:
                        insert_pos = 3 + end_match.start()
                        new_content = (
                            content[:insert_pos]
                            + f"\nlast_verified: {today}"
                            + content[insert_pos:]
                        )
                        file_path.write_text(new_content, encoding="utf-8")
                        actions.append(f"Added last_verified to: {issue.file}")

        elif issue.fix_action == "archive_artifact" and issue.file:
            artifact_path = root / issue.file
            archive_dir = root / ".archive"
            if artifact_path.exists():
                archive_dir.mkdir(parents=True, exist_ok=True)
                dest = archive_dir / issue.file
                if dest.exists():
                    shutil.rmtree(str(dest))
                shutil.move(str(artifact_path), str(dest))
                actions.append(f"Archived {issue.file} to .archive/")

        elif issue.fix_action == "add_to_index" and issue.file:
            index_path = root / "wiki" / "index.md"
            page_path = root / issue.file
            page_name = Path(issue.file).stem
            section = _determine_index_section(issue.file)
            if _add_orphan_to_index(index_path, page_name, section, page_path):
                actions.append(f"Added orphan '{page_name}' to index.md [{section}]")

    # Add [No Data Yet] to empty sections in wiki pages
    wiki_dir = root / "wiki"
    if wiki_dir.exists():
        for md_file in wiki_dir.rglob("*.md"):
            if md_file.name in ("index.md", "log.md"):
                continue
            if md_file.parent.name.startswith("."):
                continue
            try:
                content = md_file.read_text(encoding="utf-8", errors="replace")
                modified = False
                # Find sections with empty bodies
                lines = content.splitlines()
                new_lines = []
                for idx, line in enumerate(lines):
                    new_lines.append(line)
                    if re.match(r'^##\s+', line):
                        # Check if next non-blank line is another heading or EOF
                        next_content_idx = idx + 1
                        while next_content_idx < len(lines) and not lines[next_content_idx].strip():
                            next_content_idx += 1
                        if next_content_idx >= len(lines) or re.match(r'^##\s+|^---\s*$', lines[next_content_idx]):
                            new_lines.append("[No data yet]")
                            modified = True

                if modified:
                    md_file.write_text("\n".join(new_lines), encoding="utf-8")
                    rel = md_file.relative_to(root)
                    actions.append(f"Added [No data yet] to empty sections in: {rel}")
            except Exception:
                continue

    return actions


# ── Main report ────────────────────────────────────────────────────────────────

class HygieneReport:
    """Full hygiene report with scores and issues."""

    def __init__(self, root: Path):
        self.root = root
        self.issues: list[HygieneIssue] = []
        self.scores: dict[str, str] = {}
        self.fix_actions: list[str] = []

    def run(self) -> None:
        """Run all checks and compute scores."""
        structure = check_structure(self.root)
        content = check_content(self.root)
        depth = check_depth(self.root)
        duplication = check_duplication(self.root)
        brain = check_brain_health(self.root)

        self.issues = structure + content + depth + duplication + brain

        # Count total wiki pages for depth percentage grading
        total_pages = 0
        wiki_dir = self.root / "wiki"
        if wiki_dir.exists():
            for md_file in wiki_dir.rglob("*.md"):
                if md_file.name in ("index.md", "log.md"):
                    continue
                if md_file.parent.name.startswith("."):
                    continue
                total_pages += 1

        # Compute per-category scores
        for cat, cat_issues in [
            ("structure", structure),
            ("content", content),
            ("duplication", duplication),
            ("brain", brain),
        ]:
            errors = sum(1 for i in cat_issues if i.severity == "error")
            warnings = sum(1 for i in cat_issues if i.severity == "warning")
            self.scores[cat] = compute_grade(errors, warnings)

        # Depth uses percentage-based grading
        depth_issue_count = len(depth)
        self.scores["depth"] = compute_depth_grade(depth_issue_count, total_pages)

    def apply_fixes(self) -> list[str]:
        """Apply safe fixes and return actions taken."""
        self.fix_actions = apply_fixes(self.root, self.issues)
        return self.fix_actions

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict."""
        return {
            "root": str(self.root),
            "scores": self.scores,
            "issue_count": len(self.issues),
            "issues": [i.to_dict() for i in self.issues],
            "fix_actions": self.fix_actions,
        }

    def print_report(self) -> None:
        """Print human-readable report to stdout."""
        print()
        print("Brain Hygiene Report")
        print("=" * 40)
        print(f"Root: {self.root}")
        print()

        # Scores
        print("Category Scores:")
        for cat, grade in self.scores.items():
            print(f"  {cat:15s}  {grade}")
        print()

        # Issues by category
        for cat in ("structure", "content", "depth", "duplication", "brain"):
            cat_issues = [i for i in self.issues if i.category == cat]
            if not cat_issues:
                continue
            print(f"── {cat.upper()} ({len(cat_issues)} issues) ──")
            for issue in cat_issues:
                icon = {"error": "✗", "warning": "⚠", "info": "ℹ"}.get(
                    issue.severity, "?"
                )
                loc = f"  [{issue.file}]" if issue.file else ""
                fix = "  (fixable)" if issue.fixable else ""
                print(f"  {icon} {issue.message}{loc}{fix}")
            print()

        # Fix actions
        if self.fix_actions:
            print("── FIXES APPLIED ──")
            for action in self.fix_actions:
                print(f"  ✓ {action}")
            print()

        total = len(self.issues)
        fixable = sum(1 for i in self.issues if i.fixable)
        print(f"Total: {total} issues ({fixable} auto-fixable)")
        print()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Brain hygiene check for wiki-recall knowledge bases",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_ROOT),
        help="Path to knowledge base root (default: ~/.grain)",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Auto-fix safe issues (duplicates, missing dates, artifacts)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output structured JSON instead of human-readable text",
    )

    args = parser.parse_args(argv)
    root = Path(args.path)

    if not root.exists():
        print(f"Error: path does not exist: {root}", file=sys.stderr)
        return 1

    report = HygieneReport(root)
    report.run()

    if args.fix:
        report.apply_fixes()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        report.print_report()

    # Exit 1 if any errors found
    has_errors = any(i.severity == "error" for i in report.issues)
    return 1 if has_errors else 0


if __name__ == "__main__":
    sys.exit(main())
