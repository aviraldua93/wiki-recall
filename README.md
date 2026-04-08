# 🧠 wiki-recall

**The hybrid no one else built. Compiled knowledge + layered recall.**

[![CI](https://github.com/aviraldua93/wiki-recall/actions/workflows/ci.yml/badge.svg)](https://github.com/aviraldua93/wiki-recall/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-1,060_passing-brightgreen)](https://github.com/aviraldua93/wiki-recall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-15_tools-purple)](https://modelcontextprotocol.io)

| **98.4%** | **1,060** | **~550** |
|:---:|:---:|:---:|
| token savings vs dump-everything | tests passing | tokens to wake up |

[Quick Start](#quick-start) · [Memory Stack](#the-approach) · [Benchmarks](#benchmarks) · [MCP Server](#mcp-server)

---

## The Problem

Every knowledge system makes the same bet. Either you compile what you know into structured documents and accept that anything not compiled is gone forever, or you index every raw conversation and pray that search finds the right needle in a haystack of noise.

**The first approach understands but can't remember. The second remembers but doesn't understand.** Every existing tool picks a side. wiki-recall doesn't.

The insight is simple: these aren't competing strategies. They're complementary layers. A compiled wiki gives you fast, structured understanding at low token cost. A semantic search layer catches everything the wiki missed. Stack them, route queries to the right layer automatically, and you get a memory system that both understands and recalls.

---

## The Approach

It starts with your identity — about 50 tokens. Who you are, how you think, your core principles. That's L0. It loads every single time, no exceptions.

On top of that sits your essential story — another 500 tokens. What you're working on right now, your top moments, active projects. That's L1. Also always loaded. **L0 + L1 together cost ~550 tokens.** That's your wake-up cost. Compare that to the 1,500+ token context dumps most tools shove into every request.

The interesting part starts at L2. This is the compiled wiki — Karpathy-style structured entities. Mental models, architectural decisions, recurring patterns. Each entry is a Markdown file with YAML frontmatter, source citations, contradiction tracking, and lifecycle status. It doesn't load unless the query's domain calls for it.

L3 is the safety net. BM25 and FTS5 search over your full session history. **It finds what the wiki doesn't know yet.** If you talked about something three months ago but never compiled it, L3 catches it.

L4 is raw session replay. Full conversations, pulled by session ID. You almost never need it, but when you do, it's there.

| Layer | What | Size | When |
|:------|:-----|:-----|:-----|
| L0 — Identity | Core principles, persona | ~50 tokens | Always |
| L1 — Essential Story | Status, top moments, active work | ~500 tokens | Always |
| L2 — Compiled Wiki | Entities, decisions, patterns | On demand | Domain-routed |
| L3 — Semantic Search | BM25/FTS5 over session history | On demand | When wiki gaps exist |
| L4 — Raw Sessions | Full conversation replay | On demand | Reference only |

The router picks the layers. You don't.

---

## Why the Hybrid Matters

Karpathy's wiki understands your codebase but can't recall a conversation you had three months ago. MemPalace recalls every word but doesn't understand what any of it means. **wiki-recall does both.** Compiled knowledge for structure, semantic search for coverage, layered routing so you never pay for what you don't need.

---

## Quick Start

```bash
git clone https://github.com/aviraldua93/wiki-recall.git
cd wiki-recall && bun install && bun link
wiki-recall init
wiki-recall create my-api --template web-api
# ✓ Scenario created: my-api (web-api template, 3 skills loaded)
```

---

## Benchmarks

The ablation tells the story. Wiki-only misses anything not yet compiled. Search-only drowns in noise. **The hybrid closes the gap on both sides.**

| Approach | Recall | Tokens | Understands? | Searches? |
|:---------|:------:|:------:|:------------:|:---------:|
| Wiki only (Karpathy) | ~60% | Low | Yes | No |
| Search only (RAG) | ~45% | High | No | Yes |
| **Hybrid (wiki-recall)** | **~93%** | **Low** | **Yes** | **Yes** |

All benchmarks use reproducible seeded mock data. Zero API costs. Scales to 1,000 entities with zero degradation.

---

## What's Inside

| Feature | Description |
|:--------|:------------|
| 5-Layer Memory | L0–L4 stack with automatic query routing |
| Compiled Wiki | Karpathy-style entities with citations and lifecycle tracking |
| Semantic Search | BM25 + FTS5 over full session history |
| Portable Scenarios | Save/recall working state across machines via git |
| Paper Curation | arXiv + Semantic Scholar discovery, scoring, wiki ingestion |
| Visual Artifacts | Self-contained interactive HTML — graphs, clusters, timelines |
| MCP Server | 15 tools for any LLM or IDE |
| Team Handoffs | Push scenarios as PRs, pull on any machine |
| Schema Validation | JSON Schema Draft 2020-12 via Ajv |
| FTS5 Search | Full-text search over all stored knowledge |

---

## Paper Curation

Automated discovery from arXiv and Semantic Scholar. Papers are scored on a 0–1 relevance scale, deduplicated, and **ingested directly into the wiki as structured entities** — not dumped into a folder.

```bash
wiki-recall papers curate --topics "agents,retrieval" --min-score 0.3
wiki-recall papers ingest arxiv-2301-07041
```

---

## Visual Artifacts

Generate self-contained interactive HTML visualizations — knowledge graphs, topic clusters, research landscapes. **No external dependencies, no server required.** Open the file and explore.

```bash
wiki-recall visualize --type knowledge-graph --output graph.html
```

---

## MCP Server

15 tools. Connect once, your AI handles the rest.

Knowledge management, scenario ops, memory queries, paper curation, and visualization — all exposed via the [Model Context Protocol](https://modelcontextprotocol.io).

```bash
claude mcp add wikirecall -- wikirecall mcp
```

---

## Built-in Skills

| Skill | What it does |
|:------|:-------------|
| `code-review` | Five-layer review: security → correctness → style → performance → testing |
| `ci-monitor` | GitHub Actions monitoring and failure diagnosis |
| `pr-management` | Full PR lifecycle — creation, review, merging |
| `session-management` | Checkpointing and cross-machine context transfer |
| `multi-agent` | Parallel agent orchestration via docs-as-bus |

---

## Templates

| Template | What you get |
|:---------|:-------------|
| `web-api` | REST API with auth, tests, CI, and contracts |
| `frontend-app` | Dashboard with component library and design system |
| `infra-pipeline` | CI/CD, build system, and deploy config |
| `research-paper` | LaTeX paper with experiment tracking |
| `multi-agent` | A2A orchestration with crew coordination |

---

## Inspiration

wiki-recall stands on three ideas. [Andrej Karpathy](https://karpathy.ai/) showed that knowledge belongs in structured entities, not document dumps — the L2 layer is a direct implementation of that methodology. [MemPalace](https://github.com/codelahoma/mempalace) proved that different memory types deserve different retrieval costs — the L0–L4 layered stack draws from that insight. [Elvis Saravia / DAIR.AI](https://github.com/dair-ai) made research paper curation a first-class engineering activity — the discovery → scoring → ingestion pipeline builds on that work.

---

## License

[MIT](LICENSE) © Aviral Dua
