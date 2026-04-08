/**
 * Token Efficiency Benchmark — measures token usage across layer combinations.
 *
 * Compares token cost of each layer combination against a "dump everything"
 * baseline. Proves that the layered approach saves significant tokens.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import matter from "gray-matter";
import { Database } from "bun:sqlite";
import { routeQuery } from "../../src/memory/router.js";
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import { estimateTokens } from "../metrics.js";
import { generateMockEntities, generateMockSessions } from "../generators.js";
import type { MemoryConfig, MemoryLayer } from "../../src/memory/types.js";
import type { BenchmarkSuite, BenchmarkResult, SimulationConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTestEnvironment(config: SimulationConfig): {
  dir: string;
  memConfig: MemoryConfig;
  baselineTokens: number;
} {
  const dir = join(
    tmpdir(),
    `wikirecall-bench-tokens-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  // Generate entities and write as markdown files
  const entities = generateMockEntities(config.entityCount, config.seed);
  const wikiDir = join(dir, "knowledge");
  mkdirSync(wikiDir, { recursive: true });

  let allContent = "";

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const slug = entity.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const frontmatter = {
      title: entity.title,
      type: entity.type,
      updated: entity.updated,
      tags: entity.tags ?? [],
      related: entity.related ?? [],
    };
    const content = matter.stringify(entity.content ?? "", frontmatter);
    writeFileSync(join(wikiDir, `${slug}.md`), content, "utf8");
    allContent += entity.content ?? "";
  }

  // Generate sessions and write to session store
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
      const turn = session.turns[j];
      if (turn.role === "user") {
        db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
          session.id, Math.floor(j / 2), turn.content, null, "2025-01-15T00:00:00Z"
        );
      } else {
        db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
          session.id, Math.floor(j / 2), null, turn.content, "2025-01-15T00:00:00Z"
        );
      }
      allContent += turn.content;
    }
  }
  db.close();

  // Write identity
  const identityPath = join(dir, "identity.yaml");
  writeFileSync(identityPath, yaml.dump({
    name: "Benchmark User",
    roles: ["Software Engineer", "Tech Lead"],
    accounts: [{ platform: "github", username: "bench-user" }],
    coreContext: "Full-stack developer working on distributed systems.",
  }), "utf8");

  // Index sessions for L3
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

  // Baseline: total tokens if we dump EVERYTHING into context
  const baselineTokens = estimateTokens(allContent);

  return { dir, memConfig, baselineTokens };
}

function cleanup(dir: string): void {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Token Efficiency Suite
// ---------------------------------------------------------------------------

type LayerCombo = { name: string; layers: MemoryLayer[] };

const LAYER_COMBOS: LayerCombo[] = [
  { name: "L0 only", layers: ["L0"] },
  { name: "L0 + L1", layers: ["L0", "L1"] },
  { name: "L0 + L1 + L2", layers: ["L0", "L1", "L2"] },
  { name: "L0 + L1 + L2 + L3", layers: ["L0", "L1", "L2", "L3"] },
  { name: "Full stack (L0–L4)", layers: ["L0", "L1", "L2", "L3", "L4"] },
];

const TEST_QUERIES = [
  "how does the authentication system work?",
  "what did we discuss about rate limiting?",
  "what am I working on?",
  "explain the caching strategy",
  "who am I?",
];

export async function runTokenEfficiencyBenchmark(
  config: SimulationConfig
): Promise<BenchmarkSuite> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];

  // Set up isolated test env
  const originalHome = process.env.WIKIRECALL_HOME;
  const { dir, memConfig, baselineTokens } = setupTestEnvironment(config);
  process.env.WIKIRECALL_HOME = dir;

  try {
    // Measure tokens for each layer combination
    for (const combo of LAYER_COMBOS) {
      const tokenCounts: number[] = [];

      for (const q of TEST_QUERIES) {
        const response = await routeQuery(
          { query: q, maxLayers: combo.layers },
          memConfig
        );
        tokenCounts.push(response.totalTokens);
      }

      const avgTokens = Math.round(
        tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length
      );
      const maxTokens = Math.max(...tokenCounts);
      const savings = baselineTokens > 0
        ? Math.round((1 - avgTokens / baselineTokens) * 10000) / 100
        : 0;

      results.push({
        name: combo.name,
        metric: "avg_tokens",
        value: avgTokens,
        unit: "tokens",
        details: { maxTokens, queryCount: TEST_QUERIES.length },
      });

      results.push({
        name: combo.name,
        metric: "token_savings_vs_baseline",
        value: savings,
        unit: "%",
        details: { baselineTokens, layerTokens: avgTokens },
      });
    }

    // Add baseline measurement
    results.push({
      name: "Baseline (dump everything)",
      metric: "total_tokens",
      value: baselineTokens,
      unit: "tokens",
      details: {
        entityCount: config.entityCount,
        sessionCount: config.sessionCount,
      },
    });

    const fullStackResult = results.find(
      r => r.name === "Full stack (L0–L4)" && r.metric === "token_savings_vs_baseline"
    );

    const completedAt = new Date().toISOString();
    return {
      name: "token-efficiency",
      description: "Token usage across layer combinations vs dump-everything baseline",
      results,
      startedAt,
      completedAt,
      summary: `Full stack uses ~${fullStackResult?.details?.layerTokens ?? "??"} tokens vs ${baselineTokens} baseline (${fullStackResult?.value ?? "??"}% savings). ${config.entityCount} entities, ${config.sessionCount} sessions.`,
    };
  } finally {
    process.env.WIKIRECALL_HOME = originalHome;
    cleanup(dir);
  }
}
