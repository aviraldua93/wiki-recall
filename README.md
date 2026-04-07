<div align="center">

# 🧠 DevContext

### Docker for your engineering brain.

**Resume any project, on any machine, in one command.**<br>
Your repos, skills, knowledge, and working context travel with you.

[![CI](https://github.com/aviraldua93/devcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/aviraldua93/devcontext/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)

<br>

```
devcontext recall my-project
```

*Repos cloned. Branches checked out. Skills loaded. Context restored.*<br>
*You're back where you left off.*

</div>

---

## The Problem

It's Monday morning. You open your terminal.

> *"What was I working on? Which branch? What's blocked? Where are my notes?"*

You spend **30 minutes** piecing it together from Slack threads, stale tabs, and commit messages. Then your laptop dies and you switch to your desktop — **and do it all over again**.

Context is the most expensive thing in software engineering, and we throw it away every time we close our terminals.

## The Solution

DevContext packages your entire working state into a **portable, resumable scenario**:

```bash
# Friday evening — save your state
devcontext save api-project \
  --summary "Retry handler done, integration tests next" \
  --next-step "Write tests for exponential backoff" \
  --blocker "Waiting on shared-lib v2.1.0"

# Monday morning — pick up exactly where you left off
devcontext recall api-project
```

```
✔ Recalled scenario: api-project
  Status: active
  Summary: Retry handler done, integration tests next
  Next steps:
    1. Write tests for exponential backoff
  Blockers:
    ⚠ Waiting on shared-lib v2.1.0
  Skills loaded: code-review, ci-monitor
```

**Zero context loss.** Every time.

## How It Works

DevContext has three core concepts. That's it.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   📦 SCENARIO         🛠️ SKILLS            📚 KNOWLEDGE        │
│   ─────────           ──────               ─────────           │
│   Repos + branches    Reusable AI          Persistent          │
│   Working context     instruction sets     mental models       │
│   Session state       (code review,        about systems       │
│   Next steps          CI monitoring,       you work with       │
│   Blockers            PR management)       (Karpathy-style)    │
│                                                                 │
│              ┌────────────────────────┐                         │
│              │    devcontext CLI      │                         │
│              │  create · recall       │                         │
│              │  save   · handoff      │                         │
│              │  list   · teardown     │                         │
│              │  knowledge search      │                         │
│              └────────────────────────┘                         │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              │  GitHub repo sync   │                            │
│              │  (your data travels │                            │
│              │   with you — zero   │                            │
│              │   infrastructure)   │                            │
│              └─────────────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

Four commands from zero to your first scenario:

```bash
# 1. Install (clone and link locally)
git clone https://github.com/aviraldua93/devcontext.git
cd devcontext && bun install && bun link

# 2. Initialize workspace
devcontext init

# 3. Create a scenario from a template
devcontext create my-api --template web-api

# 4. Start working
devcontext recall my-api
```

Or build a custom scenario interactively:

```bash
devcontext create my-project -i
```

## Features

| | Feature | Description |
|---|---------|-------------|
| 📦 | **Working Scenarios** | Bundle repos, branches, skills, and context into one resumable unit |
| 💾 | **Save & Recall** | Checkpoint your state with `save`, restore it anywhere with `recall` |
| 🛠️ | **Pluggable Skills** | Markdown instruction files that teach AI how to review code, manage PRs, monitor CI |
| 📚 | **Knowledge Wiki** | Persistent memory about systems and concepts — survives across sessions |
| 🔄 | **Cross-Machine Sync** | GitHub-backed storage. Push from laptop, pull on desktop. Done. |
| 🤝 | **Handoffs** | Transfer a scenario to a teammate with full context — optionally as a PR |
| 🏗️ | **Templates** | Pre-built scenario templates for common project types |
| 🔍 | **Full-Text Search** | FTS5-powered search across your entire knowledge base |
| 📄 | **Paper Curation** | Discover, score, and ingest research papers from arXiv & Semantic Scholar |
| 🕸️ | **Visual Artifacts** | Generate interactive HTML knowledge graphs, timelines, and research landscapes |
| ✅ | **Schema Validation** | JSON Schema (Draft 2020-12) validates every manifest |
| 🧩 | **Skill Promotion** | Skills promote from personal → team → root as they mature |

## Built-in Skills

| Skill | Description |
|-------|-------------|
| `code-review` | Five-layer review protocol: security → correctness → style → performance → testing |
| `ci-monitor` | GitHub Actions monitoring, failure diagnosis, and build health management |
| `pr-management` | Full PR lifecycle — creation, review coordination, merging, and cleanup |
| `session-management` | Checkpointing, resumption, and cross-machine context transfer |
| `multi-agent` | Parallel agent orchestration using the docs-as-bus communication pattern |
| `paper-curation` | Research paper discovery, relevance scoring, and knowledge wiki ingestion |
| `research-loop` | Automated research workflow combining paper curation, ingestion, and visualization |

Skills are Markdown files with YAML frontmatter. Drop one in `skills/` and it's available immediately.

## Templates

Start fast with pre-built scenario scaffolds:

| Template | What you get |
|----------|-------------|
| `web-api` | REST API with auth, tests, CI pipeline, and API contracts |
| `frontend-app` | React/Angular dashboard with component library and design system |
| `infra-pipeline` | CI/CD pipelines, build system, and deployment configuration |
| `research-paper` | LaTeX paper with experiment tracking, datasets, and analysis |
| `multi-agent` | A2A agent orchestration with crew coordination and artifact bus |

```bash
devcontext create my-project --template web-api
```

## Example Scenario

A real scenario manifest — this one orchestrates a multi-agent A2A project:

```yaml
name: a2a-crews
version: "0.1.0"
status: active
description: "Multi-agent orchestration framework implementing Google's A2A protocol"

repos:
  - url: https://github.com/aviraldua93/a2a-crews
    branch: master
    purpose: "Core multi-agent framework"

skills:
  - name: multi-agent
    source: root
  - name: code-review
    source: root

knowledge:
  - name: a2a-protocol
    scope: scenario
  - name: bun-runtime
    scope: global

context:
  summary: "A2A-compliant multi-agent framework. Orchestrator splits work
            into isolated tasks, each agent writes artifacts to a shared bus."
  next_steps:
    - "Add agent health monitoring with configurable timeouts"
    - "Implement crew-level rollback on agent failure"
    - "Add OpenTelemetry tracing for cross-agent flows"
  blockers: []
```

## Knowledge Wiki

Implements [Andrej Karpathy's LLM Knowledge Base](https://karpathy.ai/) methodology: **entities, not documents.**

Each knowledge entry is a Markdown file with YAML frontmatter — a mental model of a system, tool, or concept that you carry across projects. Entities support source citations (`[Source: filename.md]`), contradiction tracking, and lifecycle status (`draft` → `reviewed` → `needs_update`).

```markdown
---
title: "Google Agent-to-Agent (A2A) Protocol"
type: concept
updated: "2025-06-15"
created: "2025-06-01"
tags: [multi-agent, protocol, interoperability]
related: [bun-runtime]
sources: [a2a-spec-v1.md]
source_count: 1
status: reviewed
---

## What It Is
Open standard for AI agent communication and task delegation.
[Source: a2a-spec-v1.md]

## Key Concepts
- **Agent Card**: JSON capability descriptor (like OpenAPI for agents)
- **Task**: Unit of work with lifecycle: submitted → working → completed
- **Artifact**: Immutable output of a completed task
```

Search your knowledge base instantly:

```bash
devcontext knowledge search "retry patterns"
```

## Paper Curation

Discover and ingest research papers directly into your knowledge wiki:

```bash
# Search arXiv and Semantic Scholar
devcontext papers search "transformer architectures" --limit 10

# Automated curation — score papers by topic relevance, recency, and citations
devcontext papers curate --topics "agents,retrieval" --keywords "RAG,multi-agent" --min-score 0.3

# Ingest a paper into the knowledge wiki as a Karpathy-style entity
devcontext papers ingest arxiv-2301-07041
```

Papers are scored on a 0–1 scale using topic match (40%), keyword match (30%), recency (20%), and citation signal (10%). Duplicates are automatically detected and merged.

## Visual Artifacts

Generate self-contained interactive HTML visualizations of your knowledge graph:

```bash
# Interactive network graph (vis.js powered)
devcontext visualize --type knowledge-graph --output graph.html

# Topic clusters grouped by tags
devcontext visualize --type topic-clusters

# Chronological timeline of entity updates
devcontext visualize --type timeline

# Combined research dashboard (graph + clusters + stats)
devcontext visualize --type research-landscape --open
```

All visualizations are single-file HTML with dark theme, zero external dependencies at runtime, and can be shared or hosted anywhere.

## Cross-Machine Sync

The killer feature. Your scenario repo is a **regular GitHub repo**.

```bash
# Laptop: save your work
devcontext save my-project --summary "Auth module done, need to write tests"

# Push to GitHub
devcontext push my-project

# Desktop: pull and resume
devcontext pull my-project
devcontext recall my-project
```

**No cloud service. No account. No subscription.** Just git.

Hand off to a teammate with a PR:

```bash
devcontext handoff my-project --to teammate --pr
```

## Portfolio Context

DevContext is part of a broader AI agent engineering portfolio:

| Project | What it does |
|---------|-------------|
| [a2a-crews](https://github.com/aviraldua93/a2a-crews) | Multi-agent orchestration via Google's A2A protocol |
| [ag-ui-crews](https://github.com/aviraldua93/ag-ui-crews) | Agent ↔ Human real-time UI streaming |
| [rag-a2a](https://github.com/aviraldua93/rag-a2a) | Agent knowledge retrieval with RAG pipelines |
| [agent-traps-lab](https://github.com/aviraldua93/agent-traps-lab) | Adversarial testing and failure-mode analysis for agents |
| [wiki-vs-rag](https://github.com/aviraldua93/wiki-vs-rag) | Head-to-head evaluation of wiki vs. RAG approaches |
| [multi-agent-playbook](https://github.com/aviraldua93/multi-agent-playbook) | Patterns and anti-patterns for multi-agent systems |
| **devcontext** | **The developer productivity layer — you are here** |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Bun](https://bun.sh) (TypeScript, ESM) |
| CLI framework | [Commander.js](https://github.com/tj/commander.js) |
| Schema validation | [Ajv](https://ajv.js.org/) — JSON Schema Draft 2020-12 |
| Storage | GitHub repos (git-based sync, zero infrastructure) |
| Knowledge search | FTS5 via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Skills format | Markdown + YAML frontmatter |
| Interactive prompts | [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) |
| Testing | Bun's built-in test runner |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Dev setup
git clone https://github.com/aviraldua93/devcontext.git
cd devcontext
bun install
bun test
```

## License

[MIT](LICENSE) © Aviral Dua
