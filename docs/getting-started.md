# Getting Started with WikiRecall

> Resume any project, on any machine, instantly.

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- Git (for scenario sync)
- A GitHub account (optional, for cross-machine sync)

## Installation

```bash
# Clone the repository
git clone https://github.com/aviraldua93/wiki-recall.git
cd wikirecall

# Install dependencies
bun install

# Run in development mode
bun run dev

# Or build a standalone binary
bun run build
./wikirecall --help
```

## Your First Scenario

### 1. Create a Scenario

```bash
# Create from scratch
wikirecall create my-api-project \
  --description "Building a REST API with retry logic" \
  --repo https://github.com/myorg/api-service:feature/retry-logic \
  --skill code-review \
  --skill ci-monitor

# Or use a template
wikirecall create my-api-project \
  --template web-api \
  --description "Building a REST API with retry logic"
```

This creates a YAML manifest at `~/.wikirecall/scenarios/my-api-project.yaml` with your repos, skills, and an initial context.

### 2. Save Your Progress

As you work, checkpoint your state:

```bash
wikirecall save my-api-project \
  --summary "Implemented retry handler with exponential backoff" \
  --next-step "Write integration tests" \
  --next-step "Add jitter to backoff"
```

### 3. Recall Later (or on Another Machine)

```bash
wikirecall recall my-api-project
```

This clones/pulls all repos listed in the scenario, loads skills, and displays your saved context — summary, next steps, open PRs, and blockers — so you can resume instantly.

Use `--skip-repos` to recall without touching repositories:

```bash
wikirecall recall my-api-project --skip-repos
```

### 4. Sync Across Machines

Push your scenario to GitHub and pull it on another machine:

```bash
# Push scenario state to a remote repo
wikirecall push my-api-project

# On another machine: pull the latest state
wikirecall pull my-api-project
```

### 5. List All Scenarios

```bash
# List all scenarios
wikirecall list

# Filter by status
wikirecall list --status active
```

### 6. Hand Off to a Colleague

```bash
wikirecall handoff my-api-project --to teammate-username
```

This transitions the scenario to `handed-off` status, preserving all context for your teammate.

### 7. Archive When Done

```bash
wikirecall teardown my-api-project
```

This moves the scenario to `archived` status. The manifest is preserved for historical reference.

## Knowledge Wiki

WikiRecall includes a Karpathy-style knowledge wiki for persistent memory about systems, patterns, and concepts.

### Create a Knowledge Entity

```bash
wikirecall knowledge create --title "Retry Patterns" --type concept --tags distributed-systems resilience
```

### Search Knowledge

```bash
wikirecall knowledge search "retry patterns"
```

### List All Entities

```bash
wikirecall knowledge list
```

### Get a Specific Entity

```bash
wikirecall knowledge get retry-patterns
```

### Delete an Entity

```bash
wikirecall knowledge delete retry-patterns
```

### Knowledge Entity Format

Knowledge entities are Markdown files with YAML frontmatter:

```markdown
---
title: "Retry Patterns"
type: concept
updated: 2025-03-15
tags: [distributed-systems, resilience]
related: [circuit-breaker]
---

## What It Is

Retry patterns handle transient failures in distributed systems...

## Key Concepts

- **Exponential backoff**: Wait time doubles with each retry
- **Jitter**: Random variation to prevent thundering herd
```

Entity types: `platform`, `system`, `repo`, `tool`, `concept`, `person`, `team`.

## Built-in Skills

Skills are reusable instruction sets that teach your AI assistant specific tasks:

| Skill | Description |
|-------|-------------|
| `code-review` | Systematic review with security, correctness, style, performance, and testing layers |
| `ci-monitor` | GitHub Actions monitoring, failure diagnosis, and build health management |
| `pr-management` | Full PR lifecycle — creation, review coordination, merging, cleanup |
| `session-management` | Checkpointing, resuming, and cross-machine context transfer |
| `multi-agent` | Multi-agent workflow orchestration with docs-as-bus communication |

Skills promote through layers: **personal** → **team** → **root** (community-vetted).

## Scenario Templates

Start fast with pre-built templates:

```bash
wikirecall create my-project --template web-api
wikirecall create my-project --template frontend-app
wikirecall create my-project --template infra-pipeline
wikirecall create my-project --template research-paper
wikirecall create my-project --template multi-agent
```

Each template provides sensible defaults for skills, context structure, and next steps.

## Configuration

WikiRecall reads these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WIKIRECALL_HOME` | `~/.wikirecall` | Root directory for all WikiRecall data |
| `WIKIRECALL_LOG_LEVEL` | `info` | Pino log level (trace, debug, info, warn, error, fatal) |
| `GITHUB_TOKEN` | — | GitHub personal access token for sync operations |

## Scenario Lifecycle

Scenarios follow a state machine:

```
        ┌──────────┐
        │  active   │
        └────┬──────┘
             │
     ┌───────┼───────┐
     ▼       ▼       ▼
  paused  handed-off  archived
     │       │         (terminal)
     └───┬───┘
         ▼
      active
```

- **active**: Currently being worked on
- **paused**: Temporarily suspended (e.g., context switch)
- **handed-off**: Transferred to another engineer
- **archived**: Completed or abandoned (terminal state)

## Development

```bash
# Run all tests
bun test

# Run unit tests only
bun test tests/unit

# Run E2E tests
bun test tests/e2e

# Type-check without emitting
bun run lint
```

## Next Steps

- Explore the [architecture documentation](./architecture.md) for system internals
- Browse [example scenarios](../examples/scenarios/) and [knowledge entities](../examples/knowledge/)
- Read the built-in [skill files](../skills/) to understand what each skill does
