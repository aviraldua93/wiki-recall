/**
 * L2 Wiki — FTS5-based knowledge entity search layer.
 *
 * Uses the existing KnowledgeSearch infrastructure from src/knowledge/search.ts
 * for full-text search. Adds domain routing: if the query mentions a known
 * domain/project, loads those entities directly without a search round-trip.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import matter from "gray-matter";
import { KnowledgeSearch } from "../../knowledge/search.js";
import { createLogger } from "../../logger.js";
import type { KnowledgeEntity } from "../../types.js";
import type { L2WikiResult } from "../types.js";

const logger = createLogger("memory:l2");

// ---------------------------------------------------------------------------
// Token counting (approximate: chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Domain detection
// ---------------------------------------------------------------------------

/**
 * Extract known entity slugs/titles from the wiki directory for domain routing.
 */
function getKnownSlugs(wikiDir: string): Map<string, string> {
  const slugMap = new Map<string, string>();
  if (!existsSync(wikiDir)) return slugMap;

  for (const f of readdirSync(wikiDir).filter(f => f.endsWith(".md"))) {
    const slug = basename(f, ".md");
    try {
      const raw = readFileSync(join(wikiDir, f), "utf8");
      const parsed = matter(raw);
      const title = (parsed.data.title as string) ?? slug;
      slugMap.set(slug, title);
      // Also index by lowercase title for matching
      slugMap.set(title.toLowerCase(), slug);
    } catch {
      slugMap.set(slug, slug);
    }
  }

  return slugMap;
}

/**
 * Detect if the query directly references a known domain/entity.
 * Returns matching slugs for direct loading.
 */
function detectDomainMatches(query: string, wikiDir: string): string[] {
  const known = getKnownSlugs(wikiDir);
  const queryLower = query.toLowerCase();
  const matches: string[] = [];

  for (const [key, value] of known) {
    // Check if the query contains the slug or title
    if (queryLower.includes(key.toLowerCase())) {
      // Resolve to the slug
      const slug = key.includes("-") || !known.has(value) ? key : value;
      if (!matches.includes(slug)) {
        matches.push(slug);
      }
    }
  }

  return matches;
}

/**
 * Load an entity directly by slug from the wiki directory.
 */
function loadEntityBySlug(slug: string, wikiDir: string): { slug: string; title: string; type: string; excerpt: string } | null {
  const filePath = join(wikiDir, `${slug}.md`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const content = parsed.content?.trim() ?? "";

    return {
      slug,
      title: (parsed.data.title as string) ?? slug,
      type: (parsed.data.type as string) ?? "concept",
      excerpt: content.slice(0, 300),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query Wiki
// ---------------------------------------------------------------------------

export interface WikiQueryOptions {
  maxResults?: number;
  domain?: string;
}

/**
 * Query the L2 wiki layer.
 *
 * 1. If a domain hint is provided or the query matches a known entity, load directly.
 * 2. Otherwise, fall back to FTS5 full-text search.
 */
export function queryWiki(
  query: string,
  wikiDir: string,
  options?: WikiQueryOptions
): L2WikiResult {
  const maxResults = options?.maxResults ?? 10;
  const entities: L2WikiResult["entities"] = [];

  // Step 1: Domain routing — check for direct entity matches
  const domainMatches = detectDomainMatches(query, wikiDir);

  if (options?.domain) {
    // Check if the domain hint matches a slug
    const directSlug = options.domain.toLowerCase().replace(/\s+/g, "-");
    if (!domainMatches.includes(directSlug)) {
      domainMatches.unshift(directSlug);
    }
  }

  // Load domain-matched entities directly
  for (const slug of domainMatches.slice(0, maxResults)) {
    const entity = loadEntityBySlug(slug, wikiDir);
    if (entity) {
      entities.push(entity);
    }
  }

  // Step 2: FTS5 search if we haven't filled our quota
  if (entities.length < maxResults) {
    try {
      const search = new KnowledgeSearch(join(wikiDir, "search.db"));
      try {
        // Ensure index exists
        search.rebuildIndex();

        const results = search.search(query, maxResults - entities.length);
        const existingSlugs = new Set(entities.map(e => e.slug));

        for (const result of results) {
          if (!existingSlugs.has(result.slug)) {
            entities.push({
              slug: result.slug,
              title: result.title,
              type: result.type,
              excerpt: result.snippet,
            });
          }
        }
      } finally {
        search.close();
      }
    } catch (err) {
      logger.debug({ err }, "FTS5 search failed, using domain results only");
    }
  }

  const tokensUsed = entities.reduce(
    (sum, e) => sum + estimateTokens(`${e.title} ${e.type} ${e.excerpt}`),
    0
  );

  logger.debug(
    { query, resultCount: entities.length, tokensUsed },
    "L2 wiki query complete"
  );

  return {
    entities,
    source: "wiki",
    tokensUsed,
  };
}
