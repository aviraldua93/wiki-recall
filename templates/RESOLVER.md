# RESOLVER -- Where Does This Go?

When new knowledge arrives, file it here:

1. Is it about a **PERSON**? -> wiki/people/<name>.md
2. Is it about a **PROJECT** you're building? -> wiki/projects/<name>.md
3. Is it about a **BUG/FIX/WORKAROUND**? -> See **Pattern Routing** below
4. Is it a **TECH CONCEPT** to remember? -> wiki/concepts/<name>.md
5. Is it a **DECISION** that was made? -> See **Decision Routing** below
6. Is it a **HARD GATE**? -> See **Gate Routing** below
7. Is it a **COMMITMENT** to someone? -> actions.md (append)
8. Is it a **VISION/STRATEGY**? -> tag as `type: strategy` in frontmatter
9. None of the above? -> harvest-suggestions.md (for review)

## Decision Routing (scope + tier)

Decisions live at the **narrowest scope** where they apply:

### Step 1: Determine scope
Ask: "Does this apply everywhere, to one domain, or to one project?"
- **Global** -> decisions.md (~15-20 entries max)
- **Domain** -> domains/X.md ## Decisions (2-4 per domain)
- **Project** -> wiki/projects/X.md ## Decisions (0-10 per project)

### Step 2: Determine tier
- **Tier 1 (behavioral)**: "always", "never", "prefer" -> copilot-instructions.md + scope file
- **Tier 2 (architectural)**: "decided to", "going with" -> scope file + brain.md L1
- **Tier 3 (historical)**: project-specific detail -> scope file only

### Step 3: Write
Format: `- [YYYY-MM-DD] [tier:N] description`
Always write to the scope file. Tier 1 also writes to copilot-instructions.md.
If ambiguous, ask the user which scope.

## Gate Routing

Hard gates follow the same scope model as decisions:
- **Global** (reference/hard-gates.md): universal rules. "95% confidence." "Install missing tools." 3-5 max.
- **Domain** (domains/X.md ## Gates): domain-specific. Build requirements, deploy gates.
- **Project** (wiki/projects/X.md ## Gates): project-specific. Version pins, test requirements.

When a gate is discovered, ask: "Does this gate apply everywhere, to one domain, or to one project?"
Format: `- [YYYY-MM-DD] gate description`

## Pattern Routing

Patterns (bugs, fixes, workarounds) follow the same scope model:
- **Global** (wiki/patterns/<name>.md): patterns that apply across all projects
- **Domain** (domains/X.md ## Patterns): domain-specific lessons
- **Project** (wiki/projects/X.md ## Patterns): project-specific bugs/fixes

When a pattern is discovered, ask: "Does this apply everywhere, to one domain, or to one project?"
Do NOT confuse patterns with gates. Patterns = lessons learned. Gates = mandatory checks.

## Page Format
Every page has two layers separated by `---`:
- **Compiled Truth** -- always current, rewritten on update (max 5-10 lines)
- **Timeline** -- append-only, never delete, always dated, always attributed

## Source Attribution
Every claim gets a source type:
- `observed` -- from code, PRs, session transcripts
- `self-stated` -- user said it directly
- `inferred` -- derived from context (include confidence: high/medium/low)
