# Multi-Agent Operating Rules

Source: https://github.com/aviraldua93/multi-agent-playbook

## Core Patterns
1. **Docs-as-Bus**: Agents write to shared files. Pass file PATHS, not content.
2. **Shared Contracts**: Parallel agents read the same spec. They never talk directly.
3. **Two-Step (SCOPE then EXECUTE)**: Max 3 deliverables per agent. Split if more.
4. **Deterministic Orchestration**: For >5 agents, pre-declare the full deployment plan.
5. **Orchestrator Self-Governance**: Tell agents WHERE to write. Read summaries, not full outputs.

## Anti-Patterns
- No mega-agents (>3 deliverables)
- No raw output forwarding (use docs-as-bus)
- No peer communication (design for isolation)
- No deep hierarchy (max depth = 2)

## Agent Deployment
| Role | Type | Parallel? | Rule |
|------|------|-----------|------|
| Explorers | explore | Unlimited | Read-only |
| Implementers | general-purpose | 1 per FILE | Owns specific files |
| Architects | general-purpose (Opus) | Yes | Design only, no edits |
| Reviewers | code-review | Yes | AFTER implementers |
| Validators | task | Sequential | AFTER review |

Wave: Explore -> Implement -> Review -> Validate -> Ship

## Agent Teams
CLI: `~/.agent-teams/team.ps1`
Commands: init, role, task, launch, status, list, clean
Max depth = 2. Sub-agent cap: 5. Haiku for read-only, Sonnet for implementation.
