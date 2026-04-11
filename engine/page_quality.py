"""
page_quality.py -- Per-page content quality checks for wiki-recall knowledge bases.

4 content-quality check categories:
  1. page_depth_check()          -- compiled truth, timeline, source attribution, size
  2. page_quality_check()        -- personal insight vs textbook, truncation, xrefs
  3. page_classification_check() -- correct category, stub/enrichable/archivable, duplicates
  4. compute_page_score()        -- numeric 0-10 score + label (DEEP/ADEQUATE/STUB/MISPLACED/PLACEHOLDER)

Each check follows the existing critic pattern:
  - LLM path using LLMClient.ask() / LLMClient.classify()
  - Regex fallback when LLM unavailable

Usage:
    from engine.page_quality import (
        page_depth_check,
        page_quality_check,
        page_classification_check,
        compute_page_score,
        PageQualityResult,
    )

    llm = LLMClient()
    wiki_root = Path("~/.grain")
    page_path = wiki_root / "wiki" / "projects" / "auth-service.md"
    content = page_path.read_text()

    depth   = page_depth_check(content, page_path, wiki_root)
    quality = page_quality_check(content, page_path, wiki_root, llm)
    classif = page_classification_check(content, page_path, wiki_root, llm)
    result  = compute_page_score(content, page_path, wiki_root, llm)
    print(result.score, result.label)  # e.g. 8, "DEEP"
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from engine.hygiene import (
    has_frontmatter,
    extract_frontmatter_field,
    has_section,
    section_has_content,
    jaccard_similarity,
    levenshtein_distance,
    STUB_SIZE_BYTES,
)
from engine.llm_client import LLMClient

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────────

# Score labels and thresholds
LABEL_DEEP = "DEEP"            # score > 7
LABEL_ADEQUATE = "ADEQUATE"    # score 4-7
LABEL_STUB = "STUB"            # score < 4
LABEL_MISPLACED = "MISPLACED"  # page in wrong category directory
LABEL_PLACEHOLDER = "PLACEHOLDER"  # all content is placeholder text

# Minimum byte size for project-type pages
PROJECT_MIN_BYTES = 200

# Source attribution patterns
SOURCE_PATTERNS = [
    re.compile(r'\[Source:\s*[^\]]+\]', re.IGNORECASE),
    re.compile(r'observed:\s*session\s+\w+', re.IGNORECASE),
    re.compile(r'self-stated:\s*session\s+\w+', re.IGNORECASE),
    re.compile(r'inferred:\s*', re.IGNORECASE),
    re.compile(r'session\s+[a-f0-9]{6,}', re.IGNORECASE),
]

# Date patterns for timeline entries
DATE_PATTERN = re.compile(r'\[\s*(\d{4}-\d{2}-\d{2})\s*\]')

# Personal/project-specific language indicators (regex fallback for quality check)
PERSONAL_INDICATORS = re.compile(
    r'\b(?:we|our|my|I|team|sprint|standup|retro|deploy|ship|migrate|refactor|debug|'
    r'production|staging|PR|pull request|commit|branch|repo|codebase|ticket|JIRA|'
    r'on-call|incident|postmortem|meeting|sync|decision|chose|decided|'
    r'learned|discovered|realized|noticed|found that|turns out)\b',
    re.IGNORECASE,
)

# Textbook/generic language indicators
TEXTBOOK_INDICATORS = re.compile(
    r'\b(?:is a|are a|refers to|is defined as|is the process of|'
    r'in computer science|in software engineering|'
    r'according to|generally|typically used for|'
    r'is commonly|is generally|is often|'
    r'a type of|a form of|a method of|a technique for)\b',
    re.IGNORECASE,
)

# Truncation patterns — sentences that appear cut off
TRUNCATION_PATTERN = re.compile(
    r'(?:^|\n)\s*[-*]?\s*\S+.*\S\s*$',  # non-empty line
)
TRUNCATED_SENTENCE = re.compile(
    r'[a-z,]\s*$'  # ends with lowercase letter or comma (no period/colon)
)

# Category directory expectations by page type
TYPE_TO_DIRECTORY = {
    "project": "projects",
    "repo": "projects",
    "platform": "projects",
    "system": "projects",
    "person": "people",
    "team": "people",
    "concept": "concepts",
    "tool": "tools",
    "pattern": "patterns",
}

# Status values suggesting archival
ARCHIVE_STATUSES = {"archived", "handed-off", "deprecated", "inactive", "completed"}

# Jaccard threshold for duplicate detection
DUPLICATE_JACCARD_THRESHOLD = 0.60


# ── Data Models ──────────────────────────────────────────────────────────────


@dataclass
class DepthCheckResult:
    """Results from page_depth_check()."""
    has_compiled_truth: bool = False
    compiled_truth_has_content: bool = False
    has_timeline: bool = False
    timeline_has_dated_entries: bool = False
    timeline_entry_count: int = 0
    has_source_attribution: bool = False
    source_count: int = 0
    meets_size_requirement: bool = True  # only relevant for project-type
    page_size_bytes: int = 0
    page_type: str = ""
    issues: list[str] = field(default_factory=list)

    @property
    def score_contribution(self) -> float:
        """Contribute 0-3 points to page score."""
        points = 0.0
        if self.has_compiled_truth and self.compiled_truth_has_content:
            points += 1.0
        elif self.has_compiled_truth:
            points += 0.3
        if self.has_timeline and self.timeline_has_dated_entries:
            points += 1.0
            # Bonus for multiple entries
            if self.timeline_entry_count >= 3:
                points += 0.3
        elif self.has_timeline:
            points += 0.3
        if self.has_source_attribution:
            points += 0.7
            if self.source_count >= 3:
                points += 0.3
        if not self.meets_size_requirement:
            points -= 0.5
        return min(points, 3.0)


@dataclass
class QualityCheckResult:
    """Results from page_quality_check()."""
    is_personal_insight: bool = False
    is_textbook_definition: bool = False
    has_truncated_sentences: bool = False
    truncated_count: int = 0
    broken_cross_refs: list[str] = field(default_factory=list)
    valid_cross_refs: list[str] = field(default_factory=list)
    frontmatter_related_matches_content: bool = True
    llm_quality_assessment: str = ""  # "personal" | "textbook" | "mixed" | ""
    issues: list[str] = field(default_factory=list)

    @property
    def score_contribution(self) -> float:
        """Contribute 0-3 points to page score."""
        points = 0.0
        if self.is_personal_insight and not self.is_textbook_definition:
            points += 1.5
        elif self.is_personal_insight:
            points += 0.8  # mixed
        elif not self.is_textbook_definition:
            points += 0.5  # neutral
        if not self.has_truncated_sentences:
            points += 0.5
        if not self.broken_cross_refs:
            points += 0.5
        elif self.valid_cross_refs:
            points += 0.2
        if self.frontmatter_related_matches_content:
            points += 0.5
        return min(points, 3.0)


@dataclass
class ClassificationCheckResult:
    """Results from page_classification_check()."""
    page_type: str = ""
    expected_directory: str = ""
    actual_directory: str = ""
    is_correctly_placed: bool = True
    is_stub: bool = False
    is_enrichable: bool = False
    is_archivable: bool = False
    duplicate_of: list[str] = field(default_factory=list)
    status: str = ""  # from frontmatter
    issues: list[str] = field(default_factory=list)

    @property
    def score_contribution(self) -> float:
        """Contribute 0-2 points to page score."""
        points = 0.0
        if self.is_correctly_placed:
            points += 1.0
        if not self.is_stub:
            points += 0.5
        if not self.duplicate_of:
            points += 0.5
        return min(points, 2.0)

    @property
    def is_misplaced(self) -> bool:
        return not self.is_correctly_placed

    @property
    def is_placeholder(self) -> bool:
        return self.is_stub and not self.is_enrichable


@dataclass
class PageQualityResult:
    """Aggregated page quality result with numeric score and label."""
    file: str = ""
    score: float = 0.0
    label: str = LABEL_STUB
    depth: Optional[DepthCheckResult] = None
    quality: Optional[QualityCheckResult] = None
    classification: Optional[ClassificationCheckResult] = None
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "score": round(self.score, 1),
            "label": self.label,
            "issues": self.issues,
        }


# ── Check 1: Page Depth ─────────────────────────────────────────────────────


def page_depth_check(
    content: str,
    page_path: Path,
    wiki_root: Path,
) -> DepthCheckResult:
    """Validate page depth: compiled truth, timeline, source attribution, size.

    Checks:
      - Compiled truth exists with real content (not [No data yet])
      - Timeline exists with chronological dated entries
      - Source attribution exists ([Source: session ID], observed:, self-stated:, inferred:)
      - Page >200 bytes for project-type pages

    No LLM needed — purely structural checks.
    """
    result = DepthCheckResult()
    result.page_size_bytes = len(content.encode("utf-8"))
    result.page_type = extract_frontmatter_field(content, "type") or ""

    # 1. Compiled truth check
    result.has_compiled_truth = has_section(content, "Compiled Truth")
    if result.has_compiled_truth:
        result.compiled_truth_has_content = section_has_content(content, "Compiled Truth")
        if not result.compiled_truth_has_content:
            result.issues.append("Compiled Truth section is empty or placeholder")

    else:
        # Also check for "## What It Is" as alternative heading
        if has_section(content, "What It Is"):
            result.has_compiled_truth = True
            result.compiled_truth_has_content = section_has_content(content, "What It Is")
        else:
            result.issues.append("Missing Compiled Truth section")

    # 2. Timeline check
    result.has_timeline = has_section(content, "Timeline")
    if result.has_timeline:
        # Extract timeline section and check for dated entries
        timeline_match = re.search(
            r'##\s+Timeline\b(.+?)(?=^##\s|\Z)',
            content, re.MULTILINE | re.DOTALL,
        )
        if timeline_match:
            timeline_body = timeline_match.group(1)
            dates_found = DATE_PATTERN.findall(timeline_body)
            result.timeline_entry_count = len(dates_found)
            result.timeline_has_dated_entries = len(dates_found) > 0

            # Check chronological ordering (dates should be ascending or descending)
            if len(dates_found) >= 2:
                try:
                    parsed_dates = [
                        datetime.strptime(d, "%Y-%m-%d") for d in dates_found
                    ]
                    # Check if sorted ascending or descending
                    is_ascending = all(
                        parsed_dates[i] <= parsed_dates[i + 1]
                        for i in range(len(parsed_dates) - 1)
                    )
                    is_descending = all(
                        parsed_dates[i] >= parsed_dates[i + 1]
                        for i in range(len(parsed_dates) - 1)
                    )
                    if not is_ascending and not is_descending:
                        result.issues.append("Timeline entries are not in chronological order")
                except ValueError:
                    pass  # unparseable dates, already counted

            if not result.timeline_has_dated_entries:
                result.issues.append("Timeline section has no dated entries")
    else:
        result.issues.append("Missing Timeline section")

    # 3. Source attribution check
    source_count = 0
    for pattern in SOURCE_PATTERNS:
        source_count += len(pattern.findall(content))
    result.source_count = source_count
    result.has_source_attribution = source_count > 0

    if not result.has_source_attribution:
        result.issues.append("No source attribution found (missing [Source:], observed:, session IDs)")

    # 4. Size check for project-type pages
    if result.page_type in ("project", "repo", "platform", "system"):
        result.meets_size_requirement = result.page_size_bytes >= PROJECT_MIN_BYTES
        if not result.meets_size_requirement:
            result.issues.append(
                f"Project page is only {result.page_size_bytes} bytes (minimum: {PROJECT_MIN_BYTES})"
            )

    return result


# ── Check 2: Page Quality ───────────────────────────────────────────────────


def page_quality_check(
    content: str,
    page_path: Path,
    wiki_root: Path,
    llm: Optional[LLMClient] = None,
) -> QualityCheckResult:
    """Validate page quality: personal insight, truncation, cross-references.

    LLM path: Ask LLM to classify content as personal insight vs textbook definition.
    Regex fallback: Count personal/project-specific terms vs textbook language.

    Checks:
      - Content is personal insight not textbook definition
      - No truncated sentences
      - Cross-references in content link to existing .md files in wiki/
      - Frontmatter related: field matches actual content references
    """
    result = QualityCheckResult()

    # Strip frontmatter for content analysis
    body = _strip_frontmatter(content)

    # 1. Personal insight vs textbook check
    if llm and llm.available and body.strip():
        # LLM path: assess content quality
        snippet = body[:2000]  # limit for token budget
        prompt = (
            "Analyze this wiki page content. Is it:\n"
            "- 'personal': Contains personal observations, project-specific details, "
            "team context, decisions made, lessons learned\n"
            "- 'textbook': Generic definitions, Wikipedia-style explanations, "
            "could be found in any documentation\n"
            "- 'mixed': Combination of both\n\n"
            "Return ONLY one word: personal, textbook, or mixed\n\n"
            f"Content:\n{snippet}"
        )
        raw = llm.ask(prompt)
        if raw:
            assessment = raw.strip().lower().rstrip(".")
            if assessment in ("personal", "textbook", "mixed"):
                result.llm_quality_assessment = assessment
                result.is_personal_insight = assessment in ("personal", "mixed")
                result.is_textbook_definition = assessment in ("textbook", "mixed")
                if assessment == "textbook":
                    result.issues.append(
                        "Content reads like a textbook definition, not personal insight"
                    )

    # Regex fallback (always runs to supplement LLM)
    if not result.llm_quality_assessment:
        sentences = _extract_sentences(body)
        if len(sentences) >= 3:
            personal_hits = sum(
                1 for s in sentences if PERSONAL_INDICATORS.search(s)
            )
            textbook_hits = sum(
                1 for s in sentences if TEXTBOOK_INDICATORS.search(s)
            )
            total = len(sentences)

            if personal_hits >= 2 or (personal_hits > textbook_hits):
                result.is_personal_insight = True
            if textbook_hits >= 2 and textbook_hits > personal_hits:
                result.is_textbook_definition = True
                result.issues.append(
                    f"Content appears generic/textbook ({textbook_hits}/{total} sentences)"
                )
        elif len(sentences) < 3 and len(body.strip()) > 50:
            # Too few sentences to judge — flag but don't penalize
            result.issues.append("Content too brief to assess quality (< 3 sentences)")

    # 2. Truncated sentence check
    lines = body.split("\n")
    truncated = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip empty lines, headings, list markers with single words, frontmatter
        if not stripped or stripped.startswith("#") or stripped.startswith("---"):
            continue
        # Skip short lines (less than 20 chars) — likely list items or labels
        if len(stripped) < 20:
            continue
        # Skip lines ending with proper punctuation or markdown
        if stripped[-1] in ".!?:;)]\">|`'":
            continue
        # Skip lines that are clearly list items with content
        if re.match(r'^[-*]\s+\S+', stripped) and len(stripped) < 60:
            continue
        # Skip lines that look like key: value pairs
        if re.match(r'^[\w\s]+:\s+', stripped):
            continue
        # Skip URLs and code blocks
        if stripped.startswith("http") or stripped.startswith("```"):
            continue
        # This line might be truncated
        if TRUNCATED_SENTENCE.search(stripped):
            truncated.append(f"Line {i + 1}: {stripped[:80]}...")

    if truncated:
        result.has_truncated_sentences = True
        result.truncated_count = len(truncated)
        result.issues.append(f"{len(truncated)} potentially truncated sentence(s)")

    # 3. Cross-reference check: find wiki links in content
    wiki_dir = wiki_root / "wiki" if wiki_root else None

    # Find [[wiki-link]] style references
    wiki_links = re.findall(r'\[\[([^\]]+)\]\]', content)
    # Find [text](path.md) style references pointing to wiki
    md_links = re.findall(r'\[([^\]]*)\]\(([^)]*\.md)\)', content)
    # Find plain path references like wiki/projects/foo.md
    path_refs = re.findall(
        r'(?:wiki|domains)/[\w\-/]+\.md', content
    )

    if wiki_dir and wiki_dir.exists():
        all_slugs = set()
        for md_file in wiki_dir.rglob("*.md"):
            if md_file.name in ("index.md", "log.md"):
                continue
            if md_file.parent.name.startswith("."):
                continue
            all_slugs.add(md_file.stem)

        # Check [[wiki-link]] references
        for link in wiki_links:
            slug = link.strip()
            if slug in all_slugs:
                result.valid_cross_refs.append(slug)
            else:
                result.broken_cross_refs.append(slug)

        # Check path references
        for ref in path_refs:
            ref_path = wiki_root / ref
            if ref_path.exists():
                result.valid_cross_refs.append(ref)
            else:
                result.broken_cross_refs.append(ref)

    if result.broken_cross_refs:
        result.issues.append(
            f"{len(result.broken_cross_refs)} broken cross-reference(s): "
            + ", ".join(result.broken_cross_refs[:5])
        )

    # 4. Frontmatter related: field vs actual content
    related_match = re.search(
        r'^related:\s*\[([^\]]*)\]', content, re.MULTILINE
    )
    if related_match and wiki_dir and wiki_dir.exists():
        related_raw = related_match.group(1)
        related_ids = [
            r.strip().strip("'\"")
            for r in related_raw.split(",")
            if r.strip()
        ]

        if related_ids:
            all_slugs_lower = set()
            for md_file in wiki_dir.rglob("*.md"):
                if md_file.parent.name.startswith("."):
                    continue
                all_slugs_lower.add(md_file.stem.lower())

            # Check each related ID actually appears in content or exists as page
            missing_refs = []
            for ref_id in related_ids:
                ref_lower = ref_id.lower().strip()
                if not ref_lower:
                    continue
                # Related reference should exist as a page
                if ref_lower not in all_slugs_lower:
                    missing_refs.append(ref_id)

            if missing_refs:
                result.frontmatter_related_matches_content = False
                result.issues.append(
                    f"Frontmatter related: references non-existent page(s): "
                    + ", ".join(missing_refs[:5])
                )

    return result


# ── Check 3: Page Classification ─────────────────────────────────────────────


def page_classification_check(
    content: str,
    page_path: Path,
    wiki_root: Path,
    llm: Optional[LLMClient] = None,
    all_pages: Optional[list[dict[str, str]]] = None,
) -> ClassificationCheckResult:
    """Validate page classification: correct category, stub detection, duplicates.

    LLM path: Ask LLM to classify page type and suggest correct directory.
    Regex fallback: Use frontmatter type field and directory mapping.

    Checks:
      - Page is in correct category directory (e.g., project page in wiki/projects/)
      - Detects stubs vs enrichable vs archivable pages
      - Detects duplicates by content similarity
    """
    result = ClassificationCheckResult()

    # Extract metadata
    result.page_type = extract_frontmatter_field(content, "type") or ""
    result.status = extract_frontmatter_field(content, "status") or ""
    tier = extract_frontmatter_field(content, "tier") or ""
    title = extract_frontmatter_field(content, "title") or page_path.stem

    # Determine actual directory
    if page_path.parent.name == "wiki":
        result.actual_directory = ""  # root of wiki
    else:
        # Get the immediate parent directory name within wiki
        try:
            wiki_dir = wiki_root / "wiki"
            rel = page_path.relative_to(wiki_dir)
            parts = rel.parts
            result.actual_directory = parts[0] if len(parts) > 1 else ""
        except (ValueError, IndexError):
            result.actual_directory = page_path.parent.name

    # 1. Category placement check
    if result.page_type:
        expected_dir = TYPE_TO_DIRECTORY.get(result.page_type.lower(), "")
        result.expected_directory = expected_dir

        if expected_dir and result.actual_directory:
            # Check if page is in the expected directory
            if result.actual_directory.lower() != expected_dir.lower():
                # Special case: archived pages can be in .archive
                if result.actual_directory.startswith("."):
                    pass  # archived pages are fine
                else:
                    result.is_correctly_placed = False
                    result.issues.append(
                        f"Page type '{result.page_type}' should be in wiki/{expected_dir}/ "
                        f"but is in wiki/{result.actual_directory}/"
                    )

    # Check if status suggests archival
    if result.status.lower() in ARCHIVE_STATUSES:
        if not result.actual_directory.startswith("."):
            result.is_archivable = True
            result.issues.append(
                f"Page has status '{result.status}' — consider archiving"
            )

    # LLM-assisted classification for ambiguous cases
    if llm and llm.available and not result.page_type:
        snippet = content[:1500]
        prompt = (
            "What type of wiki page is this? Classify as one of:\n"
            "project, person, team, concept, tool, pattern, repo, platform, system\n\n"
            "Also assess: should this page be archived or is it still relevant?\n\n"
            "Return JSON: {\"type\": \"...\", \"archive\": true/false, \"reason\": \"...\"}\n"
            "Return ONLY the JSON object.\n\n"
            f"Page title: {title}\n"
            f"Content:\n{snippet}"
        )
        raw = llm.ask(prompt)
        if raw:
            parsed = LLMClient._parse_json_response(raw)
            if isinstance(parsed, dict):
                inferred_type = parsed.get("type", "")
                if inferred_type:
                    result.page_type = inferred_type
                    expected_dir = TYPE_TO_DIRECTORY.get(inferred_type.lower(), "")
                    result.expected_directory = expected_dir
                    if (
                        expected_dir
                        and result.actual_directory
                        and result.actual_directory.lower() != expected_dir.lower()
                        and not result.actual_directory.startswith(".")
                    ):
                        result.is_correctly_placed = False
                        result.issues.append(
                            f"LLM classified as '{inferred_type}' — should be in wiki/{expected_dir}/"
                        )
                if parsed.get("archive"):
                    result.is_archivable = True
                    reason = parsed.get("reason", "")
                    result.issues.append(
                        f"LLM suggests archiving: {reason}" if reason else "LLM suggests archiving"
                    )

    # 2. Stub detection
    body = _strip_frontmatter(content)
    page_size = len(content.encode("utf-8"))

    if page_size < STUB_SIZE_BYTES:
        result.is_stub = True
    elif "[no data yet]" in body.lower() and len(body.strip()) < 100:
        result.is_stub = True
    elif tier == "3":
        result.is_stub = True

    # Determine if stub is enrichable (has timeline or session refs to pull from)
    if result.is_stub:
        has_any_content = False
        if has_section(content, "Timeline"):
            timeline_match = re.search(
                r'##\s+Timeline\b(.+?)(?=^##\s|\Z)',
                content, re.MULTILINE | re.DOTALL,
            )
            if timeline_match and len(timeline_match.group(1).strip()) > 20:
                has_any_content = True

        # Check if there are source references that could be used to enrich
        for pattern in SOURCE_PATTERNS:
            if pattern.search(content):
                has_any_content = True
                break

        result.is_enrichable = has_any_content

        if result.is_stub and not result.is_enrichable:
            result.issues.append("Stub page with no enrichable content — consider archiving")
        elif result.is_stub:
            result.issues.append("Stub page — enrichable from session data")

    # 3. Duplicate detection (requires all_pages context)
    if all_pages:
        page_slug = page_path.stem.lower()
        page_body = _strip_frontmatter(content).lower()

        for other in all_pages:
            other_path = other.get("path", "")
            other_slug = Path(other_path).stem.lower()
            other_body = _strip_frontmatter(other.get("content", "")).lower()

            # Skip self
            if other_slug == page_slug and other_path == str(page_path):
                continue

            # Skip very short pages (not meaningful for comparison)
            if len(page_body) < 50 or len(other_body) < 50:
                continue

            # Check name similarity
            name_distance = levenshtein_distance(page_slug, other_slug)
            if name_distance <= 2 and page_slug != other_slug:
                # Similar names — check content too
                similarity = jaccard_similarity(page_body, other_body)
                if similarity > DUPLICATE_JACCARD_THRESHOLD:
                    result.duplicate_of.append(other_slug)
                    result.issues.append(
                        f"Possible duplicate of '{other_slug}' "
                        f"(name distance: {name_distance}, content similarity: {similarity:.0%})"
                    )
            elif len(page_body) > 100 and len(other_body) > 100:
                # Different names but check for high content overlap
                similarity = jaccard_similarity(page_body, other_body)
                if similarity > 0.75:  # higher threshold for different names
                    result.duplicate_of.append(other_slug)
                    result.issues.append(
                        f"High content overlap with '{other_slug}' "
                        f"(similarity: {similarity:.0%})"
                    )

    return result


# ── Check 4: Compute Page Score ──────────────────────────────────────────────


def compute_page_score(
    content: str,
    page_path: Path,
    wiki_root: Path,
    llm: Optional[LLMClient] = None,
    all_pages: Optional[list[dict[str, str]]] = None,
) -> PageQualityResult:
    """Compute per-page quality score (0-10) and label.

    Aggregates results from all 3 checks:
      - Depth check: 0-3 points
      - Quality check: 0-3 points
      - Classification check: 0-2 points
      - Bonus points: 0-2 for overall completeness

    Labels:
      - DEEP: score > 7
      - ADEQUATE: score 4-7
      - STUB: score < 4
      - MISPLACED: page in wrong category (overrides score-based label)
      - PLACEHOLDER: all content is placeholder text (overrides score-based label)

    Returns PageQualityResult with score, label, and aggregated issues.
    """
    result = PageQualityResult()

    try:
        rel = str(page_path.relative_to(wiki_root))
    except ValueError:
        rel = str(page_path)
    result.file = rel

    # Run all 3 checks
    depth = page_depth_check(content, page_path, wiki_root)
    quality = page_quality_check(content, page_path, wiki_root, llm)
    classification = page_classification_check(
        content, page_path, wiki_root, llm, all_pages
    )

    result.depth = depth
    result.quality = quality
    result.classification = classification

    # Aggregate issues
    result.issues = depth.issues + quality.issues + classification.issues

    # Compute score from sub-scores
    depth_score = depth.score_contribution       # 0-3
    quality_score = quality.score_contribution    # 0-3
    class_score = classification.score_contribution  # 0-2

    # Bonus points for overall completeness (0-2)
    bonus = 0.0
    body = _strip_frontmatter(content)
    page_size = len(content.encode("utf-8"))

    # Bonus for having frontmatter
    if has_frontmatter(content):
        bonus += 0.3

    # Bonus for substantial content
    if page_size > 500:
        bonus += 0.3
    if page_size > 1000:
        bonus += 0.2

    # Bonus for having multiple sections
    section_count = len(re.findall(r'^##\s+', content, re.MULTILINE))
    if section_count >= 3:
        bonus += 0.3
    if section_count >= 5:
        bonus += 0.2

    # Bonus for having tags
    tags = extract_frontmatter_field(content, "tags")
    if tags and tags != "[]":
        bonus += 0.2

    bonus = min(bonus, 2.0)

    # Total score
    raw_score = depth_score + quality_score + class_score + bonus
    result.score = min(round(raw_score, 1), 10.0)

    # Determine label (special labels override score-based ones)
    if classification.is_misplaced:
        result.label = LABEL_MISPLACED
    elif _is_all_placeholder(content):
        result.label = LABEL_PLACEHOLDER
    elif result.score > 7:
        result.label = LABEL_DEEP
    elif result.score >= 4:
        result.label = LABEL_ADEQUATE
    else:
        result.label = LABEL_STUB

    return result


# ── Batch Processing ─────────────────────────────────────────────────────────


def score_all_pages(
    wiki_root: Path,
    llm: Optional[LLMClient] = None,
) -> list[PageQualityResult]:
    """Score all wiki pages in a knowledge base. Returns list of PageQualityResult.

    Collects all pages first (needed for duplicate detection), then scores each.
    """
    wiki_dir = wiki_root / "wiki"
    if not wiki_dir.exists():
        return []

    # Collect all pages
    all_pages: list[dict[str, str]] = []
    page_paths: list[Path] = []

    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        all_pages.append({
            "path": str(md_file),
            "content": content,
        })
        page_paths.append(md_file)

    # Score each page
    results: list[PageQualityResult] = []
    for i, md_file in enumerate(page_paths):
        content = all_pages[i]["content"]
        result = compute_page_score(
            content, md_file, wiki_root, llm, all_pages
        )
        results.append(result)

    return results


def print_score_report(results: list[PageQualityResult]) -> None:
    """Print human-readable score report."""
    if not results:
        print("No wiki pages found.")
        return

    # Group by label
    by_label: dict[str, list[PageQualityResult]] = {}
    for r in results:
        by_label.setdefault(r.label, []).append(r)

    print()
    print("Page Quality Report")
    print("=" * 60)

    # Summary
    total = len(results)
    avg_score = sum(r.score for r in results) / total if total else 0
    print(f"Total pages: {total}")
    print(f"Average score: {avg_score:.1f}/10")
    print()

    # Distribution
    for label in [LABEL_DEEP, LABEL_ADEQUATE, LABEL_STUB, LABEL_MISPLACED, LABEL_PLACEHOLDER]:
        pages = by_label.get(label, [])
        if pages:
            pct = len(pages) / total * 100
            print(f"  {label:12s}  {len(pages):3d} ({pct:.0f}%)")
    print()

    # Details for non-DEEP pages (these need attention)
    for label in [LABEL_MISPLACED, LABEL_PLACEHOLDER, LABEL_STUB]:
        pages = by_label.get(label, [])
        if not pages:
            continue
        print(f"-- {label} ({len(pages)} pages) --")
        for r in sorted(pages, key=lambda x: x.score):
            issue_str = "; ".join(r.issues[:3]) if r.issues else "no specific issues"
            print(f"  [{r.score:4.1f}] {r.file}")
            print(f"        {issue_str}")
        print()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _strip_frontmatter(content: str) -> str:
    """Remove YAML frontmatter from content."""
    if content.startswith("---"):
        end_match = re.search(r'\n---\s*\n', content[3:])
        if end_match:
            return content[3 + end_match.end():]
    return content


def _extract_sentences(text: str) -> list[str]:
    """Extract sentences from text (simple split on sentence-ending punctuation)."""
    # Split on sentence-ending punctuation followed by space or newline
    raw = re.split(r'[.!?]\s+', text)
    return [s.strip() for s in raw if len(s.strip()) > 10]


def _is_all_placeholder(content: str) -> bool:
    """Check if the entire page content is placeholder text."""
    body = _strip_frontmatter(content).strip()
    if not body:
        return True
    # Check if the only content is [No data yet] variants
    cleaned = re.sub(r'##\s+\S+.*', '', body)  # remove headings
    cleaned = cleaned.strip()
    if not cleaned:
        return True
    lower = cleaned.lower()
    placeholder_phrases = [
        "[no data yet]",
        "no data yet",
        "todo",
        "tbd",
        "placeholder",
        "coming soon",
        "to be added",
    ]
    for phrase in placeholder_phrases:
        lower = lower.replace(phrase, "")
    # After removing all placeholder phrases, check if anything real remains
    remaining = re.sub(r'[\s\-*#\[\]()]', '', lower)
    return len(remaining) < 10
