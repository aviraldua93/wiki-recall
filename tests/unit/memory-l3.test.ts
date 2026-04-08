/**
 * Unit tests for src/memory/layers/l3-semantic.ts — L3 Semantic Search layer
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { resetConfig } from "../../src/config.js";
import {
  indexSessions,
  semanticSearch,
  rebuildIndex,
  getIndexStats,
} from "../../src/memory/layers/l3-semantic.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-l3-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function createSessionStore(
  path: string,
  sessions: Array<{ id: string; summary: string }>,
  turns: Array<{ sessionId: string; turnIndex: number; userMsg: string; assistantMsg: string }>
): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      summary TEXT,
      branch TEXT,
      repository TEXT,
      cwd TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE turns (
      session_id TEXT,
      turn_index INTEGER,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT
    );
  `);

  const insertSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertTurn = db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)");

  for (const s of sessions) {
    insertSession.run(s.id, s.summary, "main", "org/repo", "/project", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z");
  }

  for (const t of turns) {
    insertTurn.run(t.sessionId, t.turnIndex, t.userMsg, t.assistantMsg, "2025-01-15T00:00:00Z");
  }

  db.close();
}

function createTestStore(): string {
  const storePath = join(testDir, "session_store.db");
  createSessionStore(storePath,
    [
      { id: "session-1", summary: "Retry logic discussion" },
      { id: "session-2", summary: "Database optimization" },
      { id: "session-3", summary: "API design review" },
    ],
    [
      { sessionId: "session-1", turnIndex: 0, userMsg: "How should we implement retry logic with exponential backoff?", assistantMsg: "I recommend using a retry pattern with jitter." },
      { sessionId: "session-1", turnIndex: 1, userMsg: "What about circuit breakers?", assistantMsg: "Circuit breakers complement retry logic by preventing cascading failures." },
      { sessionId: "session-2", turnIndex: 0, userMsg: "How can we optimize database queries?", assistantMsg: "Consider adding indexes and using query plans." },
      { sessionId: "session-2", turnIndex: 1, userMsg: "What about connection pooling?", assistantMsg: "Connection pooling reduces overhead from creating new connections." },
      { sessionId: "session-3", turnIndex: 0, userMsg: "Review this REST API design", assistantMsg: "The API follows good REST conventions." },
    ]
  );
  return storePath;
}

// ---------------------------------------------------------------------------
// indexSessions
// ---------------------------------------------------------------------------

describe("indexSessions", () => {
  test("indexes sessions from a session store", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);
    expect(existsSync(indexPath)).toBe(true);

    const stats = getIndexStats(indexPath);
    expect(stats.sessionCount).toBe(3);
  });

  test("throws when session store does not exist", () => {
    const indexPath = join(testDir, "index.db");
    expect(() => indexSessions(join(testDir, "nonexistent.db"), indexPath)).toThrow("Session store not found");
  });

  test("creates parent directories for index db", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "deep", "nested", "index.db");

    indexSessions(storePath, indexPath);
    expect(existsSync(indexPath)).toBe(true);
  });

  test("indexes both user and assistant turns", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);

    // Each turn produces 2 FTS entries (user + assistant)
    const db = new Database(indexPath, { readonly: true });
    const count = db.prepare("SELECT COUNT(*) as n FROM session_turns_fts").get() as { n: number };
    db.close();

    // 5 turns × 2 messages each = 10 entries
    expect(count.n).toBe(10);
  });

  test("clears existing index on re-index", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);
    indexSessions(storePath, indexPath);

    const db = new Database(indexPath, { readonly: true });
    const count = db.prepare("SELECT COUNT(*) as n FROM session_turns_fts").get() as { n: number };
    db.close();

    expect(count.n).toBe(10); // Same count, not doubled
  });

  test("handles empty session store", () => {
    const storePath = join(testDir, "empty_store.db");
    createSessionStore(storePath, [], []);
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);
    const stats = getIndexStats(indexPath);
    expect(stats.sessionCount).toBe(0);
    expect(stats.turnCount).toBe(0);
  });

  test("stores session metadata", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);

    const db = new Database(indexPath, { readonly: true });
    const meta = db.prepare("SELECT * FROM session_meta WHERE session_id = ?").get("session-1") as Record<string, string> | null;
    db.close();

    expect(meta).toBeTruthy();
    expect(meta!.summary).toBe("Retry logic discussion");
  });

  test("updates index metadata timestamps", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    indexSessions(storePath, indexPath);
    const stats = getIndexStats(indexPath);
    expect(stats.lastIndexed).toBeTruthy();
    expect(stats.lastIndexed.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// semanticSearch
// ---------------------------------------------------------------------------

describe("semanticSearch", () => {
  test("finds matching turns by content", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry logic exponential backoff", indexPath);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.source).toBe("semantic-search");
  });

  test("returns empty for non-existent index", () => {
    const result = semanticSearch("test", join(testDir, "nonexistent.db"));
    expect(result.matches).toEqual([]);
    expect(result.tokensUsed).toBe(0);
  });

  test("returns empty for empty index", () => {
    const storePath = join(testDir, "empty_store.db");
    createSessionStore(storePath, [], []);
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("test", indexPath);
    expect(result.matches).toEqual([]);
  });

  test("returns empty for empty query", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("", indexPath);
    expect(result.matches).toEqual([]);
  });

  test("respects limit option", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry", indexPath, { limit: 1 });
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });

  test("includes session ID in matches", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry", indexPath);
    for (const m of result.matches) {
      expect(m.sessionId).toBeTruthy();
    }
  });

  test("includes source string with session prefix", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry", indexPath);
    for (const m of result.matches) {
      expect(m.source).toMatch(/^session:/);
    }
  });

  test("scores are positive (negated FTS5 rank)", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry", indexPath);
    for (const m of result.matches) {
      expect(m.score).toBeGreaterThanOrEqual(0);
    }
  });

  test("calculates token usage", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry backoff", indexPath);
    if (result.matches.length > 0) {
      expect(result.tokensUsed).toBeGreaterThan(0);
    }
  });

  test("truncates match content to 500 chars", () => {
    const storePath = join(testDir, "long_store.db");
    const longMsg = "A".repeat(1000);
    createSessionStore(storePath,
      [{ id: "s1", summary: "long" }],
      [{ sessionId: "s1", turnIndex: 0, userMsg: longMsg, assistantMsg: "ok" }]
    );
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("AAAA", indexPath);
    for (const m of result.matches) {
      expect(m.content.length).toBeLessThanOrEqual(500);
    }
  });

  test("handles special FTS5 characters in query", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    // Should not throw
    const result = semanticSearch('test* AND (foo OR "bar")', indexPath);
    expect(result.source).toBe("semantic-search");
  });

  test("finds results across multiple sessions", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    // "connection" appears in session-2
    const result = semanticSearch("connection", indexPath);
    const sessionIds = [...new Set(result.matches.map(m => m.sessionId))];
    expect(sessionIds.length).toBeGreaterThanOrEqual(1);
  });

  test("source is always semantic-search", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const result = semanticSearch("retry", indexPath);
    expect(result.source).toBe("semantic-search");
  });
});

// ---------------------------------------------------------------------------
// rebuildIndex
// ---------------------------------------------------------------------------

describe("rebuildIndex", () => {
  test("rebuilds index (delegates to indexSessions)", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");

    rebuildIndex(storePath, indexPath);
    const stats = getIndexStats(indexPath);
    expect(stats.sessionCount).toBe(3);
  });

  test("throws when session store missing", () => {
    expect(() => rebuildIndex(join(testDir, "nope.db"), join(testDir, "index.db"))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getIndexStats
// ---------------------------------------------------------------------------

describe("getIndexStats", () => {
  test("returns stats for a populated index", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const stats = getIndexStats(indexPath);
    expect(stats.sessionCount).toBe(3);
    expect(stats.turnCount).toBe(5);
    expect(stats.lastIndexed).toBeTruthy();
  });

  test("returns defaults for non-existent index", () => {
    const stats = getIndexStats(join(testDir, "nonexistent.db"));
    expect(stats.sessionCount).toBe(0);
    expect(stats.turnCount).toBe(0);
    expect(stats.lastIndexed).toBe("");
  });

  test("returns defaults for empty index", () => {
    const storePath = join(testDir, "empty_store.db");
    createSessionStore(storePath, [], []);
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const stats = getIndexStats(indexPath);
    expect(stats.sessionCount).toBe(0);
    expect(stats.turnCount).toBe(0);
  });

  test("lastIndexed is a valid ISO timestamp", () => {
    const storePath = createTestStore();
    const indexPath = join(testDir, "index.db");
    indexSessions(storePath, indexPath);

    const stats = getIndexStats(indexPath);
    const date = new Date(stats.lastIndexed);
    expect(date.toISOString()).toBeTruthy();
  });
});
