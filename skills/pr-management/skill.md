---
name: pr-management
description: Full pull request lifecycle management — creation, review coordination, merging, and cleanup
version: "1.0.0"
source: root
---

# PR Management Skill

A comprehensive framework for managing pull requests through their entire lifecycle — from branch creation to post-merge cleanup — ensuring smooth collaboration and high-quality code delivery.

## When to Use

Use this skill whenever you need to:

- **Create a pull request** with a well-structured description, appropriate reviewers, and linked issues
- **Coordinate reviews** across multiple reviewers with clear expectations and deadlines
- **Manage merge conflicts** and rebase strategies for long-lived feature branches
- **Track PR progress** across a team or project to identify bottlenecks
- **Establish PR conventions** for a new team or repository
- **Handle complex merge scenarios** like multi-repo changes, release branches, or hotfixes
- **Clean up after merge** by deleting branches, closing linked issues, and verifying deployments

Activate this skill for any PR workflow — whether you are an author preparing a PR, a reviewer evaluating changes, or a team lead tracking delivery velocity.

## How to Execute

### Phase 1 — Branch and PR Creation

Set up the change for success before writing any code:

1. **Branch naming**: Use a consistent convention that encodes intent:
   - `feature/<ticket-id>-short-description` for new features
   - `fix/<ticket-id>-short-description` for bug fixes
   - `chore/<description>` for maintenance and refactoring
   - `docs/<description>` for documentation changes

2. **Commit hygiene**: Write atomic commits with clear messages:
   - First line: imperative mood, 50 characters max (e.g., "Add retry logic to HTTP client")
   - Body: explain what and why, not how. Reference issue numbers.
   - Keep each commit focused on one logical change.

3. **PR description template**: Include the following sections:
   ```
   ## What
   [One-paragraph summary of the change]
   
   ## Why
   [Problem statement or link to issue/ticket]
   
   ## How
   [Implementation approach and key decisions]
   
   ## Testing
   [How the change was tested — manual steps, new tests, etc.]
   
   ## Checklist
   - [ ] Tests pass locally
   - [ ] No new warnings or lint errors
   - [ ] Documentation updated (if applicable)
   - [ ] Breaking changes documented (if applicable)
   ```

4. **Labels and metadata**: Apply appropriate labels (bug, feature, breaking-change, needs-review), set milestone, and link related issues.

5. **Reviewer selection**: Choose reviewers based on:
   - Code ownership (who owns the changed files)
   - Domain expertise (who understands the feature area)
   - Availability (who can review within the expected turnaround)
   - Assign at least 2 reviewers for high-risk changes.

### Phase 2 — Review Coordination

Guide the PR through the review process efficiently:

1. **Set expectations**: Communicate the review urgency and scope. Is this a quick fix that needs fast turnaround, or a design change that warrants deep review?

2. **Respond to feedback**: Address each review comment explicitly:
   - If you agree: make the change and reply with "Done" or reference the fixing commit
   - If you disagree: explain your reasoning respectfully and propose alternatives
   - If it is out of scope: acknowledge and create a follow-up issue

3. **Resolve conversations**: Mark resolved threads to keep the review focused on open items. Do not resolve threads you did not author unless the reviewer confirms.

4. **Handle re-reviews**: When pushing changes in response to feedback:
   - Push fixup commits (not force-push) so reviewers can see incremental changes
   - Summarize what changed in a PR comment
   - Re-request review from reviewers who requested changes

5. **Manage stale PRs**: If a PR has not received a review within 2 business days:
   - Send a gentle ping to assigned reviewers
   - If still blocked after 4 days, escalate to the team lead
   - Consider breaking large PRs into smaller ones if the size is deterring reviewers

### Phase 3 — Merging

Merge the PR safely and cleanly:

1. **Pre-merge checks**:
   - All CI checks pass (green status)
   - Required number of approvals received
   - No unresolved review threads
   - Branch is up-to-date with the target branch (rebase or merge main)
   - No merge conflicts

2. **Merge strategy selection**:
   - **Squash and merge**: For feature branches with messy commit history. Creates a single clean commit on main.
   - **Rebase and merge**: For branches with clean, atomic commits that should be preserved individually.
   - **Merge commit**: For long-lived branches or release merges where the branch history itself is meaningful.

3. **Merge commit message**: Ensure the final commit message is descriptive:
   - Include the PR number for traceability
   - Summarize the change in the first line
   - Reference closed issues (e.g., "Closes #42")

### Phase 4 — Post-Merge Cleanup

Finish the lifecycle after merging:

1. **Delete the source branch**: Remove the merged branch to keep the repository clean. Most platforms offer auto-delete on merge.

2. **Verify linked issues**: Confirm that linked issues were automatically closed. If not, close them manually with a reference to the merged PR.

3. **Monitor deployment**: If the repository has continuous deployment, verify the change deployed successfully:
   - Check deployment status in GitHub environments
   - Run a quick smoke test on the deployed change
   - Monitor error rates and logs for the first 15-30 minutes

4. **Update project tracking**: Move related tickets to "Done" status. Update sprint boards, changelogs, or release notes as needed.

5. **Notify stakeholders**: If the change affects other teams or external consumers, send a brief notification summarizing what changed and any action required.

## Expected Outputs

### PR Creation Summary

```
## PR Created
- **Title**: [PR title]
- **Branch**: [source] → [target]
- **PR URL**: [link]
- **Reviewers**: [list]
- **Labels**: [list]
- **Linked Issues**: [list]
```

### Review Status Dashboard

```
## PR Review Status — [Date]
| PR | Author | Reviewers | Status | Age | Blockers |
|----|--------|-----------|--------|-----|----------|
| #123 | @author | @rev1, @rev2 | Approved | 2d | None |
| #124 | @author | @rev3 | Changes Requested | 4d | Pending fixes |
```

### Merge Report

```
## Merge Report
- **PR**: #[number] — [title]
- **Merged by**: @[user]
- **Merge strategy**: [Squash | Rebase | Merge commit]
- **Closed issues**: [list]
- **Branch deleted**: Yes/No
- **Deployment status**: [Pending | Success | Failed]
```

## PR Health Indicators

- **Cycle time target**: PRs should merge within 3 business days of creation
- **Review turnaround**: First review within 1 business day
- **Size guideline**: Keep PRs under 400 lines changed. Break larger changes into a stack of dependent PRs
- **Approval threshold**: 1 approval for low-risk, 2 for standard, 3+ for breaking/security changes
