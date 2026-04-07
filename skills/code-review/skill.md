---
name: code-review
description: Systematic code review with security, correctness, style, performance, and testing checklists
version: "1.0.0"
source: root
---

# Code Review Skill

A structured approach to reviewing code changes that ensures consistency, catches defects early, and maintains high engineering standards across the codebase.

## When to Use

Use this skill whenever you need to:

- **Review a pull request** before merging into a protected branch
- **Self-review your own changes** before requesting peer review
- **Audit existing code** for quality, security vulnerabilities, or technical debt
- **Onboard to an unfamiliar codebase** by reviewing recent changes to understand patterns
- **Post-incident review** to identify code-level root causes of production issues

Activate this skill for any code diff—whether it is a single-file hotfix or a multi-service feature branch. The review depth should scale with the change's risk and blast radius.

## How to Execute

Follow this five-layer review protocol in order. Each layer builds on the previous one, so do not skip ahead.

### Layer 1 — Security Review

Examine the diff for common vulnerability classes:

1. **Input validation**: Are all external inputs (HTTP params, CLI args, file contents, env vars) validated and sanitized before use?
2. **Authentication & authorization**: Do new endpoints or operations enforce appropriate auth checks? Are there missing permission guards?
3. **Secret management**: Are credentials, tokens, or API keys hardcoded? Are they logged or exposed in error messages?
4. **Injection risks**: Check for SQL injection, command injection, path traversal, XSS, and template injection.
5. **Dependency risks**: Do new dependencies have known CVEs? Are they pinned to specific versions?

Flag any finding with `[SECURITY]` prefix and severity (critical/high/medium/low).

### Layer 2 — Correctness Review

Verify the code does what it claims to do:

1. **Logic validation**: Trace the main code paths. Do conditionals cover all cases? Are there off-by-one errors, null dereferences, or race conditions?
2. **Edge cases**: What happens with empty inputs, maximum values, concurrent access, or network failures?
3. **Error handling**: Are errors caught, logged, and propagated correctly? Do callers handle error returns?
4. **State management**: Are state transitions valid? Is shared mutable state protected?
5. **API contracts**: Do function signatures, return types, and error codes match their documented contracts?

### Layer 3 — Style & Readability Review

Ensure the code is maintainable:

1. **Naming**: Are variables, functions, and types named clearly and consistently with codebase conventions?
2. **Structure**: Is the code organized logically? Are functions focused (single responsibility)?
3. **Comments**: Are complex algorithms or non-obvious decisions explained? Are there stale or misleading comments?
4. **Duplication**: Is there copy-pasted logic that should be extracted into shared utilities?
5. **Formatting**: Does the code follow the project's linter and formatter rules?

### Layer 4 — Performance Review

Identify potential performance issues:

1. **Algorithmic complexity**: Are there O(n²) or worse operations on potentially large datasets?
2. **Resource management**: Are database connections, file handles, and network sockets properly closed?
3. **Caching**: Are expensive computations or I/O operations repeated unnecessarily?
4. **Concurrency**: Are there blocking operations on hot paths? Could async patterns improve throughput?
5. **Memory**: Are there potential memory leaks from unbounded caches, event listeners, or closures?

### Layer 5 — Testing Review

Verify test coverage and quality:

1. **Coverage**: Are new code paths exercised by tests? Are both happy paths and error paths tested?
2. **Assertions**: Do tests assert meaningful outcomes, not just that code runs without throwing?
3. **Isolation**: Are tests independent? Do they mock external dependencies correctly?
4. **Edge cases**: Do tests cover boundary conditions, empty inputs, and error scenarios?
5. **Maintainability**: Are tests readable and well-organized? Would a new contributor understand what each test verifies?

## Expected Outputs

After completing the review, produce a structured report with the following sections:

### Review Summary

```
## Review Summary
- **Change**: [Brief description of what the PR/diff does]
- **Risk Level**: [Low | Medium | High | Critical]
- **Verdict**: [Approve | Request Changes | Needs Discussion]
- **Blocking Issues**: [Count]
- **Non-blocking Suggestions**: [Count]
```

### Findings List

Each finding should include:

```
### [LAYER] Finding Title
- **Severity**: Critical | High | Medium | Low | Info
- **File**: path/to/file.ts:42
- **Description**: What the issue is and why it matters
- **Suggestion**: Concrete fix or improvement recommendation
```

### Checklist

```
## Review Checklist
- [ ] Security: No hardcoded secrets, inputs validated, auth enforced
- [ ] Correctness: Logic verified, edge cases handled, errors propagated
- [ ] Style: Naming consistent, code readable, no duplication
- [ ] Performance: No unnecessary O(n²), resources cleaned up
- [ ] Testing: New paths covered, assertions meaningful, tests isolated
```

## Tips for Effective Reviews

- **Review in small batches**: Break large PRs into logical chunks and review each independently
- **Read the tests first**: Tests often explain intent better than implementation
- **Check the PR description**: Understand the "why" before judging the "how"
- **Be specific**: Link to exact lines and suggest concrete alternatives
- **Distinguish blocking from non-blocking**: Not every suggestion needs to block the merge
