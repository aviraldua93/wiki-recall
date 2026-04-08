/**
 * L3 Semantic Search — BM25-ranked search over raw session data.
 *
 * Uses better-sqlite3 (via bun:sqlite) + FTS5 with BM25 ranking to provide
 * semantic-style search over indexed session turns. No external dependencies
 * beyond what's already in package.json.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { createLogger } from "../../logger.js";
import type { L3SearchResult } from "../types.js";

const logger = createLogger("memory:l3");

// ---------------------------------------------------------------------------
// Token counting (approximate: chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization (matches knowledge/search.ts pattern)
// ---------------------------------------------------------------------------

function sanitizeFtsQuery(query: string): string {
  const cleaned = query.replace(/[*"():^{}]/g, " ");
  const reserved = new Set(["AND", "OR", "NOT", "NEAR"]);
  const terms = cleaned
    .split(/\s+/)
    .filter(t => t.length > 0 && !reserved.has(t.toUpperCase()));
  if (terms.length === 0) return "";
  return terms.map(t => `"${t}"`).join(" ");
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Create or open the L3 session search index database.
 */
function openIndexDb(indexDbPath: string): Database {
  const dir = dirname(indexDbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(indexDbPath);
  db.exec("PRAGMA journal_mode = WAL;");

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_meta (
      session_id TEXT PRIMARY KEY,
      summary TEXT,
      branch TEXT,
      repository TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_turns_fts USING fts5(
      session_id UNINDEXED,
      turn_index UNINDEXED,
      role UNINDEXED,
      content,
      tokenize='porter unicode61'
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Index sessions from session store
// ---------------------------------------------------------------------------

/**
 * Index all sessions from the session store into the L3 FTS5 index.
 * Reads the Copilot CLI session_store.db and extracts turns for indexing.
 */
export function indexSessions(sessionStorePath: string, indexDbPath: string): void {
  if (!existsSync(sessionStorePath)) {
    throw new Error(`Session store not found: ${sessionStorePath}`);
  }

  const sourceDb = new Database(sessionStorePath, { readonly: true });
  const indexDb = openIndexDb(indexDbPath);

  try {
    // Read sessions
    const sessions = sourceDb.prepare(
      "SELECT id, summary, branch, repository, created_at, updated_at FROM sessions"
    ).all() as Array<{
      id: string;
      summary: string | null;
      branch: string | null;
      repository: string | null;
      created_at: string;
      updated_at: string;
    }>;

    // Read turns
    const turns = sourceDb.prepare(
      "SELECT session_id, turn_index, user_message, assistant_response FROM turns ORDER BY session_id, turn_index"
    ).all() as Array<{
      session_id: string;
      turn_index: number;
      user_message: string | null;
      assistant_response: string | null;
    }>;

    // Clear existing index
    indexDb.exec("DELETE FROM session_meta");
    indexDb.exec("DELETE FROM session_turns_fts");

    // Insert sessions
    const insertSession = indexDb.prepare(
      "INSERT INTO session_meta (session_id, summary, branch, repository, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );

    const insertTurn = indexDb.prepare(
      "INSERT INTO session_turns_fts (session_id, turn_index, role, content) VALUES (?, ?, ?, ?)"
    );

    const tx = indexDb.transaction(() => {
      for (const s of sessions) {
        insertSession.run(s.id, s.summary ?? "", s.branch ?? "", s.repository ?? "", s.created_at, s.updated_at);
      }

      for (const t of turns) {
        if (t.user_message) {
          insertTurn.run(t.session_id, t.turn_index, "user", t.user_message);
        }
        if (t.assistant_response) {
          insertTurn.run(t.session_id, t.turn_index, "assistant", t.assistant_response);
        }
      }
    });

    tx();

    // Update index meta
    indexDb.prepare(
      "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('last_indexed', ?)"
    ).run(new Date().toISOString());

    indexDb.prepare(
      "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('session_count', ?)"
    ).run(String(sessions.length));

    indexDb.prepare(
      "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('turn_count', ?)"
    ).run(String(turns.length));

    logger.debug(
      { sessions: sessions.length, turns: turns.length },
      "Indexed sessions into L3"
    );
  } finally {
    sourceDb.close();
    indexDb.close();
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SemanticSearchOptions {
  limit?: number;
}

/**
 * BM25-ranked search over indexed session turns.
 */
export function semanticSearch(
  query: string,
  indexDbPath: string,
  options?: SemanticSearchOptions
): L3SearchResult {
  const limit = options?.limit ?? 20;

  if (!existsSync(indexDbPath)) {
    return { matches: [], source: "semantic-search", tokensUsed: 0 };
  }

  const db = openIndexDb(indexDbPath);

  try {
    // Check if the index has any rows
    const count = db.prepare(
      "SELECT COUNT(*) as n FROM session_turns_fts"
    ).get() as { n: number };

    if (count.n === 0) {
      return { matches: [], source: "semantic-search", tokensUsed: 0 };
    }

    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) {
      return { matches: [], source: "semantic-search", tokensUsed: 0 };
    }

    try {
      const results = db.prepare(`
        SELECT
          session_id,
          role,
          content,
          rank
        FROM session_turns_fts
        WHERE session_turns_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, limit) as Array<{
        session_id: string;
        role: string;
        content: string;
        rank: number;
      }>;

      const matches = results.map(r => ({
        content: r.content.slice(0, 500),
        score: -r.rank, // FTS5 rank is negative (lower = better)
        source: `session:${r.session_id}`,
        sessionId: r.session_id,
      }));

      const tokensUsed = matches.reduce(
        (sum, m) => sum + estimateTokens(m.content),
        0
      );

      logger.debug(
        { query, matchCount: matches.length, tokensUsed },
        "L3 semantic search complete"
      );

      return { matches, source: "semantic-search", tokensUsed };
    } catch {
      // FTS5 query failed — return empty
      return { matches: [], source: "semantic-search", tokensUsed: 0 };
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Rebuild index
// ---------------------------------------------------------------------------

/**
 * Rebuild the L3 session search index from scratch.
 */
export function rebuildIndex(sessionStorePath: string, indexDbPath: string): void {
  indexSessions(sessionStorePath, indexDbPath);
}

// ---------------------------------------------------------------------------
// Index stats
// ---------------------------------------------------------------------------

export interface IndexStats {
  sessionCount: number;
  turnCount: number;
  lastIndexed: string;
}

/**
 * Get statistics about the L3 session search index.
 */
export function getIndexStats(indexDbPath: string): IndexStats {
  const defaults: IndexStats = { sessionCount: 0, turnCount: 0, lastIndexed: "" };

  if (!existsSync(indexDbPath)) return defaults;

  try {
    const db = openIndexDb(indexDbPath);
    try {
      const getMeta = db.prepare("SELECT value FROM index_meta WHERE key = ?");

      const sessionCount = getMeta.get("session_count") as { value: string } | null;
      const turnCount = getMeta.get("turn_count") as { value: string } | null;
      const lastIndexed = getMeta.get("last_indexed") as { value: string } | null;

      return {
        sessionCount: parseInt(sessionCount?.value ?? "0", 10),
        turnCount: parseInt(turnCount?.value ?? "0", 10),
        lastIndexed: lastIndexed?.value ?? "",
      };
    } finally {
      db.close();
    }
  } catch {
    return defaults;
  }
}
