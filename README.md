# DevContext

**Portable AI-driven working scenarios — Docker for your engineering brain.**

> Resume any project, on any machine, instantly. Your repos, skills, knowledge, and context travel with you.

## The Problem

Engineers lose **30+ minutes daily** reconstructing context:
- Which repos was I working on? What branch?
- What was I doing? What decisions did I make?
- What skills/tools do I need loaded?
- What PRs are open? What's blocked?

Session loss on restart. Context doesn't travel between machines. Skills installed here don't exist there.

## The Solution

A **Working Scenario** bundles everything into a resumable, portable package:

```yaml
name: my-api-project
status: active
repos:
  - url: https://github.com/myorg/api-service
    branch: feature/retry-logic
  - url: https://github.com/myorg/shared-lib
    branch: main
skills:
  - name: code-review
    source: root
  - name: ci-monitor
    source: personal
context:
  summary: "Implementing retry logic with exponential backoff"
  open_prs: ["api-service#342"]
  next_steps:
    - "Write integration tests for retry handler"
    - "Update API docs for new error codes"
  blockers:
    - "Waiting on shared-lib v2.1.0 release"
```

**One command to resume:**
```bash
devcontext recall my-api-project
# → Clones/pulls repos, checks out branches, loads skills, restores context
```

## Architecture

```
┌──────────────────────────────────────────────┐
│  "I want to work on my-api-project"          │
├──────────────────────────────────────────────┤
│  DevContext CLI                               │
│  Commands:                                    │
│  ├─ create   — Start a new scenario           │
│  ├─ recall   — Resume a scenario              │
│  ├─ save     — Checkpoint current state       │
│  ├─ list     — Show all scenarios             │
│  ├─ handoff  — Transfer to another engineer   │
│  ├─ teardown — Archive and clean up           │
│  └─ knowledge — Search your knowledge wiki    │
├──────────────────────────────────────────────┤
│  Storage: GitHub repo (your scenarios travel) │
│  Skills: Markdown instruction files           │
│  Knowledge: Karpathy-style entity wiki        │
└──────────────────────────────────────────────┘
```

## Key Concepts

### Working Scenarios
A named unit of work — repos + skills + context + session state. Stored as YAML manifests in your GitHub repo. Portable across machines.

### Skills
Reusable instruction sets (Markdown files) that teach your AI assistant how to do specific tasks: code review patterns, CI monitoring, PR management, etc. Skills promote through layers:

```
Personal (your experiments)
  → Team (shared practices)  
    → Root (community-vetted)
```

### Knowledge Wiki
Persistent memory about systems, platforms, and concepts you work with. Karpathy-inspired: entities stored as Markdown with YAML frontmatter. Not documentation — **mental models**.

### Sync via GitHub
Your scenario repo is just a GitHub repo. Push/pull to sync across machines. PRs for handoffs. Git history for audit trail. Zero infrastructure.

## Quick Start

```bash
# Install
bun install -g devcontext

# Initialize your workspace
devcontext init

# Create a scenario
devcontext create "Working on API retry logic" \
  --repo myorg/api-service:feature/retry-logic \
  --repo myorg/shared-lib:main \
  --skill code-review \
  --skill ci-monitor

# Save progress
devcontext save --summary "Retry handler done, need integration tests"

# Later (or on another machine)...
devcontext recall my-api-project

# Search your knowledge
devcontext knowledge search "retry patterns"

# Hand off to a teammate
devcontext handoff my-api-project --to teammate-username

# Done? Archive it
devcontext teardown my-api-project
```

## Built-in Skills

| Skill | What it does |
|-------|-------------|
| `code-review` | Systematic review checklist (security, correctness, style, performance, testing) |
| `ci-monitor` | GitHub Actions pipeline monitoring and failure diagnosis |
| `pr-management` | Full PR lifecycle (create, review, merge, cleanup) |
| `session-management` | Checkpointing, resuming, cross-machine transfer |
| `multi-agent` | Multi-agent workflow orchestration with docs-as-bus pattern |

## Templates

Start fast with pre-built scenario templates:

| Template | Description |
|----------|-------------|
| `web-api` | REST API with auth, tests, CI |
| `frontend-app` | React/Angular dashboard project |
| `infra-pipeline` | CI/CD pipelines and build system |
| `research-paper` | LaTeX paper with experiments |
| `multi-agent` | A2A agent orchestration project |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun (TypeScript) |
| CLI | Commander.js |
| Schemas | JSON Schema (Draft 2020-12) |
| Storage | GitHub repos (git-based sync) |
| Knowledge search | FTS5 (SQLite) |
| Skills format | Markdown with YAML frontmatter |
| Testing | Bun test |

## Portfolio Context

| Project | Pillar |
|---------|--------|
| [a2a-crews](https://github.com/aviraldua93/a2a-crews) | Agent ↔ Agent communication |
| [ag-ui-crews](https://github.com/aviraldua93/ag-ui-crews) | Agent ↔ Human UI |
| [rag-a2a](https://github.com/aviraldua93/rag-a2a) | Agent Knowledge & Retrieval |
| [agent-traps-lab](https://github.com/aviraldua93/agent-traps-lab) | Adversarial Testing |
| [wiki-vs-rag](https://github.com/aviraldua93/wiki-vs-rag) | Paradigm Evaluation |
| **devcontext** | **Developer Productivity** |

## License

MIT
