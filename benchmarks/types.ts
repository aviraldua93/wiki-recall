/**
 * Benchmark Types — type definitions for the WikiRecall benchmark suite.
 *
 * Covers benchmark results, suite metadata, and simulation configuration
 * for reproducible performance evaluation of the 5-layer memory architecture.
 */

import type { MemoryLayer } from "../src/memory/types.js";

// ---------------------------------------------------------------------------
// Benchmark result — a single measurement
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  metric: string;
  value: number;
  unit: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Benchmark suite — a collection of results from a single benchmark run
// ---------------------------------------------------------------------------

export interface BenchmarkSuite {
  name: string;
  description: string;
  results: BenchmarkResult[];
  startedAt: string;
  completedAt: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Simulation configuration — controls data generation and test parameters
// ---------------------------------------------------------------------------

export interface SimulationConfig {
  /** How many knowledge entities to generate. */
  entityCount: number;
  /** How many mock sessions to generate. */
  sessionCount: number;
  /** How many test queries to run. */
  queryCount: number;
  /** Seed for reproducible random generation. */
  seed: number;
}

// ---------------------------------------------------------------------------
// Test query — a query with known ground truth for evaluation
// ---------------------------------------------------------------------------

export interface TestQuery {
  query: string;
  expectedLayer: MemoryLayer;
  groundTruth: string;
}

// ---------------------------------------------------------------------------
// Mock session — simulated dev conversation
// ---------------------------------------------------------------------------

export interface MockSession {
  id: string;
  turns: { role: string; content: string }[];
}

// ---------------------------------------------------------------------------
// Latency stats — percentile distribution for timing measurements
// ---------------------------------------------------------------------------

export interface LatencyStats {
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
}

// ---------------------------------------------------------------------------
// Token efficiency stats — percentile distribution for token counts
// ---------------------------------------------------------------------------

export interface TokenStats {
  avgTokens: number;
  p50: number;
  p95: number;
  p99: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: SimulationConfig = {
  entityCount: 50,
  sessionCount: 100,
  queryCount: 200,
  seed: 42,
};
