# wiki-recall Dream Protocol

You are running a nightly enrichment cycle on a user's knowledge base (`~/.grain/`).
The dream cycle deepens existing knowledge without user interaction.
Follow these steps IN ORDER. This runs unattended -- no user prompts.

## Prerequisites

Before starting, verify:
- `~/.grain/` directory exists with `brain.md` and `wiki/`. If not: skip silently.
- Python is available. If not: log "Python not found, skipping dream cycle" and exit.
- `~/.grain/engine/indexer.py` and `~/.grain/engine/harvest.py` exist. If not: skip session mining steps.
- `~/.copilot/session-store.db` exists. If not: skip session mining (no sessions to process).

Dream cycle is best-effort -- missing components are skipped, not errors.

## Step 1: Backup

- Run: `powershell -File ~/.grain/backup.ps1 onedrive`
- Report: "Brain backed up."

## Step 2: Entity Sweep

Mine recent sessions for new entities.

- Run: `python ~/.grain/engine/indexer.py --stats`
- If new sessions exist since last dream:
  - Run: `python ~/.grain/engine/indexer.py`
  - Run: `python ~/.grain/engine/harvest.py --auto`
  - Report: "Harvested N new entities from M sessions"
- If no new sessions: report "No new sessions since last dream" and continue

## Step 3: Timeline Updates

For each wiki page with a Timeline section:

### 3a. Append new timeline entries
- Check harvested data for new events related to this entity
- For each new event:
  - Append to Timeline: `- [YYYY-MM-DD] description (observed: session <id>)`
  - Never edit or delete existing timeline entries

### 3b. Detect timeline gaps
- If a page's latest timeline entry is older than 30 days AND the entity appears in recent sessions:
  - Add: `- [YYYY-MM-DD] Still active in recent sessions (observed: dream cycle)`

Report: "Updated timelines on N pages"

## Step 4: Citation Fix

Ensure all factual claims have source attribution.

- For each wiki page:
  - Scan Compiled Truth for claims without attribution
  - For each uncited claim:
    - Search session history for supporting evidence
    - If found: add `(observed: session <id>)` inline
    - If not found: add `(inferred: dream cycle, confidence: low)`
  - Report: "Added N citations across M pages"

## Step 5: Consolidation

Rewrite Compiled Truth sections that have grown stale.

### 5a. Identify stale pages
- A page is stale if:
  - Timeline has 3+ entries since last Compiled Truth rewrite
  - Compiled Truth contradicts Timeline (newer info supersedes)
  - `last_verified` is older than 30 days

### 5b. Rewrite Compiled Truth
For each stale page:
- Read Timeline entries in full
- Read related domain/project/people pages for context
- Rewrite Compiled Truth as a fresh synthesis of all known facts
- Preserve source attribution on all claims
- Update `last_verified` in frontmatter to today
- Add Timeline entry: `- [YYYY-MM-DD] Compiled truth refreshed (dream cycle)`

Report: "Consolidated N pages"

## Step 6: Enrichment Tier Review

Check if any pages should be promoted or demoted.

- For each `tier: 3` (stub) page:
  - If page now has 20+ lines of real content → promote to `tier: 2`
  - If page has substantial compiled truth + timeline → promote to `tier: 1`
- For each `tier: 2` page:
  - If page has 50+ lines, rich compiled truth, 5+ timeline entries → consider `tier: 1`
- For each `tier: 1` page:
  - If page has gone stale (no activity in 60+ days) → demote to `tier: 2`

Report: "Promoted N pages, demoted M pages"

## Step 7: Index Rebuild

- Rebuild `wiki/index.md`:
  - List all wiki pages grouped by subdirectory (projects/, patterns/, concepts/, people/)
  - Include tier and last_verified for each entry
  - Remove entries for deleted pages
  - Add entries for new pages

Report: "Index rebuilt with N pages"

## Step 8: Verify

- Run: `python ~/.grain/engine/hygiene.py --json`
- Report grades and any new issues
- Append to `wiki/log.md`:
```
- [YYYY-MM-DD] dream: swept N sessions, updated M timelines, consolidated P pages, promoted Q tiers
```

## Guidelines

- **No user interaction** — this runs unattended (nightly cron/scheduler)
- **Never delete content** — only append to timelines, rewrite compiled truth
- **Conservative enrichment** — only add claims with evidence from sessions
- **Source attribution required** on every new claim
- **Encoding**: ASCII only — no em-dashes, smart quotes, or checkmarks
- **Idempotent** — running twice should not create duplicates
- **Fast** — skip pages that don't need updates (check last_verified date)
