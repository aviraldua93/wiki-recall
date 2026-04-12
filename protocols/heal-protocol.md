# wiki-recall Heal Protocol

You are healing a user's personal knowledge base (`~/.grain/`).
Follow these steps IN ORDER. Show progress after each step. Be thorough but efficient.

## Prerequisites

Before starting, verify:
- `~/.grain/` directory exists. If not: "Run setup.ps1 first."
- `~/.grain/brain.md` exists. If not: "No brain found. Run the interview protocol first."
- Python is available: `python --version`. If not: switch to MANUAL MODE (see below).
- `~/.grain/engine/hygiene.py` exists. If not: switch to MANUAL MODE (see below).

### Manual Mode (no Python)
If Python or hygiene.py is unavailable, skip Step 2 (automated diagnosis) and instead:
- Read brain.md and count lines manually
- List files at root and count them
- Scan wiki pages for missing Compiled Truth sections
- Check frontmatter for missing dates
- Then proceed to Step 3+ using your own judgment instead of hygiene JSON output.
Report: "Running in manual mode (Python unavailable)."

## Step 1: Backup

- Run: `powershell -File ~/.grain/backup.ps1 onedrive`
- If backup script doesn't exist, copy the entire `~/.grain/` directory manually
- Report: "Brain backed up."

## Step 2: Diagnose

- Run: `python ~/.grain/engine/hygiene.py --json`
- Read the JSON output carefully
- Summarize in a table:

```
Category     | Grade | Issues
-------------|-------|-------
structure    | ?     | N
content      | ?     | N
depth        | ?     | N
duplication  | ?     | N
brain        | ?     | N
```

- If all grades are A: "Brain is healthy! Nothing to fix." and stop
- Otherwise, continue to the relevant fix steps below

## Step 3: Fix Brain Budget

**When:** brain score is B or worse, OR brain.md exceeds 40 lines / 550 tokens.

- Read `~/.grain/brain.md` in full
- Trim to under 40 lines while preserving:
  - Identity (name, GitHub identities, auth mapping) -- 5 lines max
  - Active work (current sprint/focus, 1-liner per project) -- 10 lines max
  - Routing rules (domain routing, comms routing, protocol triggers) — 10 lines max
- Move everything else to the correct location:
  - Project details → `wiki/projects/{name}.md`
  - Decisions → `decisions.md`
  - Patterns/bugs → `wiki/patterns/{name}.md`
  - Tool configs → `domains/{name}.md`
- After trimming, count lines and tokens. Report: "Brain trimmed from N to M lines (T tokens)"

## Step 4: Fix Structure Issues

**When:** structure score is B or worse.

For each structure issue from the diagnosis:

### 4a. Missing required files
- Check which core files are missing (brain.md, decisions.md, actions.md, persona.md)
- Create missing files from `templates/` if templates exist
- If no template, create a minimal version with proper frontmatter

### 4b. Root file cleanup
- List all files at `~/.grain/` root (not in subdirectories)
- For each file that doesn't belong at root:
  - Scripts → `scripts/`
  - Old backups → `.archive/`
  - Logs → `.archive/`
  - Interview artifacts → `.archive/`
- Ask before moving any file you're unsure about
- Target: 10 or fewer files at root

### 4c. Missing directories
- Ensure these directories exist: `wiki/`, `wiki/projects/`, `wiki/patterns/`, `wiki/concepts/`, `wiki/people/`, `domains/`, `templates/`, `reference/`

Report: "Fixed N structure issues"

## Step 5: Fix Content Quality

**When:** content score is B or worse.

### 5a. Fill empty Compiled Truth sections
- For each wiki page with an empty or `[No data yet]` Compiled Truth:
  - Read the page's Timeline section and any existing content
  - Read related domain pages and session history for context
  - Write a proper Compiled Truth (3-8 sentences synthesizing what is known)
  - Add source attribution: `observed: heal session` for synthesized content
  - Never fabricate — if insufficient data, write: `[Insufficient data — needs user input]`

### 5b. Fix shallow pages
- For each page scored as STUB (under 15 lines of real content):
  - Check if enough data exists in sessions, other pages, or domains to expand
  - If yes: expand sections with real content, set `tier: 2`
  - If no: leave as stub, note: `[Stub — needs enrichment from user]`
  - Report what was expanded

### 5c. Fix misplaced content
- For each page flagged as MISPLACED:
  - Read the content and determine where it should live
  - Move content to the correct wiki subdirectory
  - Update any cross-references

### 5d. Update timestamps
- For each page missing `last_verified` in frontmatter:
  - Add `last_verified: {today's date}` to the frontmatter

Report: "Fixed N content issues across M pages"

## Step 6: Enrich People Pages

**When:** wiki/people/ pages exist with thin content.

- Read `~/.grain/domains/comms.md` for name-to-identity mappings
- For each people page:
  - Read the page content
  - Check wiki/projects/ pages for collaboration mentions
  - Check domains/ for team/role context
  - Fill any empty sections: Working Relationship, Communication Preferences, Context
  - Add source attribution for each new claim
- Report: "Enriched N people pages"

## Step 7: Fix Cross-References

**When:** any diagnosis mentions broken paths or dead references.

### 7a. Validate copilot-instructions.md paths
- Read `~/.grain/copilot-instructions.md` (or `~/.github/copilot-instructions.md`)
- For each path reference (`~/.grain/...`):
  - Check if the target file/directory exists
  - If not: fix the path or remove the reference
- Report: "Fixed N broken paths in copilot-instructions.md"

### 7b. Validate wiki cross-links
- For each wiki page that references other wiki pages:
  - Check if the referenced page exists
  - If not: update or remove the link
- For `wiki/index.md`:
  - Ensure every wiki page is listed
  - Remove entries for pages that no longer exist
  - Rebuild the index if needed

Report: "Fixed N cross-reference issues"

## Step 8: Fix Duplication

**When:** duplication score is B or worse.

- For each duplicate detected in diagnosis:
  - Read both copies
  - Keep the richer/more-current version
  - Archive the other to `.archive/`
  - Update any references to point to the kept version
- For pages with >30% session ID overlap in the same domain:
  - Read both pages, identify which has richer content
  - Merge the thinner page as a section into the richer page
  - Archive the merged page
- Report: "Resolved N duplicates, merged M overlapping pages"

## Step 9: Quality Patterns

**When:** diagnosis reports quality pattern issues.

### 9a. Merge TL;DR into Compiled Truth
- For each page with both `## TL;DR` and `## Compiled Truth`:
  - Keep Compiled Truth (it IS the TL;DR)
  - Remove the TL;DR section entirely
  - Ensure Compiled Truth is 3-5 lines max

### 9b. Merge stub pages into parents
- For each page flagged as <200 bytes or <3 timeline entries:
  - Find the parent page by matching domain or topic
  - Move the stub's content as a section in the parent page
  - Archive the stub
  - Update any cross-references

### 9c. Separate prospects from real contacts
- For each people page flagged as uncontacted:
  - If the person is NOT in `domains/comms.md` Quick Resolve table:
    - Move to `wiki/people/prospects/` (create dir if needed)
  - If the person IS a real collaborator but mislabeled:
    - Add them to `domains/comms.md` and keep the page

### 9d. Enforce timeline minimum
- For each page with <3 real timeline entries:
  - Check session history for additional events
  - Add any found events as timeline entries
  - If still <3 entries: consider merging into parent page

### 9e. Add content_updated tracking
- For each page missing `content_updated` in frontmatter:
  - Add `content_updated: YYYY-MM-DD` (today's date for new content, or best guess for existing)
  - Note: `content_updated` tracks when content actually changed
  - `last_verified` tracks when the page was last reviewed (can be bulk-stamped)

Report: "Applied N quality pattern fixes"

## Step 10: Co-locate Decisions and Gates

**When:** decisions.md has entries that mention specific projects or domains.

### 10a. Scan decisions.md — per ENTRY, not per section
- Read every individual bullet entry in decisions.md (not just section headers)
- For EACH entry independently, determine scope by reading its content:
  - Does it name a specific project (e.g., "DailyStack", "rag-a2a", "grain")? -> project-specific
  - Does it reference a specific domain (e.g., "Overlake", "Cirrus", "tooling")? -> domain-specific
  - Does it reference a specific tool context (e.g., "COORDINATOR-ONLY MODE")? -> check if a reference/ file is more appropriate
  - Is it truly universal ("always test before push", "git as storage")? -> stays in decisions.md
- Do NOT classify by section header alone — entries within ## Architecture or ## Work Style can be project-specific

### 10b. Show migration plan
- Show every entry with its proposed destination:
  ```
  KEEP in decisions.md (universal): 18 entries
  MOVE to wiki/projects/dailystack.md ## Decisions: 3 entries
    - "DailyStack design: fun/colorful theme"
    - "DailyStack: SQLite for local store"
    - "DailyStack: no backend, PWA only"
  MOVE to domains/overlake.md ## Decisions: 2 entries
    - "Release via force-push on Overlake"
    ...
  ```
- Ask: "Proceed with migration? (You can edit the plan first)"

### 10c. Migrate decisions
- For each entry to move:
  - Append to the target page's ## Decisions section (create section if missing)
  - Remove from decisions.md
- Target: decisions.md has 15-20 universal entries max
- If decisions.md still has 20+ entries after migration, flag remaining candidates

### 10d. Scan reference/hard-gates.md — same per-entry classification
- For each gate entry independently:
  - Project-specific gates -> wiki/projects/X.md ## Gates
  - Domain-specific gates -> domains/X.md ## Gates
  - Universal gates stay in reference/hard-gates.md (3-5 max)

### 10e. Scan wiki/patterns/
- For each pattern page in wiki/patterns/:
  - Does it mention a specific project? -> move to wiki/projects/X.md ## Patterns
  - Does it mention a specific domain? -> move to domains/X.md ## Patterns
  - Universal? -> stays in wiki/patterns/

Report: "Migrated N decisions, M gates, P patterns to co-located pages"

## Step 11: Verify and Review

### 11a. Run hygiene again
- Run: `python ~/.grain/engine/hygiene.py --json`
- Show before/after comparison:

```
Category     | Before | After
-------------|--------|------
structure    | ?      | ?
content      | ?      | ?
depth        | ?      | ?
duplication  | ?      | ?
brain        | ?      | ?
```

### 11b. Show diff summary
- List all files that were modified, created, or moved during this heal session
- For key files (brain.md, decisions.md), show what changed:
  - Lines added/removed
  - Entries moved (from where to where)
  - Content trimmed or expanded
- Example: "12 files modified. 5 decisions moved from decisions.md to project pages. brain.md trimmed 61 to 26 lines. 3 people pages enriched."

### 11c. Confirm with user
- Ask: "These changes look correct? If not, restore from backup."
- If user says no: point them to the backup from Step 1

- Count improvements and remaining issues
- If any category is still C or worse, mention what needs user input to fix
- Report: "Heal complete. Improved N categories. M issues remain (need user input)."

## Step 12: Update Log

- Append a heal entry to `~/.grain/wiki/log.md`:
```
- [YYYY-MM-DD] heal: N issues fixed, grades improved from X to Y
```

## Guidelines

- **Never delete content** — move to Timeline or `.archive/`
- **Source attribution**: add `observed: heal session` for synthesized content
- **Ask before acting** when unsure about classification or content quality
- **One step at a time** — show progress after each step
- **Compiled Truth format**: rewritten synthesis of facts, not timeline entries
- **Timeline format**: append-only chronological entries, never edit/delete
- **Frontmatter**: preserve existing frontmatter, only add missing fields
- **Encoding**: use ASCII only in file content — no em-dashes, smart quotes, or checkmarks
