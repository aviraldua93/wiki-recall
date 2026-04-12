# AGENTS.md

## Project Overview

WikiRecall is a CLI tool for portable, AI-driven working scenarios. It bundles repos, skills, knowledge, and session state into resumable packages stored in GitHub. Think "Docker for your engineering brain."

## Common Commands

```bash
bun install                    # Install dependencies
bun test                       # Run all tests
bun test tests/unit            # Unit tests only
bun run dev                    # Run CLI in dev mode
bun run build                  # Build for distribution
```

## Architecture

```
src/
├── cli/              # CLI commands (create, recall, save, list, handoff, teardown, knowledge)
├── scenario/         # Scenario CRUD, manifest parsing, lifecycle management
├── knowledge/        # Karpathy-style wiki: entities, search (FTS5), extraction
├── skills/           # Skill loading, validation, promotion pipeline
├── sync/             # GitHub-based sync (push/pull scenarios across machines)
├── mcp/              # MCP server for IDE/agent integration
├── providers/        # LLM providers (OpenAI, mock) for knowledge extraction
schemas/              # JSON Schema (Draft 2020-12) for scenarios and knowledge entities
skills/               # Built-in skill definitions (Markdown + YAML frontmatter)
templates/            # Scenario templates (web-api, frontend-app, etc.)
scripts/              # PowerShell/Bash helper scripts
tests/                # Unit and E2E tests
examples/             # Example scenarios and knowledge entities
docs/                 # Documentation
```

## Conventions

- TypeScript, ESM-first, Bun runtime
- Pino for structured logging
- Environment-based config via `src/config.ts`
- Mock providers for all external services (zero API keys for tests)
- Scenarios stored as YAML manifests validated against JSON Schema
- Knowledge entities use Markdown with YAML frontmatter
- Skills are Markdown instruction files with YAML frontmatter
- All file paths use kebab-case

## Scenario Manifest Format

```yaml
name: my-scenario
version: "0.1.0"
status: active | paused | handed-off | archived
description: "One-line description"
repos:
  - url: https://github.com/org/repo
    branch: feature/my-branch
    purpose: "Why this repo is in the scenario"
skills:
  - name: code-review
    source: root | team | personal
knowledge:
  - name: system-architecture
    scope: scenario
context:
  summary: "What you're working on"
  open_prs: []
  next_steps: []
  blockers: []
  notes: ""
```

## Knowledge Entity Format (Karpathy Methodology)

Inspired by [Andrej Karpathy's LLM Knowledge Base](https://karpathy.ai/) approach.
Each entity is a mental model — concise, opinionated Markdown with YAML frontmatter.

### Core Fields
```yaml
---
title: "Entity Name"
type: platform | system | repo | tool | concept | person | team
updated: 2025-04-07
tags: [tag1, tag2]
related:
  - entity-id
---
```

### Extended Fields (Karpathy-style)
```yaml
---
title: "Entity Name"
type: concept
updated: 2025-06-15
created: 2025-06-01
tags: [tag1, tag2]
related: [entity-id]
sources: [path/to/source.md]
source_count: 1
status: draft | reviewed | needs_update
tier: 1 | 2 | 3
---
```

### Enrichment Tiers

The `tier` field controls how much detail an entity contains. It is used by
`harvest.py` and dream protocol to decide what to generate and how to upgrade pages.

| Tier | Label | Content |
|:----:|:------|:--------|
| **1** | Deep | Full compiled truth + timeline + architecture/working-relationship sections. Reserved for actively-referenced entities. |
| **2** | Notable | Compiled truth + timeline. No architecture or deep relationship detail. Good default for known projects/people. |
| **3** | Stub | Name + description + `[No data yet]`. Placeholder created by dream sweep or harvest for newly-discovered entities. |

Tier assignment rules:
- `harvest.py` creates new entities as **tier 3** (stubs).
- Dream protocol Phase 1 (entity sweep) creates stubs at **tier 3**.
- Interview protocol Step 4 (people) creates pages at **tier 1** or **tier 2** based on mention count.
- Manually-created entities default to **tier 2** unless the author specifies otherwise.
- Promotion from tier 3 -> 2 -> 1 happens as more data accumulates.

### Zero Tags (Karpathy Principle)

Do NOT use freeform `tags:` in YAML frontmatter. Tags are invisible to the LLM
(it reads prose, not YAML). Use wiki-links `[[page-name]]` in prose instead.
Use `type:` and `tier:` for structured classification. Use `parent_domain:` to
link projects to domains.

### Taxonomy (domain > project > task)

| Entity | Definition | Gets a page? |
|--------|-----------|-------------|
| Domain | Persistent area of work ("I belong to it") | Yes (domains/X.md) |
| Project | Something you ship, has a repo ("I ship it") | Yes (wiki/projects/X.md) |
| Task | One PR, one fix, one investigation ("I do it") | No -- timeline entry in parent project |

Projects have `parent_domain:` in frontmatter linking them to their domain.
Tasks do NOT get pages -- they are `## Timeline` entries inside project pages.

### Entity Body Structure
```markdown
## What It Is
One-paragraph description.

## Key Concepts
- term: definition

## Common Patterns
How the thing is typically used in practice.

## Anti-Patterns / Pitfalls
What to avoid and why.

## Related Work
- Active items and links
```

### Source Citations
Use `[Source: filename.md]` inline for claim attribution.

### Contradiction Tracking
Flag contradictions with:
```
> CONTRADICTION: [existing claim] vs [new claim] from [Source: filename.md]
```

## Knowledge Workflows

### Extraction (Ingest)
1. LLM analyzes session text or documents
2. Extracts structured entities with type classification
3. Deduplicates against existing knowledge base
4. Persists via entity CRUD with FTS5 indexing
5. New entities are created at **tier 3** (stub) by default

### Dream Cycle (Nightly Enrichment)

`scripts/dream.ps1` runs nightly (scheduled at 2 AM via `setup-scheduler.ps1`)
and enriches the wiki in four phases:

1. **Entity Sweep** — Scans recent sessions for new people/project names not in the wiki. Creates tier-3 stub pages using `people-template.md` and `project-template.md`.
2. **Timeline Updates** — Appends dated entries to existing project and people pages from session activity.
3. **Citation Fix** — Scans compiled truth sections for uncited claims and adds `[Source: ...]` attribution where possible.
4. **Consolidation** — Rewrites stale compiled truth sections from newer timeline entries. Uses `.raw/` sidecar files as source material when available.

### Raw Sidecars

Raw session excerpts are stored alongside compiled wiki pages:

- `wiki/projects/.raw/` — raw excerpts for project entities
- `wiki/people/.raw/` — raw excerpts for people entities

Naming convention: `{entity-slug}-{session-id-prefix}.md`
(e.g., `auth-service-a1b2c3d4.md`)

`harvest.py` saves raw excerpts when `--auto` is used. `dream.ps1` reads `.raw/`
during consolidation to rewrite compiled truth. `lint.ps1` skips `.raw/` directories.

### Search (Query)
1. FTS5 full-text search across titles, tags, types, and content
2. Porter stemming + unicode tokenization for fuzzy matching
3. BM25 ranking for relevance ordering

### Maintenance (Lint)
Entities should be periodically reviewed for:
- Stale content (check `updated` dates)
- Missing cross-references (`related` field)
- Orphan entities (not referenced by any scenario)
- Contradictions between entities
- Uncited claims (missing source attribution)

### Hygiene Check (Deep Health)

`engine/hygiene.py` performs a 4-category deep health check beyond what lint covers:

```bash
python engine/hygiene.py                    # check ~/.grain (default)
python engine/hygiene.py /path/to/kb        # check specific path
python engine/hygiene.py --fix              # auto-fix safe issues
python engine/hygiene.py --json             # structured JSON output
```

**Categories scored A--F:**
- **Structure** -- root bloat (>6 files), script duplication, empty dirs, orphan pages, construction artifacts
- **Content** -- stubs (<200 bytes), missing frontmatter, missing last_verified, stale tier-3 pages (30+ days), decisions.md noise
- **Depth** -- missing Timeline/Compiled Truth sections, person pages without working relationships, pattern pages without incidents (graded by issue % of total pages)
- **Duplication** -- content overlap >60% (Jaccard similarity), similar page names (Levenshtein distance <3)
- **Brain** -- brain.md format budget (line count, token estimate, code blocks, Identity/Active Work section presence)

**--fix mode** (safe only):
- Deletes duplicate root scripts (keeps scripts/ copy)
- Adds `last_verified` to pages missing it
- Adds `[No data yet]` to empty sections
- Archives `.mining/` and `.verification/` to `.archive/`
- Adds orphan pages to the appropriate section in wiki/index.md
- Does NOT delete, merge, or rewrite any pages

PowerShell wrapper: `scripts/hygiene.ps1 [-Path] [-Fix] [-Refactor] [-Retrofit] [-Json]`

### Heal (Unified Pipeline)

`engine/heal.py` is the single command that replaces hygiene + retrofit + refactor.
It orchestrates: diagnose → auto-fix → smart-fix → depth-upgrade → verify.

```bash
python engine/heal.py                     # diagnose only (5 critic functions + content quality)
python engine/heal.py /path/to/wiki       # diagnose specific path
python engine/heal.py --fix               # diagnose + auto-fix + smart-fix
python engine/heal.py --deep              # include depth-upgrade (promote stubs)
python engine/heal.py --verify            # full pipeline with before/after comparison
python engine/heal.py --json              # structured JSON output
python engine/heal.py --no-llm            # force regex-only mode
```

**5 Diagnostic Check Categories** (regex-only, via `engine/hygiene.py`):
- **structure** -- required files, root file count, directory structure
- **content** -- compiled truth completeness, source attribution, staleness
- **depth** -- page depth scoring (lines, sections, frontmatter)
- **duplication** -- Jaccard similarity detection across pages
- **brain** -- brain.md budget, line count, token estimate

LLM judgment (content quality, classification, enrichment) is done by
the user's Copilot session via `protocols/heal-protocol.md`.

**4 Content-Quality Check Categories** (via `engine/page_quality.py`):
1. **Page Depth** -- compiled truth exists with real content (not `[No data yet]`), timeline exists with chronological dated entries, source attribution exists (session IDs, dates, `[Source:]` tags), page >200 bytes for project-type pages
2. **Page Quality** -- content is personal insight not textbook definition, no truncated sentences, cross-references link to real pages, frontmatter `related` field matches content
3. **Page Classification** -- page in correct category directory (e.g., project pages in `wiki/projects/`), stub/enrichable/archivable status detection, duplicate detection (Jaccard similarity >60%)
4. **Page Score** -- numeric 0-10 score aggregated from depth (0-3 pts), quality (0-3 pts), classification (0-2 pts), and bonus (0-2 pts)

**Content-Quality Scoring Tiers:**

| Label | Score | Meaning |
|:------|:-----:|:--------|
| `DEEP` | >7 | Full compiled truth + timeline + attribution. Personal insight style. |
| `ADEQUATE` | 4-7 | Has structure but may lack depth, attribution, or insight. |
| `STUB` | <4 | Minimal content, missing key sections. |
| `MISPLACED` | any | Page is in the wrong category directory (overrides score label). |
| `PLACEHOLDER` | any | All content is `[No data yet]` placeholder text (overrides score label). |

**--fix content-aware actions** (via `protocols/heal-protocol.md`):
- **Enrich placeholders** -- LLM session fills `[No data yet]` pages from session context
- **Archive stubs** -- stubs >30 days old with no timeline activity moved to `.archive/`
- **Move misplaced pages** -- pages in wrong category directory moved to correct one
- **Rewrite generic content** -- LLM session rewrites textbook definitions to personal insight style
- **Comment out broken paths** (#34) -- broken paths in copilot-instructions.md wrapped in HTML comments
- **Brain trim** (#36) -- brain.md trimmed when >40 lines (runs by default with --fix)
- **Timestamp update** (#38) -- every page touched by --fix gets `updated:` set to today, `last_verified:` added if missing
- **README convention** (#41) -- structure critic validates README.md exists, has project heading, description, no internal URLs

**Subsumes issues:** #34 (path validation), #36 (brain trim), #38 (timestamp update), #41 (README convention).

**JSON Output Schema** (`heal --json`):

```json
{
  "root": "/path/to/kb",
  "scores": {"structure": "A", "content": "B", "depth": "C", "duplication": "A", "brain": "B"},
  "issue_count": 12,
  "issues": [{"category": "...", "severity": "...", "message": "...", "file": "..."}],
  "critic_findings": [{"critic": "...", "severity": "...", "message": "...", "file": "...", "suggestion": "...", "auto_fixable": false}],
  "fix_actions": ["action description", "..."],
  "smart_fix_actions": ["action description", "..."],
  "depth_actions": ["action description", "..."],
  "page_scores": {
    "wiki/projects/auth-service.md": {
      "file": "wiki/projects/auth-service.md",
      "score": 8.2,
      "label": "DEEP",
      "issues": ["no source attribution found"]
    }
  }
}
```

The `page_scores` field maps relative file paths to `PageQualityResult` objects with:
- `file` (string) -- relative path within the knowledge base
- `score` (float) -- numeric quality score 0-10
- `label` (string) -- one of `DEEP`, `ADEQUATE`, `STUB`, `MISPLACED`, `PLACEHOLDER`
- `issues` (string[]) -- list of specific content issues found

### Refactoring (Interactive Cleanup)

`engine/refactor.py` provides guided 6-phase interactive cleanup:

```bash
python engine/refactor.py                   # refactor ~/.grain (default)
python engine/refactor.py /path/to/kb       # refactor specific path
```

**Phases:**
1. Root cleanup (automated — scripts, artifacts, empty dirs)
2. Projects cleanup (interactive — archive stubs/thin pages per prompt)
3. Content depth review (show noise and stubs)
4. Dedup check (show overlapping pages)
5. Rebuild index (regenerate index.md from actual pages)
6. Final validation (re-run hygiene check)

Safety: Always backs up first. Archives instead of deleting.

### Retrofit (Interactive Upgrade)

`engine/retrofit.py` upgrades pre-wiki-recall brains to the current format:

```bash
python engine/retrofit.py                   # retrofit ~/.grain (default)
python engine/retrofit.py /path/to/kb       # retrofit specific path
scripts/hygiene.ps1 -Retrofit               # PowerShell wrapper
```

**Phases:**
1. Structure cleanup (automated, from hygiene --fix)
2. Brain.md cleanup (trim to Identity+Active Work under 40 lines, no LLM)
3. Wire RESOLVER (inline routing rules into copilot-instructions.md)
4. Add compiled truth + timeline sections to pages missing them
5. Clean decisions.md (remove harvest noise — [harvest] tag or very short entries)
6. Run hygiene check + report before/after stats

Safety: Always backs up first. Interactive confirmation. Archive, don't delete.

### Decision and Gate Routing (scoped + tiered)

Decisions and gates live at the **narrowest scope** where they apply:

| Scope | Decisions file | Gates file | Max entries |
|-------|---------------|------------|-------------|
| Global | decisions.md | reference/hard-gates.md | 15-20 / 3-5 |
| Domain | domains/X.md ## Decisions | domains/X.md ## Gates | 2-4 each |
| Project | wiki/projects/X.md ## Decisions | wiki/projects/X.md ## Gates | 0-10 each |

When a decision/gate is detected, ask: "Global, domain, or project scope?"
- Tier 1 (behavioral): "always/never" -> scope file + copilot-instructions.md
- Tier 2 (architectural): "decided to" -> scope file + brain.md
- Tier 3 (historical): project-specific -> scope file only

Format: `- [YYYY-MM-DD] [tier:N] description`
See `templates/RESOLVER.md` for full routing rules.

## Testing

- Unit tests in `tests/unit/` — mock all externals
- E2E tests in `tests/e2e/` — full scenario lifecycle
- Run: `bun test` (all) or `bun test tests/unit`

## IMPORTANT: No internal/corporate references

This is a public open-source project. Zero references to:
- Any corporate org names, internal tools, or team names
- Internal URLs (SharePoint, ADO, eng.ms, aka.ms)
- Corporate auth patterns (EMU, GHEC corporate)
- Real people's names or email addresses
- Any proprietary systems or codenames

Use only generic, public GitHub references.

## Source Attribution

Every claim in compiled truth sections must have a source type:
- `observed: session <id>` — from code, PRs, or session transcripts
- `self-stated: session <id>` — user said it directly
- `inferred: <reasoning>, confidence: high|medium|low` — derived from context

When writing to any compiled truth or timeline section, always include the source type.
See `templates/RESOLVER.md` for filing rules and page format conventions.

## Compiled Truth + Timeline Format

All wiki pages, project pages, people pages, and domain files use a two-layer format:
- **Compiled Truth** — always current, rewritten on every update (max 5-10 lines)
- **Timeline** — append-only, never delete, always dated, always attributed with session ID

These layers are separated by `---`. The compiled truth is what agents read for quick context.
The timeline is the audit trail.

## Proactive Feedback Loop

When working with a user's wiki-recall knowledge base, do these WITHOUT being asked:
- New topic not in wiki → TELL the user, offer to create a knowledge entity
- Info contradicts existing wiki → FLAG it, offer to update
- Decision made in conversation → ASK "save to scenario context?"
- Session reaching natural end (>5 exchanges) → ASK "save anything to knowledge base?"
- New project/domain mentioned → Offer to create a scenario or entity
- Recurring question → Suggest compiling into a permanent wiki entity

**No staging.** When the user confirms, write directly. The conversation is the review process.

## Architecture: Protocols, Not Scripts (#49)

Python scripts do **plumbing only** (diagnosis, backup, file moves, counting).
LLM judgment is done by the **user's Copilot session** via markdown protocols.

```
protocols/
  heal-protocol.md        -- 'heal my brain' -> step-by-step for the LLM session
  interview-protocol.md   -- set up a new brain from scratch
  retrofit-protocol.md    -- upgrade pre-wiki-recall brains
  dream-protocol.md       -- nightly enrichment cycle
```

**The split:**

| Layer     | Tool                        | What it does                                        |
|-----------|:----------------------------|:----------------------------------------------------|
| DIAGNOSIS | Python scripts (hygiene.py) | Count lines, find orphans, detect broken paths       |
| JUDGMENT  | The LLM session itself      | Trim brain, write compiled truth, classify, enrich   |
| PLUMBING  | Python scripts (backup, mv) | Backup, archive, move files safely                   |

**How it works:**
1. User says "heal my brain"
2. Copilot reads `protocols/heal-protocol.md`
3. Protocol says: run `python engine/hygiene.py --json` for DIAGNOSIS
4. Copilot reads the diagnosis, applies JUDGMENT fixes directly
5. Protocol says: run hygiene again to VERIFY

**Zero subprocess LLM calls.** `engine/llm_client.py` is a stub -- all methods
return empty/fallback responses. The class exists for API compatibility only.

### Adding a New Feature

1. If it needs diagnosis: add regex checks to `engine/hygiene.py`
2. If it needs judgment: add steps to the relevant protocol `.md`
3. If it needs plumbing: add Python functions (no LLM calls)
4. Never spawn `copilot -p` subprocesses from Python
