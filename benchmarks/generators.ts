/**
 * Benchmark Generators — generate realistic mock data for benchmarks.
 *
 * All generators are deterministic via a seeded PRNG. Zero network calls,
 * zero API costs — pure mock data for reproducible benchmarks.
 */

import type { KnowledgeEntity, KnowledgeEntityType } from "../src/types.js";
import type { MemoryLayer } from "../src/memory/types.js";
import type { TestQuery, MockSession } from "./types.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------

function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function uuid(rng: () => number): string {
  const hex = "0123456789abcdef";
  const parts = [8, 4, 4, 4, 12];
  return parts
    .map(len =>
      Array.from({ length: len }, () => hex[Math.floor(rng() * 16)]).join("")
    )
    .join("-");
}

// ---------------------------------------------------------------------------
// Content pools — realistic dev vocabulary
// ---------------------------------------------------------------------------

const ENTITY_TYPES: KnowledgeEntityType[] = [
  "platform", "system", "repo", "tool", "concept", "person", "team",
];

const TECH_DOMAINS = [
  "authentication", "rate-limiting", "caching", "database", "api-gateway",
  "message-queue", "search-engine", "ci-cd", "monitoring", "logging",
  "container-orchestration", "load-balancing", "service-mesh", "event-sourcing",
  "graphql", "rest-api", "websockets", "grpc", "oauth", "jwt",
];

const PROJECT_NAMES = [
  "Atlas", "Beacon", "Catalyst", "Dagger", "Eclipse", "Falcon", "Granite",
  "Horizon", "Ignite", "Javelin", "Keystone", "Lighthouse", "Meridian",
  "Nexus", "Onyx", "Prism", "Quartz", "Radiant", "Sentinel", "Typhoon",
];

const TOOL_NAMES = [
  "Redis", "PostgreSQL", "Kafka", "Elasticsearch", "Docker", "Kubernetes",
  "Terraform", "Prometheus", "Grafana", "Nginx", "Envoy", "Vault",
  "RabbitMQ", "MongoDB", "Consul", "Istio", "ArgoCD", "Datadog",
  "Sentry", "LaunchDarkly",
];

const PERSON_NAMES = [
  "Alice Chen", "Bob Kumar", "Carlos Rivera", "Diana Park", "Eli Foster",
  "Fiona O'Brien", "George Yamada", "Hana Kim", "Ivan Petrov", "Julia Santos",
];

const TEAM_NAMES = [
  "Platform Engineering", "Core Services", "Developer Experience",
  "Infrastructure", "Data Platform", "Security Engineering",
  "Frontend Architecture", "Backend Services", "SRE", "Growth Engineering",
];

const TAG_POOL = [
  "architecture", "performance", "security", "scalability", "reliability",
  "observability", "devops", "backend", "frontend", "microservices",
  "distributed-systems", "data-pipeline", "machine-learning", "testing",
  "documentation", "incident-response", "capacity-planning", "migration",
  "refactoring", "tech-debt",
];

const CONTENT_TEMPLATES = [
  (domain: string, related: string) =>
    `## Overview\n\nThe ${domain} system handles core ${domain} functionality.\n\nSee also [[${related}]] for related patterns.\n\n## Architecture\n\nUses a layered approach with retry logic and circuit breakers.\n\n#${domain} #architecture`,

  (domain: string, related: string) =>
    `## Design\n\nImplements ${domain} using event-driven patterns.\n\nRelated: [[${related}]]\n\n## Key Decisions\n\n- Chose eventual consistency for ${domain}\n- Rate limiting at 1000 req/s\n- Circuit breaker with 5s timeout\n\n#${domain} #design`,

  (domain: string, related: string) =>
    `## ${domain}\n\nThis component provides ${domain} capabilities for the platform.\n\nIntegrates with [[${related}]] for cross-cutting concerns.\n\n## Implementation Notes\n\n- Written in TypeScript\n- Uses dependency injection\n- Comprehensive error handling\n\n#${domain}`,

  (domain: string, related: string) =>
    `## Summary\n\nHandles ${domain} with focus on resilience and performance.\n\nDependencies: [[${related}]]\n\n## Metrics\n\n- p99 latency: <50ms\n- Availability: 99.95%\n- Error rate: <0.1%\n\n#${domain} #metrics`,
];

// ---------------------------------------------------------------------------
// Session conversation templates
// ---------------------------------------------------------------------------

const SESSION_TOPICS = [
  { topic: "retry handler", turns: [
    { role: "user", content: "How does the retry handler work in our authentication service?" },
    { role: "assistant", content: "The retry handler uses exponential backoff with jitter. It starts at 100ms and caps at 30s. Failed auth requests are retried up to 3 times before failing." },
    { role: "user", content: "Should we add circuit breaking?" },
    { role: "assistant", content: "Yes, a circuit breaker would prevent cascading failures. I'd recommend a half-open state after 5s timeout." },
  ]},
  { topic: "database migration", turns: [
    { role: "user", content: "We need to migrate the user table to add two-factor auth columns." },
    { role: "assistant", content: "I'll create a migration that adds `totp_secret` and `totp_enabled` columns. We should use a non-blocking ALTER TABLE." },
    { role: "user", content: "What about backward compatibility?" },
    { role: "assistant", content: "Both columns should be nullable with defaults. Existing code won't break. We can backfill in a separate migration." },
  ]},
  { topic: "rate limiting", turns: [
    { role: "user", content: "Our API is getting hammered. We need rate limiting." },
    { role: "assistant", content: "I recommend a sliding window rate limiter using Redis. Set limits per API key: 100 req/min for free tier, 1000 for paid." },
    { role: "user", content: "How do we handle burst traffic?" },
    { role: "assistant", content: "Use a token bucket algorithm. Allow short bursts up to 2x the rate limit, with tokens refilling over the window." },
  ]},
  { topic: "caching strategy", turns: [
    { role: "user", content: "Our search endpoint is slow. Should we add caching?" },
    { role: "assistant", content: "Yes, a multi-level cache: L1 in-memory (10s TTL) and L2 Redis (5min TTL). Cache key includes query hash + filters." },
    { role: "user", content: "What about cache invalidation?" },
    { role: "assistant", content: "Use event-driven invalidation. When entities update, publish an event that clears related cache keys." },
  ]},
  { topic: "monitoring setup", turns: [
    { role: "user", content: "We need better observability for the payment service." },
    { role: "assistant", content: "Set up structured logging with correlation IDs, distributed tracing with OpenTelemetry, and custom metrics for payment flow." },
    { role: "user", content: "What metrics should we track?" },
    { role: "assistant", content: "Key metrics: payment success rate, p50/p95/p99 latency, error rate by type, and revenue per minute. Alert on any >5% drop." },
  ]},
  { topic: "security audit", turns: [
    { role: "user", content: "We got a security audit report. Need to fix JWT validation." },
    { role: "assistant", content: "The main issues are: no audience validation, missing issuer check, and algorithm confusion vulnerability. Let me patch these." },
    { role: "user", content: "How do we prevent this in the future?" },
    { role: "assistant", content: "Add a JWT validation middleware that enforces all checks. Use a security linter in CI. Rotate keys every 90 days." },
  ]},
  { topic: "performance optimization", turns: [
    { role: "user", content: "The dashboard API takes 3 seconds to load. Users are complaining." },
    { role: "assistant", content: "Profile shows N+1 queries. The dashboard makes 47 separate DB calls. Let me batch these into 3 queries with JOINs." },
    { role: "user", content: "Anything else we can do?" },
    { role: "assistant", content: "Add pagination, lazy-load charts, and precompute aggregations in a materialized view refreshed every 5 minutes." },
  ]},
  { topic: "API versioning", turns: [
    { role: "user", content: "We need to break the user API to add new fields. How do we version?" },
    { role: "assistant", content: "Use URL path versioning: /v1/users and /v2/users. Keep v1 supported for 6 months with a deprecation header." },
    { role: "user", content: "Should we use content negotiation instead?" },
    { role: "assistant", content: "For this project, URL versioning is simpler. Content negotiation adds complexity without much benefit at our scale." },
  ]},
];

// ---------------------------------------------------------------------------
// Generate mock entities
// ---------------------------------------------------------------------------

/**
 * Generate realistic knowledge entities with wikilinks, tags, and diverse types.
 */
export function generateMockEntities(count: number, seed: number): KnowledgeEntity[] {
  const rng = createRng(seed);
  const entities: KnowledgeEntity[] = [];
  const slugs: string[] = [];

  for (let i = 0; i < count; i++) {
    const type = pick(ENTITY_TYPES, rng);
    let title: string;
    let domain: string;

    switch (type) {
      case "repo":
        title = pick(PROJECT_NAMES, rng) + (i > 20 ? ` ${i}` : "");
        domain = pick(TECH_DOMAINS, rng);
        break;
      case "tool":
        title = pick(TOOL_NAMES, rng) + (i > 20 ? ` Integration ${i}` : " Integration");
        domain = pick(TECH_DOMAINS, rng);
        break;
      case "person":
        title = pick(PERSON_NAMES, rng);
        domain = pick(TECH_DOMAINS, rng);
        break;
      case "team":
        title = pick(TEAM_NAMES, rng);
        domain = pick(TECH_DOMAINS, rng);
        break;
      default:
        domain = pick(TECH_DOMAINS, rng);
        title = `${domain.replace(/-/g, " ")} ${type}`;
        break;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    slugs.push(slug);

    const tags = pickN(TAG_POOL, 2 + Math.floor(rng() * 4), rng);
    const relatedSlugs = slugs.length > 1
      ? pickN(slugs.filter(s => s !== slug), Math.min(Math.floor(rng() * 3), slugs.length - 1), rng)
      : [];

    const relatedName = relatedSlugs.length > 0 ? relatedSlugs[0] : domain;
    const template = pick(CONTENT_TEMPLATES, rng);
    const content = template(domain, relatedName);

    const year = 2024 + Math.floor(rng() * 2);
    const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
    const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");

    const entity: KnowledgeEntity = {
      title,
      type,
      updated: `${year}-${month}-${day}`,
      tags,
      related: relatedSlugs,
      content,
      status: pick(["draft", "reviewed", "needs_update"] as const, rng),
    };

    entities.push(entity);
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Generate mock sessions
// ---------------------------------------------------------------------------

/**
 * Generate realistic dev conversation sessions.
 */
export function generateMockSessions(count: number, seed: number): MockSession[] {
  const rng = createRng(seed);
  const sessions: MockSession[] = [];

  for (let i = 0; i < count; i++) {
    const template = pick(SESSION_TOPICS, rng);
    const id = uuid(rng);

    // Vary the conversation slightly
    const turns = template.turns.map(t => ({
      role: t.role,
      content: t.content + (rng() > 0.7 ? ` (iteration ${i})` : ""),
    }));

    // Sometimes add extra turns
    if (rng() > 0.5) {
      const extraDomain = pick(TECH_DOMAINS, rng);
      turns.push(
        { role: "user", content: `What about ${extraDomain} implications?` },
        { role: "assistant", content: `Good point. The ${extraDomain} layer should be considered. We'll need to ensure compatibility.` },
      );
    }

    sessions.push({ id, turns });
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// Generate test queries
// ---------------------------------------------------------------------------

/**
 * Generate test queries with known answers tagged to expected memory layers.
 */
export function generateTestQueries(
  entities: KnowledgeEntity[],
  sessions: MockSession[],
  count: number
): TestQuery[] {
  const queries: TestQuery[] = [];
  const perType = Math.max(1, Math.floor(count / 6));

  // L0 — Identity queries
  const l0Templates = [
    "who am I?",
    "what are my roles?",
    "show my identity",
    "what's my name?",
    "tell me about myself",
    "what accounts do I have?",
    "my developer profile",
    "who is the current user?",
  ];
  for (let i = 0; i < perType && queries.length < count; i++) {
    queries.push({
      query: l0Templates[i % l0Templates.length],
      expectedLayer: "L0",
      groundTruth: "identity information",
    });
  }

  // L1 — Story queries
  const l1Templates = [
    "what am I working on?",
    "what's my current status?",
    "summarize my recent activity",
    "what projects are active?",
    "give me a quick update",
    "what are my key metrics?",
    "what happened recently?",
    "show my top moments",
  ];
  for (let i = 0; i < perType && queries.length < count; i++) {
    queries.push({
      query: l1Templates[i % l1Templates.length],
      expectedLayer: "L1",
      groundTruth: "project status and activity summary",
    });
  }

  // L2 — Wiki queries (entity-specific)
  for (let i = 0; i < perType && queries.length < count; i++) {
    const entity = entities[i % entities.length];
    const titleLower = entity.title.toLowerCase();
    const templates = [
      `how does the ${titleLower} work?`,
      `explain the ${titleLower} architecture`,
      `what is ${titleLower}?`,
      `show me details about ${titleLower}`,
    ];
    queries.push({
      query: templates[i % templates.length],
      expectedLayer: "L2",
      groundTruth: entity.content ?? entity.title,
    });
  }

  // L3 — Search queries (conversational / session-based)
  const l3Templates = [
    "what did we discuss about rate limiting last week?",
    "when did we talk about the retry handler?",
    "what was our conversation about caching?",
    "remember when we discussed the database migration?",
    "what did we say about monitoring?",
    "previous discussion about security audit",
    "last time we discussed API versioning",
    "history of performance optimization discussions",
  ];
  for (let i = 0; i < perType && queries.length < count; i++) {
    queries.push({
      query: l3Templates[i % l3Templates.length],
      expectedLayer: "L3",
      groundTruth: "session conversation content",
    });
  }

  // L4 — Session queries (specific session ID)
  for (let i = 0; i < perType && queries.length < count; i++) {
    const session = sessions[i % sessions.length];
    queries.push({
      query: `show me session ${session.id}`,
      expectedLayer: "L4",
      groundTruth: session.turns.map(t => t.content).join(" "),
    });
  }

  // Cross-layer queries — should hit L2 + L3
  const crossLayerTemplates = [
    "summarize everything about authentication",
    "give me a complete overview of caching",
    "what do we know about rate limiting — both docs and conversations?",
    "comprehensive view of our monitoring setup",
    "all information about the database architecture",
  ];
  for (let i = 0; queries.length < count; i++) {
    queries.push({
      query: crossLayerTemplates[i % crossLayerTemplates.length],
      expectedLayer: "L2", // primary layer
      groundTruth: "cross-layer information combining wiki and search",
    });
  }

  return queries.slice(0, count);
}
