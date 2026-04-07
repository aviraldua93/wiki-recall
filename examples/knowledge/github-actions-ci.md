---
title: "GitHub Actions CI"
type: tool
updated: "2025-04-01"
tags:
  - ci-cd
  - automation
  - github
  - devops
related:
  - docker
  - kubernetes
---

## What It Is

GitHub Actions is a CI/CD platform integrated directly into GitHub repositories. It automates build, test, and deployment workflows triggered by repository events (push, pull request, schedule, manual dispatch). Workflows are defined as YAML files in `.github/workflows/`.

## Key Concepts

- **Workflow**: A YAML file defining an automated process. Triggered by events or schedules. Located in `.github/workflows/`.
- **Job**: A set of steps that run on the same runner. Jobs run in parallel by default; use `needs` for sequential execution.
- **Step**: A single task within a job. Either runs a shell command (`run`) or uses a pre-built action (`uses`).
- **Action**: A reusable unit of workflow logic. Published on the GitHub Marketplace or defined locally in the repository.
- **Runner**: The machine that executes jobs. GitHub provides hosted runners (Ubuntu, Windows, macOS) or you can self-host.
- **Matrix strategy**: Run the same job across multiple configurations (OS, language version, dependency version) in parallel.
- **Artifact**: File or data produced by a workflow that can be shared between jobs or downloaded after completion.
- **Secret**: Encrypted environment variable stored at repository, environment, or organization level. Accessed via `${{ secrets.NAME }}`.
- **Concurrency group**: Prevents multiple runs of the same workflow from executing simultaneously. Useful for deployments.
- **Reusable workflow**: A workflow that can be called from other workflows using `workflow_call`, reducing duplication across repositories.

## Common Patterns

### Build and Test on PR

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
```

### Matrix Testing

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
    node: [18, 20, 22]
  fail-fast: true
```

### Caching Dependencies

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-npm-
```

## Best Practices

- **Pin action versions** to a specific SHA or tag (e.g., `actions/checkout@v4`) to prevent supply chain attacks.
- **Use dependency caching** to speed up builds — cache `node_modules`, `.pip`, `.gradle`, etc.
- **Set timeouts** on jobs and steps to prevent hung workflows from consuming runner minutes.
- **Use concurrency groups** to cancel outdated runs when new commits are pushed to the same branch.
- **Minimize secrets exposure** — only pass secrets to steps that need them, never log them.
- **Keep workflows modular** — use reusable workflows and composite actions to share logic.
- **Fail fast in matrices** — set `fail-fast: true` so a failure in one matrix dimension cancels the rest.

## Troubleshooting

- **"Resource not accessible by integration"**: Check the `permissions` key in the workflow — the default token may lack required scopes.
- **Slow builds**: Enable dependency caching, use matrix strategies to parallelize, and consider self-hosted runners for heavy workloads.
- **Flaky tests**: Use retry actions (e.g., `nick-fields/retry`) for known intermittent failures. Track and fix root causes.
- **Rate limiting**: GitHub API calls within Actions are subject to rate limits. Use `gh api --cache` or add delays between API calls.

## Related Work

- Docker for containerized build environments
- Kubernetes for deployment target orchestration
- Dependabot for automated dependency updates (also runs via GitHub Actions)
