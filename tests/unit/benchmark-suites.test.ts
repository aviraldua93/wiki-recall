/**
 * Unit tests for benchmarks/suites — each suite runs and produces valid results.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { runTokenEfficiencyBenchmark } from "../../benchmarks/suites/token-efficiency.js";
import { runRecallPrecisionBenchmark } from "../../benchmarks/suites/recall-precision.js";
import { runRoutingAccuracyBenchmark } from "../../benchmarks/suites/routing-accuracy.js";
import { runScaleStressBenchmark } from "../../benchmarks/suites/scale-stress.js";
import { runLayerComparisonBenchmark } from "../../benchmarks/suites/layer-comparison.js";
import { runBenchmark, runAllBenchmarks, ALL_SUITE_NAMES } from "../../benchmarks/runner.js";
import { generateMarkdownReport, generateHtmlReport, formatConsoleSummary } from "../../benchmarks/reporter.js";
import type { SimulationConfig, BenchmarkSuite } from "../../benchmarks/types.js";

// ---------------------------------------------------------------------------
// Shared test config (small for speed)
// ---------------------------------------------------------------------------

const SMALL_CONFIG: SimulationConfig = {
  entityCount: 5,
  sessionCount: 5,
  queryCount: 10,
  seed: 42,
};

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-bench-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Validate suite structure
// ---------------------------------------------------------------------------

function validateSuite(suite: BenchmarkSuite): void {
  expect(suite.name).toBeTruthy();
  expect(suite.description).toBeTruthy();
  expect(suite.startedAt).toBeTruthy();
  expect(suite.completedAt).toBeTruthy();
  expect(suite.summary).toBeTruthy();
  expect(Array.isArray(suite.results)).toBe(true);
  expect(suite.results.length).toBeGreaterThan(0);

  for (const r of suite.results) {
    expect(r.name).toBeTruthy();
    expect(r.metric).toBeTruthy();
    expect(typeof r.value).toBe("number");
    expect(r.unit).toBeTruthy();
  }
}

// ---------------------------------------------------------------------------
// Token Efficiency Suite
// ---------------------------------------------------------------------------

describe("token-efficiency suite", () => {
  test("runs and produces valid results", async () => {
    const suite = await runTokenEfficiencyBenchmark(SMALL_CONFIG);
    validateSuite(suite);
    expect(suite.name).toBe("token-efficiency");
  });

  test("includes baseline measurement", async () => {
    const suite = await runTokenEfficiencyBenchmark(SMALL_CONFIG);
    const baseline = suite.results.find(r => r.name.includes("Baseline"));
    expect(baseline).toBeDefined();
    expect(baseline!.value).toBeGreaterThan(0);
  });

  test("includes all layer combinations", async () => {
    const suite = await runTokenEfficiencyBenchmark(SMALL_CONFIG);
    const names = suite.results.map(r => r.name);
    expect(names.some(n => n.includes("L0 only"))).toBe(true);
    expect(names.some(n => n.includes("Full stack"))).toBe(true);
  });

  test("token savings are reported", async () => {
    const suite = await runTokenEfficiencyBenchmark(SMALL_CONFIG);
    const savings = suite.results.filter(r => r.metric === "token_savings_vs_baseline");
    expect(savings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Recall & Precision Suite
// ---------------------------------------------------------------------------

describe("recall-precision suite", () => {
  test("runs and produces valid results", async () => {
    const suite = await runRecallPrecisionBenchmark(SMALL_CONFIG);
    validateSuite(suite);
    expect(suite.name).toBe("recall-precision");
  });

  test("includes overall recall and precision", async () => {
    const suite = await runRecallPrecisionBenchmark(SMALL_CONFIG);
    const recall = suite.results.find(r => r.name === "Overall" && r.metric === "recall");
    const precision = suite.results.find(r => r.name === "Overall" && r.metric === "precision");
    expect(recall).toBeDefined();
    expect(precision).toBeDefined();
  });

  test("recall and precision values are in range", async () => {
    const suite = await runRecallPrecisionBenchmark(SMALL_CONFIG);
    const recallPrecision = suite.results.filter(r => r.metric === "recall" || r.metric === "precision");
    for (const r of recallPrecision) {
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Routing Accuracy Suite
// ---------------------------------------------------------------------------

describe("routing-accuracy suite", () => {
  test("runs and produces valid results", async () => {
    const suite = await runRoutingAccuracyBenchmark(SMALL_CONFIG);
    validateSuite(suite);
    expect(suite.name).toBe("routing-accuracy");
  });

  test("includes overall accuracy", async () => {
    const suite = await runRoutingAccuracyBenchmark(SMALL_CONFIG);
    const overall = suite.results.find(r => r.name === "Overall Routing");
    expect(overall).toBeDefined();
    expect(overall!.value).toBeGreaterThanOrEqual(0);
    expect(overall!.value).toBeLessThanOrEqual(100);
  });

  test("includes per-layer accuracy", async () => {
    const suite = await runRoutingAccuracyBenchmark(SMALL_CONFIG);
    const layerResults = suite.results.filter(r => r.name.startsWith("Layer L"));
    expect(layerResults.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scale Stress Suite
// ---------------------------------------------------------------------------

describe("scale-stress suite", () => {
  // Scale-stress runs 5 scale levels (10, 50, 100, 500, 1000) — needs more time
  const SCALE_TIMEOUT = 120_000;

  test("runs and produces valid results", async () => {
    const suite = await runScaleStressBenchmark(SMALL_CONFIG);
    validateSuite(suite);
    expect(suite.name).toBe("scale-stress");
  }, SCALE_TIMEOUT);

  test("includes latency measurements", async () => {
    const suite = await runScaleStressBenchmark(SMALL_CONFIG);
    const latencies = suite.results.filter(r => r.metric === "search_latency_avg");
    expect(latencies.length).toBeGreaterThan(0);
  }, SCALE_TIMEOUT);

  test("includes memory measurements", async () => {
    const suite = await runScaleStressBenchmark(SMALL_CONFIG);
    const memory = suite.results.filter(r => r.metric === "heap_used_mb");
    expect(memory.length).toBeGreaterThan(0);
  }, SCALE_TIMEOUT);

  test("includes degradation analysis", async () => {
    const suite = await runScaleStressBenchmark(SMALL_CONFIG);
    const degradation = suite.results.find(r => r.name === "Degradation");
    expect(degradation).toBeDefined();
  }, SCALE_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Layer Comparison Suite
// ---------------------------------------------------------------------------

describe("layer-comparison suite", () => {
  test("runs and produces valid results", async () => {
    const suite = await runLayerComparisonBenchmark(SMALL_CONFIG);
    validateSuite(suite);
    expect(suite.name).toBe("layer-comparison");
  });

  test("compares three configurations", async () => {
    const suite = await runLayerComparisonBenchmark(SMALL_CONFIG);
    const names = new Set(suite.results.map(r => r.name));
    expect(names.has("Wiki Only (Karpathy)")).toBe(true);
    expect(names.has("Search Only (RAG/MemPalace)")).toBe(true);
    expect(names.has("Hybrid (WikiRecall)")).toBe(true);
  });

  test("includes recall comparison deltas", async () => {
    const suite = await runLayerComparisonBenchmark(SMALL_CONFIG);
    const deltas = suite.results.filter(r => r.metric === "recall_delta");
    expect(deltas.length).toBe(2);
  });

  test("includes token measurements", async () => {
    const suite = await runLayerComparisonBenchmark(SMALL_CONFIG);
    const tokens = suite.results.filter(r => r.metric === "avg_tokens");
    expect(tokens.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

describe("runner", () => {
  test("runBenchmark runs a specific suite", async () => {
    const suite = await runBenchmark("token-efficiency", SMALL_CONFIG);
    expect(suite.name).toBe("token-efficiency");
  });

  test("runBenchmark throws on unknown suite", async () => {
    expect(runBenchmark("nonexistent" as never, SMALL_CONFIG)).rejects.toThrow();
  });

  test("ALL_SUITE_NAMES contains all suites", () => {
    expect(ALL_SUITE_NAMES).toContain("token-efficiency");
    expect(ALL_SUITE_NAMES).toContain("recall-precision");
    expect(ALL_SUITE_NAMES).toContain("routing-accuracy");
    expect(ALL_SUITE_NAMES).toContain("scale-stress");
    expect(ALL_SUITE_NAMES).toContain("layer-comparison");
  });
});

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

describe("reporter", () => {
  const mockSuite: BenchmarkSuite = {
    name: "test-suite",
    description: "A test suite",
    results: [
      { name: "Test", metric: "recall", value: 95.5, unit: "%" },
      { name: "Test", metric: "latency", value: 12, unit: "ms" },
    ],
    startedAt: "2025-01-15T00:00:00Z",
    completedAt: "2025-01-15T00:01:00Z",
    summary: "Test completed successfully.",
  };

  test("generateMarkdownReport produces valid markdown", () => {
    const md = generateMarkdownReport([mockSuite]);
    expect(md).toContain("# WikiRecall Memory Architecture");
    expect(md).toContain("test-suite");
    expect(md).toContain("95.50");
    expect(md).toContain("| Name |");
  });

  test("generateHtmlReport produces valid HTML", () => {
    const html = generateHtmlReport([mockSuite]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("WikiRecall Benchmark Results");
    expect(html).toContain("test-suite");
  });

  test("formatConsoleSummary produces readable output", () => {
    const summary = formatConsoleSummary([mockSuite]);
    expect(summary).toContain("WikiRecall Benchmark Results");
    expect(summary).toContain("Test Suite");
  });

  test("markdown report includes all suites", () => {
    const suites = [mockSuite, { ...mockSuite, name: "another-suite" }];
    const md = generateMarkdownReport(suites);
    expect(md).toContain("test-suite");
    expect(md).toContain("another-suite");
  });

  test("html report contains chart styles", () => {
    const html = generateHtmlReport([mockSuite]);
    expect(html).toContain("bar-chart");
    expect(html).toContain("bar-fill");
  });
});
