---
title: "REST API Design"
type: concept
updated: 2025-06-15
tags:
  - api
  - http
  - rest
  - design-patterns
  - web-services
related:
  - jwt-authentication
  - rate-limiting
---

## What It Is

REST (Representational State Transfer) is an architectural style for designing networked applications. RESTful APIs use HTTP methods to perform CRUD operations on resources identified by URIs. A well-designed REST API is predictable, consistent, and easy to consume.

## Key Concepts

- **Resource-oriented URLs**: Use nouns, not verbs. `/users/42` not `/getUser?id=42`. Nest related resources: `/users/42/orders`.
- **HTTP verbs for operations**: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE (remove).
- **Stateless communication**: Each request contains all information needed to process it. No server-side session state between requests.
- **Status codes**: Use standard HTTP status codes — 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 404 (Not Found), 500 (Server Error).
- **Pagination**: Use cursor-based pagination for large collections. Include `next` and `prev` links in responses.
- **Versioning**: Prefer URL path versioning (`/v1/users`) or Accept header versioning over query parameters.
- **HATEOAS**: Include links to related resources and available actions in responses to make the API self-describing.

## Common Patterns

- **Filtering and sorting**: `GET /users?status=active&sort=created_at:desc`
- **Partial responses**: `GET /users/42?fields=name,email` to reduce payload size
- **Bulk operations**: `POST /users/batch` with an array body for creating multiple resources
- **Idempotency keys**: Include `Idempotency-Key` header for POST requests to prevent duplicate operations
- **Rate limiting**: Return `X-RateLimit-Remaining` and `Retry-After` headers

## Anti-Patterns to Avoid

- Deeply nested URLs beyond 2 levels (`/a/1/b/2/c/3/d/4`)
- Using POST for everything instead of appropriate HTTP verbs
- Returning 200 OK with error details in the body
- Exposing internal database IDs without considering security implications
- Inconsistent naming conventions (mixing camelCase and snake_case)

## Related Work

- OpenAPI Specification (Swagger) for API documentation
- JSON:API specification for standardized response format
- gRPC as an alternative for high-performance internal services
