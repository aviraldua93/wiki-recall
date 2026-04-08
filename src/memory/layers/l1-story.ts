/**
 * L1 Essential Story — compiled summary layer (~500 tokens).
 *
 * Scans knowledge entities and session data to produce a compact
 * narrative of the developer's current state: top moments, active
 * projects, and key metrics.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import matter from "gray-matter";
import { Database } from "bun:sqlite";
import { createLogger } from "../../logger.js";
import type { KnowledgeEntity } from "../../types.js";
import type { L1EssentialStory } from "../types.js";

const logger = createLogger("memory:l1");

// ---------------------------------------------------------------------------
// Token counting (approximate: chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Entity scanning
// ---------------------------------------------------------------------------

function loadEntitiesFromDir(wikiDir: string): Array<{ slug: string; entity: KnowledgeEntity }> {
  if (!existsSync(wikiDir)) return [];

  return readdirSync(wikiDir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const raw = readFileSync(join(wikiDir, f), "utf8");
      const parsed = matter(raw);
      return {
        slug: basename(f, ".md"),
        entity: {
          title: parsed.data.title ?? basename(f, ".md"),
          type: parsed.data.type ?? "concept",
          updated: parsed.data.updated ?? "",
          tags: parsed.data.tags ?? [],
          related: parsed.data.related ?? [],
          content: parsed.content?.trim() ?? "",
          ...(parsed.data.created && { created: parsed.data.created }),
          ...(parsed.data.status && { status: parsed.data.status }),
        } as KnowledgeEntity,
      };
    });
}

// ---------------------------------------------------------------------------
// Session stats
// ---------------------------------------------------------------------------

interface SessionStats {
  sessionCount: number;
  turnCount: number;
  lastActivity: string;
}

function getSessionStats(sessionStorePath?: string): SessionStats {
  const defaults: SessionStats = { sessionCount: 0, turnCount: 0, lastActivity: "" };

  if (!sessionStorePath || !existsSync(sessionStorePath)) return defaults;

  try {
    const db = new Database(sessionStorePath, { readonly: true });
    try {
      const sessions = db.prepare(
        "SELECT COUNT(*) as count FROM sessions"
      ).get() as { count: number } | null;

      const turns = db.prepare(
        "SELECT COUNT(*) as count FROM turns"
      ).get() as { count: number } | null;

      const lastSession = db.prepare(
        "SELECT updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1"
      ).get() as { updated_at: string } | null;

      return {
        sessionCount: sessions?.count ?? 0,
        turnCount: turns?.count ?? 0,
        lastActivity: lastSession?.updated_at ?? "",
      };
    } finally {
      db.close();
    }
  } catch {
    logger.debug("Could not read session store for L1 stats");
    return defaults;
  }
}

// ---------------------------------------------------------------------------
// Generate Essential Story
// ---------------------------------------------------------------------------

/**
 * Generate an L1 Essential Story by scanning knowledge entities and sessions.
 *
 * - Top 5 moments: most recently updated entities with most connections
 * - Active projects: entities of type "repo" or scenarios with active status
 * - Key metrics: entity count, session count, last activity
 * - Target ~500 tokens
 */
export function generateEssentialStory(
  wikiDir: string,
  sessionStorePath?: string
): L1EssentialStory {
  const entries = loadEntitiesFromDir(wikiDir);
  const stats = getSessionStats(sessionStorePath);

  // Sort by updated date (most recent first), then by connection count
  const sorted = [...entries].sort((a, b) => {
    const dateA = a.entity.updated || "";
    const dateB = b.entity.updated || "";
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    return (b.entity.related?.length ?? 0) - (a.entity.related?.length ?? 0);
  });

  // Top 5 moments — most recent + most connected
  const topMoments = sorted.slice(0, 5).map(entry => ({
    date: String(entry.entity.updated || "unknown"),
    event: `Updated: ${entry.entity.title}`,
    significance: entry.entity.type +
      (entry.entity.related && entry.entity.related.length > 0
        ? ` (${entry.entity.related.length} connections)`
        : ""),
  }));

  // Active projects — repos or entities tagged as active
  const activeProjects = entries
    .filter(e =>
      e.entity.type === "repo" ||
      e.entity.type === "system" ||
      (e.entity.status === "draft" || e.entity.status === "reviewed")
    )
    .slice(0, 5)
    .map(e => ({
      name: e.entity.title,
      status: e.entity.status ?? e.entity.type,
      lastActivity: String(e.entity.updated || "unknown"),
    }));

  // Key metrics
  const keyMetrics = [
    { label: "Knowledge entities", value: String(entries.length) },
    { label: "Sessions", value: String(stats.sessionCount) },
    { label: "Session turns", value: String(stats.turnCount) },
  ];

  if (stats.lastActivity) {
    keyMetrics.push({ label: "Last activity", value: stats.lastActivity });
  }

  const generatedAt = new Date().toISOString();

  const story: L1EssentialStory = {
    topMoments,
    activeProjects,
    keyMetrics,
    generatedAt,
    tokenCount: 0,
  };

  // Calculate token count from the prompt representation
  story.tokenCount = estimateTokens(storyToPrompt(story));

  logger.debug(
    { entityCount: entries.length, tokenCount: story.tokenCount },
    "Generated L1 essential story"
  );

  return story;
}

// ---------------------------------------------------------------------------
// Story to prompt
// ---------------------------------------------------------------------------

/**
 * Format an L1 story as a compact prompt for LLM context.
 */
export function storyToPrompt(story: L1EssentialStory): string {
  const sections: string[] = [];

  if (story.topMoments.length > 0) {
    sections.push("## Recent Activity");
    for (const m of story.topMoments) {
      sections.push(`- [${m.date}] ${m.event} — ${m.significance}`);
    }
  }

  if (story.activeProjects.length > 0) {
    sections.push("\n## Active Projects");
    for (const p of story.activeProjects) {
      sections.push(`- ${p.name} (${p.status}, last: ${p.lastActivity})`);
    }
  }

  if (story.keyMetrics.length > 0) {
    sections.push("\n## Key Metrics");
    for (const m of story.keyMetrics) {
      sections.push(`- ${m.label}: ${m.value}`);
    }
  }

  return sections.join("\n");
}
