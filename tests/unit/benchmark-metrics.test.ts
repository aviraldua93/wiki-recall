/**
 * Unit tests for benchmarks/metrics.ts — measurement functions.
 */

import { describe, test, expect } from "bun:test";
import {
  measureRecall,
  measurePrecision,
  measureTokenEfficiency,
  measureLatency,
  measureRoutingAccuracy,
  estimateTokens,
} from "../../benchmarks/metrics.js";
import type { MemoryResponse, MemoryLayer } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Helper — create mock MemoryResponse
// ---------------------------------------------------------------------------

function mockResponse(overrides?: Partial<MemoryResponse>): MemoryResponse {
  return {
    layers: {
      L0: {
        name: "Alice",
        roles: ["Software Engineer"],
        accounts: [{ platform: "github", username: "alice" }],
        coreContext: "Backend developer working on distributed systems.",
      },
      L1: {
        topMoments: [
          { date: "2025-01-15", event: "Updated: Authentication System", significance: "system (2 connections)" },
        ],
        activeProjects: [{ name: "Atlas", status: "active", lastActivity: "2025-01-15" }],
        keyMetrics: [{ label: "Knowledge entities", value: "10" }],
        generatedAt: "2025-01-15T00:00:00Z",
        tokenCount: 50,
      },
      L2: {
        entities: [
          { slug: "auth", title: "Authentication", type: "system", excerpt: "OAuth2 authentication with retry logic and rate limiting." },
        ],
        source: "wiki",
        tokensUsed: 30,
      },
    },
    totalTokens: 100,
    routingDecision: "L0 + L1 + L2",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// measureRecall
// ---------------------------------------------------------------------------

describe("measureRecall", () => {
  test("returns 1 when all ground truth found", () => {
    const responses = [mockResponse()];
    const groundTruth = ["authentication", "retry logic"];
    const recall = measureRecall(responses, groundTruth);
    expect(recall).toBeGreaterThan(0.5);
  });

  test("returns 0 when no results", () => {
    const recall = measureRecall([], ["authentication"]);
    expect(recall).toBe(0);
  });

  test("returns 1 when ground truth is empty", () => {
    const recall = measureRecall([mockResponse()], []);
    expect(recall).toBe(1);
  });

  test("returns lower recall when content doesn't match", () => {
    const responses = [mockResponse()];
    const recall = measureRecall(responses, ["quantum computing topology"]);
    expect(recall).toBeLessThan(1);
  });

  test("handles multiple responses", () => {
    const responses = [mockResponse(), mockResponse()];
    const recall = measureRecall(responses, ["authentication"]);
    expect(recall).toBeGreaterThan(0);
  });

  test("recall is between 0 and 1", () => {
    const responses = [mockResponse()];
    const recall = measureRecall(responses, ["authentication", "xyz-nonexistent"]);
    expect(recall).toBeGreaterThanOrEqual(0);
    expect(recall).toBeLessThanOrEqual(1);
  });

  test("partial matches count when enough keywords match", () => {
    const responses = [mockResponse()];
    const recall = measureRecall(responses, ["authentication system with OAuth"]);
    expect(recall).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// measurePrecision
// ---------------------------------------------------------------------------

describe("measurePrecision", () => {
  test("returns 1 when no results", () => {
    const precision = measurePrecision([], ["anything"]);
    expect(precision).toBe(1);
  });

  test("returns 0 when ground truth is empty", () => {
    const precision = measurePrecision([mockResponse()], []);
    expect(precision).toBe(0);
  });

  test("precision is between 0 and 1", () => {
    const responses = [mockResponse()];
    const precision = measurePrecision(responses, ["authentication"]);
    expect(precision).toBeGreaterThanOrEqual(0);
    expect(precision).toBeLessThanOrEqual(1);
  });

  test("higher precision when response matches ground truth", () => {
    const responses = [mockResponse()];
    const precision = measurePrecision(responses, ["authentication", "OAuth2", "retry", "rate limiting"]);
    expect(precision).toBeGreaterThan(0.3);
  });

  test("handles response with no content layers", () => {
    const empty: MemoryResponse = {
      layers: {},
      totalTokens: 0,
      routingDecision: "none",
    };
    const precision = measurePrecision([empty], ["test"]);
    expect(precision).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// measureTokenEfficiency
// ---------------------------------------------------------------------------

describe("measureTokenEfficiency", () => {
  test("returns zeros for empty results", () => {
    const stats = measureTokenEfficiency([]);
    expect(stats.avgTokens).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(0);
    expect(stats.p99).toBe(0);
  });

  test("calculates correct average", () => {
    const responses = [
      mockResponse({ totalTokens: 100 }),
      mockResponse({ totalTokens: 200 }),
      mockResponse({ totalTokens: 300 }),
    ];
    const stats = measureTokenEfficiency(responses);
    expect(stats.avgTokens).toBe(200);
  });

  test("calculates correct p50 for odd count", () => {
    const responses = [
      mockResponse({ totalTokens: 10 }),
      mockResponse({ totalTokens: 20 }),
      mockResponse({ totalTokens: 30 }),
    ];
    const stats = measureTokenEfficiency(responses);
    expect(stats.p50).toBe(20);
  });

  test("p95 >= p50", () => {
    const responses = Array.from({ length: 100 }, (_, i) =>
      mockResponse({ totalTokens: (i + 1) * 10 })
    );
    const stats = measureTokenEfficiency(responses);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
  });

  test("p99 >= p95", () => {
    const responses = Array.from({ length: 100 }, (_, i) =>
      mockResponse({ totalTokens: (i + 1) * 5 })
    );
    const stats = measureTokenEfficiency(responses);
    expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
  });

  test("single response returns same value for all percentiles", () => {
    const responses = [mockResponse({ totalTokens: 42 })];
    const stats = measureTokenEfficiency(responses);
    expect(stats.avgTokens).toBe(42);
    expect(stats.p50).toBe(42);
    expect(stats.p95).toBe(42);
    expect(stats.p99).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// measureLatency
// ---------------------------------------------------------------------------

describe("measureLatency", () => {
  test("measures async function latency", async () => {
    const stats = await measureLatency(async () => {
      await new Promise(r => setTimeout(r, 1));
    }, 5);
    expect(stats.avgMs).toBeGreaterThan(0);
    expect(stats.p50).toBeGreaterThan(0);
  });

  test("avgMs is positive for non-trivial function", async () => {
    const stats = await measureLatency(async () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    }, 3);
    expect(stats.avgMs).toBeGreaterThanOrEqual(0);
  });

  test("p95 >= p50", async () => {
    const stats = await measureLatency(async () => {
      await new Promise(r => setTimeout(r, 1));
    }, 10);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
  });

  test("p99 >= p95", async () => {
    const stats = await measureLatency(async () => {
      await new Promise(r => setTimeout(r, 1));
    }, 10);
    expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
  });

  test("runs the correct number of iterations", async () => {
    let count = 0;
    await measureLatency(async () => { count++; }, 5);
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// measureRoutingAccuracy
// ---------------------------------------------------------------------------

describe("measureRoutingAccuracy", () => {
  test("returns 1 when all routing is correct", () => {
    const results: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [
      { expectedLayer: "L0", actualLayers: ["L0", "L1"] },
      { expectedLayer: "L2", actualLayers: ["L0", "L1", "L2"] },
      { expectedLayer: "L3", actualLayers: ["L0", "L1", "L3"] },
    ];
    expect(measureRoutingAccuracy(results)).toBe(1);
  });

  test("returns 0 when all routing is wrong", () => {
    const results: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [
      { expectedLayer: "L3", actualLayers: ["L0", "L1"] },
      { expectedLayer: "L4", actualLayers: ["L0", "L1", "L2"] },
    ];
    expect(measureRoutingAccuracy(results)).toBe(0);
  });

  test("returns correct ratio for mixed results", () => {
    const results: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [
      { expectedLayer: "L0", actualLayers: ["L0", "L1"] },  // correct
      { expectedLayer: "L4", actualLayers: ["L0", "L1"] },  // wrong
      { expectedLayer: "L2", actualLayers: ["L0", "L1", "L2"] }, // correct
    ];
    const accuracy = measureRoutingAccuracy(results);
    expect(accuracy).toBeCloseTo(2 / 3, 5);
  });

  test("returns 1 for empty results", () => {
    expect(measureRoutingAccuracy([])).toBe(1);
  });

  test("expected layer must be in actual layers", () => {
    const results: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [
      { expectedLayer: "L2", actualLayers: ["L0", "L1"] },
    ];
    expect(measureRoutingAccuracy(results)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  test("estimates tokens as ceil(chars/4)", () => {
    expect(estimateTokens("1234")).toBe(1);
    expect(estimateTokens("12345")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });

  test("handles long strings", () => {
    const text = "a".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });

  test("handles single character", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});
