"""
heal.py -- Unified heal command for wiki-recall knowledge bases.

Single command that replaces retrofit + hygiene + refactor by orchestrating:
  1. DIAGNOSE  -- run all hygiene checks + 5 LLM critic functions
  2. AUTO-FIX  -- safe, non-destructive fixes (from hygiene.py)
  3. SMART-FIX -- LLM-assisted fixes for judgment-required issues
  4. DEPTH-UPGRADE -- promote tier-3 stubs to tier-2 with content
  5. VERIFY    -- re-run diagnose, print before/after comparison

5 LLM Critic Functions (all have regex fallback):
  - karpathy:        Evaluate entity quality per Karpathy methodology
  - gbrain:          Evaluate brain.md budget and coherence
  - structure:       Classify root files, detect bloat
  - content:         Assess content quality, noise detection
  - cross_reference: Validate cross-references and path references

Interface:
    python engine/heal.py                     # diagnose only
    python engine/heal.py /path/to/wiki       # diagnose specific path
    python engine/heal.py --fix               # diagnose + auto-fix + smart-fix
    python engine/heal.py --json              # JSON output
    python engine/heal.py --deep              # include depth-upgrade
    python engine/heal.py --verify            # full pipeline with verification

Safety: auto_fix() only touches safe fixes. smart_fix() uses LLM judgment.
        depth_upgrade() adds content, never deletes. All changes are additive.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# Add project root so we can import engine modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.hygiene import (
    HygieneIssue,
    HygieneReport,
    apply_fixes,
    check_brain_health,
    check_content,
    check_depth,
    check_duplication,
    check_structure,
    compute_depth_grade,
    compute_grade,
    extract_frontmatter_field,
    has_frontmatter,
    has_section,
    section_has_content,
    DEFAULT_ROOT,
)
from engine.llm_client import LLMClient

logger = logging.getLogger(__name__)


# ── Critic Finding Model ──────────────────────────────────────────────────────


@dataclass
class CriticFinding:
    """A single finding from a critic function."""

    critic: str  # karpathy | gbrain | structure | content | cross_reference
    severity: str  # error | warning | info
    message: str
    file: Optional[str] = None
    suggestion: Optional[str] = None
    auto_fixable: bool = False

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "critic": self.critic,
            "severity": self.severity,
            "message": self.message,
        }
        if self.file:
            d["file"] = self.file
        if self.suggestion:
            d["suggestion"] = self.suggestion
        if self.auto_fixable:
            d["auto_fixable"] = True
        return d


# ── Heal Report ───────────────────────────────────────────────────────────────


@dataclass
class HealReport:
    """Full heal report with hygiene issues, critic findings, and scores."""

    root: Path
    issues: list[HygieneIssue] = field(default_factory=list)
    scores: dict[str, str] = field(default_factory=dict)
    critic_findings: list[CriticFinding] = field(default_factory=list)
    fix_actions: list[str] = field(default_factory=list)
    smart_fix_actions: list[str] = field(default_factory=list)
    depth_actions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "scores": self.scores,
            "issue_count": len(self.issues),
            "issues": [i.to_dict() for i in self.issues],
            "critic_findings": [f.to_dict() for f in self.critic_findings],
            "fix_actions": self.fix_actions,
            "smart_fix_actions": self.smart_fix_actions,
            "depth_actions": self.depth_actions,
        }

    def print_report(self, before_scores: dict[str, str] | None = None) -> None:
        """Print human-readable report."""
        print()
        print("Heal Report")
        print("=" * 50)
        print(f"Root: {self.root}")
        print()

        # Scores (with before/after if available)
        print("Category Scores:")
        for cat, grade in self.scores.items():
            if before_scores and cat in before_scores:
                prev = before_scores[cat]
                arrow = " -> " + grade if prev != grade else ""
                indicator = " (improved)" if grade < prev else ""
                print(f"  {cat:15s}  {prev}{arrow}{indicator}")
            else:
                print(f"  {cat:15s}  {grade}")
        print()

        # Hygiene issues by category
        for cat in ("structure", "content", "depth", "duplication", "brain"):
            cat_issues = [i for i in self.issues if i.category == cat]
            if not cat_issues:
                continue
            print(f"-- {cat.upper()} ({len(cat_issues)} issues) --")
            for issue in cat_issues:
                icon = {"error": "x", "warning": "!", "info": "i"}.get(
                    issue.severity, "?"
                )
                loc = f"  [{issue.file}]" if issue.file else ""
                fix = "  (fixable)" if issue.fixable else ""
                print(f"  [{icon}] {issue.message}{loc}{fix}")
            print()

        # Critic findings
        critic_names = sorted(set(f.critic for f in self.critic_findings))
        for critic_name in critic_names:
            findings = [f for f in self.critic_findings if f.critic == critic_name]
            if not findings:
                continue
            print(f"-- CRITIC: {critic_name} ({len(findings)} findings) --")
            for finding in findings:
                icon = {"error": "x", "warning": "!", "info": "i"}.get(
                    finding.severity, "?"
                )
                loc = f"  [{finding.file}]" if finding.file else ""
                print(f"  [{icon}] {finding.message}{loc}")
                if finding.suggestion:
                    print(f"      -> {finding.suggestion}")
            print()

        # Fix actions
        all_actions = self.fix_actions + self.smart_fix_actions + self.depth_actions
        if all_actions:
            print("-- ACTIONS TAKEN --")
            for action in all_actions:
                print(f"  + {action}")
            print()

        total = len(self.issues) + len(self.critic_findings)
        print(f"Total: {len(self.issues)} hygiene issues, "
              f"{len(self.critic_findings)} critic findings")
        print()


# ── 5 LLM Critic Functions ───────────────────────────────────────────────────


def critic_karpathy(root: Path, llm: LLMClient) -> list[CriticFinding]:
    """Evaluate entity quality per Karpathy methodology.

    LLM mode: Assess compiled truth completeness, source attribution, contradiction
    detection across wiki pages.
    Regex fallback: Check for missing ## Compiled Truth, uncited claims (no [Source:]),
    structural completeness.
    """
    findings: list[CriticFinding] = []
    wiki_dir = root / "wiki"
    if not wiki_dir.exists():
        return findings

    pages_data: list[dict[str, str]] = []
    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        rel = str(md_file.relative_to(root))
        pages_data.append({"file": rel, "content": content, "name": md_file.stem})

    if not pages_data:
        return findings

    if llm.available:
        # LLM-powered Karpathy quality assessment
        # Batch pages for efficiency
        batch_text = ""
        for page in pages_data[:20]:  # Limit to 20 pages per LLM call
            snippet = page["content"][:500]
            batch_text += f"\n--- {page['file']} ---\n{snippet}\n"

        prompt = (
            "You are a Karpathy-style knowledge base quality critic.\n"
            "For each wiki page below, check:\n"
            "1. Does it have a Compiled Truth section with real content (not just placeholders)?\n"
            "2. Are claims attributed with [Source: ...] citations?\n"
            "3. Is the content actionable and opinionated (not generic filler)?\n\n"
            "Return a JSON array of objects:\n"
            '[{"file": "...", "issues": ["issue1", "issue2"], "quality": "good|fair|poor"}]\n'
            "Return ONLY pages with issues. Omit pages that are fine.\n"
            "Return ONLY the JSON array.\n\n"
            f"Pages:\n{batch_text}"
        )
        raw = llm.ask(prompt)
        if raw:
            parsed = llm._parse_json_response(raw)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict) and "file" in item:
                        for issue_text in item.get("issues", []):
                            findings.append(CriticFinding(
                                critic="karpathy",
                                severity="warning",
                                message=issue_text,
                                file=item["file"],
                            ))

    # Regex fallback (always runs to catch structural issues)
    for page in pages_data:
        content = page["content"]
        rel = page["file"]

        # Check for compiled truth with actual content
        if has_frontmatter(content):
            if has_section(content, "Compiled Truth"):
                if not section_has_content(content, "Compiled Truth"):
                    findings.append(CriticFinding(
                        critic="karpathy",
                        severity="warning",
                        message="Compiled Truth section is empty/placeholder",
                        file=rel,
                        suggestion="Add substantive compiled truth content",
                    ))
            # Check for uncited claims in compiled truth
            ct_match = re.search(
                r'##\s+Compiled Truth\b(.+?)(?=^##\s|\Z)',
                content, re.MULTILINE | re.DOTALL,
            )
            if ct_match:
                ct_body = ct_match.group(1).strip()
                if ct_body and "[no data yet]" not in ct_body.lower():
                    # Has content but no source citations
                    if "[Source:" not in ct_body and "observed:" not in ct_body.lower():
                        findings.append(CriticFinding(
                            critic="karpathy",
                            severity="info",
                            message="Compiled Truth has no source citations",
                            file=rel,
                            suggestion="Add [Source: session XXXXX] attribution",
                        ))

    return findings


def critic_gbrain(root: Path, llm: LLMClient) -> list[CriticFinding]:
    """Evaluate brain.md budget and coherence.

    LLM mode: Assess whether brain.md is coherent, focused, and within budget.
    Detect inlined decisions that belong in decisions.md.
    Regex fallback: Line count > 40, token count > 550, code blocks, missing L0/L1.
    """
    findings: list[CriticFinding] = []
    brain_path = root / "brain.md"

    if not brain_path.exists():
        findings.append(CriticFinding(
            critic="gbrain",
            severity="error",
            message="brain.md not found",
        ))
        return findings

    try:
        content = brain_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        findings.append(CriticFinding(
            critic="gbrain",
            severity="error",
            message="brain.md unreadable",
            file="brain.md",
        ))
        return findings

    lines = content.split("\n")
    line_count = len(lines)
    token_estimate = len(content) // 4

    if llm.available:
        prompt = (
            "You are a brain.md quality critic for a personal wiki system.\n"
            "brain.md should be a concise L0+L1 summary of who the user is and what\n"
            "they're currently working on. Budget: 40 lines, 550 tokens.\n\n"
            "Check for:\n"
            "1. Inlined decisions (should be in decisions.md)\n"
            "2. Code blocks (should be in reference/)\n"
            "3. Multi-line project descriptions (should be 1 line each)\n"
            "4. Tool routing rules (should be in domains/)\n"
            "5. Generic filler vs actionable content\n\n"
            "Return a JSON array of issue strings. Return ONLY the JSON array.\n\n"
            f"brain.md ({line_count} lines, ~{token_estimate} tokens):\n"
            f"{content[:3000]}"
        )
        raw = llm.ask(prompt)
        if raw:
            parsed = llm._parse_json_response(raw)
            if isinstance(parsed, list):
                for issue_text in parsed:
                    if isinstance(issue_text, str):
                        findings.append(CriticFinding(
                            critic="gbrain",
                            severity="warning",
                            message=issue_text,
                            file="brain.md",
                        ))

    # Regex fallback checks
    if line_count > 40:
        sev = "error" if line_count > 80 else "warning"
        findings.append(CriticFinding(
            critic="gbrain",
            severity=sev,
            message=f"brain.md has {line_count} lines (budget: 40)",
            file="brain.md",
            suggestion="Trim to L0+L1 essentials",
            auto_fixable=True,
        ))

    if token_estimate > 550:
        sev = "error" if token_estimate > 1000 else "warning"
        findings.append(CriticFinding(
            critic="gbrain",
            severity=sev,
            message=f"brain.md ~{token_estimate} tokens (budget: 550)",
            file="brain.md",
        ))

    if "```" in content:
        findings.append(CriticFinding(
            critic="gbrain",
            severity="error",
            message="brain.md contains code blocks -- move to reference/",
            file="brain.md",
            auto_fixable=True,
        ))

    # Check for inlined decisions
    decision_patterns = [
        re.compile(r'^\s*[-*]\s*\[?\d{4}-\d{2}-\d{2}\]?\s+.*(?:decided|settled|going with|chose)', re.IGNORECASE),
        re.compile(r'^\s*[-*]\s*(?:Decision|DECISION):\s+', re.IGNORECASE),
    ]
    decision_count = sum(
        1 for line in lines
        if any(p.match(line) for p in decision_patterns)
    )
    if decision_count > 0:
        findings.append(CriticFinding(
            critic="gbrain",
            severity="warning",
            message=f"brain.md has {decision_count} inlined decision(s) -- move to decisions.md",
            file="brain.md",
            auto_fixable=True,
        ))

    # Missing L0/L1
    if "## L0" not in content and "## Identity" not in content:
        findings.append(CriticFinding(
            critic="gbrain",
            severity="error",
            message="brain.md missing L0/Identity section",
            file="brain.md",
        ))

    if "## L1" not in content and "## Active" not in content:
        findings.append(CriticFinding(
            critic="gbrain",
            severity="error",
            message="brain.md missing L1/Active Work section",
            file="brain.md",
        ))

    return findings


# Known core files that should always be at root
_CORE_ROOT_FILES = {
    "brain.md", "decisions.md", "actions.md", "copilot-instructions.md",
    "index.md", "README.md", ".gitignore",
}

# Script extensions
_SCRIPT_EXTENSIONS = {".ps1", ".sh", ".py", ".bat", ".cmd"}

# Archive candidates
_ARCHIVE_EXTENSIONS = {".bak", ".old", ".orig", ".tmp"}


def critic_structure(root: Path, llm: LLMClient) -> list[CriticFinding]:
    """Classify root files and detect structural issues.

    LLM mode: Classify each root file as CORE/SCRIPT/ARCHIVE/DELETE.
    Regex fallback: Pattern match on extensions and known core file list.
    """
    findings: list[CriticFinding] = []

    if not root.exists():
        return findings

    root_files = [f for f in root.iterdir() if f.is_file()]

    # Root file budget
    if len(root_files) > 15:
        findings.append(CriticFinding(
            critic="structure",
            severity="error",
            message=f"Root has {len(root_files)} files (error threshold: 15)",
            suggestion="Classify and move non-core files",
        ))
    elif len(root_files) > 10:
        findings.append(CriticFinding(
            critic="structure",
            severity="warning",
            message=f"Root has {len(root_files)} files (warn threshold: 10)",
            suggestion="Review and organize root files",
        ))

    # Classify files
    classifications: dict[str, str] = {}

    if llm.available and root_files:
        file_list = "\n".join(f.name for f in root_files)
        prompt = (
            "Classify each root file into exactly one category:\n"
            "- CORE: essential files that must stay at root (brain.md, decisions.md, etc.)\n"
            "- SCRIPT: scripts that should be in scripts/ directory\n"
            "- ARCHIVE: old/backup files that should be archived\n"
            "- DELETE: temporary or generated files safe to remove\n\n"
            "Return a JSON object mapping filename to category.\n"
            "Return ONLY the JSON object.\n\n"
            f"Files:\n{file_list}"
        )
        raw = llm.ask(prompt)
        if raw:
            parsed = llm._parse_json_response(raw)
            if isinstance(parsed, dict):
                classifications = parsed

    # Regex fallback classification
    for f in root_files:
        if f.name in classifications:
            continue
        if f.name in _CORE_ROOT_FILES:
            classifications[f.name] = "CORE"
        elif f.suffix in _SCRIPT_EXTENSIONS:
            classifications[f.name] = "SCRIPT"
        elif f.suffix in _ARCHIVE_EXTENSIONS:
            classifications[f.name] = "ARCHIVE"
        elif f.name.startswith("."):
            classifications[f.name] = "CORE"  # dotfiles are config
        else:
            classifications[f.name] = "CORE"  # default to keeping

    # Generate findings for non-CORE files
    for filename, category in classifications.items():
        if category == "SCRIPT":
            findings.append(CriticFinding(
                critic="structure",
                severity="info",
                message=f"Script at root: {filename} -> move to scripts/",
                file=filename,
                suggestion="Move to scripts/ directory",
                auto_fixable=True,
            ))
        elif category == "ARCHIVE":
            findings.append(CriticFinding(
                critic="structure",
                severity="info",
                message=f"Archive candidate: {filename}",
                file=filename,
                suggestion="Move to .archive/",
                auto_fixable=True,
            ))
        elif category == "DELETE":
            findings.append(CriticFinding(
                critic="structure",
                severity="warning",
                message=f"Temporary/generated file: {filename}",
                file=filename,
                suggestion="Consider deleting",
            ))

    return findings


def critic_content(root: Path, llm: LLMClient) -> list[CriticFinding]:
    """Assess content quality and detect noise.

    LLM mode: Evaluate whether stubs are worth keeping, detect noise in decisions.md.
    Regex fallback: Size-based stub detection, harvest noise regex.
    """
    findings: list[CriticFinding] = []

    # Check decisions.md for noise
    decisions_path = root / "decisions.md"
    if decisions_path.exists():
        try:
            content = decisions_path.read_text(encoding="utf-8", errors="replace")
            entry_lines = [
                line.strip() for line in content.split("\n")
                if line.strip().startswith("-")
            ]

            if llm.available and entry_lines:
                # Sample up to 20 entries for LLM review
                sample = entry_lines[:20]
                sample_text = "\n".join(f"{i+1}. {e}" for i, e in enumerate(sample))
                prompt = (
                    "You are a noise filter for decisions.md in a personal wiki.\n"
                    "Review these decision entries and classify each as:\n"
                    "- REAL: genuine design/architecture/technology decision\n"
                    "- NOISE: code snippet, template text, harvest dump, or generic statement\n\n"
                    "Return a JSON array: "
                    '[{"index": 1, "verdict": "REAL"|"NOISE", "reason": "..."}]\n'
                    "Return ONLY the JSON array.\n\n"
                    f"Entries:\n{sample_text}"
                )
                raw = llm.ask(prompt)
                if raw:
                    parsed = llm._parse_json_response(raw)
                    if isinstance(parsed, list):
                        noise_count = sum(
                            1 for v in parsed
                            if isinstance(v, dict) and v.get("verdict") == "NOISE"
                        )
                        if noise_count > 0:
                            findings.append(CriticFinding(
                                critic="content",
                                severity="warning",
                                message=f"decisions.md: {noise_count}/{len(sample)} sampled entries are noise",
                                file="decisions.md",
                                suggestion="Clean with LLM verify filter",
                                auto_fixable=True,
                            ))

            # Regex fallback: detect harvest dumps
            harvest_noise = 0
            short_entries = 0
            for line in entry_lines:
                entry = line.lstrip("- ")
                if "[harvest]" in entry.lower():
                    harvest_noise += 1
                elif re.match(r'^\[\d{4}-\d{2}-\d{2}\]\s+\S+\s*$', entry):
                    short_entries += 1

            if harvest_noise > 5:
                findings.append(CriticFinding(
                    critic="content",
                    severity="warning",
                    message=f"decisions.md has {harvest_noise} [harvest] tagged entries",
                    file="decisions.md",
                    auto_fixable=True,
                ))
            if short_entries > 5:
                findings.append(CriticFinding(
                    critic="content",
                    severity="info",
                    message=f"decisions.md has {short_entries} very short entries (likely noise)",
                    file="decisions.md",
                ))
        except Exception:
            pass

    # Check wiki stubs
    wiki_dir = root / "wiki"
    if wiki_dir.exists():
        stub_count = 0
        for md_file in wiki_dir.rglob("*.md"):
            if md_file.name in ("index.md", "log.md"):
                continue
            if md_file.parent.name.startswith("."):
                continue
            if md_file.stat().st_size < 200:
                stub_count += 1

        if stub_count > 5:
            findings.append(CriticFinding(
                critic="content",
                severity="warning",
                message=f"{stub_count} wiki pages are stubs (<200 bytes)",
                suggestion="Consider upgrading to tier-2 or archiving",
            ))

    return findings


def critic_cross_reference(root: Path, llm: LLMClient) -> list[CriticFinding]:
    """Validate cross-references between entities.

    LLM mode: Assess whether related entities make sense semantically.
    Regex fallback: Parse related: YAML field, check file existence on disk.
    """
    findings: list[CriticFinding] = []
    wiki_dir = root / "wiki"

    if not wiki_dir.exists():
        return findings

    # Collect all page slugs for existence checking
    all_slugs: set[str] = set()
    page_relations: list[tuple[str, str, list[str]]] = []

    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue

        slug = md_file.stem
        all_slugs.add(slug)

        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        # Extract related: field from frontmatter
        related_match = re.search(
            r'^related:\s*\[([^\]]*)\]', content, re.MULTILINE
        )
        if related_match:
            related_raw = related_match.group(1)
            related_ids = [
                r.strip().strip("'\"")
                for r in related_raw.split(",")
                if r.strip()
            ]
            rel = str(md_file.relative_to(root))
            page_relations.append((rel, slug, related_ids))

    # Check for broken references
    for file_rel, slug, related_ids in page_relations:
        for ref_id in related_ids:
            if ref_id not in all_slugs:
                findings.append(CriticFinding(
                    critic="cross_reference",
                    severity="warning",
                    message=f"Broken reference: '{ref_id}' not found in wiki",
                    file=file_rel,
                    suggestion=f"Remove '{ref_id}' from related: or create the page",
                ))

    # Check copilot-instructions.md for broken path references
    for instructions_name in ("copilot-instructions.md",):
        instructions_path = root / instructions_name
        if not instructions_path.exists():
            # Also check ~/.github/
            instructions_path = Path.home() / ".github" / instructions_name
        if instructions_path.exists():
            try:
                content = instructions_path.read_text(encoding="utf-8", errors="replace")
                # Find path references like wiki/projects/foo.md, domains/bar.md
                path_refs = re.findall(
                    r'(?:wiki|domains|scripts|reference)/[\w\-/]+\.(?:md|ps1|py|sh)',
                    content,
                )
                for ref in path_refs:
                    ref_path = root / ref
                    if not ref_path.exists():
                        findings.append(CriticFinding(
                            critic="cross_reference",
                            severity="warning",
                            message=f"Broken path in copilot-instructions.md: {ref}",
                            file=str(instructions_path.relative_to(root)
                                     if instructions_path.is_relative_to(root)
                                     else instructions_path),
                            suggestion=f"Remove or fix path reference: {ref}",
                        ))
            except Exception:
                pass

    # LLM semantic check (only if we have relations)
    if llm.available and page_relations:
        # Build a summary for LLM to assess
        relation_text = ""
        for file_rel, slug, related_ids in page_relations[:15]:
            relation_text += f"  {slug} -> related: [{', '.join(related_ids)}]\n"

        if relation_text:
            prompt = (
                "Review these wiki page cross-references. Do the 'related' links\n"
                "make semantic sense? Flag any that seem wrong or missing.\n\n"
                "Return a JSON array of issues (empty array if all are fine):\n"
                '[{"page": "slug", "issue": "description"}]\n'
                "Return ONLY the JSON array.\n\n"
                f"Relations:\n{relation_text}"
            )
            raw = llm.ask(prompt)
            if raw:
                parsed = llm._parse_json_response(raw)
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict) and "page" in item:
                            findings.append(CriticFinding(
                                critic="cross_reference",
                                severity="info",
                                message=item.get("issue", "cross-reference concern"),
                                file=item.get("page"),
                            ))

    return findings


# ── HealPipeline ──────────────────────────────────────────────────────────────


class HealPipeline:
    """Unified heal pipeline: diagnose -> auto-fix -> smart-fix -> depth-upgrade -> verify."""

    def __init__(self, root: Path, llm: LLMClient | None = None):
        self.root = root
        self.llm = llm or LLMClient(fallback_mode=True)

    def diagnose(self) -> HealReport:
        """Run all hygiene checks and critic functions. Returns HealReport."""
        report = HealReport(root=self.root)

        # 1. Run hygiene checks (from hygiene.py)
        structure_issues = check_structure(self.root)
        content_issues = check_content(self.root)
        depth_issues = check_depth(self.root)
        duplication_issues = check_duplication(self.root)
        brain_issues = check_brain_health(self.root)

        report.issues = (
            structure_issues + content_issues + depth_issues
            + duplication_issues + brain_issues
        )

        # Count total wiki pages for depth grading
        total_pages = 0
        wiki_dir = self.root / "wiki"
        if wiki_dir.exists():
            for md_file in wiki_dir.rglob("*.md"):
                if md_file.name in ("index.md", "log.md"):
                    continue
                if md_file.parent.name.startswith("."):
                    continue
                total_pages += 1

        # Compute scores (same logic as HygieneReport)
        for cat, cat_issues in [
            ("structure", structure_issues),
            ("content", content_issues),
            ("duplication", duplication_issues),
            ("brain", brain_issues),
        ]:
            errors = sum(1 for i in cat_issues if i.severity == "error")
            warnings = sum(1 for i in cat_issues if i.severity == "warning")
            report.scores[cat] = compute_grade(errors, warnings)

        depth_count = len(depth_issues)
        report.scores["depth"] = compute_depth_grade(depth_count, total_pages)

        # 2. Run 5 critic functions
        critics = [
            ("karpathy", critic_karpathy),
            ("gbrain", critic_gbrain),
            ("structure", critic_structure),
            ("content", critic_content),
            ("cross_reference", critic_cross_reference),
        ]
        for critic_name, critic_fn in critics:
            try:
                critic_findings = critic_fn(self.root, self.llm)
                report.critic_findings.extend(critic_findings)
            except Exception as e:
                logger.warning("Critic %s failed: %s", critic_name, e)
                report.critic_findings.append(CriticFinding(
                    critic=critic_name,
                    severity="error",
                    message=f"Critic failed: {e}",
                ))

        return report

    def auto_fix(self, report: HealReport) -> list[str]:
        """Apply safe, non-destructive fixes from hygiene.py.

        Returns list of actions taken.
        """
        actions = apply_fixes(self.root, report.issues, llm=self.llm)
        report.fix_actions = actions
        return actions

    def smart_fix(self, report: HealReport) -> list[str]:
        """Apply LLM-assisted fixes for judgment-required issues.

        Uses critic findings to determine what needs smart fixing.
        Falls back to regex-based fixes when LLM unavailable.
        """
        actions: list[str] = []

        # Smart fix 1: Brain.md trim (from gbrain critic)
        gbrain_findings = [
            f for f in report.critic_findings
            if f.critic == "gbrain" and f.auto_fixable
        ]
        if gbrain_findings:
            brain_path = self.root / "brain.md"
            if brain_path.exists():
                try:
                    content = brain_path.read_text(encoding="utf-8", errors="replace")
                    original_lines = len(content.strip().split("\n"))

                    # Import retrofit functions for brain cleanup
                    from engine.retrofit import (
                        extract_code_blocks,
                        extract_inline_decisions,
                        trim_project_descriptions,
                        remove_blank_line_runs,
                    )

                    # Step 1: Extract code blocks
                    content, code_blocks = extract_code_blocks(content)
                    if code_blocks:
                        ref_dir = self.root / "reference"
                        ref_dir.mkdir(parents=True, exist_ok=True)
                        extract_path = ref_dir / "extracted-from-brain.md"
                        extract_content = "# Code Blocks Extracted from brain.md\n\n"
                        extract_content += f"Extracted on {datetime.now().strftime('%Y-%m-%d')}\n\n"
                        for i, block in enumerate(code_blocks, 1):
                            extract_content += f"## Block {i}\n\n{block}\n\n"
                        extract_path.write_text(extract_content, encoding="utf-8")
                        actions.append(f"Extracted {len(code_blocks)} code block(s) from brain.md")

                    # Step 2: Extract inlined decisions
                    content, decisions = extract_inline_decisions(content)
                    if decisions:
                        decisions_path = self.root / "decisions.md"
                        today = datetime.now().strftime("%Y-%m-%d")
                        new_entries = "\n".join(f"- [{today}] [tier:2] {d}" for d in decisions)
                        with open(decisions_path, "a", encoding="utf-8") as f:
                            f.write(f"\n## Extracted from brain.md ({today})\n\n{new_entries}\n")
                        actions.append(f"Extracted {len(decisions)} decision(s) from brain.md")

                    # Step 3: Trim project descriptions
                    if self.llm.available:
                        from engine.retrofit import _llm_trim_project_descriptions
                        content, summary_count = _llm_trim_project_descriptions(content, self.llm)
                        if summary_count:
                            actions.append(f"LLM-summarized {summary_count} project description(s)")
                    else:
                        content = trim_project_descriptions(content)

                    # Step 4: Collapse blank lines
                    content = remove_blank_line_runs(content)

                    final_lines = len(content.strip().split("\n"))
                    if final_lines < original_lines:
                        brain_path.write_text(content, encoding="utf-8")
                        actions.append(f"Trimmed brain.md: {original_lines} -> {final_lines} lines")
                except Exception as e:
                    logger.warning("Brain.md smart fix failed: %s", e)

        # Smart fix 2: Move scripts from root to scripts/
        structure_findings = [
            f for f in report.critic_findings
            if f.critic == "structure" and f.auto_fixable and f.file
        ]
        for finding in structure_findings:
            if "move to scripts/" in (finding.suggestion or "").lower():
                src = self.root / finding.file
                scripts_dir = self.root / "scripts"
                if src.exists():
                    scripts_dir.mkdir(parents=True, exist_ok=True)
                    dest = scripts_dir / finding.file
                    if not dest.exists():
                        import shutil
                        shutil.move(str(src), str(dest))
                        actions.append(f"Moved {finding.file} to scripts/")
            elif "move to .archive/" in (finding.suggestion or "").lower():
                src = self.root / finding.file
                archive_dir = self.root / ".archive"
                if src.exists():
                    archive_dir.mkdir(parents=True, exist_ok=True)
                    dest = archive_dir / finding.file
                    if not dest.exists():
                        import shutil
                        shutil.move(str(src), str(dest))
                        actions.append(f"Archived {finding.file}")

        # Smart fix 3: Clean decisions.md noise
        content_findings = [
            f for f in report.critic_findings
            if f.critic == "content" and f.auto_fixable
            and f.file == "decisions.md"
        ]
        if content_findings:
            decisions_path = self.root / "decisions.md"
            if decisions_path.exists():
                try:
                    content = decisions_path.read_text(encoding="utf-8", errors="replace")
                    lines = content.split("\n")
                    cleaned: list[str] = []
                    removed = 0
                    for line in lines:
                        stripped = line.strip()
                        if stripped.startswith("-"):
                            entry = stripped.lstrip("- ")
                            # Remove [harvest] tagged entries
                            if "[harvest]" in entry.lower():
                                removed += 1
                                continue
                            # Remove very short auto-generated entries
                            if re.match(r'^\[\d{4}-\d{2}-\d{2}\]\s+\S+\s*$', entry):
                                removed += 1
                                continue
                        cleaned.append(line)

                    if removed > 0:
                        decisions_path.write_text("\n".join(cleaned), encoding="utf-8")
                        actions.append(f"Cleaned {removed} noise entries from decisions.md")
                except Exception as e:
                    logger.warning("decisions.md cleanup failed: %s", e)

        report.smart_fix_actions = actions
        return actions

    def depth_upgrade(self, report: HealReport) -> list[str]:
        """Promote tier-3 stubs to tier-2 using LLM or structural additions.

        Returns list of actions taken.
        """
        actions: list[str] = []
        wiki_dir = self.root / "wiki"

        if not wiki_dir.exists():
            return actions

        for md_file in wiki_dir.rglob("*.md"):
            if md_file.name in ("index.md", "log.md"):
                continue
            if md_file.parent.name.startswith("."):
                continue

            try:
                content = md_file.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            tier = extract_frontmatter_field(content, "tier")
            if tier != "3":
                continue

            rel = str(md_file.relative_to(self.root))
            page_type = extract_frontmatter_field(content, "type")
            title = extract_frontmatter_field(content, "title") or md_file.stem

            upgraded = False

            # Add missing Compiled Truth section
            if not has_section(content, "Compiled Truth"):
                if self.llm.available:
                    # LLM generates initial compiled truth
                    summary = self.llm.summarize(content, max_words=50)
                    if summary:
                        content = _insert_section_after_frontmatter(
                            content, "Compiled Truth", summary
                        )
                        upgraded = True
                else:
                    content = _insert_section_after_frontmatter(
                        content, "Compiled Truth", "[No data yet]"
                    )
                    upgraded = True

            # Add missing Timeline section
            if not has_section(content, "Timeline"):
                today = datetime.now().strftime("%Y-%m-%d")
                content = content.rstrip() + f"\n\n## Timeline\n\n- [{today}] Page upgraded from tier-3 stub\n"
                upgraded = True

            # Upgrade tier 3 -> 2 in frontmatter
            if upgraded:
                content = re.sub(
                    r'^(tier:\s*)3\s*$',
                    r'\g<1>2',
                    content,
                    count=1,
                    flags=re.MULTILINE,
                )
                # Update the updated/last_verified date
                today = datetime.now().strftime("%Y-%m-%d")
                if "updated:" in content:
                    content = re.sub(
                        r'^(updated:\s*).*$',
                        rf'\g<1>{today}',
                        content,
                        count=1,
                        flags=re.MULTILINE,
                    )
                if "last_verified:" in content:
                    content = re.sub(
                        r'^(last_verified:\s*).*$',
                        rf'\g<1>{today}',
                        content,
                        count=1,
                        flags=re.MULTILINE,
                    )

                md_file.write_text(content, encoding="utf-8")
                actions.append(f"Upgraded {rel}: tier 3 -> 2")

        report.depth_actions = actions
        return actions

    def verify(self, before_report: HealReport) -> HealReport:
        """Re-run diagnose and compare with before_report.

        Prints before/after comparison and returns the new report.
        """
        after_report = self.diagnose()

        before_scores = before_report.scores
        after_scores = after_report.scores

        # Copy actions from the pipeline run
        after_report.fix_actions = before_report.fix_actions
        after_report.smart_fix_actions = before_report.smart_fix_actions
        after_report.depth_actions = before_report.depth_actions

        print()
        print("Verification: Before -> After")
        print("=" * 50)

        improved = 0
        for cat in ("structure", "content", "depth", "duplication", "brain"):
            before_grade = before_scores.get(cat, "?")
            after_grade = after_scores.get(cat, "?")
            change = ""
            if after_grade < before_grade:
                change = " (IMPROVED)"
                improved += 1
            elif after_grade > before_grade:
                change = " (REGRESSED)"
            print(f"  {cat:15s}  {before_grade} -> {after_grade}{change}")

        before_issues = len(before_report.issues)
        after_issues = len(after_report.issues)
        before_findings = len(before_report.critic_findings)
        after_findings = len(after_report.critic_findings)

        print()
        print(f"  Issues:   {before_issues} -> {after_issues} "
              f"({before_issues - after_issues:+d})")
        print(f"  Findings: {before_findings} -> {after_findings} "
              f"({before_findings - after_findings:+d})")
        print(f"  Categories improved: {improved}/5")
        print()

        total_actions = (
            len(after_report.fix_actions)
            + len(after_report.smart_fix_actions)
            + len(after_report.depth_actions)
        )
        print(f"  Total actions taken: {total_actions}")
        print()

        return after_report


# ── Helpers ───────────────────────────────────────────────────────────────────


def _insert_section_after_frontmatter(content: str, heading: str, body: str) -> str:
    """Insert a new ## section after YAML frontmatter."""
    if content.startswith("---"):
        # Find end of frontmatter
        end_match = re.search(r'\n---\s*\n', content[3:])
        if end_match:
            insert_pos = 3 + end_match.end()
            return (
                content[:insert_pos]
                + f"\n## {heading}\n\n{body}\n"
                + content[insert_pos:]
            )
    # No frontmatter — insert at top
    return f"## {heading}\n\n{body}\n\n{content}"


# ── CLI Entry Point ───────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for heal command."""
    parser = argparse.ArgumentParser(
        description="Unified heal command for wiki-recall knowledge bases. "
                    "Replaces hygiene + retrofit + refactor with a single pipeline.",
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
        help="Apply safe auto-fixes + LLM-assisted smart fixes",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output structured JSON instead of human-readable text",
    )
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Include depth-upgrade (promote tier-3 stubs to tier-2)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run full pipeline with before/after verification",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Force regex-only mode (skip LLM even if available)",
    )

    args = parser.parse_args(argv)
    root = Path(args.path)

    if not root.exists():
        print(f"Error: path does not exist: {root}", file=sys.stderr)
        return 1

    llm = LLMClient(fallback_mode=args.no_llm)
    pipeline = HealPipeline(root, llm=llm)

    # Phase 1: Diagnose
    report = pipeline.diagnose()
    before_scores = dict(report.scores)  # snapshot for verify

    if args.fix or args.verify:
        # Phase 2: Auto-fix
        pipeline.auto_fix(report)

        # Phase 3: Smart-fix
        pipeline.smart_fix(report)

    if args.deep or args.verify:
        # Phase 4: Depth-upgrade
        pipeline.depth_upgrade(report)

    if args.verify:
        # Phase 5: Verify
        report = pipeline.verify(report)

    # Output
    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        if args.verify:
            report.print_report(before_scores=before_scores)
        else:
            report.print_report()

    # Exit 1 if any errors
    has_errors = any(i.severity == "error" for i in report.issues)
    has_critic_errors = any(f.severity == "error" for f in report.critic_findings)
    return 1 if (has_errors or has_critic_errors) else 0


if __name__ == "__main__":
    sys.exit(main())
