---
title: "Retry Patterns"
type: concept
updated: "2025-03-15"
tags:
  - distributed-systems
  - resilience
  - fault-tolerance
  - networking
related:
  - circuit-breaker
  - rate-limiting
---

## What It Is

Retry patterns are strategies for automatically re-attempting failed operations in distributed systems. They handle transient failures — temporary conditions like network timeouts, service restarts, or rate limiting — that resolve on their own after a brief wait.

## Key Concepts

- **Transient failure**: A temporary error that will likely succeed on retry (e.g., HTTP 503, connection timeout, DNS resolution failure).
- **Permanent failure**: An error that will not resolve with retries (e.g., HTTP 404, authentication failure). Must not be retried.
- **Exponential backoff**: Wait time doubles with each retry (1s, 2s, 4s, 8s...), reducing pressure on the failing service.
- **Jitter**: Random variation added to backoff delays to prevent thundering herd when many clients retry simultaneously.
- **Max retries**: Upper bound on retry attempts to prevent infinite loops. Typically 3-5 for synchronous requests.
- **Retry budget**: Percentage of total requests that may be retries (e.g., 10%), preventing retry storms from overwhelming a recovering service.
- **Idempotency**: Operations must be safe to repeat. Non-idempotent operations (e.g., payment charges) require idempotency keys.

## Common Strategies

### Fixed Delay
Wait a constant amount between retries. Simple but can cause synchronized retry storms.

### Exponential Backoff
`delay = base * 2^attempt` — Doubles wait time each attempt. Standard approach for most APIs.

### Exponential Backoff with Jitter
`delay = random(0, base * 2^attempt)` — Adds randomization to spread retry load. Recommended by most cloud providers.

### Circuit Breaker Integration
After repeated failures, stop retrying entirely (circuit "opens") and fail fast. Periodically test if the service has recovered (circuit "half-open") before resuming normal traffic.

## When to Use

- HTTP client calls to external services
- Database connection pools during failover
- Message queue consumers with intermittent delivery
- File system operations on networked storage

## When NOT to Use

- Client-side input validation errors (HTTP 400)
- Authentication/authorization failures (HTTP 401/403)
- Resource not found errors (HTTP 404)
- Business logic violations — these are permanent failures

## Related Work

- Circuit breaker pattern for preventing cascade failures
- Rate limiting for controlling outbound request volume
- Bulkhead pattern for isolating failure domains
