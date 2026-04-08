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
---
```

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

## Proactive Feedback Loop

When working with a user's wiki-recall knowledge base, do these WITHOUT being asked:
- New topic not in wiki → TELL the user, offer to create a knowledge entity
- Info contradicts existing wiki → FLAG it, offer to update
- Decision made in conversation → ASK "save to scenario context?"
- Session reaching natural end (>5 exchanges) → ASK "save anything to knowledge base?"
- New project/domain mentioned → Offer to create a scenario or entity
- Recurring question → Suggest compiling into a permanent wiki entity

**No staging.** When the user confirms, write directly. The conversation is the review process.
