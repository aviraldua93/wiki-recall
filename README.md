<p align="center"><img src="hero.svg" alt="Wiki Recall Hero" width="800" /></p>

# wiki-recall

**Compiled knowledge + layered recall for Copilot CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-10_tools-purple)](https://modelcontextprotocol.io)

| **~550** | **5 layers** | **10 MCP tools** |
|:---:|:---:|:---:|
| tokens to wake up | L0-L4 memory stack | search, recall, status |

[Quick Start](#quick-start) - [Architecture](#architecture) - [Engine](#python-engine) - [MCP Server](#mcp-server) - [Use Cases](#real-world-use-cases)

---

## The Problem

Every Copilot CLI session starts from scratch. You repeat context, re-explain decisions, and lose track of what you already figured out.

wiki-recall fixes this by compiling your session history into a persistent, structured knowledge base that loads automatically on every session start. It ships as a **template + engine**: the template creates your personal `~/.grain/` knowledge base, and the engine keeps it indexed and searchable.

---

## Architecture

```
~/.grain/                              (YOUR DATA - local only, never pushed)
|- brain.md                            L0+L1 hot cache (~550 tokens, every session)
|- actions.md                          Follow-ups, commitments, todos
|- decisions.md                        Things already decided (never re-debate)
|- wiki/
|  |- index.md                         Master catalog
|  |- projects/                        One page per project
|  |- patterns/                        Bugs, gotchas, workarounds
|  +- concepts/                        Tech concepts
|- domains/                            Domain context files (one per work area)
|- reference/                          Hard gates, multi-agent rules
|- engine/
|  |- chromadb/                        Semantic search index
|  +- .last_indexed                    Timestamp tracking
+- .obsidian/                          Vault config for graph view
```

### Memory Stack

| Layer | What | Size | When |
|:------|:-----|:-----|:-----|
| L0 - Identity | Core principles, persona | ~50 tokens | Always |
| L1 - Active Work | Status, top projects, recent decisions | ~500 tokens | Always |
| L2 - Compiled Wiki | Karpathy-style entities with citations | On demand | Domain-routed |
| L3 - Semantic Search | ChromaDB embeddings over session history | On demand | When wiki gaps exist |
| L4 - Raw Sessions | Full conversation replay | On demand | Reference only |

**L0 + L1 = ~550 tokens.** That is your wake-up cost. Everything else loads on demand.

---

## Quick Start

### Prerequisites
- Python 3.11+ with `pip`
- [Bun](https://bun.sh) (for TypeScript modules)
- Copilot CLI (for session history)

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/wiki-recall.git
cd wiki-recall

# Install Python engine dependencies
pip install chromadb pyyaml

# Install TypeScript dependencies
bun install

# Run the setup wizard - creates your personal ~/.grain/
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

The setup wizard will:
1. Ask your name, GitHub identities, and work domains
2. Create the `~/.grain/` directory structure
3. Generate `brain.md` with your L0 identity
4. Generate `copilot-instructions.md` for Copilot CLI
5. Index your existing session history (if available)
6. Open the Obsidian vault (if installed)

---

## Python Engine

The engine mines your Copilot CLI sessions and makes them searchable.

### Indexer (`engine/indexer.py`)

Reads the Copilot CLI session store, chunks conversations, and indexes them into ChromaDB alongside wiki pages and decisions.

```bash
python engine/indexer.py                # Full reindex
python engine/indexer.py --incremental  # Only new sessions
python engine/indexer.py --stats        # Show collection stats
```

### Search (`engine/search.py`)

Four search modes with automatic deduplication:

```python
from engine.search import GrainSearcher

s = GrainSearcher()
results = s.hybrid_search("why did we switch auth approach?")
# Combines: wiki keyword search + ChromaDB semantic + decisions search
```

### MCP Server (`engine/mcp_server.py`)

10-tool MCP server for Copilot CLI integration:

| Tool | What it does |
|:-----|:-------------|
| `grain_wake_up` | Load L0+L1 identity context (~550 tokens) |
| `grain_search` | Hybrid search (wiki + semantic + decisions) |
| `grain_recall` | Read a specific wiki page by topic |
| `grain_domains` | List all domain files |
| `grain_domain` | Read a specific domain file |
| `grain_decisions` | Search or list decisions |
| `grain_projects` | List all project wiki pages |
| `grain_patterns` | List all pattern pages |
| `grain_session` | Get session details by ID |
| `grain_status` | System health check |

```bash
# Start the MCP server
python -m engine

# Or add to your MCP config
# { "command": "python", "args": ["-m", "engine"], "transport": "stdio" }
```

---

## Scripts

| Script | What it does |
|:-------|:-------------|
| `scripts/setup.ps1` | Interactive onboarding wizard |
| `scripts/refresh.ps1` | Mine session_store - update brain.md Active Work |
| `scripts/compact.ps1` | Archive old brain.md entries, reset timestamps |
| `scripts/lint.ps1` | Wiki health check (orphans, stale pages, coverage) |

---

## TypeScript Modules

The repo also includes TypeScript modules for benchmarks, visual artifacts, and paper curation:

| Feature | Description |
|:--------|:------------|
| 5-Layer Memory | L0-L4 stack with automatic query routing |
| Paper Curation | arXiv + Semantic Scholar discovery, scoring, wiki ingestion |
| Visual Artifacts | Self-contained interactive HTML - graphs, clusters, timelines |
| Portable Scenarios | Save/recall working state across machines via git |
| Schema Validation | JSON Schema Draft 2020-12 via Ajv |

```bash
bun test          # Run all TypeScript tests
bun run build     # Build CLI binary
```

---

## Key Design Decisions

These emerged from 6 expert reviews and 18 simulation tests:

- **Instructions file < 60 lines** - Copilot CLI truncates longer files
- **brain.md < 550 tokens** - L0+L1 only; everything else on-demand
- **Write-back is direct-with-ask** - no staging area (too much friction)
- **Proactive feedback loop** - Copilot asks "save this decision?" without being prompted
- **Session IDs link wiki to raw data** - full traceability

---

## Real-World Use Cases

How this actually plays out in daily use.

### Monday Morning Cold Start

```
# You open terminal. Haven't touched this project in 2 weeks.
# brain.md auto-loads with your session. ~430 tokens.

> "What was I working on?"

# Copilot already knows:
# - Your 3 active projects and their status
# - The PR you left open
# - The decision you made about retry logic
# - The blocker waiting on a teammate

# Zero context dump. Zero "let me search my notes."
# You're productive in 30 seconds.
```

### Cross-Project Pattern Recognition

```
# You hit a rate-limiting bug in Project B.
# You vaguely remember solving something similar in Project A.

> "Have I dealt with rate limiting before?"

# L3 semantic search finds the conversation from 3 months ago:
# "We used exponential backoff with jitter, max 3 retries,
#  then dead-letter queue. Decided 2025-11-03."

# The exact solution. From a session you forgot existed.
```

### The Proactive Feedback Loop

```
# During a conversation, you make a design decision:
> "Let's use WebSockets instead of polling for the dashboard"

# Copilot proactively asks:
> "Save this decision? WebSockets over polling for dashboard updates."

# You say "yes". Written directly to decisions.md.
# Next month, when someone asks "why WebSockets?", it's there.
# No staging. No review folder. Conversation IS the review.
```

### Onboarding a New Team Member

```
# New engineer joins. You hand them the wiki-recall setup:

wiki-recall setup
# → Asks their name, GitHub, work domains
# → Creates ~/.grain/ with empty brain.md
# → Generates copilot-instructions.md

# Day 1: they have the structure.
# Week 1: brain.md has their first 5 projects.
# Month 1: 50+ wiki entities, patterns emerging.
# Month 3: their AI knows their domain better than most teammates.
```

### Research Paper Deep Dive

```
wiki-recall papers curate --topics "multi-agent,orchestration" --max 10
# → Finds papers from arXiv + Semantic Scholar, scores by relevance

wiki-recall papers ingest arxiv-2301-07041
# → Creates wiki entity with key concepts, citations, cross-references
# → After 15 papers: structured wiki with connections, zero manual summaries
```

### The "20x Productivity" Effect

After 2 weeks of use, you stop explaining things. `brain.md` already loaded your project context. The wiki has your architecture decisions. The AI knows your testing patterns. You talk less. You ship more.

---

## Separation: Template vs Data

| | wiki-recall (this repo) | ~/.grain/ (your machine) |
|:--|:--|:--|
| **Contains** | Engine code, templates, scripts | Your personal brain, wiki, decisions |
| **Pushed to** | GitHub (public) | Nowhere (local only) |
| **PII** | None - all placeholders | Your name, projects, context |

The setup wizard generates your personal `~/.grain/` from the templates. The engine code runs against your local data. **Data never flows out.**

---

## Inspiration

Built on three proven patterns:

1. **[Andrej Karpathy](https://karpathy.ai/)** - Compile knowledge into structured entities, don't re-derive it. The L2 wiki layer is a direct implementation.
2. **[MemPalace](https://github.com/codelahoma/mempalace)** - Different memory types deserve different retrieval costs. The L0-L4 layered stack draws from this insight.
3. **[Second Brain (NicholasSpisak)](https://github.com/NicholasSpisak)** - Skill-based packaging with ingest/query/lint operations.

---

## License

[MIT](LICENSE)