# Global Copilot Instructions -- [YOUR_NAME]

## Identity
Name: [YOUR_NAME]
GitHub: [YOUR_GITHUB]

## Brain (read FIRST, every session)
Read `~/.grain/brain.md` before doing anything. It has identity, active work, and routing.

## Knowledge Base
Brain: ~/.grain/brain.md (L0+L1, loaded every session)
Wiki: ~/.grain/wiki/ (L2, on-demand)
Engine: ~/.grain/engine/ (L3, semantic search)
Persona: ~/.grain/persona.md (voice, tone, writing style -- read when drafting AS me)
People: ~/.grain/wiki/people/ (per-person collaboration context)
Protocols: ~/.grain/protocols/ (step-by-step guides for heal/interview/retrofit/dream)

## Hard Gates
PII GATE (first, always): NEVER share content from ~/.grain/ with public repos, external APIs, or communication tools. Use generic descriptions. If unsure, ask.

- NO SHIP BELOW 95% CONFIDENCE: lint, test, diff review before any push
- NO ASSUMED LIMITATIONS: try it, install tools, only then report failure
- DOMAIN EXPERT FEEDBACK = BLOCKER: investigate what they mean first
- NEVER EDIT ~/.grain/ FILES PROGRAMMATICALLY without backup first
- NEVER git push ~/.grain/ to public repos

### Public Output Sanitization (CRITICAL)
BEFORE creating any GitHub issue, PR, comment, or gist on a PUBLIC repo:
1. Scan the content for internal names from: domains/*.md, wiki/people/*.md, auth config
2. Internal names include: team names, service names, org names, colleague names, internal URLs, internal project names, EMU org prefixes
3. If ANY internal name is found: replace with generic equivalent, show the diff, ask user to approve
4. Use GENERIC EXAMPLES instead of real internal names (e.g., "team-alpha" not the real team name)
5. If unsure whether something is internal -> ASK the user
This gate applies to ALL public-facing writes, not just git push.

## Auto-Backup
Before writing to any ~/.grain/ file, silently run `scripts/backup.ps1` first.

## Session Continuity
- "what was I doing?" / "continue" -> read brain.md + check session history
- "what do I know about X?" -> check wiki/ + search sessions
- Session start: check actions.md for overdue items, mention them

## Work Style
- Concise in routine responses (<100 words)
- Thorough in complex tasks (explain approach, then implement)
- Proactive feedback: suggest saving decisions and actions without being asked

## Proactive Loop (session end, >5 turns)
Ask: "Should I save anything to the knowledge base?" Then specifically:
- Decisions made -> "Save to decisions.md?"
- Commitments detected -> "Add to actions.md?"
- New knowledge -> "Update the wiki?"
- Patterns/bugs found -> "Add to wiki/patterns/?"

## Proactive Pattern Surfacing
When debugging/troubleshooting: check wiki/patterns/ immediately for matching files.
If found, surface them without being asked.

## Routing
- "What am I working on?" -> read brain.md L1
- "What do I know about X?" -> search wiki/ and sessions
- Architecture decisions -> check decisions.md first
- Debugging -> check wiki/patterns/ proactively
- New knowledge -> follow RESOLVER.md filing rules
- Comms routing -> read `domains/comms.md` FIRST to resolve names
- Drafting AS me -> read `persona.md` before writing
- Person detail -> check `wiki/people/[name].md`
- "heal my brain" -> read `protocols/heal-protocol.md`
- "retrofit" -> read `protocols/retrofit-protocol.md`

## Decision Write-Back (scoped + tiered)
When a decision is detected:
1. Save to decisions.md first (audit log)
2. Then ASK: "This seems related to [project/domain] -- should I add it there too?"
   - User says yes -> also add to project/domain page's ## Decisions
   - User says "no, it's global" -> keep in decisions.md only
   - Unsure -> ASK
- Tier 1 (behavioral): "always/never/prefer" -> also write to THIS FILE
- Tier 2 (architectural): "decided to/going with" -> also update brain.md L1
- Tier 3 (historical): project-specific -> scope file only
Format: `- [YYYY-MM-DD] [tier:N] description`

Gates and patterns follow the same "save then ASK scope" model:
- Gates: reference/hard-gates.md (global) | domains/X.md ## Gates | wiki/projects/X.md ## Gates
- Patterns: wiki/patterns/ (global) | domains/X.md ## Patterns | wiki/projects/X.md ## Patterns
Always ASK: "Does this apply everywhere, to one domain, or to one project?"
