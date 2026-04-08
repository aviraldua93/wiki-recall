/**
 * Recall & Precision Benchmark — measures information retrieval quality.
 *
 * Generates test queries with known ground truth, runs them through the
 * memory router, and measures recall (did we find the right info?) and
 * precision (did we avoid noise?). Breaks down by query type.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import matter from "gray-matter";
import { Database } from "bun:sqlite";
import { routeQuery } from "../../src/memory/router.js";
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import { measureRecall, measurePrecision } from "../metrics.js";
import { generateMockEntities, generateMockSessions, generateTestQueries } from "../generators.js";
import type { MemoryConfig, MemoryLayer, MemoryResponse } from "../../src/memory/types.js";
import type { BenchmarkSuite, BenchmarkResult, SimulationConfig, TestQuery } from "../types.js";

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

function setupTestEnvironment(config: SimulationConfig): {
  dir: string;
  memConfig: MemoryConfig;
  queries: TestQuery[];
} {
  const dir = join(
    tmpdir(),
    `wikirecall-bench-recall-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  const entities = generateMockEntities(config.entityCount, config.seed);
  const sessions = generateMockSessions(config.sessionCount, config.seed);
  const queries = generateTestQueries(entities, sessions, config.queryCount);

  // Write entities
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

  // Write sessions
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

  // Identity
  const identityPath = join(dir, "identity.yaml");
  writeFileSync(identityPath, yaml.dump({
    name: "Benchmark User",
    roles: ["Software Engineer"],
    accounts: [],
    coreContext: "Developer focused on distributed systems.",
  }), "utf8");

  // Index for L3
  const indexPath = join(dir, "memory", "session-index.db");
  mkdirSync(join(dir, "memory"), { recursive: true });
  indexSessions(storePath, indexPath);

  const memConfig: MemoryConfig = {
    l0Path: identityPath,
    l1AutoGenerate: true,
    l2WikiDir: wikiDir,
    l3Enabled: true,
    l3DbPath: indexPath,
    l4SessionStorePath: storePath,
  };

  return { dir, memConfig, queries };
}

// ---------------------------------------------------------------------------
// Recall & Precision Suite
// ---------------------------------------------------------------------------

export async function runRecallPrecisionBenchmark(
  config: SimulationConfig
): Promise<BenchmarkSuite> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];

  const originalHome = process.env.WIKIRECALL_HOME;
  const { dir, memConfig, queries } = setupTestEnvironment(config);
  process.env.WIKIRECALL_HOME = dir;

  try {
    // Group queries by expected layer
    const queryGroups = new Map<MemoryLayer, TestQuery[]>();
    for (const q of queries) {
      const group = queryGroups.get(q.expectedLayer) ?? [];
      group.push(q);
      queryGroups.set(q.expectedLayer, group);
    }

    // Run all queries and collect responses
    const allResponses: MemoryResponse[] = [];
    const allGroundTruth: string[] = [];

    for (const q of queries) {
      const response = await routeQuery({ query: q.query }, memConfig);
      allResponses.push(response);
      allGroundTruth.push(q.groundTruth);
    }

    // Overall recall and precision
    const overallRecall = measureRecall(allResponses, allGroundTruth);
    const overallPrecision = measurePrecision(allResponses, allGroundTruth);

    results.push({
      name: "Overall",
      metric: "recall",
      value: Math.round(overallRecall * 10000) / 100,
      unit: "%",
      details: { queryCount: queries.length },
    });

    results.push({
      name: "Overall",
      metric: "precision",
      value: Math.round(overallPrecision * 10000) / 100,
      unit: "%",
      details: { queryCount: queries.length },
    });

    // Per-layer breakdown
    for (const [layer, layerQueries] of queryGroups) {
      const layerResponses: MemoryResponse[] = [];
      const layerTruth: string[] = [];

      for (const q of layerQueries) {
        const response = await routeQuery({ query: q.query }, memConfig);
        layerResponses.push(response);
        layerTruth.push(q.groundTruth);
      }

      const recall = measureRecall(layerResponses, layerTruth);
      const precision = measurePrecision(layerResponses, layerTruth);

      results.push({
        name: `Layer ${layer}`,
        metric: "recall",
        value: Math.round(recall * 10000) / 100,
        unit: "%",
        details: { queryCount: layerQueries.length, layer },
      });

      results.push({
        name: `Layer ${layer}`,
        metric: "precision",
        value: Math.round(precision * 10000) / 100,
        unit: "%",
        details: { queryCount: layerQueries.length, layer },
      });
    }

    const completedAt = new Date().toISOString();
    return {
      name: "recall-precision",
      description: "Recall and precision across query types and memory layers",
      results,
      startedAt,
      completedAt,
      summary: `Overall: ${Math.round(overallRecall * 100)}% recall, ${Math.round(overallPrecision * 100)}% precision across ${queries.length} queries. ${config.entityCount} entities, ${config.sessionCount} sessions.`,
    };
  } finally {
    process.env.WIKIRECALL_HOME = originalHome;
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
