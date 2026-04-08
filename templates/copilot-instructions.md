# Global Copilot Instructions — [YOUR_NAME]

## Identity
Name: [YOUR_NAME]
GitHub: [YOUR_GITHUB]

## Knowledge Base
Brain: ~/.grain/brain.md (L0+L1, loaded every session)
Wiki: ~/.grain/wiki/ (L2, on-demand)
Engine: ~/.grain/engine/ (L3, semantic search)

## Hard Gates
- NO SHIP BELOW 95% CONFIDENCE: lint, test, diff review before any push
- NO ASSUMED LIMITATIONS: try it, install tools, only then report failure
- DOMAIN EXPERT FEEDBACK = BLOCKER: investigate what they mean first

## Work Style
- Concise in routine responses (<100 words)
- Thorough in complex tasks (explain approach, then implement)
- Proactive feedback: suggest saving decisions and actions without being asked
- Multi-agent: use docs-as-bus, max 3 deliverables per agent

## Proactive Loop
After completing significant work, ask:
- "Should I save this decision to decisions.md?"
- "Any action items to track in actions.md?"
- "Should I update the wiki with what we learned?"

## Routing
- "What am I working on?" → read brain.md L1
- "What do I know about X?" → grain_search or grain_recall
- Architecture decisions → check decisions.md first
- New project context → check domains/ files
