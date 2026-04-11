"""
retrofit.py -- Interactive upgrade for pre-wiki-recall brains.

Guided 6-phase upgrade that modernizes an existing knowledge base:
  Phase 1: Structure cleanup (automated, from hygiene --fix)
  Phase 2: Brain.md cleanup (trim to L0+L1 under 40 lines, no LLM)
  Phase 3: Wire RESOLVER (inline routing rules into copilot-instructions.md)
  Phase 4: Add compiled truth + timeline sections to pages missing them
  Phase 5: Clean decisions.md (remove harvest noise)
  Phase 6: Run hygiene check + report before/after stats

Interface:
    python engine/retrofit.py                  # retrofit ~/.grain
    python engine/retrofit.py /path/to/wiki    # retrofit specific path

Safety: ALWAYS backs up first. Interactive confirmation. Archive, don't delete.
"""

from __future__ import annotations

import logging
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
    apply_fixes,
    has_frontmatter,
    has_section,
    section_has_content,
    update_brain_timestamp,
    DEFAULT_ROOT,
)
from engine.llm_client import LLMClient

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

BRAIN_MAX_LINES = 40
HARVEST_TAG = "[harvest]"
MIN_DECISION_LENGTH = 200

# RESOLVER routing rules for inlining
RESOLVER_ROUTING_RULES = """
## Knowledge Filing (RESOLVER)

When new knowledge arrives, route it:
1. About a **PERSON** -> wiki/people/<name>.md
2. About a **PROJECT** -> wiki/projects/<name>.md
3. About a **BUG/FIX** -> wiki/patterns/<name>.md
4. A **TECH CONCEPT** -> wiki/concepts/<name>.md
5. A **DECISION** -> see Decision Write-Back tiers below
6. A **COMMITMENT** -> actions.md
7. A **VISION/STRATEGY** -> tag as type: strategy in frontmatter
8. None of the above -> harvest-suggestions.md
"""

DECISION_WRITEBACK_SECTION = """
## Decision Write-Back (Tiered)

When a decision is detected in conversation, classify and route by tier:

### Tier 1 -- Behavioral Rules (always loaded)
Trigger words: "always", "never", "prefer", "default to", "every session"
Action: Write the rule DIRECTLY into this file under Work Style or Hard Gates + log to decisions.md

### Tier 2 -- Architectural Decisions (loaded via brain.md)
Trigger words: "decided to", "going with", "settled on", "architecture"
Action: Append to decisions.md + update brain.md L1 top 5

### Tier 3 -- Historical Decisions (on-demand reference)
Trigger words: same as Tier 2 but project-specific or lower impact
Action: Append to decisions.md only

Format for all tiers: `- [YYYY-MM-DD] [tier:N] description`
"""


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
    backup_dir = root.parent / f".grain-retrofit-backup-{timestamp}"
    print(f"  Creating backup at: {backup_dir}")

    for item_name in ("brain.md", "decisions.md", "actions.md", "wiki", "domains",
                       "copilot-instructions.md"):
        src = root / item_name
        if src.exists():
            if src.is_file():
                backup_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src), str(backup_dir / item_name))
            else:
                shutil.copytree(str(src), str(backup_dir / item_name))

    return backup_dir


def count_pages(root: Path) -> int:
    """Count wiki pages for stats."""
    wiki_dir = root / "wiki"
    if not wiki_dir.exists():
        return 0
    count = 0
    for md in wiki_dir.rglob("*.md"):
        if md.name not in ("index.md", "log.md") and not md.parent.name.startswith("."):
            count += 1
    return count


# ── Phase 1: Structure Cleanup ────────────────────────────────────────────────

def phase_1_structure_cleanup(root: Path) -> dict:
    """Phase 1: Automated structure cleanup using hygiene --fix."""
    print("\n-- Phase 1: Structure Cleanup (automated) --")
    stats = {"fixes_applied": 0}

    issues = check_structure(root)
    fixable = [i for i in issues if i.fixable]

    if not fixable:
        print("  [OK] Structure is clean -- nothing to fix")
        return stats

    fixed = apply_fixes(root, issues)
    stats["fixes_applied"] = fixed
    print(f"  [OK] {fixed} structural fixes applied")
    return stats


# ── Phase 2: Brain.md Cleanup ─────────────────────────────────────────────────

def extract_code_blocks(content: str) -> tuple[str, list[str]]:
    """Extract fenced code blocks from brain.md content.

    Returns (cleaned_content, list_of_code_blocks).
    """
    blocks: list[str] = []
    pattern = re.compile(r'^```[^\n]*\n.*?^```', re.MULTILINE | re.DOTALL)

    def replacer(match: re.Match) -> str:
        blocks.append(match.group(0))
        return ""

    cleaned = pattern.sub(replacer, content)
    return cleaned, blocks


def extract_inline_decisions(content: str) -> tuple[str, list[str]]:
    """Extract lines that look like inlined decisions from brain.md.

    Matches dated and undated decision lines using broad keyword coverage:
    - Dated: ``- [2025-01-01] decided / settled / chose / went with ...``
    - Prefixed: ``- Decision: ...`` or ``- DECISION: ...``
    - Keyword: ``decided to``, ``settled on``, ``going with``, ``chose``,
      ``went with``, ``switched to``, ``adopted``, ``moved to``,
      ``using X instead``, ``prefer X over``, ``always use``, ``never use``,
      ``default to``

    Returns (cleaned_content, list_of_decision_lines).
    """
    decisions: list[str] = []

    # Broad set of decision-signal keywords
    _DECISION_VERBS = (
        r'(?:decided|settled\s+on|going\s+with|chose|went\s+with|switched\s+to|'
        r'adopted|moved\s+to|using\s+\S+\s+instead|prefer\s+\S+\s+over|'
        r'always\s+use|never\s+use|default\s+to|standardized?\s+on|'
        r'committed\s+to|locked\s+in|picked|selected|opting\s+for|'
        r'ruled\s+out|dropped|deprecated|replaced\s+\S+\s+with)'
    )

    decision_patterns = [
        # Dated: - [2025-01-01] ... <verb>
        re.compile(
            rf'^\s*[-*]\s*\[?\d{{4}}-\d{{2}}-\d{{2}}\]?\s+.*{_DECISION_VERBS}',
            re.IGNORECASE,
        ),
        # Prefixed: - Decision: ...
        re.compile(r'^\s*[-*]\s*(?:Decision|DECISION):\s+', re.IGNORECASE),
        # Undated keyword: - decided to ... / - went with ...
        re.compile(
            rf'^\s*[-*]\s+{_DECISION_VERBS}',
            re.IGNORECASE,
        ),
        # Tier-tagged: - [tier:N] ...
        re.compile(r'^\s*[-*]\s*\[tier:\d\]', re.IGNORECASE),
    ]

    lines = content.split("\n")
    cleaned_lines: list[str] = []

    for line in lines:
        is_decision = any(p.match(line) for p in decision_patterns)
        if is_decision:
            decisions.append(line.strip().lstrip("-* "))
        else:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines), decisions


def trim_project_descriptions(content: str) -> str:
    """Trim multi-line project descriptions to one line each.

    In L1 sections, a *project header* is any top-level list item whose text
    starts with ``**Name**``.  All continuation lines (indented text, indented
    sub-bullets, or plain non-header text) that follow a project header are
    dropped so each project occupies exactly one line.
    """
    lines = content.split("\n")
    result: list[str] = []
    in_l1 = False
    eating_continuation = False

    for line in lines:
        stripped = line.strip()

        # Detect L1 section start
        if re.match(r'^##\s+L1\b', line, re.IGNORECASE):
            in_l1 = True
            eating_continuation = False
            result.append(line)
            continue

        # Any other ## heading ends L1
        if re.match(r'^##\s', line) and in_l1:
            in_l1 = False
            eating_continuation = False

        if in_l1:
            is_indented = line.startswith(("  ", "\t"))

            # Top-level (non-indented) project header: ``- **Name** ...``
            if not is_indented and re.match(r'^[-*]\s+\*\*', stripped):
                eating_continuation = True
                result.append(line)
                continue

            # Top-level (non-indented) list item that is NOT a project header
            if not is_indented and re.match(r'^[-*]\s+', stripped):
                eating_continuation = False
                result.append(line)
                continue

            # While eating continuation, drop indented / plain continuation lines
            if eating_continuation and stripped:
                continue

            # Blank line after a project entry — stop eating but keep the blank
            if eating_continuation and not stripped:
                eating_continuation = False

        result.append(line)

    return "\n".join(result)


def remove_blank_line_runs(content: str) -> str:
    """Collapse runs of 3+ blank lines to 2."""
    return re.sub(r'\n{4,}', '\n\n\n', content)


# ── Tool Routing Headings (to extract from brain.md → domains/) ───────────
_TOOL_ROUTING_HEADINGS = re.compile(
    r'^##\s+(?:Tool(?:s|ing)?|Routing|Domain(?:s)?|MCP|Server(?:s)?|Extension(?:s)?|'
    r'IDE|Editor|Plugin(?:s)?|Command(?:s)?|CLI)\b',
    re.IGNORECASE,
)


def extract_tool_routing(content: str, domains_dir: Path) -> tuple[str, int]:
    """Extract tool/domain routing sections from brain.md into domains/ files.

    Looks for ``## Tools``, ``## Routing``, ``## Domains``, ``## MCP``, etc.
    Each matched section (heading → next ``##`` heading or EOF) is written to
    ``domains/<heading-slug>.md`` and removed from the source content.

    Returns (cleaned_content, sections_extracted).
    """
    lines = content.split("\n")
    result: list[str] = []
    extracted_sections: list[tuple[str, list[str]]] = []  # (heading_text, lines)
    current_section: list[str] | None = None
    current_heading: str | None = None

    for line in lines:
        # Check if this line starts a tool-routing section
        if _TOOL_ROUTING_HEADINGS.match(line):
            # Flush any in-progress section first
            if current_section is not None:
                extracted_sections.append((current_heading, current_section))
            # Start capturing the new tool-routing section
            current_heading = line
            current_section = [line]
            continue

        if current_section is not None:
            # Another ## heading (non-tool) ends the captured section
            if re.match(r'^##\s', line):
                extracted_sections.append((current_heading, current_section))
                current_section = None
                current_heading = None
                result.append(line)
            else:
                current_section.append(line)
            continue

        result.append(line)

    # Flush any trailing section
    if current_section is not None:
        extracted_sections.append((current_heading, current_section))

    if not extracted_sections:
        return content, 0

    domains_dir.mkdir(parents=True, exist_ok=True)
    for heading, section_lines in extracted_sections:
        # Derive a filename from the heading: ## Tools Setup -> tools-setup.md
        slug = re.sub(r'^##\s+', '', heading).strip()
        slug = re.sub(r'[^a-zA-Z0-9]+', '-', slug).strip('-').lower()
        if not slug:
            slug = "routing"
        out_path = domains_dir / f"{slug}.md"

        section_text = "\n".join(section_lines).strip() + "\n"
        # Append if file already exists
        if out_path.exists():
            existing = out_path.read_text(encoding="utf-8", errors="replace")
            section_text = existing.rstrip() + "\n\n" + section_text
        out_path.write_text(section_text, encoding="utf-8")

    return "\n".join(result), len(extracted_sections)


def phase_2_brain_cleanup(root: Path, llm: LLMClient | None = None) -> dict:
    """Phase 2: Trim brain.md to L0+L1 under 40 lines. Uses LLM when available for smarter summaries."""
    print("\n-- Phase 2: Brain.md Cleanup --")
    brain_path = root / "brain.md"
    stats = {
        "original_lines": 0,
        "final_lines": 0,
        "code_blocks_extracted": 0,
        "decisions_extracted": 0,
        "tool_routing_extracted": 0,
        "llm_summaries": 0,
    }

    if not brain_path.exists():
        print("  No brain.md found -- skipping")
        return stats

    content = brain_path.read_text(encoding="utf-8", errors="replace")
    original_lines = len(content.strip().split("\n"))
    stats["original_lines"] = original_lines

    if original_lines <= BRAIN_MAX_LINES:
        print(f"  brain.md is {original_lines} lines (under {BRAIN_MAX_LINES}) -- no trimming needed")
        stats["final_lines"] = original_lines
        return stats

    print(f"  brain.md has {original_lines} lines (target: {BRAIN_MAX_LINES})")

    # Step 1: Extract code blocks -> reference/extracted-from-brain.md
    content, code_blocks = extract_code_blocks(content)
    stats["code_blocks_extracted"] = len(code_blocks)
    if code_blocks:
        ref_dir = root / "reference"
        ref_dir.mkdir(parents=True, exist_ok=True)
        extract_path = ref_dir / "extracted-from-brain.md"
        extract_content = "# Code Blocks Extracted from brain.md\n\n"
        extract_content += f"Extracted on {datetime.now().strftime('%Y-%m-%d')}\n\n"
        for i, block in enumerate(code_blocks, 1):
            extract_content += f"## Block {i}\n\n{block}\n\n"
        extract_path.write_text(extract_content, encoding="utf-8")
        print(f"  Extracted {len(code_blocks)} code block(s) to reference/extracted-from-brain.md")

    # Step 2: Extract inlined decisions -> decisions.md
    content, decisions = extract_inline_decisions(content)
    stats["decisions_extracted"] = len(decisions)
    if decisions:
        decisions_path = root / "decisions.md"
        today = datetime.now().strftime("%Y-%m-%d")
        existing = ""
        if decisions_path.exists():
            existing = decisions_path.read_text(encoding="utf-8", errors="replace")
        new_entries = "\n".join(f"- [{today}] [tier:2] {d}" for d in decisions)
        with open(decisions_path, "a", encoding="utf-8") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            f.write(f"\n## Extracted from brain.md ({today})\n\n{new_entries}\n")
        print(f"  Extracted {len(decisions)} decision(s) to decisions.md")

    # Step 3: Extract tool/domain routing sections -> domains/
    domains_dir = root / "domains"
    content, routing_count = extract_tool_routing(content, domains_dir)
    stats["tool_routing_extracted"] = routing_count
    if routing_count:
        print(f"  Extracted {routing_count} tool-routing section(s) to domains/")

    # Step 4: Trim project descriptions to one line
    # When LLM available, use summarize for multi-line project descriptions
    if llm and llm.available:
        content, summary_count = _llm_trim_project_descriptions(content, llm)
        stats["llm_summaries"] = summary_count
        if summary_count:
            print(f"  LLM-summarized {summary_count} project description(s)")
    else:
        content = trim_project_descriptions(content)

    # Step 5: Collapse blank line runs
    content = remove_blank_line_runs(content)

    final_lines = len(content.strip().split("\n"))
    stats["final_lines"] = final_lines

    if not prompt_yn(f"  Trim brain.md from {original_lines} to ~{final_lines} lines?", default=True):
        print("  -> Skipped")
        return stats

    brain_path.write_text(content, encoding="utf-8")
    update_brain_timestamp(root)
    print(f"  [OK] brain.md trimmed: {original_lines} -> {final_lines} lines")
    return stats


def _llm_trim_project_descriptions(content: str, llm: LLMClient) -> tuple[str, int]:
    """Use LLM to summarize multi-line project descriptions to 1 line each.

    Returns (modified_content, count_of_summaries).
    """
    lines = content.split("\n")
    result: list[str] = []
    in_l1 = False
    summary_count = 0
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if re.match(r'^##\s+L1\b', line, re.IGNORECASE):
            in_l1 = True
            result.append(line)
            i += 1
            continue
        if re.match(r'^##\s', line) and in_l1:
            in_l1 = False

        # Detect multi-line project entries in L1
        if in_l1 and re.match(r'^\s*[-*]\s+\*\*', stripped):
            # Collect continuation lines
            desc_lines = [line]
            j = i + 1
            while j < len(lines):
                next_stripped = lines[j].strip()
                if not next_stripped:
                    break
                if next_stripped.startswith(("-", "*", "#")):
                    break
                desc_lines.append(lines[j])
                j += 1
            if len(desc_lines) > 1:
                full_desc = " ".join(ln.strip() for ln in desc_lines)
                summary = llm.summarize(full_desc, max_words=15)
                if summary:
                    # Extract the bold project name from first line
                    name_match = re.match(r'^(\s*[-*]\s+\*\*[^*]+\*\*)', desc_lines[0])
                    if name_match:
                        result.append(f"{name_match.group(1)} -- {summary}")
                    else:
                        result.append(f"{desc_lines[0].rstrip()} -- {summary}")
                    summary_count += 1
                    i = j
                    continue
            result.append(line)
            i += 1
            continue

        result.append(line)
        i += 1

    return "\n".join(result), summary_count


# ── Phase 3: Wire RESOLVER ────────────────────────────────────────────────────

def wire_resolver_to_instructions(instructions_path: Path) -> bool:
    """Add RESOLVER routing rules and decision write-back to copilot-instructions.md.

    Returns True if changes were made.
    """
    content = ""
    if instructions_path.exists():
        content = instructions_path.read_text(encoding="utf-8", errors="replace")

    changed = False

    if "Knowledge Filing (RESOLVER)" not in content:
        content = content.rstrip() + "\n" + RESOLVER_ROUTING_RULES
        changed = True

    if "Decision Write-Back (Tiered)" not in content:
        content = content.rstrip() + "\n" + DECISION_WRITEBACK_SECTION
        changed = True

    if changed:
        instructions_path.parent.mkdir(parents=True, exist_ok=True)
        instructions_path.write_text(content, encoding="utf-8")

    return changed


def phase_3_wire_resolver(root: Path) -> dict:
    """Phase 3: Wire RESOLVER routing rules into copilot-instructions.md."""
    print("\n-- Phase 3: Wire RESOLVER --")
    stats = {"wired": False, "locations": []}

    # Wire to ~/.github/copilot-instructions.md (live location)
    home = Path.home()
    github_instructions = home / ".github" / "copilot-instructions.md"
    grain_instructions = root / "copilot-instructions.md"

    if not prompt_yn("  Inline RESOLVER routing rules into copilot-instructions.md?", default=True):
        print("  -> Skipped")
        return stats

    # Wire the live location
    if wire_resolver_to_instructions(github_instructions):
        stats["wired"] = True
        stats["locations"].append(str(github_instructions))
        print(f"  [OK] Wired RESOLVER to {github_instructions}")

    # Also update backup copy in ~/.grain/
    if grain_instructions.exists():
        if wire_resolver_to_instructions(grain_instructions):
            stats["locations"].append(str(grain_instructions))
            print(f"  [OK] Wired RESOLVER to {grain_instructions} (backup)")

    if not stats["wired"]:
        print("  [OK] RESOLVER already wired -- no changes needed")

    return stats


# ── Phase 4: Compiled Truth + Timeline ────────────────────────────────────────

def add_compiled_truth_and_timeline(file_path: Path) -> bool:
    """Add ## Compiled Truth and ## Timeline sections to a page if missing.

    Returns True if changes were made.
    """
    content = file_path.read_text(encoding="utf-8", errors="replace")
    changed = False
    lines = content.split("\n")

    # Find where to insert (after frontmatter if present, else after first heading)
    insert_pos = 0
    if content.startswith("---"):
        # Find end of frontmatter
        for i, line in enumerate(lines[1:], 1):
            if line.strip() == "---":
                insert_pos = i + 1
                break

    if not has_section(content, "Compiled Truth"):
        # Get existing body content to put under Compiled Truth
        body_start = insert_pos
        body_lines = []
        for i in range(body_start, len(lines)):
            if lines[i].strip().startswith("## "):
                break
            if lines[i].strip():
                body_lines.append(lines[i])

        ct_section = "\n## Compiled Truth\n\n"
        if body_lines:
            ct_section += "\n".join(body_lines) + "\n"
        else:
            ct_section += "[No data yet]\n"

        # Insert after frontmatter
        lines.insert(insert_pos, ct_section)
        changed = True

    if not has_section("\n".join(lines), "Timeline"):
        lines.append("\n## Timeline\n\n[No data yet]\n")
        changed = True

    if changed:
        file_path.write_text("\n".join(lines), encoding="utf-8")

    return changed


def phase_4_compiled_truth_timeline(root: Path, llm: LLMClient | None = None) -> dict:
    """Phase 4: Add compiled truth + timeline sections to pages missing them.

    When LLM available, generates an initial compiled truth summary from page content.
    """
    print("\n-- Phase 4: Add Compiled Truth + Timeline --")
    stats = {"pages_updated": 0, "pages_checked": 0, "llm_summaries": 0}

    wiki_dir = root / "wiki"
    if not wiki_dir.exists():
        print("  No wiki/ directory -- skipping")
        return stats

    pages_needing_update: list[Path] = []
    for md_file in wiki_dir.rglob("*.md"):
        if md_file.name in ("index.md", "log.md"):
            continue
        if md_file.parent.name.startswith("."):
            continue
        stats["pages_checked"] += 1

        content = md_file.read_text(encoding="utf-8", errors="replace")
        if not has_section(content, "Compiled Truth") or not has_section(content, "Timeline"):
            pages_needing_update.append(md_file)

    if not pages_needing_update:
        print(f"  [OK] All {stats['pages_checked']} pages have Compiled Truth + Timeline")
        return stats

    print(f"  Found {len(pages_needing_update)} page(s) missing sections:")
    for p in pages_needing_update[:10]:
        rel = p.relative_to(root)
        print(f"    - {rel}")
    if len(pages_needing_update) > 10:
        print(f"    ... and {len(pages_needing_update) - 10} more")

    if not prompt_yn(f"  Add Compiled Truth + Timeline to {len(pages_needing_update)} page(s)?", default=True):
        print("  -> Skipped")
        return stats

    for p in pages_needing_update:
        try:
            if add_compiled_truth_and_timeline(p):
                stats["pages_updated"] += 1

                # If LLM available, generate a summary for the compiled truth
                if llm and llm.available:
                    page_content = p.read_text(encoding="utf-8", errors="replace")
                    summary = llm.summarize(page_content, max_words=50)
                    if summary and summary != "[No data yet]":
                        # Replace [No data yet] in Compiled Truth with LLM summary
                        updated = page_content.replace(
                            "## Compiled Truth\n\n[No data yet]",
                            f"## Compiled Truth\n\n{summary}",
                            1,
                        )
                        if updated != page_content:
                            p.write_text(updated, encoding="utf-8")
                            stats["llm_summaries"] += 1
        except Exception as e:
            print(f"  Failed on {p.name}: {e}")

    print(f"  [OK] Updated {stats['pages_updated']} page(s)")
    if stats["llm_summaries"]:
        print(f"  LLM-generated {stats['llm_summaries']} compiled truth summary(ies)")
    return stats


# ── Phase 5: Clean decisions.md ───────────────────────────────────────────────

def is_harvest_noise(line: str) -> bool:
    """Check if a decisions.md entry is harvest noise.

    Noise = has [harvest] tag OR is a short entry (<200 chars).
    """
    stripped = line.strip()
    if not stripped.startswith("-"):
        return False

    entry = stripped.lstrip("- ")

    if HARVEST_TAG.lower() in entry.lower():
        return True

    if len(entry) < MIN_DECISION_LENGTH:
        # Only flag very short entries that look auto-generated
        # Don't remove legitimate short decisions
        if re.match(r'^\[\d{4}-\d{2}-\d{2}\]\s+\S+\s*$', entry):
            return True

    return False


def phase_5_clean_decisions(root: Path, llm: LLMClient | None = None) -> dict:
    """Phase 5: Clean decisions.md by removing harvest noise.

    When LLM available, uses verify() to separate real decisions from noise
    instead of regex-only heuristics.
    """
    print("\n-- Phase 5: Clean decisions.md --")
    stats = {"noise_entries": 0, "total_entries": 0, "archived": 0, "llm_verified": False}

    decisions_path = root / "decisions.md"
    if not decisions_path.exists():
        print("  No decisions.md found -- skipping")
        return stats

    content = decisions_path.read_text(encoding="utf-8", errors="replace")
    lines = content.split("\n")

    # Collect all decision entries
    entry_lines: list[str] = []
    non_entry_lines: list[str] = []
    for line in lines:
        if line.strip().startswith("-"):
            entry_lines.append(line)
            stats["total_entries"] += 1
        else:
            non_entry_lines.append(line)

    # When LLM available, use verify() for better noise detection
    if llm and llm.available and entry_lines:
        candidates = [{"text": ln.strip().lstrip("- ")} for ln in entry_lines]
        verified = llm.verify(candidates, "decisions")
        verified_texts = {v["text"] for v in verified}
        noise_lines = [ln for ln in entry_lines if ln.strip().lstrip("- ") not in verified_texts]
        clean_entry_lines = [ln for ln in entry_lines if ln.strip().lstrip("- ") in verified_texts]
        stats["llm_verified"] = True
        print("  (using LLM verification)")
    else:
        # Regex-only fallback
        noise_lines = [ln for ln in entry_lines if is_harvest_noise(ln)]
        clean_entry_lines = [ln for ln in entry_lines if not is_harvest_noise(ln)]

    stats["noise_entries"] = len(noise_lines)

    # Reconstruct clean_lines preserving headings and structure
    clean_lines = []
    entry_idx = 0
    for line in lines:
        if line.strip().startswith("-"):
            if line not in noise_lines:
                clean_lines.append(line)
        else:
            clean_lines.append(line)

    if not noise_lines:
        print(f"  [OK] decisions.md is clean ({stats['total_entries']} entries, no noise)")
        return stats

    print(f"  Found {len(noise_lines)} noise entries out of {stats['total_entries']} total:")
    for line in noise_lines[:5]:
        print(f"    {line.strip()[:80]}...")
    if len(noise_lines) > 5:
        print(f"    ... and {len(noise_lines) - 5} more")

    if not prompt_yn(f"  Archive {len(noise_lines)} noise entries?", default=True):
        print("  -> Skipped")
        return stats

    # Archive noise to .archive/decisions-noise.md
    archive_dir = root / ".archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / "decisions-noise.md"
    today = datetime.now().strftime("%Y-%m-%d")
    with open(archive_path, "a", encoding="utf-8") as f:
        f.write(f"\n## Archived on {today}\n\n")
        for line in noise_lines:
            f.write(line + "\n")

    decisions_path.write_text("\n".join(clean_lines), encoding="utf-8")
    stats["archived"] = len(noise_lines)
    print(f"  [OK] Archived {len(noise_lines)} noise entries to .archive/decisions-noise.md")
    return stats


# ── Phase 6: Hygiene Check + Stats ────────────────────────────────────────────

def phase_6_hygiene_report(root: Path) -> dict:
    """Phase 6: Run hygiene check and report before/after stats."""
    print("\n-- Phase 6: Final Hygiene Check --")
    stats = {"grades": {}}

    report = HygieneReport(root)
    report.run()
    report.print_report()

    stats["grades"] = dict(report.scores)
    return stats


# ── Main Orchestrator ──────────────────────────────────────────────────────────

def retrofit(root: Path) -> None:
    """Run the full 6-phase retrofit workflow."""
    print()
    print("Wiki-Recall Brain Retrofit")
    print("=" * 40)
    print(f"Target: {root}")
    print()

    if not root.exists():
        print(f"Error: path does not exist: {root}")
        sys.exit(1)

    # Initialize shared LLM client
    llm = LLMClient()
    if llm.available:
        print(f"  LLM backend: {llm.backend}")
    else:
        print("  LLM: not available (regex-only mode)")

    # Collect before stats
    before_pages = count_pages(root)
    brain_path = root / "brain.md"
    before_brain_lines = 0
    if brain_path.exists():
        before_brain_lines = len(brain_path.read_text(encoding="utf-8", errors="replace").strip().split("\n"))

    before_report = HygieneReport(root)
    before_report.run()
    before_grades = dict(before_report.scores)

    # Always backup first
    print("-- Pre-flight: Backup --")
    backup_dir = ensure_backup(root)
    print(f"  [OK] Backup saved to: {backup_dir}")

    # Run phases
    all_stats: dict = {}
    all_stats["phase_1"] = phase_1_structure_cleanup(root)
    all_stats["phase_2"] = phase_2_brain_cleanup(root, llm=llm)
    all_stats["phase_3"] = phase_3_wire_resolver(root)
    all_stats["phase_4"] = phase_4_compiled_truth_timeline(root, llm=llm)
    all_stats["phase_5"] = phase_5_clean_decisions(root, llm=llm)
    all_stats["phase_6"] = phase_6_hygiene_report(root)

    # After stats
    after_pages = count_pages(root)
    after_brain_lines = 0
    if brain_path.exists():
        after_brain_lines = len(brain_path.read_text(encoding="utf-8", errors="replace").strip().split("\n"))

    # Summary
    print()
    print("=" * 40)
    print("  Retrofit Summary")
    print("=" * 40)
    print()
    print(f"  Brain.md: {before_brain_lines} -> {after_brain_lines} lines")
    print(f"  Wiki pages: {before_pages} -> {after_pages}")
    print(f"  Grades before: {before_grades}")
    if "grades" in all_stats.get("phase_6", {}):
        print(f"  Grades after:  {all_stats['phase_6']['grades']}")
    print(f"  Backup at: {backup_dir}")
    print()


def main() -> None:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Interactive brain retrofit for pre-wiki-recall knowledge bases",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_ROOT),
        help="Path to knowledge base root (default: ~/.grain)",
    )
    args = parser.parse_args()
    root = Path(args.path)
    retrofit(root)


if __name__ == "__main__":
    main()
