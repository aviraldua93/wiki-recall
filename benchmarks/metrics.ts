/**
 * Benchmark Metrics — measurement functions for memory system evaluation.
 *
 * Provides recall, precision, token efficiency, latency, and routing
 * accuracy measurements. All functions are pure — no side effects.
 */

import type { MemoryResponse, MemoryLayer } from "../src/memory/types.js";
import type { LatencyStats, TokenStats } from "./types.js";

// ---------------------------------------------------------------------------
// Text extraction — pull searchable text from a MemoryResponse
// ---------------------------------------------------------------------------

function extractResponseText(response: MemoryResponse): string {
  const parts: string[] = [];

  if (response.layers.L0) {
    parts.push(response.layers.L0.name);
    parts.push(response.layers.L0.roles.join(" "));
    parts.push(response.layers.L0.coreContext);
  }

  if (response.layers.L1) {
    for (const m of response.layers.L1.topMoments) {
      parts.push(m.event, m.significance);
    }
    for (const p of response.layers.L1.activeProjects) {
      parts.push(p.name, p.status);
    }
  }

  if (response.layers.L2) {
    for (const e of response.layers.L2.entities) {
      parts.push(e.title, e.type, e.excerpt);
    }
  }

  if (response.layers.L3) {
    for (const m of response.layers.L3.matches) {
      parts.push(m.content);
    }
  }

  if (response.layers.L4) {
    for (const t of response.layers.L4.turns) {
      parts.push(t.content);
    }
  }

  return parts.join(" ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Recall — % of relevant info found
// ---------------------------------------------------------------------------

/**
 * Measure recall: what fraction of ground truth items appear in the results.
 *
 * Each ground truth string is checked for presence in the response text.
 * Returns a value between 0 and 1.
 */
export function measureRecall(
  results: MemoryResponse[],
  groundTruth: string[]
): number {
  if (groundTruth.length === 0) return 1;
  if (results.length === 0) return 0;

  const allText = results.map(r => extractResponseText(r)).join(" ");
  let found = 0;

  for (const truth of groundTruth) {
    const keywords = truth.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matchedKeywords = keywords.filter(kw => allText.includes(kw));
    if (matchedKeywords.length >= Math.max(1, Math.ceil(keywords.length * 0.5))) {
      found++;
    }
  }

  return found / groundTruth.length;
}

// ---------------------------------------------------------------------------
// Precision — % of returned info that's relevant
// ---------------------------------------------------------------------------

/**
 * Measure precision: what fraction of returned content is relevant to ground truth.
 *
 * Splits response text into chunks and checks each against ground truth keywords.
 * Returns a value between 0 and 1.
 */
export function measurePrecision(
  results: MemoryResponse[],
  groundTruth: string[]
): number {
  if (results.length === 0) return 1;
  if (groundTruth.length === 0) return 0;

  const truthKeywords = new Set(
    groundTruth
      .flatMap(t => t.toLowerCase().split(/\s+/))
      .filter(w => w.length > 2)
  );

  let totalChunks = 0;
  let relevantChunks = 0;

  for (const result of results) {
    const layers = getActiveLayers(result);
    totalChunks += layers.length;

    for (const layer of layers) {
      const text = getLayerText(result, layer).toLowerCase();
      const words = text.split(/\s+/).filter(w => w.length > 2);
      const overlap = words.filter(w => truthKeywords.has(w)).length;
      if (overlap > 0 || words.length === 0) {
        relevantChunks++;
      }
    }
  }

  return totalChunks > 0 ? relevantChunks / totalChunks : 1;
}

// ---------------------------------------------------------------------------
// Token efficiency — distribution of token counts
// ---------------------------------------------------------------------------

/**
 * Measure token efficiency across multiple responses.
 *
 * Returns average, p50, p95, and p99 token counts.
 */
export function measureTokenEfficiency(results: MemoryResponse[]): TokenStats {
  if (results.length === 0) {
    return { avgTokens: 0, p50: 0, p95: 0, p99: 0 };
  }

  const tokens = results.map(r => r.totalTokens).sort((a, b) => a - b);

  return {
    avgTokens: Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length),
    p50: percentile(tokens, 0.5),
    p95: percentile(tokens, 0.95),
    p99: percentile(tokens, 0.99),
  };
}

// ---------------------------------------------------------------------------
// Latency — time distribution for async operations
// ---------------------------------------------------------------------------

/**
 * Measure latency of an async function over multiple iterations.
 *
 * Returns average, p50, p95, and p99 in milliseconds.
 */
export async function measureLatency(
  fn: () => Promise<unknown>,
  iterations: number
): Promise<LatencyStats> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);

  return {
    avgMs: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
    p50: Math.round(percentile(times, 0.5) * 100) / 100,
    p95: Math.round(percentile(times, 0.95) * 100) / 100,
    p99: Math.round(percentile(times, 0.99) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Routing accuracy — % of queries routed to the correct layer
// ---------------------------------------------------------------------------

/**
 * Measure routing accuracy: what fraction of queries were routed to the
 * expected layer(s).
 *
 * Returns a value between 0 and 1.
 */
export function measureRoutingAccuracy(
  results: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[]
): number {
  if (results.length === 0) return 1;

  let correct = 0;
  for (const r of results) {
    if (r.actualLayers.includes(r.expectedLayer)) {
      correct++;
    }
  }

  return correct / results.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function getActiveLayers(response: MemoryResponse): MemoryLayer[] {
  const layers: MemoryLayer[] = [];
  if (response.layers.L0) layers.push("L0");
  if (response.layers.L1) layers.push("L1");
  if (response.layers.L2) layers.push("L2");
  if (response.layers.L3) layers.push("L3");
  if (response.layers.L4) layers.push("L4");
  return layers;
}

function getLayerText(response: MemoryResponse, layer: MemoryLayer): string {
  switch (layer) {
    case "L0":
      return response.layers.L0
        ? `${response.layers.L0.name} ${response.layers.L0.roles.join(" ")} ${response.layers.L0.coreContext}`
        : "";
    case "L1":
      return response.layers.L1
        ? response.layers.L1.topMoments.map(m => m.event).join(" ")
        : "";
    case "L2":
      return response.layers.L2
        ? response.layers.L2.entities.map(e => `${e.title} ${e.excerpt}`).join(" ")
        : "";
    case "L3":
      return response.layers.L3
        ? response.layers.L3.matches.map(m => m.content).join(" ")
        : "";
    case "L4":
      return response.layers.L4
        ? response.layers.L4.turns.map(t => t.content).join(" ")
        : "";
  }
}

/**
 * Estimate token count from a string (chars / 4 — matches codebase pattern).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
