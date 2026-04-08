/**
 * Scale Stress Test — measures performance under increasing entity counts.
 *
 * Runs with 10, 50, 100, 500, 1000 entities and measures search latency,
 * index rebuild time, and memory usage to find the performance ceiling.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import matter from "gray-matter";
import { Database } from "bun:sqlite";
import { routeQuery } from "../../src/memory/router.js";
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import { measureLatency } from "../metrics.js";
import { generateMockEntities, generateMockSessions } from "../generators.js";
import type { MemoryConfig } from "../../src/memory/types.js";
import type { BenchmarkSuite, BenchmarkResult, SimulationConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupScaleEnvironment(entityCount: number, sessionCount: number, seed: number): {
  dir: string;
  memConfig: MemoryConfig;
} {
  const dir = join(
    tmpdir(),
    `devcontext-bench-scale-${entityCount}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  const entities = generateMockEntities(entityCount, seed);
  const wikiDir = join(dir, "knowledge");
  mkdirSync(wikiDir, { recursive: true });
  for (const entity of entities) {
    const slug = entity.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    writeFileSync(
      join(wikiDir, `${slug}.md`),
      matter.stringify(entity.content ?? "", {
        title: entity.title,
        type: entity.type,
        updated: entity.updated,
        tags: entity.tags ?? [],
        related: entity.related ?? [],
      }),
      "utf8"
    );
  }

  const sessions = generateMockSessions(sessionCount, seed);
  const storePath = join(dir, "session_store.db");
  const db = new Database(storePath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
  `);
  for (const session of sessions) {
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      session.id, `Session`, "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z"
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
    name: "Scale Test User",
    roles: ["Engineer"],
    accounts: [],
    coreContext: "Testing at scale.",
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
// Scale Stress Suite
// ---------------------------------------------------------------------------

const SCALE_LEVELS = [10, 50, 100, 500, 1000];
const SCALE_QUERIES = [
  "how does the authentication system work?",
  "what did we discuss about caching?",
  "explain the rate limiting architecture",
];

export async function runScaleStressBenchmark(
  config: SimulationConfig
): Promise<BenchmarkSuite> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];
  const originalHome = process.env.DEVCONTEXT_HOME;
  const dirsToClean: string[] = [];

  try {
    for (const entityCount of SCALE_LEVELS) {
      const sessionCount = Math.min(entityCount * 2, config.sessionCount);
      const { dir, memConfig } = setupScaleEnvironment(entityCount, sessionCount, config.seed);
      dirsToClean.push(dir);
      process.env.DEVCONTEXT_HOME = dir;

      // Measure search latency
      const searchLatency = await measureLatency(async () => {
        for (const q of SCALE_QUERIES) {
          await routeQuery({ query: q }, memConfig);
        }
      }, 3);

      results.push({
        name: `${entityCount} entities`,
        metric: "search_latency_avg",
        value: searchLatency.avgMs,
        unit: "ms",
        details: { entityCount, sessionCount, p50: searchLatency.p50, p95: searchLatency.p95 },
      });

      // Measure index rebuild time
      const rebuildLatency = await measureLatency(async () => {
        indexSessions(memConfig.l4SessionStorePath, memConfig.l3DbPath);
      }, 3);

      results.push({
        name: `${entityCount} entities`,
        metric: "index_rebuild_time",
        value: rebuildLatency.avgMs,
        unit: "ms",
        details: { entityCount, sessionCount },
      });

      // Memory usage (approximate via process.memoryUsage)
      const memUsage = process.memoryUsage();
      results.push({
        name: `${entityCount} entities`,
        metric: "heap_used_mb",
        value: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
        unit: "MB",
        details: { rss: Math.round(memUsage.rss / 1024 / 1024) },
      });
    }

    // Find degradation point
    const latencies = results
      .filter(r => r.metric === "search_latency_avg")
      .map(r => ({ entities: parseInt(r.name), latency: r.value }));

    let degradationPoint = "none detected";
    for (let i = 1; i < latencies.length; i++) {
      const ratio = latencies[i].latency / latencies[i - 1].latency;
      if (ratio > 3) {
        degradationPoint = `${latencies[i].entities} entities (${ratio.toFixed(1)}x slowdown)`;
        break;
      }
    }

    results.push({
      name: "Degradation",
      metric: "performance_ceiling",
      value: latencies[latencies.length - 1]?.latency ?? 0,
      unit: "ms",
      details: { degradationPoint, scaleLevels: SCALE_LEVELS },
    });

    const completedAt = new Date().toISOString();
    return {
      name: "scale-stress",
      description: "Performance under increasing entity counts (10 to 1000)",
      results,
      startedAt,
      completedAt,
      summary: `Tested ${SCALE_LEVELS.join(", ")} entities. Degradation: ${degradationPoint}. Max latency: ${latencies[latencies.length - 1]?.latency.toFixed(1) ?? "??"}ms at ${SCALE_LEVELS[SCALE_LEVELS.length - 1]} entities.`,
    };
  } finally {
    process.env.DEVCONTEXT_HOME = originalHome;
    for (const dir of dirsToClean) {
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
}
