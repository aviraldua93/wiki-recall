# RESOLVER — Where Does This Go?

When new knowledge arrives, file it here:

1. Is it about a **PERSON**? → wiki/people/<name>.md
2. Is it about a **PROJECT** you're building? → wiki/projects/<name>.md
3. Is it about a **BUG/FIX/WORKAROUND**? → wiki/patterns/<name>.md
4. Is it a **TECH CONCEPT** to remember? → wiki/concepts/<name>.md
5. Is it a **DECISION** that was made? → See **Decision Routing** below
6. Is it a **COMMITMENT** to someone? → actions.md (append)
7. Is it a **VISION/STRATEGY**? → tag as `type: strategy` in frontmatter
8. None of the above? → harvest-suggestions.md (for review)

## Decision Routing (3 tiers)

When a decision is detected:

### Tier 1 — Behavioral Rules (always loaded)
Trigger words: "always", "never", "prefer", "default to", "every session"
Write to: ~/.github/copilot-instructions.md (live) + decisions.md (audit log)
Examples: "always run tests before pushing", "never commit secrets to repos"

### Tier 2 — Architectural Decisions (loaded via brain.md)
Trigger words: "decided to", "going with", "settled on", "architecture"
Write to: decisions.md + update brain.md L1 top 5
Examples: "git as storage backend", "Bun over Node for this project"

### Tier 3 — Historical Decisions (on-demand reference)
Trigger words: same as Tier 2 but project-specific or lower impact
Write to: decisions.md only
Examples: "chose Cohere reranker over custom", "using Jest not Vitest"

### Detection Logic
1. Scan for trigger words in the user's message
2. Match tier by specificity: Tier 1 (global behavior) > Tier 2 (architecture) > Tier 3 (implementation detail)
3. Ask user to confirm tier if ambiguous
4. Write to all required destinations for that tier
5. Format: `- [YYYY-MM-DD] [tier:N] description`

## Page Format
Every page has two layers separated by `---`:
- **Compiled Truth** — always current, rewritten on update (max 5-10 lines)
- **Timeline** — append-only, never delete, always dated, always attributed

## Source Attribution
Every claim gets a source type:
- `observed` — from code, PRs, session transcripts
- `self-stated` — user said it directly
- `inferred` — derived from context (include confidence: high/medium/low)
