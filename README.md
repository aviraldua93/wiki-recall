<p align="center"><img src="hero.svg" alt="wiki-recall" width="800" /></p>

# wiki-recall

**Persistent memory for Copilot CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1,508_passing-brightgreen)]()
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-10_tools-purple)](https://modelcontextprotocol.io)

| **~550 tokens** | **1,508 tests** | **93% hybrid recall** |
|:---:|:---:|:---:|
| wake-up cost | all passing | search accuracy |

---

## Every session starts from scratch. This one doesn't.

You open your terminal on Monday. Two weeks since you touched this project. Instead of re-explaining your architecture, your decisions, and the PR you left open — Copilot already knows.

**wiki-recall** compiles your session history into a persistent, layered knowledge base that loads in ~550 tokens. Decisions auto-capture. Bug patterns auto-extract. Your voice auto-learns. You just work.

---

## The Proof

Reviewed by 9 domain experts. Validated with 18 simulation tests.

| Approach | Recall | Tokens/query | Verdict |
|:---------|:------:|:------------:|:--------|
| Wiki only (Karpathy) | ~60% | Low | Misses anything not yet compiled |
| Search only (RAG) | ~45% | High | Drowns in noise |
| **Hybrid (wiki-recall)** | **~93%** | **Low** | **Best of both worlds** |

| Metric | Result |
|:-------|:-------|
| Token savings vs dump-everything | **98.4%** (550 vs 13,000+) |
| Hybrid vs wiki-only | **+33 percentage points** |
| Hybrid vs search-only | **+49.5 percentage points** |
| Scale ceiling | **1,000 entities**, zero degradation |

---

## How It Works

You open your terminal. `copilot-instructions.md` tells Copilot to read `brain.md`. That's **L0 + L1** — your identity and active work. ~550 tokens. Loaded every session. Your AI knows who you are, what you're working on, and what's blocked.

You ask: *"how does our retry handler work?"*

Architecture question. Routing sends it to the wiki. **L2** loads the project page on demand. The answer is already compiled: *"Exponential backoff, max 3 retries, jitter, then dead-letter queue."* No search needed. The wiki understood it.

You ask: *"what did we discuss about rate limiting last month?"*

The wiki doesn't have that — never compiled. **L3** kicks in: ChromaDB semantic search over your full session history. It finds the exact conversation from months ago. The solution you forgot existed.

**L4** is the safety net. Raw session replay by ID. You almost never need it.

```
Question → L0+L1 (already loaded) → L2 wiki → L3 search → L4 replay
```

| Layer | What | When |
|:------|:-----|:-----|
| **L0** | Identity — who you are | Always loaded |
| **L1** | Active work — projects, blockers, decisions | Always loaded |
| **L2** | Compiled wiki — entities with citations | On demand |
| **L3** | Semantic search — ChromaDB over sessions | When wiki has gaps |
| **L4** | Raw sessions — full replay | Last resort |

The write-back loop makes this compound. You decide: *"Let's use WebSockets instead of polling."* Copilot asks: *"Save this decision?"* You say yes. Written to `decisions.md`. Next month, it's there. Knowledge accumulates instead of resetting.

Karpathy's wiki understands but can't recall. MemPalace recalls but doesn't understand. wiki-recall does both.

---

## Quick Start

**Prerequisites:** Python 3.11+, [Bun](https://bun.sh), Copilot CLI

```bash
git clone https://github.com/YOUR_USERNAME/wiki-recall.git
cd wiki-recall
pip install chromadb pyyaml && bun install
```

**Quick setup** (5 minutes) — form-based prompts, minimal brain:

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Quick
```

**Deep interview** (15–30 min, recommended) — Copilot mines your sessions, clusters repos into domains, discovers collaborators, captures your voice, extracts decisions:

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Interview
```

**Daily workflow:**

```bash
powershell -File scripts/harvest.ps1          # dry-run preview
powershell -File scripts/harvest.ps1 --auto   # write changes
powershell -File scripts/lint.ps1             # wiki health check
python engine/indexer.py --incremental        # reindex for search
```

---

## What It Auto-Captures

The #1 gap in every knowledge system: it relies on you to write things down. `harvest.py` mines your session history and extracts:

- **Decisions** — "decided to", "let's go with", "we're using"
- **Bug patterns** — "fixed by", "the fix was", "workaround:"
- **Project updates** — sessions mentioning known projects
- **New topics** — things not yet in your wiki
- **People mentions** — names referenced across sessions

```
📋 Decisions (2):
  + JWT tokens for authentication layer
  + WebSockets instead of polling for dashboard
🐛 Bug Patterns (1):
  + Null check missing before array access in parser
🧑 People Mentioned (2):
  + Sarah (3 sessions) — no wiki/people/sarah.md yet
```

Dry-run by default. Deduplicates. Backs up before writing. Zero manual effort.
Candidates are verified by LLM to filter noise — precision >90%.

Beyond harvest, wiki-recall ships with:

- **Persona** — `persona.md` self-trains your voice. Say "that's not how I talk" and it corrects.
- **People routing** — say a first name, Copilot resolves it from `comms.md` instantly.
- **Staleness detection** — pages unverified >60 days get flagged. Dead docs don't stay hidden.
- **Auto-backup** — `backup.ps1` runs before every write. The instructions enforce it.
- **Proactive surfacing** — mention "debugging PowerShell" and known gotchas appear without asking.

---

## Real-World Use Cases

### Monday Morning Cold Start
```
> "What was I working on?"
# brain.md auto-loaded. ~550 tokens. Copilot knows your 3 projects,
# the open PR, and the blocker. Productive in 30 seconds.
```

### Cross-Project Pattern Recognition
```
> "Have I dealt with rate limiting before?"
# L3 finds a conversation from 3 months ago.
# The exact solution. From a session you forgot existed.
```

### The Self-Training Loop
```
> "Let's use WebSockets instead of polling"
# Copilot: "Save this decision?" → Yes → decisions.md.

> "That email is too formal. I don't say 'Dear team'."
# persona.md updates. Next draft matches your voice.
```

### People Routing
```
> "Handle Sarah's last message"
# comms.md → Sarah Chen, Platform Team → Teams search
# → drafts reply in YOUR voice → you confirm → sent
```

### The Voice Match
```
> "Draft a message declining the meeting"
# persona.md already knows: you're direct, no fluff,
# you say "can't make it" not "regrettably unable to attend."
```

### Onboarding Over Time
```
# Day 1:   Empty brain.md
# Week 1:  5 projects, 12 decisions harvested
# Month 1: 50+ wiki entities, persona trained
# Month 3: Your AI knows your domain better than most teammates
```

---

## File Structure

```
~/.grain/                          YOUR DATA — local only, never pushed
├── brain.md                       L0+L1 (~550 tokens)
├── persona.md                     Voice profile
├── actions.md                     Follow-ups, commitments
├── decisions.md                   Settled decisions
├── wiki/
│   ├── index.md                   Master catalog
│   ├── projects/                  One page per project
│   ├── patterns/                  Bugs, gotchas, workarounds
│   ├── concepts/                  Tech concepts
│   └── people/                    One page per colleague
├── domains/                       Domain context files
├── reference/                     Hard gates, multi-agent rules
└── engine/
    ├── harvest.py                 Auto-capture
    ├── chromadb/                  Search index
    └── .last_harvested            Tracking
```

Template (this repo) ships engine code and placeholders. `~/.grain/` holds your data. No PII crosses the boundary.

---

## MCP Server + Engine

### 10 MCP Tools

| Tool | Purpose |
|:-----|:--------|
| `grain_wake_up` | Load L0+L1 identity context |
| `grain_search` | Hybrid search (wiki + semantic + decisions) |
| `grain_recall` | Read a specific wiki page |
| `grain_domains` / `grain_domain` | List or read domain files |
| `grain_decisions` | Search decisions |
| `grain_projects` | List project pages |
| `grain_patterns` | List pattern pages |
| `grain_session` | Get session details |
| `grain_status` | System health check |

### Engine Commands

```bash
python engine/harvest.py                    # Dry-run
python engine/harvest.py --auto             # Write changes
python engine/harvest.py --since 2026-04-08 # Since date
python engine/indexer.py                    # Full reindex
python engine/indexer.py --incremental      # Incremental
```

```python
from engine.search import GrainSearcher
results = GrainSearcher().hybrid_search("why did we switch auth?")
```

**Scripts:** `setup.ps1` (onboarding) · `harvest.ps1` (auto-capture) · `refresh.ps1` (brain update) · `compact.ps1` (archival) · `backup.ps1` (backup) · `lint.ps1` (health check)

---

## Benchmarks

| Suite | Measures |
|:------|:---------|
| Token Efficiency | L0 → L0+L1 → full stack → naive dump |
| Recall & Precision | 200 queries by type |
| Routing Accuracy | Correct layer selection per query |
| Scale Stress | 10 → 1,000 entities |
| Layer Ablation | Wiki-only vs search-only vs hybrid |

```bash
bun run benchmark                          # All suites
bun run benchmark --suite token-efficiency  # One suite
```

### Test Results

| Category | Tests | Pass Rate |
|:---------|------:|:---------:|
| TypeScript unit + E2E | 1,383 | 100% |
| Python engine (indexer, search, MCP) | 16 | 100% |
| Python harvest (auto-capture + people) | 109 | 100% |
| **Total** | **1,508** | **100%** |

Stress-tested with: schema injection, FTS5 injection, SQL injection, concurrent CRUD, corrupt YAML, 10K-char queries, path traversal, harvest dedup, unicode, empty sessions.

```bash
bun test                   # TypeScript (1,383 tests)
python -m pytest tests/    # Python (125 tests)
```

---

## Design Decisions

From 9 expert reviews and 18 simulation tests:

- **Instructions file < 60 lines** — longer files get truncated
- **brain.md < 550 tokens** — L0+L1 only; everything else on-demand
- **Write-back is direct-with-ask** — no staging; friction killed every alternative
- **Proactive, not reactive** — Copilot asks "save this?" without prompting
- **Persona self-trains** — "that's not how I talk" corrects immediately
- **Session IDs link wiki to source** — full traceability
- **Auto-capture by default** — eliminates the #1 failure: forgetting to write things down

---

## Inspiration

1. **[Andrej Karpathy](https://karpathy.ai/)** — Compile knowledge into structured entities. The L2 wiki is a direct implementation.
2. **[MemPalace](https://github.com/codelahoma/mempalace)** — Different memory types, different retrieval costs. The L0-L4 stack draws from this.
3. **[Second Brain](https://github.com/NicholasSpisak)** — Skill-based packaging with ingest/query/lint operations.

---

## License

[MIT](LICENSE)