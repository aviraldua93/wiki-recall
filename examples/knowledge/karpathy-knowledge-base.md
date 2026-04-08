---
title: "Karpathy-Style LLM Knowledge Base"
type: concept
updated: "2025-06-15"
created: "2025-06-01"
tags:
  - knowledge-management
  - llm
  - rag-alternative
  - karpathy
  - prompt-engineering
related:
  - a2a-protocol
sources:
  - karpathy-blog-post.md
source_count: 1
status: reviewed
---

## What It Is

Andrej Karpathy popularized a knowledge management approach where instead of using RAG (retrieval-augmented generation) to feed context to LLMs, you curate a structured wiki of knowledge entities — concise, opinionated Markdown documents that an LLM can read in full. Each entity captures the mental model a human expert carries: what something is, how it works, common patterns, pitfalls, and relationships to other concepts.

## The 7-Step System

1. **Folder structure**: `raw/`, `wiki/`, `outputs/`, `CLAUDE.md` schema file
2. **Schema file** (CLAUDE.md): Identity, Architecture, Wiki Conventions (YAML frontmatter, wikilinks, source citations, contradiction flags), Index & Log, Ingest/Query/Lint workflows, Focus Areas
3. **Raw folder dumping**: Use Obsidian Web Clipper or similar to dump sources — no organizing
4. **Ingest prompt**: Read source → discuss → create summary → update index → update ALL relevant pages → add backlinks → flag contradictions → log
5. **Query prompt**: Read index → find pages → synthesize with citations → file answers back
6. **Monthly lint**: Check for contradictions, stale claims, orphans, missing cross-refs, uncited claims
7. **Compounding**: File exploration outputs back, visual outputs, git version control

## The 6 Prompts

1. **INGEST**: Process a single source document into wiki pages
2. **INGEST (batch)**: Process multiple sources in one session
3. **QUERY**: Answer a question using the wiki knowledge base
4. **LINT**: Validate and clean up the wiki
5. **EXPLORE**: Interactively explore and synthesize across the wiki
6. **BRIEF**: Generate a concise summary of wiki state and recent changes

## YAML Frontmatter Convention

```yaml
---
title: "Page Title"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
source_count: N
status: draft | reviewed | needs_update
---
```

## Source Citations

Every factual claim traces back to a source: `[Source: filename.md]`

## Contradiction Flags

When new information conflicts with existing wiki content:
```
> CONTRADICTION: [existing claim] vs [new claim] from [Source: filename.md]
```

## Wiki Structure

- `wiki/index.md` — Lists every page with one-line description, organized by category
- `wiki/log.md` — Append-only chronological log: `## [YYYY-MM-DD] action | Description`
- Ingest should touch 10-15 wiki pages per source (not just create one page)

## Key Principles

- **Human-curated over auto-generated**: Each entity is written or reviewed by a domain expert. The signal-to-noise ratio far exceeds auto-scraped documentation or raw embeddings.
- **Fits in context window**: Entities are sized to be loaded entirely into an LLM's context. No chunking, no retrieval ranking ambiguity — the model sees the complete mental model.
- **Opinionated and practical**: Entities include "best practices" and "anti-patterns" sections — the kind of knowledge that only exists in senior engineers' heads, not in official docs.
- **Relationship graph**: Entities reference each other via `related` fields, forming a navigable knowledge graph. An LLM can follow links to gather multi-hop context.
- **Living documents**: Entities have `updated` dates and are maintained as part of the development workflow, not a separate documentation effort.
- **Compounding returns**: Query answers are filed back into the wiki, making it grow smarter with use.

## Known Limitations

- **Context ceiling**: ~400K words practical limit for wiki size
- **Error compounding**: LLM compilation errors propagate across interlinked pages
- **Hallucination**: Compiled pages may contain LLM-fabricated claims
- **Cost**: $2-5 per source document compilation
- **No enterprise scale**: Single-user, single-model architecture
- **Single-model blind spots**: One LLM's biases shape the entire wiki

## Structure of a Knowledge Entity

A well-formed entity follows a consistent structure:

1. **Frontmatter** — YAML metadata: title, type, updated date, tags, related entities
2. **What It Is** — One-paragraph definition accessible to someone unfamiliar with the topic
3. **Key Concepts** — Bulleted list of essential terms and their definitions
4. **Common Patterns** — How the thing is typically used in practice, with code examples
5. **Anti-Patterns / Pitfalls** — What to avoid and why
6. **Related Work** — Links to adjacent concepts, alternatives, and complementary tools

## When Wiki Beats RAG

- **Small, stable knowledge domains** — when the corpus fits in context and changes infrequently, RAG's retrieval overhead adds latency without improving quality.
- **Highly opinionated knowledge** — best practices, architecture decisions, team conventions. These are poorly served by embedding similarity search.
- **Multi-hop reasoning** — when answering a question requires synthesizing information from multiple related concepts. Wiki entities with explicit relationships support this better than isolated retrieved chunks.
- **Consistency requirements** — wiki entries are reviewed for accuracy and consistency. RAG over unreviewed documents can surface contradictory information.

## When RAG Beats Wiki

- **Large, dynamic corpora** — thousands of documents that change frequently. Manual curation doesn't scale.
- **Long-tail factual recall** — specific dates, numbers, API parameters buried in documentation. Embedding search excels at locating these needles.
- **User-specific context** — when the relevant knowledge depends on who is asking (their project, their codebase). RAG can retrieve personalized context.
- **Freshness requirements** — when information changes daily (e.g., dependency changelogs, security advisories). Auto-indexed RAG stays current without human effort.

## Hybrid Approach

The most effective systems combine both: a curated wiki for core domain knowledge (architecture, patterns, conventions) plus RAG for long-tail facts (API references, changelogs, issue history). The wiki provides the reasoning framework; RAG fills in specific details.

## Relevance to WikiRecall

WikiRecall's knowledge entities are a direct implementation of the Karpathy approach. Each entity is a Markdown file with YAML frontmatter, sized for context window loading, and connected via `related` fields. Scenarios select which entities to load, giving the LLM a curated mental model for the specific work at hand — rather than searching the entire knowledge base for every query.

## Related Work

- WikiRecall knowledge entity format — the implementation of this approach in the WikiRecall project
- RAG (Retrieval-Augmented Generation) — the complementary approach that WikiRecall's wiki-vs-rag benchmark evaluates
- Zettelkasten method — a pre-digital knowledge management system with similar principles of atomic, linked notes
