/**
 * L4 Sessions — raw session turn history layer.
 *
 * Loads verbatim session turns from the Copilot CLI session store.
 * Only invoked when a specific session ID is mentioned in the query.
 */

import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { createLogger } from "../../logger.js";
import type { L4SessionResult } from "../types.js";

const logger = createLogger("memory:l4");

// ---------------------------------------------------------------------------
// Token counting (approximate: chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Get session
// ---------------------------------------------------------------------------

/**
 * Load raw session turns by session ID from the session store.
 */
export function getSession(sessionId: string, sessionStorePath: string): L4SessionResult {
  if (!existsSync(sessionStorePath)) {
    throw new Error(`Session store not found: ${sessionStorePath}`);
  }

  const db = new Database(sessionStorePath, { readonly: true });

  try {
    // Verify session exists
    const session = db.prepare(
      "SELECT id FROM sessions WHERE id = ?"
    ).get(sessionId) as { id: string } | null;

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Load turns
    const rows = db.prepare(
      "SELECT turn_index, user_message, assistant_response FROM turns WHERE session_id = ? ORDER BY turn_index"
    ).all(sessionId) as Array<{
      turn_index: number;
      user_message: string | null;
      assistant_response: string | null;
    }>;

    const turns: { role: string; content: string }[] = [];
    for (const row of rows) {
      if (row.user_message) {
        turns.push({ role: "user", content: row.user_message });
      }
      if (row.assistant_response) {
        turns.push({ role: "assistant", content: row.assistant_response });
      }
    }

    const tokensUsed = turns.reduce(
      (sum, t) => sum + estimateTokens(t.content),
      0
    );

    logger.debug(
      { sessionId, turnCount: turns.length, tokensUsed },
      "Loaded L4 session"
    );

    return {
      sessionId,
      turns,
      source: "raw-session",
      tokensUsed,
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// List recent sessions
// ---------------------------------------------------------------------------

/**
 * List the most recent sessions from the session store.
 */
export function listRecentSessions(
  sessionStorePath: string,
  limit = 10
): { id: string; summary: string; date: string }[] {
  if (!existsSync(sessionStorePath)) {
    return [];
  }

  try {
    const db = new Database(sessionStorePath, { readonly: true });
    try {
      const rows = db.prepare(
        "SELECT id, summary, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?"
      ).all(limit) as Array<{
        id: string;
        summary: string | null;
        updated_at: string;
      }>;

      return rows.map(r => ({
        id: r.id,
        summary: r.summary ?? "",
        date: r.updated_at,
      }));
    } finally {
      db.close();
    }
  } catch {
    logger.debug("Could not list recent sessions");
    return [];
  }
}
