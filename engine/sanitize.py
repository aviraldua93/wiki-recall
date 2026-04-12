"""
sanitize.py -- Public output sanitization for wiki-recall (#75).

Scans text content against internal names loaded dynamically from
the user's brain files (domains, people, auth config). Returns
matches found so the caller can block or sanitize before publishing.

Usage:
    python engine/sanitize.py "text to scan"
    python engine/sanitize.py --file path/to/content.md
    python engine/sanitize.py --json "text to scan"    # structured output

This is both a library (import scan_for_internal) and a CLI tool.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Add project root for imports
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

DEFAULT_ROOT = Path.home() / ".grain"


# ── Pattern loading ──────────────────────────────────────────────────────────

def load_internal_patterns(root: Path) -> list[str]:
    """Load internal name patterns dynamically from brain files.

    Sources:
    - domains/*.md: domain names, repo names, team names
    - wiki/people/*.md: colleague names
    - domains/comms.md: name-to-identity Quick Resolve table
    - Auth config in brain.md: EMU org prefixes, internal orgs
    """
    patterns: set[str] = set()

    # 1. People names from wiki/people/
    people_dir = root / "wiki" / "people"
    if people_dir.exists():
        for md in people_dir.glob("*.md"):
            if md.stem in ("index", "README"):
                continue
            # Page stem is the person's name slug
            name = md.stem.replace("-", " ").title()
            if len(name) > 2:
                patterns.add(name)
            # Also scan content for full names
            try:
                content = md.read_text(encoding="utf-8", errors="replace")
                # Look for "Name: Full Name" or "title: Full Name" in frontmatter
                name_match = re.search(r'(?:title|name):\s*"?([^"\n]+)"?', content, re.I)
                if name_match:
                    full_name = name_match.group(1).strip().strip('"')
                    if len(full_name) > 3 and full_name != "[No data yet]":
                        patterns.add(full_name)
            except Exception:
                pass

    # 2. Domain-specific names from domains/comms.md Quick Resolve table
    comms_path = root / "domains" / "comms.md"
    if comms_path.exists():
        try:
            content = comms_path.read_text(encoding="utf-8", errors="replace")
            # Extract names from table rows: | Name | alias | ...
            for m in re.finditer(r"\|\s*([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*\|", content):
                name = m.group(1).strip()
                if len(name) > 3:
                    patterns.add(name)
        except Exception:
            pass

    # 3. Internal org/repo names from domains/*.md
    domains_dir = root / "domains"
    if domains_dir.exists():
        for md in domains_dir.glob("*.md"):
            try:
                content = md.read_text(encoding="utf-8", errors="replace")
                # Extract repo paths: org/repo-name or full URLs
                for m in re.finditer(r"(?:github\.com|dev\.azure\.com)[/:]([a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)", content):
                    org_repo = m.group(1)
                    org = org_repo.split("/")[0]
                    if len(org) > 2:
                        patterns.add(org)
            except Exception:
                pass

    # 4. Internal URLs (corp domains loaded from config, not hardcoded)
    # Users define their corp domains in brain.md or a config file
    # Default: scan for common patterns without hardcoding specific companies
    corp_patterns = [
        "eng.ms", "aka.ms",
    ]
    # Dynamically detect corp domains from brain.md auth section
    brain_path = root / "brain.md"
    if brain_path.exists():
        try:
            brain = brain_path.read_text(encoding="utf-8", errors="replace")
            # Extract domain patterns from auth/org references
            for m in re.finditer(r"@([\w.-]+\.(?:com|org|net|io))", brain):
                domain = m.group(1)
                if len(domain) > 5:
                    corp_patterns.append(domain)
            # Extract ADO/GitHub org URLs
            for m in re.finditer(r"dev\.azure\.com/(\w+)", brain):
                corp_patterns.append(f"dev.azure.com/{m.group(1)}")
        except Exception:
            pass
    patterns.update(p for p in corp_patterns if len(p) > 3)

    # Filter out very short or generic patterns
    return sorted(p for p in patterns if len(p) > 2)


# ── Scanning ─────────────────────────────────────────────────────────────────

def scan_for_internal(
    content: str,
    root: Path | None = None,
    extra_patterns: list[str] | None = None,
) -> list[dict]:
    """Scan content for internal names loaded from brain files.

    Args:
        content: Text to scan.
        root: Brain root path (default: ~/.grain/).
        extra_patterns: Additional patterns to scan for.

    Returns:
        List of matches: [{pattern, line_number, context}]
    """
    _root = root or DEFAULT_ROOT
    patterns = load_internal_patterns(_root)
    if extra_patterns:
        patterns.extend(extra_patterns)

    if not patterns:
        return []

    matches: list[dict] = []
    lines = content.split("\n")

    for i, line in enumerate(lines, 1):
        for pattern in patterns:
            if pattern.lower() in line.lower():
                # Avoid matching within URLs that are already generic
                matches.append({
                    "pattern": pattern,
                    "line_number": i,
                    "context": line.strip()[:120],
                })

    return matches


def sanitize(content: str, matches: list[dict]) -> str:
    """Replace internal names with generic equivalents.

    Simple replacement -- for complex cases, the LLM session should
    review via the protocol.
    """
    result = content
    seen: set[str] = set()
    counter = 1

    for m in matches:
        pattern = m["pattern"]
        if pattern.lower() in seen:
            continue
        seen.add(pattern.lower())

        # Generate generic replacement
        if " " in pattern:  # Looks like a person name
            replacement = f"[Person-{counter}]"
        elif "." in pattern:  # Looks like a domain
            replacement = f"[internal-domain-{counter}]"
        elif "/" in pattern:  # Looks like an org/repo
            replacement = f"[internal-org-{counter}]"
        else:
            replacement = f"[internal-{counter}]"

        result = re.sub(re.escape(pattern), replacement, result, flags=re.IGNORECASE)
        counter += 1

    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scan text for internal names before publishing to public repos",
    )
    parser.add_argument("text", nargs="?", help="Text to scan (or use --file)")
    parser.add_argument("--file", help="File to scan")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Brain root path")
    parser.add_argument("--json", action="store_true", dest="json_output", help="JSON output")
    parser.add_argument("--fix", action="store_true", help="Show sanitized version")

    args = parser.parse_args()

    content = ""
    if args.file:
        content = Path(args.file).read_text(encoding="utf-8", errors="replace")
    elif args.text:
        content = args.text
    else:
        content = sys.stdin.read()

    if not content.strip():
        print("No content to scan.")
        return 0

    matches = scan_for_internal(content, root=Path(args.root))

    if args.json_output:
        print(json.dumps({"matches": matches, "count": len(matches)}, indent=2))
    elif matches:
        print(f"\nFound {len(matches)} internal name(s):\n")
        for m in matches:
            print(f"  Line {m['line_number']}: '{m['pattern']}' in: {m['context']}")
        if args.fix:
            sanitized = sanitize(content, matches)
            print("\n--- Sanitized version ---\n")
            print(sanitized)
        print(f"\nBLOCKED: {len(matches)} internal names found. Sanitize before publishing.")
        return 1
    else:
        print("Clean: no internal names detected.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
