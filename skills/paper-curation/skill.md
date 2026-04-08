---
name: paper-curation
description: Automated research paper discovery and knowledge compilation
version: "0.1.0"
source: root
tags: [research, papers, knowledge, curation]
---

# Paper Curation Skill

Automated research paper discovery, curation, and knowledge compilation.
Inspired by Elvis Saravia's (DAIR.AI) paper curation approach and
Karpathy's LLM Knowledge Base pattern.

## When to Use

- **Daily research curation** — run each morning to discover new papers in your areas of interest
- **Topic deep-dives** — search for papers on a specific topic before starting a new project
- **Knowledge compounding** — continuously ingest papers to build a growing knowledge wiki
- **Literature review** — systematically scan arXiv and Semantic Scholar for relevant work

## How to Execute

### Search for papers

```bash
# Search across arXiv and Semantic Scholar
wikirecall papers search "transformer attention mechanisms"

# Search with result limit
wikirecall papers search "retrieval augmented generation" --limit 20
```

### Run automated curation

```bash
# Curate papers based on your config (topics, keywords, thresholds)
wikirecall papers curate

# Curate with custom topic filter
wikirecall papers curate --topics "LLM,agents,RAG"
```

### Ingest papers into knowledge wiki

```bash
# Ingest a specific paper by ID
wikirecall papers ingest arxiv-2301-07041

# Batch ingest from last curation run
wikirecall papers ingest --all
```

## The Curation → Ingest → Compound Loop

1. **Discover** — Search arXiv and Semantic Scholar for papers matching your topics and keywords
2. **Score** — Rank papers by relevance (topic match, keyword match, recency, citation count)
3. **Filter** — Apply minimum relevance threshold and daily paper limit
4. **Ingest** — Convert top papers into knowledge entities with YAML frontmatter
5. **Link** — Auto-detect related entities and create backlinks
6. **Compound** — Over time, your knowledge wiki grows richer with interconnected concepts

## Tips for High-Signal Paper Finding

- **Be specific with topics** — "transformer attention" beats "machine learning"
- **Use multiple keywords** — combine technical terms: "flash attention", "efficient inference", "KV cache"
- **Set a high min relevance** — start with 0.3 and adjust based on signal-to-noise ratio
- **Limit papers per day** — 5-10 papers/day prevents information overload
- **Review the ingestion log** — check `knowledge/ingestion-log.md` to track what's been processed
- **Cross-reference sources** — papers found in both arXiv and Semantic Scholar tend to be higher quality
- **Watch citation counts** — high citations signal influential work, but don't ignore new papers

## Configuration

Set up your curation config in your scenario or use CLI flags:

```yaml
curation:
  topics: ["large language models", "retrieval augmented generation", "code generation"]
  keywords: ["transformer", "attention", "LLM", "RAG", "agent"]
  minRelevanceScore: 0.3
  maxPapersPerDay: 10
  sources: ["arxiv", "semantic-scholar"]
```

## Expected Outputs

- **Curated paper list** — ranked papers matching your topics and relevance threshold
- **Knowledge entities** — Markdown files with YAML frontmatter in the knowledge directory
- **Backlinks** — related entity cross-references updated automatically
- **Ingestion log** — `knowledge/ingestion-log.md` tracking all processed papers
