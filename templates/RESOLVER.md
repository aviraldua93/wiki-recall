# RESOLVER — Where Does This Go?

When new knowledge arrives, file it here:

1. Is it about a **PERSON**? → wiki/people/<name>.md
2. Is it about a **PROJECT** you're building? → wiki/projects/<name>.md
3. Is it about a **BUG/FIX/WORKAROUND**? → wiki/patterns/<name>.md
4. Is it a **TECH CONCEPT** to remember? → wiki/concepts/<name>.md
5. Is it a **DECISION** that was made? → decisions.md (append)
6. Is it a **COMMITMENT** to someone? → actions.md (append)
7. Is it a **VISION/STRATEGY**? → tag as `type: strategy` in frontmatter
8. None of the above? → harvest-suggestions.md (for review)

## Page Format
Every page has two layers separated by `---`:
- **Compiled Truth** — always current, rewritten on update (max 5-10 lines)
- **Timeline** — append-only, never delete, always dated, always attributed

## Source Attribution
Every claim gets a source type:
- `observed` — from code, PRs, session transcripts
- `self-stated` — user said it directly
- `inferred` — derived from context (include confidence: high/medium/low)
