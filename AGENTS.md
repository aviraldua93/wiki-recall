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
`harvest.py` and `dream.ps1` to decide what to generate and how to upgrade pages.

| Tier | Label | Content |
|:----:|:------|:--------|
| **1** | Deep | Full compiled truth + timeline + architecture/working-relationship sections. Reserved for actively-referenced entities. |
| **2** | Notable | Compiled truth + timeline. No architecture or deep relationship detail. Good default for known projects/people. |
| **3** | Stub | Name + description + `[No data yet]`. Placeholder created by dream sweep or harvest for newly-discovered entities. |

Tier assignment rules:
- `harvest.py` creates new entities as **tier 3** (stubs).
- `dream.ps1` Phase 1 (entity sweep) creates stubs at **tier 3**.
- Interview protocol Step 4 (people) creates pages at **tier 1** or **tier 2** based on mention count.
- Manually-created entities default to **tier 2** unless the author specifies otherwise.
- Promotion from tier 3 → 2 → 1 happens as more data accumulates (via dream consolidation or manual edits).

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
- **Brain** -- brain.md format budget (line count, token estimate, code blocks, L0/L1 section presence)

**--fix mode** (safe only):
- Deletes duplicate root scripts (keeps scripts/ copy)
- Adds `last_verified` to pages missing it
- Adds `[No data yet]` to empty sections
- Archives `.mining/` and `.verification/` to `.archive/`
- Adds orphan pages to the appropriate section in wiki/index.md
- Does NOT delete, merge, or rewrite any pages

PowerShell wrapper: `scripts/hygiene.ps1 [-Path] [-Fix] [-Refactor] [-Json]`

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
