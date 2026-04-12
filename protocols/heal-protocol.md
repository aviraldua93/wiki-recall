# wiki-recall Heal Protocol

You are healing a user's personal knowledge base (`~/.grain/`).
Follow these steps IN ORDER. Show progress after each step. Be thorough but efficient.

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
  - L0: Identity (name, GitHub identities, auth mapping) — 5 lines max
  - L1: Active work (current sprint/focus, 1-liner per project) — 10 lines max
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
- Report: "Resolved N duplicates"

## Step 9: Verify

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

- Count improvements and remaining issues
- If any category is still C or worse, mention what needs user input to fix
- Report: "Heal complete. Improved N categories. M issues remain (need user input)."

## Step 10: Update Log

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
