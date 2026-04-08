<div align="center">

# 🧠 DevContext

### The first developer tool that combines compiled knowledge with layered memory retrieval.

**Karpathy-style wiki for understanding. Semantic search for recall. Five layers, ~550 tokens to wake up.**

[![CI](https://github.com/aviraldua93/devcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/aviraldua93/devcontext/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-833_passing-brightgreen)](https://github.com/aviraldua93/devcontext/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-15_tools-purple)](https://modelcontextprotocol.io)

</div>

---

Every LLM memory system makes the same trade-off: **compile knowledge and lose recall**, or **store everything and understand nothing**.

DevContext doesn't choose. It stacks both.

```
devcontext memory query "what's our retry strategy?"
```

The query hits **five layers** — identity in 50 tokens, curated highlights in 500, compiled wiki entries for deep understanding, BM25 search for anything the wiki missed, and raw session replay as the last resort. Total wake-up cost: **~550 tokens**. Most context-dump tools start at 1,500+.

---

## The Hybrid Memory Architecture

**This is the core differentiator.** No other tool combines compiled knowledge (Karpathy) with layered retrieval (MemPalace) into a single query path.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DEVCONTEXT MEMORY STACK                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L0  IDENTITY                              ~50 tokens        │  │
│  │  ── Always loaded. Zero search cost.                         │  │
│  │  Who you are. Core principles. Project mission.              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L1  ESSENTIAL STORY                       ~500 tokens       │  │
│  │  ── Always loaded. Auto-generated highlights.                │  │
│  │  Current status, blockers, what you were doing.              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L2  COMPILED WIKI (on demand)             domain-routed     │  │
│  │  ── Karpathy-style structured entities.                      │  │
│  │  Mental models, not documents. Source-cited. Lifecycle-       │  │
│  │  tracked. This is where understanding lives.                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L3  SEMANTIC SEARCH (on demand)           BM25 / FTS5       │  │
│  │  ── Full-text search over session history.                   │  │
│  │  Catches what the wiki never compiled. Fuzzy recall.         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L4  RAW SESSIONS (reference)              full replay       │  │
│  │  ── Complete conversation history.                           │  │
│  │  The court record. Nothing lost, nothing forgotten.          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**L0 + L1 load on every query** — 550 tokens, always. L2–L4 activate only when needed, routed by query domain. You get instant orientation plus deep retrieval, without paying the token cost of either approach alone.

```bash
# Query specific layers
devcontext memory query "retry strategy" --layers L0,L1,L2

# See what's in each layer
devcontext memory stats

# Initialize your identity
devcontext memory identity
```

---

## Why Not Just X?

| | Karpathy Wiki | RAG / MemPalace | **DevContext** |
|:---|:---:|:---:|:---:|
| **Compiled knowledge** | ✅ Entities, not docs | ❌ Raw chunks | ✅ **Karpathy-style entities** |
| **Semantic search** | ❌ Only what you compiled | ✅ Everything stored | ✅ **BM25/FTS5 over history** |
| **Wake-up cost** | High (load full wiki) | High (embed + retrieve) | **~550 tokens (L0+L1)** |
| **Portable scenarios** | ❌ | ❌ | ✅ **Git-synced state** |
| **Paper curation** | ❌ | ❌ | ✅ **arXiv + Semantic Scholar** |
| **Visual artifacts** | ❌ | ❌ | ✅ **Interactive HTML dashboards** |
| **IDE integration** | ❌ | Varies | ✅ **15-tool MCP server** |

**The insight:** Compiled knowledge gives you speed and understanding. Semantic search gives you completeness. The layered architecture gives you both — and the token budget to actually use them in production.

---

## Quick Start

```bash
# Install
git clone https://github.com/aviraldua93/devcontext.git
cd devcontext && bun install && bun link

# Initialize workspace
devcontext init

# Create a scenario from a template
devcontext create my-api --template web-api

# Start working — repos cloned, skills loaded, context restored
devcontext recall my-api
```

Or interactively:

```bash
devcontext create my-project -i
```

---

## Portable Working Scenarios

DevContext packages your entire working state — repos, branches, skills, context, blockers — into a **resumable scenario** that syncs via Git.

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

**Zero context loss.** Push from laptop, pull on desktop. Hand off to a teammate as a PR. No cloud service, no subscription — just git.

```bash
devcontext push my-project          # Push to GitHub
devcontext pull my-project          # Pull on another machine
devcontext handoff my-project --to teammate --pr
```

---

## Knowledge Wiki

The L2 layer. Implements [Andrej Karpathy's methodology](https://karpathy.ai/): **entities, not documents.**

Each entry is a Markdown file with YAML frontmatter — a mental model of a system, tool, or concept that you carry across projects. Source citations, contradiction tracking, lifecycle status (`draft` → `reviewed` → `needs_update`).

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

```bash
devcontext knowledge search "retry patterns"
devcontext knowledge list --type concept
devcontext knowledge get a2a-protocol
```

---

## Research Paper Curation

Automated discovery and ingestion from **arXiv** and **Semantic Scholar** — inspired by [Elvis Saravia's](https://github.com/dair-ai) work on ML research tooling.

Papers are scored on a **0–1 relevance scale**: topic match (40%), keyword match (30%), recency (20%), citation signal (10%). Duplicates are automatically detected and merged. High-scoring papers ingest directly into the knowledge wiki as Karpathy-style entities.

```bash
# Search across both sources
devcontext papers search "transformer architectures" --limit 10

# Automated curation — score by relevance
devcontext papers curate --topics "agents,retrieval" --keywords "RAG,multi-agent" --min-score 0.3

# Ingest into wiki as a structured entity
devcontext papers ingest arxiv-2301-07041
```

**The pipeline:** Discover → Score → Deduplicate → Ingest → Visualize. One command from "interesting paper" to searchable, citation-linked wiki entry.

---

## Visual Knowledge Artifacts

Generate **self-contained interactive HTML** visualizations. Zero external dependencies at runtime. Dark theme. Shareable anywhere.

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

Four visualization types: **knowledge-graph** (entity relationships), **topic-clusters** (tag groupings), **timeline** (chronological evolution), **research-landscape** (combined dashboard with search, filtering, and type breakdown).

---

## MCP Server

**15 tools** exposed via the [Model Context Protocol](https://modelcontextprotocol.io). Any LLM, any IDE.

```bash
devcontext mcp              # Start on stdio
devcontext mcp --list-tools # See all 15 tools
```

| Category | Tools |
|:---|:---|
| **Knowledge** | `knowledge_search`, `knowledge_get_entity`, `knowledge_list_entities`, `knowledge_create_entity`, `knowledge_update_entity` |
| **Scenarios** | `scenario_list`, `scenario_get`, `scenario_create`, `scenario_save` |
| **Memory** | `memory_query`, `memory_identity`, `memory_stats` |
| **Papers** | `papers_search`, `papers_curate` |
| **Visualization** | `visualize_knowledge` |

Add to your IDE's MCP config:

```json
{
  "mcpServers": {
    "devcontext": {
      "command": "devcontext",
      "args": ["mcp"]
    }
  }
}
```

Your AI assistant now has direct access to the full memory stack, knowledge wiki, and paper curation pipeline.

---

## Features

| | Feature | Description |
|:---|:---|:---|
| 🧠 | **5-Layer Memory** | Hybrid compiled + search architecture, ~550 token wake-up |
| 📦 | **Working Scenarios** | Bundle repos, branches, skills, and context into one resumable unit |
| 💾 | **Save & Recall** | Checkpoint your state with `save`, restore it anywhere with `recall` |
| 🛠️ | **Pluggable Skills** | Markdown instruction files that teach AI how to review code, manage PRs, monitor CI |
| 📚 | **Knowledge Wiki** | Karpathy-style entities with source citations and lifecycle tracking |
| 📄 | **Paper Curation** | Automated discovery and scoring from arXiv & Semantic Scholar |
| 🕸️ | **Visual Artifacts** | Interactive HTML knowledge graphs, timelines, and research landscapes |
| 🔌 | **MCP Server** | 15 tools for IDE and LLM integration via Model Context Protocol |
| 🔄 | **Cross-Machine Sync** | GitHub-backed storage. Push from laptop, pull on desktop |
| 🤝 | **Handoffs** | Transfer a scenario to a teammate with full context — optionally as a PR |
| 🏗️ | **Templates** | 5 pre-built scenario templates for common project types |
| 🔍 | **Full-Text Search** | FTS5-powered search across your entire knowledge base |
| ✅ | **Schema Validation** | JSON Schema (Draft 2020-12) validates every manifest |
| 🧩 | **Skill Promotion** | Skills promote from personal → team → root as they mature |

## Built-in Skills

| Skill | Description |
|:---|:---|
| `code-review` | Five-layer review protocol: security → correctness → style → performance → testing |
| `ci-monitor` | GitHub Actions monitoring, failure diagnosis, and build health management |
| `pr-management` | Full PR lifecycle — creation, review coordination, merging, and cleanup |
| `session-management` | Checkpointing, resumption, and cross-machine context transfer |
| `multi-agent` | Parallel agent orchestration using the docs-as-bus communication pattern |
| `paper-curation` | Research paper discovery, relevance scoring, and knowledge wiki ingestion |
| `research-loop` | Automated research workflow combining paper curation, ingestion, and visualization |

Skills are Markdown files with YAML frontmatter. Drop one in `skills/` and it's available immediately.

## Templates

| Template | What you get |
|:---|:---|
| `web-api` | REST API with auth, tests, CI pipeline, and API contracts |
| `frontend-app` | React/Angular dashboard with component library and design system |
| `infra-pipeline` | CI/CD pipelines, build system, and deployment configuration |
| `research-paper` | LaTeX paper with experiment tracking, datasets, and analysis |
| `multi-agent` | A2A agent orchestration with crew coordination and artifact bus |

```bash
devcontext create my-project --template web-api
```

---

## Example Scenario

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

---

## Tech Stack

| Component | Technology |
|:---|:---|
| Runtime | [Bun](https://bun.sh) (TypeScript, ESM) |
| CLI framework | [Commander.js](https://github.com/tj/commander.js) |
| Schema validation | [Ajv](https://ajv.js.org/) — JSON Schema Draft 2020-12 |
| Storage | GitHub repos (git-based sync, zero infrastructure) |
| Knowledge search | FTS5 via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| MCP server | [Model Context Protocol](https://modelcontextprotocol.io) (15 tools) |
| Skills format | Markdown + YAML frontmatter |
| Interactive prompts | [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) |
| Testing | Bun's built-in test runner (833 tests) |

## Portfolio Context

DevContext is part of a broader AI agent engineering portfolio:

| Project | What it does |
|:---|:---|
| [a2a-crews](https://github.com/aviraldua93/a2a-crews) | Multi-agent orchestration via Google's A2A protocol |
| [ag-ui-crews](https://github.com/aviraldua93/ag-ui-crews) | Agent ↔ Human real-time UI streaming |
| [rag-a2a](https://github.com/aviraldua93/rag-a2a) | Agent knowledge retrieval with RAG pipelines |
| [agent-traps-lab](https://github.com/aviraldua93/agent-traps-lab) | Adversarial testing and failure-mode analysis for agents |
| [wiki-vs-rag](https://github.com/aviraldua93/wiki-vs-rag) | Head-to-head evaluation of wiki vs. RAG approaches |
| [multi-agent-playbook](https://github.com/aviraldua93/multi-agent-playbook) | Patterns and anti-patterns for multi-agent systems |
| **devcontext** | **The developer productivity layer — you are here** |

---

## Inspiration & Credits

DevContext stands on the shoulders of three ideas:

- **[Andrej Karpathy](https://karpathy.ai/)** — The "compiled wiki" methodology. Knowledge as structured entities, not document dumps. DevContext's L2 layer is a direct implementation.
- **[MemPalace](https://github.com/codelahoma/mempalace)** — The layered memory architecture. The insight that different memory types (identity, story, reference) should have different retrieval costs. DevContext's L0–L4 stack is inspired by this approach.
- **[Elvis Saravia / DAIR.AI](https://github.com/dair-ai)** — Research paper curation as a first-class engineering activity. The paper discovery → scoring → ingestion pipeline draws from DAIR.AI's work on making ML research accessible.

The synthesis: **compiled knowledge for speed, semantic search for completeness, layered retrieval for token efficiency.** Each idea alone solves part of the problem. Together, they solve the whole thing.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/aviraldua93/devcontext.git
cd devcontext
bun install
bun test    # 833 tests across 33 files
```

## License

[MIT](LICENSE) © Aviral Dua
