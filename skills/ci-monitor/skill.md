---
name: ci-monitor
description: GitHub Actions pipeline monitoring, failure diagnosis, and build health management
version: "1.0.0"
source: root
---

# CI Monitor Skill

A systematic approach to monitoring continuous integration pipelines, diagnosing build failures, and maintaining healthy CI/CD workflows using GitHub Actions.

## When to Use

Use this skill whenever you need to:

- **Diagnose a failing CI pipeline** to unblock a pull request or deployment
- **Monitor build health** across multiple repositories or branches
- **Investigate flaky tests** that pass intermittently and erode confidence in the test suite
- **Optimize pipeline performance** by identifying slow jobs, redundant steps, or caching opportunities
- **Set up or modify CI workflows** to ensure they follow best practices for reliability and speed
- **Triage CI alerts** to determine whether a failure requires immediate action or can be deferred

Activate this skill when any GitHub Actions workflow run fails, when build times degrade noticeably, or when you need to understand the current CI health of a project.

## How to Execute

### Step 1 — Assess Current Pipeline Status

Start by gathering the current state of all relevant workflows:

1. **List recent workflow runs**: Check the status of the last 10-20 runs for each active workflow. Note patterns of success, failure, and cancellation.
2. **Identify failing workflows**: For each failed run, note the workflow name, trigger event (push, PR, schedule), branch, and failure timestamp.
3. **Check for patterns**: Are failures isolated to one branch, one workflow, or one time window? Cluster related failures together.
4. **Review run duration trends**: Compare recent run durations against the historical baseline. Flag any runs that took significantly longer than average.

### Step 2 — Diagnose Failures

For each failed workflow run, perform root cause analysis:

1. **Read the job logs**: Start from the failed step and read upward for context. Look for:
   - Compilation errors and type errors
   - Test assertion failures with expected vs. actual values
   - Timeout errors indicating hung processes
   - Resource exhaustion (out of memory, disk full)
   - Network errors (DNS failures, connection timeouts, registry unavailable)
   - Permission errors (missing secrets, insufficient token scopes)

2. **Classify the failure**:
   - **Code defect**: A genuine bug introduced by recent changes
   - **Flaky test**: Non-deterministic test that passes on retry
   - **Infrastructure**: Runner issue, network blip, or resource constraint
   - **Configuration**: Missing secret, expired token, or incorrect workflow syntax
   - **Dependency**: Upstream package release breaking the build

3. **Check the triggering commit**: Review the diff of the commit that triggered the failure. Did the change touch files related to the failing step?

4. **Compare with last successful run**: Identify what changed between the last green run and the current red run (commits, dependency updates, workflow changes).

### Step 3 — Resolve or Escalate

Based on the diagnosis, take appropriate action:

1. **Code defect**: Identify the minimal fix and either apply it directly or create an issue with reproduction steps.
2. **Flaky test**: Re-run the workflow to confirm flakiness. If confirmed, quarantine the test with a tracking issue and `@flaky` annotation.
3. **Infrastructure**: Retry the run. If persistent, check GitHub Status page and runner availability. Consider self-hosted runners for critical paths.
4. **Configuration**: Fix the workflow file, update secrets, or rotate expired tokens.
5. **Dependency**: Pin the breaking dependency version and create a separate PR to investigate the upgrade path.

### Step 4 — Monitor and Prevent

After resolving immediate failures:

1. **Track CI health metrics**: Monitor success rate, mean time to fix, and average run duration over time.
2. **Review caching strategy**: Ensure dependency caches (node_modules, pip, go modules) are configured correctly and cache keys are stable.
3. **Optimize parallelism**: Split slow test suites across multiple jobs using matrix strategies. Run independent checks concurrently.
4. **Set up notifications**: Configure failure alerts via GitHub notifications, webhooks, or chat integrations so failures are noticed quickly.
5. **Document known issues**: Maintain a list of known flaky tests, infrastructure constraints, and workarounds for the team.

## Expected Outputs

### Pipeline Status Report

```
## CI Health Report — [Repository Name]
- **Date**: YYYY-MM-DD
- **Overall Status**: 🟢 Healthy | 🟡 Degraded | 🔴 Failing
- **Success Rate (7d)**: XX%
- **Avg Run Duration**: X min Y sec
- **Active Failures**: [Count]
```

### Failure Diagnosis

```
## Failure Diagnosis
- **Workflow**: [workflow name]
- **Run**: [run URL or ID]
- **Trigger**: [push | pull_request | schedule | workflow_dispatch]
- **Branch**: [branch name]
- **Failed Job**: [job name]
- **Failed Step**: [step name]
- **Root Cause**: [Code defect | Flaky test | Infrastructure | Configuration | Dependency]
- **Error Summary**: [One-line description of the error]
- **Recommended Action**: [Specific fix or next step]
```

### Action Items

```
## Action Items
- [ ] [Priority] [Description] — [Owner/Assignee]
- [ ] [Priority] [Description] — [Owner/Assignee]
```

## CI Best Practices Checklist

- **Caching**: Use dependency caches with version-pinned keys to avoid cold builds
- **Timeouts**: Set explicit job and step timeouts to prevent hung pipelines
- **Concurrency**: Use GitHub Actions `concurrency` groups to cancel outdated runs on the same branch
- **Matrix testing**: Test across multiple OS, runtime, and dependency versions
- **Secrets rotation**: Rotate CI secrets on a regular schedule and audit access
- **Workflow modularity**: Use reusable workflows and composite actions to reduce duplication
- **Fail fast**: Configure matrix jobs with `fail-fast: true` for faster feedback on failures
