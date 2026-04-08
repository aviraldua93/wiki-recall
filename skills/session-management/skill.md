---
name: session-management
description: Working session checkpointing, resumption, and cross-machine context transfer
version: "1.0.0"
source: root
---

# Session Management Skill

A disciplined approach to capturing, preserving, and restoring working context across sessions, machines, and engineers. Ensures zero context loss when switching tasks, ending a work day, or handing off to a colleague.

## When to Use

Use this skill whenever you need to:

- **End a work session** and want to resume exactly where you left off tomorrow
- **Switch between projects** without losing context on either one
- **Transfer work to another machine** (e.g., from office desktop to home laptop)
- **Hand off a task to a colleague** with full context so they can continue without ramp-up
- **Resume after an interruption** (meeting, urgent bug, context switch) and need to rebuild mental state
- **Audit what you worked on** for standup reports, time tracking, or retrospectives
- **Recover from a crash** where your IDE or terminal session was lost unexpectedly

Activate this skill at natural breakpoints: before lunch, end of day, before meetings, or whenever you are about to context-switch away from the current task.

## How to Execute

### Step 1 — Capture Current State

Before ending or pausing a session, systematically capture everything you will need to resume:

1. **Summarize current progress**: Write a 2-3 sentence summary of what you accomplished and where you stopped. Be specific — "Implemented retry handler, tests passing, need to add backoff jitter" is better than "Working on retry logic."

2. **Record open files and positions**: Note which files you had open and where your cursor/attention was focused. This helps recreate your mental working set.

3. **Document next steps**: Write an ordered list of the next 3-5 actions. Each item should be concrete and actionable:
   - Good: "Add exponential backoff with jitter to retryHandler() in src/http/retry.ts"
   - Bad: "Finish retry logic"

4. **List blockers**: Record anything preventing progress — waiting on a review, blocked by a dependency, need clarification from a teammate.

5. **Capture open PRs and branches**: Note all active branches and their status:
   - Branch name and repo
   - PR number (if opened)
   - Current CI status
   - Outstanding review comments

6. **Save notes and observations**: Record any insights, decisions, or context that is not captured in code or commits:
   - "Chose exponential backoff over linear because the upstream service recommends it in their rate-limit docs"
   - "The flaky test in auth.test.ts is caused by timezone sensitivity — tracked in issue #87"

### Step 2 — Persist the Checkpoint

Save the captured state durably:

1. **Update the scenario manifest**: Run `wikirecall save` with your summary and next steps. This updates the YAML manifest with your current context.

2. **Commit and push changes**: Ensure all work-in-progress code is committed (even as draft commits) and pushed to the remote branch. Uncommitted changes cannot travel across machines.

3. **Sync the scenario**: Run `wikirecall save` to push the updated scenario manifest to GitHub. This ensures the checkpoint is available from any machine.

4. **Verify the checkpoint**: Run `wikirecall list` and confirm your scenario shows the correct status, summary, and timestamp.

### Step 3 — Resume a Session

When returning to work, restore context efficiently:

1. **Recall the scenario**: Run `wikirecall recall <scenario-name>` to restore the full working environment — repos, branches, skills, and context.

2. **Review the context**: Read the restored summary, next steps, and blockers. This should take less than 60 seconds to rebuild your mental state.

3. **Check for external changes**: Review any new commits on the branch, new PR comments, or updated blockers since your last session.

4. **Update scenario status**: Change the scenario status to `active` if it was paused, and begin working on the first item in your next steps list.

5. **Verify environment**: Confirm that all repos are on the correct branches, dependencies are installed, and the dev server starts correctly.

### Step 4 — Cross-Machine Transfer

When moving work between machines:

1. **Source machine**: Complete Steps 1-2 above. Ensure everything is pushed to GitHub.

2. **Target machine**: Run `wikirecall recall <scenario-name>`. WikiRecall will:
   - Clone or pull all repos listed in the scenario
   - Check out the correct branches
   - Load the associated skills
   - Display the saved context (summary, next steps, blockers)

3. **Verify the transfer**: Run `wikirecall list` on the target machine and confirm the scenario matches what you saved on the source machine.

4. **Install dependencies**: WikiRecall restores repo state but not local tooling. Run your project's dependency install command (e.g., `bun install`, `npm install`, `pip install -r requirements.txt`).

### Step 5 — Handoff to Another Engineer

When transferring work to a colleague:

1. **Save a detailed checkpoint** (Step 1) with extra emphasis on:
   - Architecture decisions and their rationale
   - Known gotchas and workarounds
   - Related documentation or reference links

2. **Run handoff**: Execute `wikirecall handoff <scenario-name> --to <colleague>`. This:
   - Creates a handoff PR in the scenario repo
   - Updates the scenario status to `handed-off`
   - Includes your context summary in the PR description

3. **Communicate directly**: Supplement the handoff with a brief conversation or message. Written context is necessary but not always sufficient — a 5-minute walkthrough can save hours of ramp-up.

## Expected Outputs

### Session Checkpoint

```
## Session Checkpoint — [Scenario Name]
- **Date**: YYYY-MM-DD HH:MM
- **Status**: paused
- **Summary**: [2-3 sentence description of progress and stopping point]
- **Active Branch**: [repo]:[branch]
- **Open PRs**: [list with status]
- **Next Steps**:
  1. [Concrete action item]
  2. [Concrete action item]
  3. [Concrete action item]
- **Blockers**: [list or "None"]
- **Notes**: [Decisions, insights, observations]
```

### Resume Report

```
## Session Resumed — [Scenario Name]
- **Date**: YYYY-MM-DD HH:MM
- **Last Checkpoint**: [timestamp]
- **Time Since Last Session**: [duration]
- **Repos Restored**: [count] — all on correct branches
- **Skills Loaded**: [list]
- **Next Action**: [first item from next steps]
```

### Handoff Summary

```
## Handoff — [Scenario Name]
- **From**: @[author]
- **To**: @[recipient]
- **Handoff PR**: [link]
- **Context Summary**: [what was done, what remains, key decisions]
- **Estimated Remaining Effort**: [rough hours/days estimate]
```

## Session Management Best Practices

- **Checkpoint frequently**: Save at least once per work session, more often during complex tasks
- **Be specific in summaries**: Future-you (or your colleague) has no short-term memory of what you did today
- **Keep next steps small**: Each item should be completable in under 2 hours
- **Clean up before handoff**: Squash WIP commits, resolve TODO comments, close stale branches
- **Test the resume path**: Periodically verify that recalling your scenario on a fresh machine actually works
