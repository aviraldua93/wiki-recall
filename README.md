<p align="center"><img src="hero.svg" alt="wiki-recall" width="800" /></p>

# wiki-recall

**Persistent memory for Copilot CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-2,291_passing-brightgreen)]()
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-10_tools-purple)](https://modelcontextprotocol.io)

| **~550 tokens** | **2,291 tests** | **93% hybrid recall** |
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

## Why wiki-recall

| | wiki-recall | Second Brain (Obsidian) | MemPalace | GBrain (Garry Tan) | Plain RAG |
|:---|:---|:---|:---|:---|:---|
| **Setup** | 15-min interview | Manual vault curation | Manual palace building | Manual brain writing | Dump everything |
| **Maintenance** | Automated (dream cycle) | Manual daily notes | Manual | Manual | None (and it shows) |
| **Token cost** | 550/query (hybrid routing) | N/A (not LLM-native) | Varies | Varies | 13,000+ (dump everything) |
| **Recall** | 93% (hybrid) | Depends on your notes | Depends on your palace | Depends on your brain | 45% (noise) |
| **LLM-native** | Yes (protocols + routing) | No (file sync) | No (memory technique) | Partially | Yes (but noisy) |
| **Learns from sessions** | Yes (harvest + dream) | No | No | No | Stores but doesn't learn |

**Before wiki-recall:** *"Explain the auth system, the retry handler, and why we chose Postgres over Mongo. Also who reviewed the last PR?"* Every. Single. Session.

**After wiki-recall:** Copilot already knows. brain.md loaded. Wiki compiled. Session history indexed. You just ask.

---

## How It Works

You open your terminal. `copilot-instructions.md` tells Copilot to read `brain.md`. Your identity and active work. ~300 tokens. Loaded every session. Your AI knows who you are, what you're working on, and what's blocked.

You ask: *"how does our retry handler work?"*

Architecture question. Routing sends it to the wiki. The project page loads on demand. The answer is already compiled: *"Exponential backoff, max 3 retries, jitter, then dead-letter queue."* No search needed. The wiki understood it.

You ask: *"what did we discuss about rate limiting last month?"*

The wiki doesn't have that -- never compiled. Session history search finds the exact conversation from months ago. The solution you forgot existed.

```
Question -> brain (always loaded) -> wiki (on demand) -> session history (fallback)
```

| Layer | What | When |
|:------|:-----|:-----|
| **Brain** | Identity + active work | Always loaded |
| **Wiki** | Compiled knowledge with citations | On demand |
| **Sessions** | Full session history search | When wiki has gaps |

The write-back loop makes this compound. You decide: *"Let's use WebSockets instead of polling."* Copilot asks: *"Save this decision?"* You say yes. Written to `decisions.md`. Next month, it's there. Knowledge accumulates instead of resetting.

Karpathy's wiki understands but can't recall. wiki-recall does both.

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

**Adopt an existing brain** — already have a `~/.grain/` or similar knowledge base?

```bash
wiki-recall init --adopt ~/.grain/
```

Non-destructive. Scans your directory, validates structure, adds missing pieces (RESOLVER.md, dream cycle, format upgrades) without overwriting. To upgrade a pre-wiki-recall brain to current format, run `wiki-recall heal --retrofit` (see below).

**Nightly enrichment** (dream cycle) — runs automatically at 2 AM if scheduled:

```bash
powershell -File scripts/dream.ps1            # manual run
powershell -File scripts/setup-scheduler.ps1  # register 2 AM schedule
```

The dream cycle sweeps for new entities, appends timeline updates, fixes missing citations, and consolidates stale compiled truth from raw session data.

---

## One Command to Rule Them All

```bash
wiki-recall heal
```

Five diagnostic checks find issues across structure, content, depth, duplication, and brain budget. Your Copilot session reads the protocol, interprets the diagnosis, and fixes what needs judgment. Python does plumbing. The LLM session does thinking. Zero subprocesses. Zero timeouts. Letter grade A-F per category.

```bash
python engine/hygiene.py --json   # diagnosis (plumbing)
# Then: "heal my brain"          # Copilot reads protocols/heal-protocol.md
```

`cargo clippy` for your knowledge base. Run it weekly.

---

## What It Auto-Captures

The #1 gap in every knowledge system: it relies on you to write things down. `harvest.py` mines your session history and extracts:

- **Decisions** — "decided to", "let's go with", "we're using"
- **Bug patterns** — "fixed by", "the fix was", "workaround:"
- **Project updates** — sessions mentioning known projects
- **New topics** — things not yet in your wiki
- **People pages** — auto-created from session mentions with compiled truth, working relationship, and timeline

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
Candidates are filtered by regex heuristics to reduce noise.

Beyond harvest, wiki-recall ships with:

- **Persona** — `persona.md` self-trains your voice. Say "that's not how I talk" and it corrects.
- **People routing** — say a first name, Copilot resolves it from `comms.md` instantly.
- **Enrichment tiers** — entities graduate tier 3 (stub) → 2 (notable) → 1 (deep) as data accumulates.
- **Tiered decisions** — Tier 1 behavioral → copilot-instructions.md. Tier 2 architectural → decisions.md + brain.md. Tier 3 historical → decisions.md only.
- **Path validation** — verifies every path in copilot-instructions.md exists on disk. Root cleanup enforces a 6-file budget.
- **Stale detection** — flags pages with outdated `last_verified` timestamps. Dead docs don't stay hidden.
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
wiki-recall heal                            # Diagnose + auto-fix everything
wiki-recall heal --fix                      # Apply smart-fixes (enrich, archive, rewrite)
wiki-recall heal --retrofit                 # Upgrade legacy brains
wiki-recall heal --json                     # Structured output for CI (includes page_scores)
```

```bash
python engine/harvest.py                    # Dry-run harvest
python engine/harvest.py --auto             # Write changes
python engine/indexer.py                    # Full reindex
python engine/indexer.py --incremental      # Incremental reindex
```

Under the hood, `heal` follows a markdown protocol: `protocols/heal-protocol.md` guides the LLM session through diagnosis (`hygiene.py` --json) -> judgment fixes -> verification. Python does plumbing. The LLM session does thinking. Per-page quality scores (DEEP/ADEQUATE/STUB/MISPLACED/PLACEHOLDER) inform which pages need attention.

**Scripts:** `setup.ps1` · `harvest.ps1` · `refresh.ps1` · `compact.ps1` · `backup.ps1` · `lint.ps1` · `hygiene.ps1` · `dream.ps1`

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
| TypeScript (Vitest) | 1,727 | 100% |
| Python (pytest) | 564 | 100% |
| **Total** | **2,291** | **100%** |

Stress-tested with: schema injection, FTS5 injection, SQL injection, concurrent CRUD, corrupt YAML, 10K-char queries, path traversal, harvest dedup, unicode, empty sessions.

```bash
bun test                   # TypeScript (1,727 tests)
python -m pytest tests/    # Python (564 tests)
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