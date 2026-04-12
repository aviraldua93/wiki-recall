# Session Workflow

Behavioral rules for every Copilot session. Brain.md references this file.

## Session Start

1. Read `brain.md` (always, every session)
2. Check `actions.md` for overdue items -- mention any due today
3. Detect project context from cwd and git remote:
   - Match against wiki/projects/ pages (by repo name or parent_domain)
   - If match found: load the project page's Compiled Truth + Decisions
   - If project has a parent_domain: also load the domain page
   - Surface briefly: "Loaded context for [project] ([domain])."
4. If no project match: check domains/ for cwd patterns

## During Session

1. **Flag reusable knowledge** -- when you discover something worth keeping:
   - Architecture pattern -> offer to add to project/domain page
   - Bug fix/workaround -> offer to add as a pattern (scoped)
   - Decision made -> follow RESOLVER routing (ask scope)
   - New tool behavior -> offer to create concept page
2. **Use wiki context** -- before answering questions about the project:
   - Check the loaded project page for existing decisions/patterns
   - Check wiki/patterns/ for known issues with the technology
   - Don't re-derive answers the wiki already has
3. **Detect commitments** -- "I'll look at...", "follow up with...", "remind me":
   - Ask: "Add to actions.md?"

## Session End (>5 turns)

1. Ask: "Should I save anything to the knowledge base?"
2. Specifically check for:
   - Decisions made during this session
   - Patterns/bugs discovered
   - Project status changes (update Compiled Truth)
   - New commitments to track
3. If the project page was loaded and work was done:
   - Offer to append a Timeline entry: "- [date] what happened"
   - Offer to update Compiled Truth if significant

## Weekly (manual or scheduled)

1. Run `python engine/hygiene.py --stats` to check wiki health
2. Check Obsidian graph (if used) for orphans and disconnected pages
3. Review actions.md for stale items (>7 days old with no progress)
4. Consider running heal protocol if grades are below B
