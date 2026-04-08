/**
 * Routing Accuracy Benchmark — measures query-to-layer routing correctness.
 *
 * Tests that queries route to the correct memory layer(s):
 *   "who am I?" → L0
 *   "what's the project status?" → L1
 *   "how does X architecture work?" → L2
 *   "what did we discuss about Y?" → L3
 *   "show me session <uuid>" → L4
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import matter from "gray-matter";
import { Database } from "bun:sqlite";
import { routeQuery } from "../../src/memory/router.js";
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import { measureRoutingAccuracy } from "../metrics.js";
import { generateMockEntities, generateMockSessions, generateTestQueries } from "../generators.js";
import type { MemoryConfig, MemoryLayer, MemoryResponse } from "../../src/memory/types.js";
import type { BenchmarkSuite, BenchmarkResult, SimulationConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Detect active layers in a response
// ---------------------------------------------------------------------------

function getActiveLayers(response: MemoryResponse): MemoryLayer[] {
  const layers: MemoryLayer[] = [];
  if (response.layers.L0) layers.push("L0");
  if (response.layers.L1) layers.push("L1");
  if (response.layers.L2) layers.push("L2");
  if (response.layers.L3) layers.push("L3");
  if (response.layers.L4) layers.push("L4");
  return layers;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupTestEnvironment(config: SimulationConfig): {
  dir: string;
  memConfig: MemoryConfig;
} {
  const dir = join(
    tmpdir(),
    `wikirecall-bench-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  const entities = generateMockEntities(config.entityCount, config.seed);
  const wikiDir = join(dir, "knowledge");
  mkdirSync(wikiDir, { recursive: true });
  for (const entity of entities) {
    const slug = entity.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const frontmatter = {
      title: entity.title,
      type: entity.type,
      updated: entity.updated,
      tags: entity.tags ?? [],
      related: entity.related ?? [],
    };
    writeFileSync(join(wikiDir, `${slug}.md`), matter.stringify(entity.content ?? "", frontmatter), "utf8");
  }

  const sessions = generateMockSessions(config.sessionCount, config.seed);
  const storePath = join(dir, "session_store.db");
  const db = new Database(storePath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
  `);
  for (const session of sessions) {
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      session.id, `Session ${session.id.slice(0, 8)}`, "main", "org/repo", "/",
      "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z"
    );
    for (let j = 0; j < session.turns.length; j++) {
      const t = session.turns[j];
      db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
        session.id, Math.floor(j / 2),
        t.role === "user" ? t.content : null,
        t.role === "assistant" ? t.content : null,
        "2025-01-15T00:00:00Z"
      );
    }
  }
  db.close();

  const identityPath = join(dir, "identity.yaml");
  writeFileSync(identityPath, yaml.dump({
    name: "Benchmark User",
    roles: ["Software Engineer"],
    accounts: [{ platform: "github", username: "bench-user" }],
    coreContext: "Full-stack developer.",
  }), "utf8");

  const indexPath = join(dir, "memory", "session-index.db");
  mkdirSync(join(dir, "memory"), { recursive: true });
  indexSessions(storePath, indexPath);

  return {
    dir,
    memConfig: {
      l0Path: identityPath,
      l1AutoGenerate: true,
      l2WikiDir: wikiDir,
      l3Enabled: true,
      l3DbPath: indexPath,
      l4SessionStorePath: storePath,
    },
  };
}

// ---------------------------------------------------------------------------
// Routing Accuracy Suite
// ---------------------------------------------------------------------------

interface RoutingTestCase {
  query: string;
  expectedLayer: MemoryLayer;
  description: string;
}

export async function runRoutingAccuracyBenchmark(
  config: SimulationConfig
): Promise<BenchmarkSuite> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];

  const originalHome = process.env.WIKIRECALL_HOME;
  const { dir, memConfig } = setupTestEnvironment(config);
  process.env.WIKIRECALL_HOME = dir;

  try {
    // Fixed test cases for deterministic routing evaluation
    const testCases: RoutingTestCase[] = [
      // L0 identity queries
      { query: "who am I?", expectedLayer: "L0", description: "Identity question" },
      { query: "what are my roles?", expectedLayer: "L0", description: "Role question" },
      { query: "show my developer profile", expectedLayer: "L0", description: "Profile request" },
      { query: "what's my name?", expectedLayer: "L0", description: "Name question" },
      { query: "my accounts", expectedLayer: "L0", description: "Accounts question" },

      // L1 story queries
      { query: "what am I working on?", expectedLayer: "L1", description: "Active work question" },
      { query: "what are my key metrics?", expectedLayer: "L1", description: "Metrics question" },
      { query: "summarize my recent activity", expectedLayer: "L1", description: "Activity summary" },
      { query: "what projects are active?", expectedLayer: "L1", description: "Project status" },

      // L2 wiki queries
      { query: "how does the authentication architecture work?", expectedLayer: "L2", description: "Architecture question" },
      { query: "explain the caching-strategy concept", expectedLayer: "L2", description: "Concept question" },
      { query: "what is rate-limiting?", expectedLayer: "L2", description: "Definition question" },

      // L3 conversational/search queries
      { query: "what did we discuss about rate limiting?", expectedLayer: "L3", description: "Past discussion" },
      { query: "when did we talk about the retry handler?", expectedLayer: "L3", description: "Temporal question" },
      { query: "remember when we discussed caching?", expectedLayer: "L3", description: "Memory recall" },
      { query: "previous conversation about monitoring", expectedLayer: "L3", description: "Previous session" },
      { query: "last time we discussed security", expectedLayer: "L3", description: "Last discussion" },
      { query: "what did I say about performance?", expectedLayer: "L3", description: "Self-reference" },
      { query: "history of our API versioning discussions", expectedLayer: "L3", description: "History query" },

      // L4 session queries (with UUID)
      { query: "show me session 12345678-1234-1234-1234-123456789abc", expectedLayer: "L4", description: "Session by UUID" },
      { query: "load session 87654321-4321-4321-4321-cba987654321", expectedLayer: "L4", description: "Session load" },
    ];

    // Run each test case
    const routingResults: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [];
    const perLayerResults = new Map<MemoryLayer, { correct: number; total: number }>();

    for (const tc of testCases) {
      const response = await routeQuery({ query: tc.query }, memConfig);
      const activeLayers = getActiveLayers(response);
      routingResults.push({ expectedLayer: tc.expectedLayer, actualLayers: activeLayers });

      const entry = perLayerResults.get(tc.expectedLayer) ?? { correct: 0, total: 0 };
      entry.total++;
      if (activeLayers.includes(tc.expectedLayer)) {
        entry.correct++;
      }
      perLayerResults.set(tc.expectedLayer, entry);
    }

    // Overall accuracy
    const overallAccuracy = measureRoutingAccuracy(routingResults);

    results.push({
      name: "Overall Routing",
      metric: "accuracy",
      value: Math.round(overallAccuracy * 10000) / 100,
      unit: "%",
      details: { testCaseCount: testCases.length },
    });

    // Per-layer accuracy
    for (const [layer, stats] of perLayerResults) {
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
      results.push({
        name: `Layer ${layer}`,
        metric: "routing_accuracy",
        value: Math.round(accuracy * 10000) / 100,
        unit: "%",
        details: { correct: stats.correct, total: stats.total },
      });
    }

    // Also run generated queries for broader coverage
    const entities = generateMockEntities(config.entityCount, config.seed);
    const sessions = generateMockSessions(config.sessionCount, config.seed);
    const genQueries = generateTestQueries(entities, sessions, Math.min(config.queryCount, 50));

    const genResults: { expectedLayer: MemoryLayer; actualLayers: MemoryLayer[] }[] = [];
    for (const q of genQueries) {
      const response = await routeQuery({ query: q.query }, memConfig);
      genResults.push({ expectedLayer: q.expectedLayer, actualLayers: getActiveLayers(response) });
    }

    const genAccuracy = measureRoutingAccuracy(genResults);
    results.push({
      name: "Generated Queries",
      metric: "routing_accuracy",
      value: Math.round(genAccuracy * 10000) / 100,
      unit: "%",
      details: { queryCount: genQueries.length },
    });

    const completedAt = new Date().toISOString();
    return {
      name: "routing-accuracy",
      description: "Query routing accuracy to correct memory layer(s)",
      results,
      startedAt,
      completedAt,
      summary: `Overall routing accuracy: ${Math.round(overallAccuracy * 100)}% across ${testCases.length} fixed test cases. Generated query accuracy: ${Math.round(genAccuracy * 100)}% across ${genQueries.length} queries.`,
    };
  } finally {
    process.env.WIKIRECALL_HOME = originalHome;
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
