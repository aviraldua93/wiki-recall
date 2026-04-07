# DevContext Architecture

> System overview for developers contributing to DevContext.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DevContext CLI                            │
│  Commands: create | recall | save | list | handoff |         │
│            teardown | knowledge search                       │
│  Framework: Commander.js                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Scenario    │  │  Knowledge   │  │    Skills     │       │
│  │   Engine      │  │    Wiki      │  │   System      │       │
│  │              │  │              │  │              │       │
│  │  • Manager   │  │  • Entities  │  │  • Loader    │       │
│  │  • Lifecycle │  │  • Search    │  │  • Validator  │       │
│  │  • Templates │  │  • Extraction│  │  • Promotion  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│  ┌──────┴─────────────────┴─────────────────┴───────┐       │
│  │              Shared Infrastructure                │       │
│  │  • Types (src/types.ts)                           │       │
│  │  • Config (src/config.ts) — env-based, 12-factor  │       │
│  │  • Logger (src/logger.ts) — structured JSON/pino  │       │
│  │  • Schemas (schemas/*.json) — JSON Schema 2020-12 │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │  GitHub Sync  │  │  Providers   │                          │
│  │  • Push/Pull │  │  • OpenAI    │                          │
│  │  • Handoff PR│  │  • Mock      │                          │
│  └──────────────┘  └──────────────┘                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
  ┌──────────────┐                    ┌──────────────┐
  │  GitHub Repo  │                    │  Local Disk   │
  │  (Sync Store) │                    │  ~/.devcontext│
  └──────────────┘                    └──────────────┘
```

## Module Responsibilities

### CLI Layer (`src/cli/`)

The CLI uses **Commander.js** to expose these commands:

| Command | Description | Key Operations |
|---------|-------------|----------------|
| `create` | Start a new scenario | Template selection, schema validation, disk write |
| `recall` | Resume a scenario | YAML read, context display, branch checkout |
| `save` | Checkpoint current state | Context update, YAML write, optional git push |
| `list` | Show all scenarios | Directory scan, YAML parsing, status display |
| `handoff` | Transfer to another engineer | Status transition, PR creation, context packaging |
| `teardown` | Archive and clean up | Status → archived, optional branch cleanup |
| `knowledge` | Search knowledge wiki | FTS5 query, entity display |

### Scenario Engine (`src/scenario/`)

- **`manager.ts`** — CRUD operations: create, read, update, delete, list. Scenarios are stored as YAML files in `~/.devcontext/scenarios/`. All mutations are validated against `schemas/scenario.schema.json` using **ajv**.

- **`lifecycle.ts`** — State machine enforcing valid transitions:
  ```
  active → paused | handed-off | archived
  paused → active | archived
  handed-off → active | archived
  archived → (terminal — no transitions)
  ```

- **`templates.ts`** — Five pre-built scenario starters: `web-api`, `frontend-app`, `infra-pipeline`, `research-paper`, `multi-agent`. Each provides default skills, context structure, and next steps.

### Knowledge Wiki (`src/knowledge/`)

- **`entities.ts`** — CRUD for Karpathy-style knowledge entities. Entities are Markdown files with YAML frontmatter parsed by **gray-matter**. Stored in `~/.devcontext/knowledge/`.

- **`search.ts`** — FTS5 full-text search powered by **bun:sqlite**. Indexes entity titles, tags, types, and content. Returns results ranked by relevance with snippet highlighting.

- **`extraction.ts`** — Provider-based knowledge extraction from text. Uses the provider pattern to support OpenAI (production) and mock (testing) backends.

### Skills System (`src/skills/`)

- **`loader.ts`** — Loads skill Markdown files from `skills/<name>/skill.md`. Parses YAML frontmatter (name, description, version, source) and body content using gray-matter.

- **`validator.ts`** — Validates skills against naming conventions (kebab-case), required fields, and recommended content sections (When to Use, How to Execute, Expected Outputs).

- **`promotion.ts`** — Promotion pipeline: `personal → team → root`. Skills must pass validation and meet content quality requirements to promote.

### Providers (`src/providers/`)

- **`mock.ts`** — Deterministic mock provider for testing. Returns configurable entities, supports error simulation and artificial delays. Zero API keys required.

### GitHub Sync (`src/sync/`)

Git-based sync for pushing/pulling scenarios across machines. Handoff creates a PR in the scenario repo with full context in the description.

## Data Flow

### Creating a Scenario

```
User Input → CLI (create command)
  → Template selection (if --template)
  → Schema validation (ajv)
  → YAML serialization (js-yaml)
  → Disk write (~/.devcontext/scenarios/<name>.yaml)
```

### Searching Knowledge

```
User Input → CLI (knowledge search)
  → FTS5 query (bun:sqlite)
  → Rank by relevance
  → Snippet extraction
  → Display results
```

### Skill Loading

```
Scenario Recall → Read skill references
  → Load from skills/<name>/skill.md
  → Parse with gray-matter
  → Validate with validator
  → Return structured skill data
```

## Storage Layout

```
~/.devcontext/
├── scenarios/
│   ├── my-api-project.yaml
│   └── dashboard-redesign.yaml
├── knowledge/
│   ├── retry-patterns.md
│   ├── api-gateway.md
│   └── search.db          (FTS5 index)
└── config                  (future: local config overrides)
```

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Bun | Fast startup, built-in TypeScript, built-in test runner, native SQLite |
| CLI | Commander.js | Mature, well-documented, supports subcommands and options |
| Schema Validation | ajv (Draft 2020-12) | Industry standard, fast, supports formats (uri, date) |
| YAML | js-yaml + gray-matter | js-yaml for scenario manifests, gray-matter for Markdown frontmatter |
| Search | bun:sqlite (FTS5) | Zero external dependencies, porter stemming, fast full-text search |
| Logging | pino | Structured JSON, async writes via sonic-boom, configurable levels |
| LLM | OpenAI SDK | Provider pattern allows swapping; mock provider for tests |

## Testing Strategy

- **Unit tests** (`tests/unit/`): One test file per module. Mock all external dependencies. Use Bun's built-in test runner.
- **E2E tests** (`tests/e2e/`): Full scenario lifecycles exercising multiple modules together.
- **Schema validation**: Both unit and E2E tests validate data against JSON Schema to catch drift.
- **Mock providers**: All LLM/API dependencies use mock providers in tests — zero API keys needed.
