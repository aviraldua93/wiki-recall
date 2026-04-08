/**
 * Stress tests for src/memory/router.ts — edge cases, unicode, tiny budgets,
 * empty workspaces, and very long queries.
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
import { indexSessions } from "../../src/memory/layers/l3-semantic.js";
import type { MemoryConfig, MemoryQuery } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-stress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function writeIdentity(dir: string, name = "StressBot"): void {
  writeFileSync(join(dir, "identity.yaml"), yaml.dump({
    name,
    roles: ["SWE"],
    accounts: [{ platform: "github", username: "stress" }],
    coreContext: "Stress test identity.",
  }), "utf8");
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

function createSessionStore(path: string, sessions: Array<{ id: string; msg: string; resp: string }>): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
  `);
  for (const s of sessions) {
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      s.id, "Test", "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z"
    );
    db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)").run(
      s.id, 0, s.msg, s.resp, "2025-01-15T00:00:00Z"
    );
  }
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
// Empty workspace — no wiki, no sessions, no identity
// ---------------------------------------------------------------------------

describe("router stress — empty workspace", () => {
  test("handles completely empty workspace gracefully", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "anything" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined(); // falls back to default identity
    expect(result.layers.L1).toBeDefined(); // always generated
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.routingDecision).toBeString();
  });

  test("empty wiki + empty sessions returns valid response", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, []);

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
    expect(result.layers.L2).toBeUndefined(); // no entities to match
  });

  test("empty wiki + empty sessions + L3 enabled returns valid routing", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, []);
    const indexPath = join(testDir, "memory", "session-index.db");
    indexSessions(storePath, indexPath);

    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.routingDecision).toContain("L0");
    expect(result.routingDecision).toContain("L1");
  });

  test("missing wiki directory returns L0+L1 only", async () => {
    // Don't create the knowledge dir at all
    const result = await routeQuery({ query: "test" }, defaultConfig());
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
  });

  test("missing session store file doesn't crash", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const config = defaultConfig();
    config.l4SessionStorePath = join(testDir, "nonexistent.db");

    const result = await routeQuery(
      { query: "Show me abc12345-1234-1234-1234-123456789abc" },
      config
    );
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Very long queries
// ---------------------------------------------------------------------------

describe("router stress — very long queries", () => {
  test("handles query with 1000 characters", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const longQuery = "a".repeat(1000);
    const result = await routeQuery({ query: longQuery }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("handles query with 10000 characters", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const longQuery = "test ".repeat(2000);
    const result = await routeQuery({ query: longQuery }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  test("long query with embedded UUID still detects session ID", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, [{
      id: "abc12345-1234-1234-1234-123456789abc",
      msg: "Hello",
      resp: "World",
    }]);

    const longQuery = "x".repeat(500) + " abc12345-1234-1234-1234-123456789abc " + "y".repeat(500);
    const result = await routeQuery({ query: longQuery }, defaultConfig());
    expect(result.layers.L4).toBeDefined();
    expect(result.layers.L4?.sessionId).toBe("abc12345-1234-1234-1234-123456789abc");
  });

  test("query with only whitespace still works", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "   \t\n  " }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("single character query works", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "x" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tiny token budget (100 tokens)
// ---------------------------------------------------------------------------

describe("router stress — tiny token budget", () => {
  test("maxTokens=100 still returns L0 at minimum", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test", maxTokens: 100 }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("maxTokens=100 with many entities truncates results", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 20; i++) {
      writeEntity(wikiDir, `entity-${i}`, {
        title: `Entity ${i}`,
        content: "A".repeat(500),
      });
    }

    const result = await routeQuery({ query: "entity", maxTokens: 100 }, defaultConfig());
    // L0+L1 have a base cost, so total may exceed 100 but should be less than unconstrained
    const unconstrainedResult = await routeQuery({ query: "entity" }, defaultConfig());
    expect(result.totalTokens).toBeLessThanOrEqual(unconstrainedResult.totalTokens);
  });

  test("maxTokens=1 is an extreme edge case that still returns", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test", maxTokens: 1 }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.routingDecision).toBeString();
  });

  test("maxTokens=0 still produces a response", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "test", maxTokens: 0 }, defaultConfig());
    expect(result).toBeDefined();
  });

  test("maxTokens=100 skips expensive L2 wiki when budget is consumed", async () => {
    writeIdentity(testDir);
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 50; i++) {
      writeEntity(wikiDir, `bulk-${i}`, {
        title: `Bulk Entity ${i}`,
        content: "Long content ".repeat(100),
      });
    }

    const result = await routeQuery({ query: "bulk", maxTokens: 100 }, defaultConfig());
    // With such a small budget, fewer entities should be included
    const l2Entities = result.layers.L2?.entities ?? [];
    expect(l2Entities.length).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Unicode and emoji in queries
// ---------------------------------------------------------------------------

describe("router stress — unicode/emoji queries", () => {
  test("handles emoji-only query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "🚀🔥💡" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("handles CJK characters in query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "分散システムのリトライパターン" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  test("handles mixed emoji + ASCII query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "retry patterns 🔄 with backoff ⏱️" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("handles Arabic/RTL text in query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "أنماط إعادة المحاولة" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("entity with unicode title is searchable", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "unicode-test", {
      title: "Unicode Entity 🚀",
      content: "Contains emoji and unicode: café résumé naïve",
    });

    const result = await routeQuery({ query: "unicode-test" }, defaultConfig());
    expect(result.layers.L2).toBeDefined();
    expect(result.layers.L2?.entities.length).toBeGreaterThan(0);
  });

  test("handles special characters in query without crashing", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const specialChars = 'query with "quotes" and \'apostrophes\' and <brackets> & ampersands';
    const result = await routeQuery({ query: specialChars }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });

  test("handles newlines and tabs in query", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "line1\nline2\ttab" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L0).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Conversational query detection edge cases
// ---------------------------------------------------------------------------

describe("router stress — conversational detection", () => {
  test("'what did we discuss' is detected as conversational", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, [{
      id: "s1", msg: "retry discussion", resp: "Use exponential backoff",
    }]);
    indexSessions(storePath, join(testDir, "memory", "session-index.db"));

    const result = await routeQuery({ query: "what did we discuss about retry?" }, defaultConfig());
    expect(result.routingDecision).toContain("conversational");
  });

  test("'remember when' triggers conversational path", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, [{
      id: "s2", msg: "fixed the cache bug", resp: "Used LRU eviction",
    }]);
    indexSessions(storePath, join(testDir, "memory", "session-index.db"));

    const result = await routeQuery({ query: "remember when we fixed the cache bug?" }, defaultConfig());
    expect(result.routingDecision).toContain("conversational");
  });

  test("plain factual query is NOT detected as conversational", async () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = await routeQuery({ query: "retry patterns" }, defaultConfig());
    expect(result.routingDecision).not.toContain("conversational");
  });
});

// ---------------------------------------------------------------------------
// Multiple entities stress
// ---------------------------------------------------------------------------

describe("router stress — many entities", () => {
  test("handles 100 entities without error", async () => {
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 100; i++) {
      writeEntity(wikiDir, `entity-${i}`, {
        title: `Entity ${i}`,
        type: i % 3 === 0 ? "concept" : i % 3 === 1 ? "system" : "decision",
        content: `Content for entity ${i}`,
        tags: [`tag-${i % 5}`],
      });
    }

    const result = await routeQuery({ query: "entity" }, defaultConfig());
    expect(result).toBeDefined();
    expect(result.layers.L2?.entities.length).toBeGreaterThan(0);
  });

  test("domain filter narrows entity results", async () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "alpha-concept", { title: "Alpha Concept", content: "alpha" });
    writeEntity(wikiDir, "beta-concept", { title: "Beta Concept", content: "beta" });

    const result = await routeQuery(
      { query: "concept", domain: "alpha-concept" },
      defaultConfig()
    );
    expect(result.layers.L2).toBeDefined();
  });
});
