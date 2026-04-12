# wiki-recall Retrofit Protocol

You are upgrading a pre-wiki-recall brain (`~/.grain/`) to the wiki-recall format.
This brain was created manually or by an older system. Follow these steps IN ORDER.

## Prerequisites

Before starting, verify:
- `~/.grain/` directory exists with at least `brain.md`. If not: "Use interview protocol instead."
- Python is available: `python --version`. If not: skip Step 8 (hygiene check) -- do manual review instead.
- Writable: try creating a test file in `~/.grain/`. If permission denied, stop.

If Python is unavailable, the retrofit still works -- just skip automated hygiene and review files manually.

## Step 1: Backup

- Run: `powershell -File ~/.grain/backup.ps1 onedrive`
- If no backup script exists, copy `~/.grain/` to a safe location manually
- Report: "Brain backed up."

## Step 2: Assess Current State

- List all files and directories in `~/.grain/`
- Categorize what exists:
  - Does brain.md exist? How many lines?
  - Does wiki/ directory exist? How many pages?
  - Does domains/ directory exist? How many domains?
  - Are there decisions.md, actions.md, persona.md?
  - Are there loose scripts, logs, or artifacts at root?
- Report a summary table of what was found

## Step 3: Create Missing Structure

- Ensure these directories exist:
  - `wiki/`, `wiki/projects/`, `wiki/patterns/`, `wiki/concepts/`, `wiki/people/`
  - `domains/`, `templates/`, `reference/`, `protocols/`
- Create missing core files from templates:
  - `decisions.md` — with header and tier explanation
  - `actions.md` — with `## Pending` section
  - `persona.md` — minimal template (user fills during interview)
  - `wiki/index.md` — empty index to be populated
- Report: "Created N missing directories and M missing files"

## Step 4: Trim brain.md

- Read brain.md in full
- Extract content that should live elsewhere:

### 4a. Extract decisions
- Find lines that look like decisions ("decided to", "we chose", "always use", "never do")
- Move them to `decisions.md` with date prefix `[YYYY-MM-DD]`
- In brain.md, replace with a one-liner reference if needed

### 4b. Extract project details
- Find project descriptions longer than 2 lines
- For each project, create or update `wiki/projects/{slug}.md`:
  - Use `templates/project-template.md` format if available
  - Add Compiled Truth section with the extracted content
  - Add Timeline entry: `[YYYY-MM-DD] Migrated from brain.md during retrofit`
  - Set `tier: 2`
- In brain.md, keep only a one-liner per project

### 4c. Extract tool/domain routing
- Find blocks that describe tools, domains, or routing rules
- Move to `domains/{name}.md` files
- In brain.md, keep only routing references

### 4d. Clean up formatting
- Remove blank line runs (max 1 blank line between sections)
- Remove code blocks that don't belong in brain.md
- Ensure brain.md is under 40 lines / 550 tokens

Report: "Brain trimmed from N to M lines. Extracted P projects, D decisions, R routing rules."

## Step 5: Add Compiled Truth + Timeline Format

For every wiki page and domain page that doesn't already use the format:

- Add `## Compiled Truth` section (if missing) — synthesize existing content
- Add `---` separator
- Add `## Timeline` section (if missing) — move chronological entries here
- Add frontmatter if missing: `tier:`, `last_verified:`, `source:`
- Add source attribution: `observed: retrofit session`

Report: "Added compiled truth format to N pages"

## Step 6: Wire RESOLVER

- Check if `templates/RESOLVER.md` exists in the wiki-recall installation
- If yes, ensure `copilot-instructions.md` references the RESOLVER routing rules
- If no copilot-instructions.md exists:
  - Create from `templates/copilot-instructions.md`
  - Replace `{{BRAIN_ROOT}}` with `~/.grain`
  - Inline the RESOLVER routing rules
- Wire to `~/.github/copilot-instructions.md` (symlink or copy)

Report: "RESOLVER wired to copilot-instructions.md"

## Step 7: Clean decisions.md

- Read decisions.md
- Remove obvious noise:
  - Code snippets (lines with `{`, `}`, `=>`, `import`)
  - Template text (lines containing `{{`, `template`, `placeholder`)
  - Generic statements that aren't actual decisions
  - Duplicate entries (keep the first occurrence)
- Ensure remaining decisions have date prefixes
- Report: "Cleaned decisions.md: removed N noise entries, kept M real decisions"

## Step 8: Run Hygiene Check

- Run: `python ~/.grain/engine/hygiene.py`
- Show the full report
- If any auto-fixable issues remain: `python ~/.grain/engine/hygiene.py --fix`
- Report: "Retrofit complete. Hygiene grades: structure=X, content=Y, depth=Z, duplication=W, brain=V"

## Step 9: Summary

- Show a before/after comparison:
  - Files at root: before → after
  - Brain.md lines: before → after
  - Wiki pages: before → after
  - Domain pages: before → after
  - Hygiene grades: before → after
- Report: "Retrofit complete. Your brain is now wiki-recall compatible."
- Suggest: "Run 'heal my brain' periodically to maintain quality."

## Guidelines

- **Never delete content** — always move to the correct location or `.archive/`
- **Ask before moving** any file you're unsure about
- **Preserve user voice** — don't rewrite content, just restructure it
- **Source attribution**: `observed: retrofit session` for migrated content
- **Encoding**: ASCII only — no em-dashes, smart quotes, or checkmarks
- **One step at a time** — show progress after each step
