/**
 * Benchmark Runner — orchestrates all benchmark suites.
 *
 * Runs suites sequentially, collects results, and generates reports.
 */

import { runTokenEfficiencyBenchmark } from "./suites/token-efficiency.js";
import { runRecallPrecisionBenchmark } from "./suites/recall-precision.js";
import { runRoutingAccuracyBenchmark } from "./suites/routing-accuracy.js";
import { runScaleStressBenchmark } from "./suites/scale-stress.js";
import { runLayerComparisonBenchmark } from "./suites/layer-comparison.js";
import type { BenchmarkSuite, SimulationConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Suite registry
// ---------------------------------------------------------------------------

export type SuiteName =
  | "token-efficiency"
  | "recall-precision"
  | "routing-accuracy"
  | "scale-stress"
  | "layer-comparison";

const SUITE_RUNNERS: Record<SuiteName, (config: SimulationConfig) => Promise<BenchmarkSuite>> = {
  "token-efficiency": runTokenEfficiencyBenchmark,
  "recall-precision": runRecallPrecisionBenchmark,
  "routing-accuracy": runRoutingAccuracyBenchmark,
  "scale-stress": runScaleStressBenchmark,
  "layer-comparison": runLayerComparisonBenchmark,
};

export const ALL_SUITE_NAMES: SuiteName[] = Object.keys(SUITE_RUNNERS) as SuiteName[];

// ---------------------------------------------------------------------------
// Run a single benchmark
// ---------------------------------------------------------------------------

/**
 * Run a specific benchmark suite by name.
 */
export async function runBenchmark(
  suiteName: SuiteName,
  config: SimulationConfig = DEFAULT_CONFIG
): Promise<BenchmarkSuite> {
  const runner = SUITE_RUNNERS[suiteName];
  if (!runner) {
    throw new Error(
      `Unknown benchmark suite: "${suiteName}". Available: ${ALL_SUITE_NAMES.join(", ")}`
    );
  }
  return runner(config);
}

// ---------------------------------------------------------------------------
// Run all benchmarks
// ---------------------------------------------------------------------------

/**
 * Run all benchmark suites and return results.
 */
export async function runAllBenchmarks(
  config: SimulationConfig = DEFAULT_CONFIG
): Promise<BenchmarkSuite[]> {
  const results: BenchmarkSuite[] = [];

  for (const name of ALL_SUITE_NAMES) {
    const suite = await runBenchmark(name, config);
    results.push(suite);
  }

  return results;
}
