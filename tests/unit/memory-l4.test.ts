/**
 * Unit tests for src/memory/layers/l4-sessions.ts — L4 Sessions layer
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { resetConfig } from "../../src/config.js";
import {
  getSession,
  listRecentSessions,
} from "../../src/memory/layers/l4-sessions.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-l4-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function createSessionStore(
  path: string,
  sessions: Array<{ id: string; summary: string; updatedAt: string }>,
  turns: Array<{ sessionId: string; turnIndex: number; userMsg: string | null; assistantMsg: string | null }>
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
    insertSession.run(s.id, s.summary, "main", "org/repo", "/project", s.updatedAt, s.updatedAt);
  }

  for (const t of turns) {
    insertTurn.run(t.sessionId, t.turnIndex, t.userMsg, t.assistantMsg, "2025-01-15T00:00:00Z");
  }

  db.close();
}

function createDefaultStore(): string {
  const storePath = join(testDir, "session_store.db");
  createSessionStore(storePath,
    [
      { id: "session-1", summary: "First session", updatedAt: "2025-01-15T10:00:00Z" },
      { id: "session-2", summary: "Second session", updatedAt: "2025-01-16T10:00:00Z" },
      { id: "session-3", summary: "Third session", updatedAt: "2025-01-17T10:00:00Z" },
    ],
    [
      { sessionId: "session-1", turnIndex: 0, userMsg: "Hello", assistantMsg: "Hi there!" },
      { sessionId: "session-1", turnIndex: 1, userMsg: "How are you?", assistantMsg: "I'm doing well." },
      { sessionId: "session-2", turnIndex: 0, userMsg: "Help with code", assistantMsg: "Sure, what do you need?" },
      { sessionId: "session-3", turnIndex: 0, userMsg: null, assistantMsg: "Welcome back!" },
    ]
  );
  return storePath;
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("getSession", () => {
  test("loads session turns by ID", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-1", storePath);

    expect(result.sessionId).toBe("session-1");
    expect(result.turns.length).toBe(4); // 2 turns × 2 messages each
    expect(result.source).toBe("raw-session");
  });

  test("returns user and assistant turns in order", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-1", storePath);

    expect(result.turns[0].role).toBe("user");
    expect(result.turns[0].content).toBe("Hello");
    expect(result.turns[1].role).toBe("assistant");
    expect(result.turns[1].content).toBe("Hi there!");
  });

  test("throws when session store does not exist", () => {
    expect(() => getSession("session-1", join(testDir, "nonexistent.db"))).toThrow("Session store not found");
  });

  test("throws when session ID does not exist", () => {
    const storePath = createDefaultStore();
    expect(() => getSession("nonexistent", storePath)).toThrow("Session not found");
  });

  test("calculates token usage", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-1", storePath);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  test("handles session with single turn", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-2", storePath);
    expect(result.turns.length).toBe(2); // 1 user + 1 assistant
  });

  test("skips null messages", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-3", storePath);
    // session-3 has null user message, only assistant
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].role).toBe("assistant");
    expect(result.turns[0].content).toBe("Welcome back!");
  });

  test("source is always raw-session", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-1", storePath);
    expect(result.source).toBe("raw-session");
  });

  test("handles session with many turns", () => {
    const storePath = join(testDir, "many_turns.db");
    const turns = Array.from({ length: 50 }, (_, i) => ({
      sessionId: "big-session",
      turnIndex: i,
      userMsg: `Message ${i}`,
      assistantMsg: `Response ${i}`,
    }));

    createSessionStore(storePath,
      [{ id: "big-session", summary: "Big session", updatedAt: "2025-01-15T00:00:00Z" }],
      turns
    );

    const result = getSession("big-session", storePath);
    expect(result.turns.length).toBe(100); // 50 turns × 2
  });

  test("token count approximates chars / 4", () => {
    const storePath = createDefaultStore();
    const result = getSession("session-1", storePath);

    const totalChars = result.turns.reduce((sum, t) => sum + t.content.length, 0);
    const expected = Math.ceil(totalChars / 4);
    // Token count is sum of individual ceil operations, may differ slightly
    expect(Math.abs(result.tokensUsed - expected)).toBeLessThan(result.turns.length + 1);
  });
});

// ---------------------------------------------------------------------------
// listRecentSessions
// ---------------------------------------------------------------------------

describe("listRecentSessions", () => {
  test("lists recent sessions ordered by date descending", () => {
    const storePath = createDefaultStore();
    const sessions = listRecentSessions(storePath);

    expect(sessions.length).toBe(3);
    expect(sessions[0].id).toBe("session-3");
    expect(sessions[1].id).toBe("session-2");
    expect(sessions[2].id).toBe("session-1");
  });

  test("returns empty array when store does not exist", () => {
    const sessions = listRecentSessions(join(testDir, "nonexistent.db"));
    expect(sessions).toEqual([]);
  });

  test("respects limit parameter", () => {
    const storePath = createDefaultStore();
    const sessions = listRecentSessions(storePath, 2);
    expect(sessions.length).toBe(2);
  });

  test("returns session summaries", () => {
    const storePath = createDefaultStore();
    const sessions = listRecentSessions(storePath);
    expect(sessions[0].summary).toBe("Third session");
  });

  test("returns session dates", () => {
    const storePath = createDefaultStore();
    const sessions = listRecentSessions(storePath);
    expect(sessions[0].date).toBe("2025-01-17T10:00:00Z");
  });

  test("handles empty session store", () => {
    const storePath = join(testDir, "empty_store.db");
    createSessionStore(storePath, [], []);
    const sessions = listRecentSessions(storePath);
    expect(sessions).toEqual([]);
  });

  test("default limit is 10", () => {
    const storePath = join(testDir, "many_sessions.db");
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      id: `session-${i}`,
      summary: `Session ${i}`,
      updatedAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    createSessionStore(storePath, sessions, []);

    const result = listRecentSessions(storePath);
    expect(result.length).toBe(10);
  });

  test("handles sessions with null summaries", () => {
    const storePath = join(testDir, "null_summary.db");
    const db = new Database(storePath);
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, branch TEXT, repository TEXT, cwd TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
    `);
    db.prepare("INSERT INTO sessions VALUES (?, NULL, ?, ?, ?, ?, ?)").run("s1", "main", "org/repo", "/", "2025-01-15T00:00:00Z", "2025-01-15T00:00:00Z");
    db.close();

    const sessions = listRecentSessions(storePath);
    expect(sessions.length).toBe(1);
    expect(sessions[0].summary).toBe("");
  });
});
