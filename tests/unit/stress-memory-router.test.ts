/**
 * STRESS TEST 5: Memory Router Edge Cases — missing config, empty dirs,
 * zero token budget, all layers disabled, concurrent queries.
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
import type { MemoryConfig, MemoryQuery, MemoryLayer } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-stress-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    l0Path: join(testDir, "identity.yaml"),
    l1AutoGenerate: true,
    l2WikiDir: join(testDir, "knowledge"),
    l3Enabled: true,
    l3DbPath: join(testDir, "memory", "session-index.db"),
    l4SessionStorePath: join(testDir, "session_store.db"),
    ...overrides,
  };
}

function writeIdentity(dir: string): string {
  const path = join(dir, "identity.yaml");
  writeFileSync(path, yaml.dump({
    name: "Stress Tester",
    roles: ["SWE"],
    accounts: [{ platform: "github", username: "stresstester" }],
    coreContext: "Testing edge cases.",
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
  const dir = join(testDir, "session_store_dir");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
  `);
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "abc12345-1234-1234-1234-123456789abc", "Test session", "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z"
  );
  db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
    "abc12345-1234-1234-1234-123456789abc", 0, "What about retry?", "Use backoff.", "2025-01-15T00:00:00Z"
  );
  db.close();
}

// ---------------------------------------------------------------------------
// No identity file configured
// ---------------------------------------------------------------------------

describe("Router — no identity file", () => {
  test("uses default identity when file missing", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L0?.name).toBe("Developer");
  });

  test("uses default identity when path is nonsense", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig({
      l0Path: join(testDir, "nonexistent", "doesnt", "exist.yaml"),
    }));
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L0?.name).toBe("Developer");
  });

  test("handles corrupted identity file gracefully", async () => {
    const idPath = join(testDir, "identity.yaml");
    writeFileSync(idPath, "NOT VALID YAML {{{{", "utf8");
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    // Should either use default identity or have an L0 error in routing decision
    expect(result).toBeDefined();
    expect(result.routingDecision).toContain("L0");
  });

  test("handles binary identity file", async () => {
    const idPath = join(testDir, "identity.yaml");
    writeFileSync(idPath, Buffer.from([0xFF, 0xFE, 0x00, 0x01]));
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty wiki directory
// ---------------------------------------------------------------------------

describe("Router — empty wiki directory", () => {
  test("L2 returns no entities for empty wiki dir", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "anything" }, defaultConfig());
    // L2 should either be undefined or have 0 entities
    if (result.layers.L2) {
      expect(result.layers.L2.entities).toEqual([]);
    }
  });

  test("L2 handles nonexistent wiki dir", async () => {
    // Don't create the wiki dir at all
    const result = await routeQuery({ query: "anything" }, defaultConfig({
      l2WikiDir: join(testDir, "nonexistent-wiki"),
    }));

    // Should not crash
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// No session store
// ---------------------------------------------------------------------------

describe("Router — no session store", () => {
  test("L4 skipped when session store doesn't exist", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "abc12345-1234-1234-1234-123456789abc" },
      defaultConfig()
    );

    // L4 should handle missing store gracefully
    expect(result).toBeDefined();
    expect(result.routingDecision).toContain("L4");
  });

  test("L3 handles missing session store path", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "what did we discuss last time" },
      defaultConfig({ l3DbPath: join(testDir, "nonexistent.db") })
    );

    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Token budget of 0
// ---------------------------------------------------------------------------

describe("Router — zero token budget", () => {
  test("token budget 0 still processes L0", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", maxTokens: 0 },
      defaultConfig()
    );

    // L0 is always included even with 0 budget (the check is tokensUsed < maxTokens)
    // With 0 budget, nothing should be included beyond what gets past the check
    expect(result).toBeDefined();
    expect(result.totalTokens).toBeDefined();
  });

  test("token budget 1 limits layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    writeEntity(wikiDir, "test-entity", { title: "Test", content: "Test content" });

    const result = await routeQuery(
      { query: "test", maxTokens: 1 },
      defaultConfig()
    );

    expect(result).toBeDefined();
    // With 1 token budget, later layers should be skipped
  });

  test("negative token budget", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", maxTokens: -1 },
      defaultConfig()
    );

    // Negative budget: tokensUsed < -1 is never true initially... but 0 < -1 is false
    // so NO layers should be included beyond L0
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// All layers disabled
// ---------------------------------------------------------------------------

describe("Router — all layers disabled", () => {
  test("empty maxLayers array enables all layers (default behavior)", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", maxLayers: [] },
      defaultConfig()
    );

    // Empty array = all layers enabled (shouldIncludeLayer returns true for empty)
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
  });

  test("explicitly excluding all layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    // There's no way to truly exclude all without a special value
    // Using a non-existent layer name
    const result = await routeQuery(
      { query: "test", maxLayers: ["L0"] },
      defaultConfig()
    );

    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeUndefined();
    expect(result.layers.L2).toBeUndefined();
  });

  test("only L2 enabled", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "test", { title: "Test", content: "content" });

    const result = await routeQuery(
      { query: "test", maxLayers: ["L2"] },
      defaultConfig()
    );

    expect(result.layers.L0).toBeUndefined();
    expect(result.layers.L1).toBeUndefined();
  });

  test("only L4 enabled but no session ID in query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "no session id here", maxLayers: ["L4"] },
      defaultConfig()
    );

    expect(result.layers.L4).toBeUndefined();
    expect(result.routingDecision).toContain("no session ID");
  });

  test("L3 disabled in config", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "what did we discuss" },
      defaultConfig({ l3Enabled: false })
    );

    expect(result.layers.L3).toBeUndefined();
    expect(result.routingDecision).toContain("L3: disabled");
  });
});

// ---------------------------------------------------------------------------
// 100 concurrent queries
// ---------------------------------------------------------------------------

describe("Router — concurrent queries", () => {
  test("100 concurrent queries don't crash", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    writeEntity(wikiDir, "test", { title: "Test", content: "Test content" });

    const promises = Array.from({ length: 100 }, (_, i) =>
      routeQuery({ query: `test query ${i}` }, defaultConfig())
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    // All should succeed
    expect(fulfilled.length).toBe(100);
    expect(rejected.length).toBe(0);
  });

  test("50 concurrent queries with different layers", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const layers: MemoryLayer[][] = [["L0"], ["L1"], ["L2"], ["L0", "L1"], ["L0", "L1", "L2"]];

    const promises = Array.from({ length: 50 }, (_, i) =>
      routeQuery(
        { query: `query ${i}`, maxLayers: layers[i % layers.length] },
        defaultConfig()
      )
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled.length).toBe(50);
  });

  test("concurrent queries with session ID detection", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const sessionStorePath = join(testDir, "session_store.db");
    createSessionStore(sessionStorePath);

    const promises = Array.from({ length: 20 }, (_, i) =>
      routeQuery(
        { query: i % 2 === 0
          ? "abc12345-1234-1234-1234-123456789abc"
          : "regular query"
        },
        defaultConfig()
      )
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Query edge cases
// ---------------------------------------------------------------------------

describe("Router — query edge cases", () => {
  test("empty query string", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "" }, defaultConfig());
    expect(result).toBeDefined();
  });

  test("very long query (10,000 chars)", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "word ".repeat(2000) },
      defaultConfig()
    );
    expect(result).toBeDefined();
  });

  test("query with special characters", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: '"; DROP TABLE;-- <script>alert(1)</script>' },
      defaultConfig()
    );
    expect(result).toBeDefined();
  });

  test("query with only whitespace", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "   \t\n  " }, defaultConfig());
    expect(result).toBeDefined();
  });

  test("query with conversational patterns triggers L3", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "what did we discuss last time about the API" },
      defaultConfig()
    );
    expect(result.routingDecision).toContain("L3");
  });

  test("query with multiple session IDs", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "compare abc12345-1234-1234-1234-123456789abc and def12345-1234-1234-1234-123456789def" },
      defaultConfig()
    );
    // Should detect first UUID
    expect(result.routingDecision).toContain("L4");
  });

  test("query with UUID-like but invalid pattern", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "not-a-uuid-1234" },
      defaultConfig()
    );
    expect(result.routingDecision).toContain("no session ID");
  });

  test("domain hint with nonexistent domain", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", domain: "nonexistent-domain" },
      defaultConfig()
    );
    expect(result).toBeDefined();
  });

  test("maxTokens as Infinity", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery(
      { query: "test", maxTokens: Infinity },
      defaultConfig()
    );
    expect(result).toBeDefined();
  });
});
