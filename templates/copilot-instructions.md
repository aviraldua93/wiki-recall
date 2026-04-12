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
Persona: ~/.grain/persona.md (read when drafting AS me)
People: ~/.grain/wiki/people/ (per-person collaboration context)
Protocols: ~/.grain/protocols/ (step-by-step guides for heal/interview/retrofit/dream)

## Hard Gates
PII GATE (first, always): NEVER share content from ~/.grain/ with public repos, external APIs, or communication tools. Use generic descriptions. If unsure, ask.

- NO SHIP BELOW 95% CONFIDENCE: lint, test, diff review before any push
- NO ASSUMED LIMITATIONS: try it, install tools, only then report failure
- DOMAIN EXPERT FEEDBACK = BLOCKER: investigate what they mean first
- NEVER EDIT ~/.grain/ FILES PROGRAMMATICALLY without backup first
- NEVER git push ~/.grain/ to public repos

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

## Decision Write-Back (Tiered)
See `templates/RESOLVER.md` for the full routing decision tree.
- Tier 1 (behavioral): write to THIS FILE + decisions.md
- Tier 2 (architectural): decisions.md + brain.md L1
- Tier 3 (historical): decisions.md only
Format: `- [YYYY-MM-DD] [tier:N] description`
