---
title: "Karpathy-Style LLM Knowledge Base"
type: concept
updated: "2025-06-15"
tags:
  - knowledge-management
  - llm
  - rag-alternative
  - karpathy
  - prompt-engineering
related:
  - a2a-protocol
---

## What It Is

Andrej Karpathy popularized a knowledge management approach where instead of using RAG (retrieval-augmented generation) to feed context to LLMs, you curate a structured wiki of knowledge entities — concise, opinionated Markdown documents that an LLM can read in full. Each entity captures the mental model a human expert carries: what something is, how it works, common patterns, pitfalls, and relationships to other concepts.

## Key Principles

- **Human-curated over auto-generated**: Each entity is written or reviewed by a domain expert. The signal-to-noise ratio far exceeds auto-scraped documentation or raw embeddings.
- **Fits in context window**: Entities are sized to be loaded entirely into an LLM's context. No chunking, no retrieval ranking ambiguity — the model sees the complete mental model.
- **Opinionated and practical**: Entities include "best practices" and "anti-patterns" sections — the kind of knowledge that only exists in senior engineers' heads, not in official docs.
- **Relationship graph**: Entities reference each other via `related` fields, forming a navigable knowledge graph. An LLM can follow links to gather multi-hop context.
- **Living documents**: Entities have `updated` dates and are maintained as part of the development workflow, not a separate documentation effort.

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

## Relevance to DevContext

DevContext's knowledge entities are a direct implementation of the Karpathy approach. Each entity is a Markdown file with YAML frontmatter, sized for context window loading, and connected via `related` fields. Scenarios select which entities to load, giving the LLM a curated mental model for the specific work at hand — rather than searching the entire knowledge base for every query.

## Related Work

- DevContext knowledge entity format — the implementation of this approach in the DevContext project
- RAG (Retrieval-Augmented Generation) — the complementary approach that DevContext's wiki-vs-rag benchmark evaluates
- Zettelkasten method — a pre-digital knowledge management system with similar principles of atomic, linked notes
