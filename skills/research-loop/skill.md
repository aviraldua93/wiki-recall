---
name: research-loop
description: Automated research discovery, ingestion, and insight surfacing
version: "0.1.0"
source: root
tags: [research, automation, knowledge, loop]
---

# Research Loop Skill

A structured approach to continuous research discovery and knowledge compounding. The research loop automates the cycle of discovering relevant sources, ingesting them into your knowledge base, querying for insights, and surfacing connections you wouldn't find manually.

## When to Use

Use this skill when you need to:

- **Build expertise in a new domain** — systematically discover and ingest key papers, tools, and concepts
- **Stay current on fast-moving topics** — set up recurring discovery sweeps across sources
- **Surface hidden connections** — find relationships between entities that span different domains or time periods
- **Prepare for deep work** — front-load research ingestion so your knowledge base compounds before you start building
- **Audit knowledge gaps** — identify areas where your entity coverage is thin relative to the topic's importance

The research loop is most valuable when your knowledge base has 20+ entities and you want to move from manual curation to systematic compounding.

## How to Execute

Run the research loop phases in order:

```bash
# Discover new sources
wikirecall knowledge search "<topic>"

# Ingest discovered sources
wikirecall knowledge create --title "<entity>" --type concept --tags "<tags>"

# Query for insights
wikirecall knowledge search "<query>"
```

## The Loop: Discover → Ingest → Query → Compound

### Phase 1 — Discover

Identify new sources of knowledge relevant to your active scenarios.

1. **Sweep existing entities** — look at `related` fields and `[[wikilinks]]` for references you haven't ingested yet
2. **Search by tags** — use `wikirecall knowledge search` to find clusters with few entities (potential gaps)
3. **External sources** — check arXiv, GitHub trending, blog aggregators, and conference proceedings for topics matching your tags
4. **Stakeholder signals** — review recent PRs, issues, and discussions for emerging concepts not yet captured

Output: A ranked list of candidate sources, each with a one-line description and relevance score (1–5).

### Phase 2 — Ingest

Transform raw sources into structured knowledge entities.

1. **Create entities** for each high-relevance source:
   ```bash
   wikirecall knowledge create --title "Concept Name" --type concept --tags "tag1,tag2"
   ```
2. **Write content** using Karpathy-style mental models:
   - What it is (1–2 sentences)
   - Why it matters (context in your domain)
   - How it connects (link to existing entities via `related` and `[[wikilinks]]`)
   - Open questions (what you don't know yet)
3. **Cross-link aggressively** — every new entity should reference 2–3 existing entities
4. **Tag consistently** — use existing tags before creating new ones

### Phase 3 — Query

Use search and visualization to surface patterns.

1. **Full-text search** — `wikirecall knowledge search "query"` to find entities by content
2. **Visualize the graph** — `wikirecall visualize` to see the network topology
   - Isolated nodes = poorly connected knowledge (needs more links)
   - Dense clusters = well-understood areas
   - Bridge nodes = key concepts connecting different domains
3. **Topic clusters** — `wikirecall visualize --type topic-clusters` to find tag imbalances
4. **Timeline view** — `wikirecall visualize --type timeline` to track knowledge growth rate

### Phase 4 — Compound

Let accumulated knowledge generate new insights.

1. **Identify bridge opportunities** — entities in different clusters that should be connected
2. **Write synthesis entities** — create "concept" entities that connect multiple domains:
   - "Retry Patterns + Circuit Breakers" → new entity: "Resilience Architecture"
   - "OAuth2 + RBAC" → new entity: "Authorization Patterns"
3. **Update existing entities** with new context from recent additions
4. **Generate the research landscape** — `wikirecall visualize --type research-landscape` for a full dashboard
5. **Archive stale entities** — mark entities with `status: needs_update` if they haven't been revised in 90+ days

## Setting Up Automated Curation

### Daily sweep (5 minutes)

```bash
# Check for entities updated today
wikirecall knowledge list | grep "$(date +%Y-%m-%d)"

# Generate fresh graph
wikirecall visualize --output ./daily-graph.html
```

### Weekly review (30 minutes)

1. Run the full research landscape: `wikirecall visualize --type research-landscape --output ./weekly-review.html`
2. Open the dashboard and identify:
   - New clusters forming
   - Isolated nodes needing connections
   - Stale clusters with no recent updates
3. Create 3–5 new entities from the discovery phase
4. Update 2–3 existing entities with fresh connections

### Monthly audit (1 hour)

1. Export the full entity list and review coverage
2. Compare entity count growth month-over-month
3. Identify the top 5 most-connected entities (your knowledge hubs)
4. Write one synthesis entity that connects your most active clusters
5. Archive any entities that are no longer relevant

## Expected Outputs

After running a research loop cycle, you should have:

- **New entities**: 3–10 new knowledge entities per cycle
- **Updated links**: 5–15 new cross-references between existing entities
- **Visualization**: An updated knowledge graph showing the current state
- **Gap analysis**: A list of topics that need deeper coverage
- **Synthesis notes**: At least one new entity connecting previously separate clusters

## Tips

- **Start small** — begin with 10 entities and grow organically
- **Prefer depth over breadth** — 5 well-connected entities beat 20 isolated ones
- **Use wikilinks liberally** — `[[entity-name]]` in content creates implicit graph edges
- **Review the graph weekly** — visual patterns reveal gaps your linear reading misses
- **Tag taxonomy matters** — keep tags to 10–15 core categories, merge similar ones
