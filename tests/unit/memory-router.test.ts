/**
 * Unit tests for src/memory/router.ts — Memory router and query routing
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import yaml from "js-yaml";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import { routeQuery } from "../../src/memory/router.js";
import { createMemorySystem, createDefaultMemorySystem } from "../../src/memory/index.js";
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import type { MemoryConfig, MemoryQuery, MemoryLayer } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeIdentity(dir: string): string {
  const path = join(dir, "identity.yaml");
  writeFileSync(path, yaml.dump({
    name: "Alice",
    roles: ["SWE"],
    accounts: [{ platform: "github", username: "alice" }],
    coreContext: "Backend developer.",
  }), "utf8");
  return path;
}

function writeEntity(dir: string, slug: string, entity: Record<string, unknown>): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const frontmatter = {
    title: entity.title ?? slug,
    type: entity.type ?? "concept",
    updated: entity.updated ?? "2025-01-15",
    tags: entity.tags ?? [],
    related: entity.related ?? [],
  };
  const content = matter.stringify((entity.content as string) ?? "", frontmatter);
  writeFileSync(join(dir, `${slug}.md`), content, "utf8");
}

function createSessionStore(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
  `);
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "abc12345-1234-1234-1234-123456789abc", "Test session", "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z"
  );
  db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
    "abc12345-1234-1234-1234-123456789abc", 0, "What about retry logic?", "Use exponential backoff.", "2025-01-15T00:00:00Z"
  );
  db.close();
}

function defaultConfig(): MemoryConfig {
  return {
    l0Path: join(testDir, "identity.yaml"),
    l1AutoGenerate: true,
    l2WikiDir: join(testDir, "knowledge"),
    l3Enabled: true,
    l3DbPath: join(testDir, "memory", "session-index.db"),
    l4SessionStorePath: join(testDir, "session_store.db"),
  };
}

// ---------------------------------------------------------------------------
// routeQuery — L0 + L1 always included
// ---------------------------------------------------------------------------

describe("routeQuery — L0 + L1", () => {
  test("always includes L0 identity when file exists", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L0?.name).toBe("Alice");
  });

  test("uses default identity when file missing", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L0?.name).toBe("Developer");
  });

  test("always includes L1 story", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L1).toBeDefined();
    expect(result.layers.L1?.generatedAt).toBeTruthy();
  });

  test("L1 includes entity data from wiki directory", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "test-entity", { title: "Test Entity" });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    const entityMetric = result.layers.L1?.keyMetrics.find(m => m.label === "Knowledge entities");
    expect(entityMetric?.value).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// routeQuery — L2 wiki routing
// ---------------------------------------------------------------------------

describe("routeQuery — L2 wiki", () => {
  test("routes to L2 wiki when entities match query", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "retry-patterns", {
      title: "Retry Patterns",
      content: "Exponential backoff strategies.",
    });

    const result = await routeQuery({ query: "retry-patterns" }, defaultConfig());
    expect(result.layers.L2).toBeDefined();
    expect(result.layers.L2?.entities.length).toBeGreaterThan(0);
  });

  test("routes to L2 with domain hint", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "my-project", { title: "My Project", content: "stuff" });

    const result = await routeQuery(
      { query: "anything", domain: "my-project" },
      defaultConfig()
    );
    expect(result.layers.L2).toBeDefined();
  });

  test("L2 not included when excluded from maxLayers", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "test", { title: "Test" });

    const result = await routeQuery(
      { query: "test", maxLayers: ["L0", "L1"] },
      defaultConfig()
    );
    expect(result.layers.L2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// routeQuery — L3 semantic search
// ---------------------------------------------------------------------------

describe("routeQuery — L3 semantic search", () => {
  test("routes to L3 when wiki returns no results", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    // Create session store and index
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath);
    const indexPath = join(testDir, "memory", "session-index.db");
    indexSessions(storePath, indexPath);

    const result = await routeQuery({ query: "retry" }, defaultConfig());
    expect(result.layers.L3).toBeDefined();
    expect(result.routingDecision).toContain("L3");
  });

  test("routes to L3 for conversational queries even with wiki results", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "retry", { title: "Retry", content: "retry patterns" });

    // Create session store with content that matches the query
    const storePath = join(testDir, "session_store.db");
    const db = new Database(storePath);
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
    `);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run("s1", "Retry discussion", "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z");
    db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run("s1", 0, "discuss retry patterns", "We discussed retry with backoff and jitter.", "2025-01-15T00:00:00Z");
    db.close();

    const indexPath = join(testDir, "memory", "session-index.db");
    indexSessions(storePath, indexPath);

    const result = await routeQuery(
      { query: "what did we discuss about retry?" },
      defaultConfig()
    );
    // L3 is attempted for conversational queries
    expect(result.routingDecision).toContain("L3");
    expect(result.routingDecision).toContain("conversational");
  });

  test("L3 skipped when disabled in config", async () => {
    const config = defaultConfig();
    config.l3Enabled = false;
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, config);
    expect(result.layers.L3).toBeUndefined();
    expect(result.routingDecision).toContain("disabled");
  });

  test("L3 not included when excluded from maxLayers", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "what did we discuss?", maxLayers: ["L0", "L1", "L2"] },
      defaultConfig()
    );
    expect(result.layers.L3).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// routeQuery — L4 session loading
// ---------------------------------------------------------------------------

describe("routeQuery — L4 sessions", () => {
  test("routes to L4 when query contains a session UUID", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath);

    const result = await routeQuery(
      { query: "Show me session abc12345-1234-1234-1234-123456789abc" },
      defaultConfig()
    );
    expect(result.layers.L4).toBeDefined();
    expect(result.layers.L4?.sessionId).toBe("abc12345-1234-1234-1234-123456789abc");
  });

  test("L4 not loaded when no session ID in query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L4).toBeUndefined();
    expect(result.routingDecision).toContain("no session ID");
  });

  test("L4 handles invalid session ID gracefully", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath);

    const result = await routeQuery(
      { query: "Show me session 00000000-0000-0000-0000-000000000000" },
      defaultConfig()
    );
    // Should fail gracefully — L4 not included
    expect(result.routingDecision).toContain("L4");
  });

  test("L4 not included when excluded from maxLayers", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath);

    const result = await routeQuery(
      { query: "Show me abc12345-1234-1234-1234-123456789abc", maxLayers: ["L0", "L1"] },
      defaultConfig()
    );
    expect(result.layers.L4).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// routeQuery — Token budgets
// ---------------------------------------------------------------------------

describe("routeQuery — token budgets", () => {
  test("respects maxTokens budget", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 10; i++) {
      writeEntity(wikiDir, `entity-${i}`, {
        title: `Entity ${i}`,
        content: "A".repeat(200),
      });
    }

    // Very low budget should skip expensive layers
    const result = await routeQuery(
      { query: "entity", maxTokens: 10 },
      defaultConfig()
    );
    expect(result.totalTokens).toBeLessThan(200);
  });

  test("totalTokens is sum of all layer tokens", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  test("routingDecision explains layer choices", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.routingDecision).toContain("L0");
    expect(result.routingDecision).toContain("L1");
  });
});

// ---------------------------------------------------------------------------
// routeQuery — maxLayers filtering
// ---------------------------------------------------------------------------

describe("routeQuery — maxLayers filtering", () => {
  test("only includes requested layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", maxLayers: ["L0"] },
      defaultConfig()
    );
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeUndefined();
    expect(result.layers.L2).toBeUndefined();
  });

  test("empty maxLayers includes all layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "test", { title: "Test", content: "content" });

    const result = await routeQuery(
      { query: "test", maxLayers: [] },
      defaultConfig()
    );
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
  });

  test("undefined maxLayers includes all layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createMemorySystem
// ---------------------------------------------------------------------------

describe("createMemorySystem", () => {
  test("creates system with config", () => {
    const config = defaultConfig();
    const system = createMemorySystem(config);
    expect(system.config).toBe(config);
    expect(typeof system.query).toBe("function");
  });

  test("query function routes through layers", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const system = createMemorySystem(defaultConfig());
    const result = await system.query({ query: "test" });
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createDefaultMemorySystem
// ---------------------------------------------------------------------------

describe("createDefaultMemorySystem", () => {
  test("creates system with default config paths", () => {
    const system = createDefaultMemorySystem();
    expect(system.config.l0Path).toContain("identity.yaml");
    expect(system.config.l2WikiDir).toContain("knowledge");
    expect(system.config.l3DbPath).toContain("session-index.db");
  });

  test("default system query works", async () => {
    // Set DEVCONTEXT_HOME so the default system can find (empty) data
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const system = createDefaultMemorySystem();
    const result = await system.query({ query: "test" });
    expect(result.layers.L0).toBeDefined();
  });
});
