/**
 * Memory Router — intelligent query routing across all 5 memory layers.
 *
 * Routing strategy:
 *   - L0 + L1 are ALWAYS included (cheap, always loaded)
 *   - L2 wiki if query matches a known domain/entity
 *   - L3 semantic search if wiki has no results or query is conversational
 *   - L4 raw sessions only if a specific session ID is mentioned
 *   - Respects maxTokens budget
 */

import { existsSync } from "node:fs";
import { createLogger } from "../logger.js";
import { loadIdentity, createDefaultIdentity, generateIdentityPrompt } from "./layers/l0-identity.js";
import { generateEssentialStory, storyToPrompt } from "./layers/l1-story.js";
import { queryWiki } from "./layers/l2-wiki.js";
import { semanticSearch } from "./layers/l3-semantic.js";
import { getSession } from "./layers/l4-sessions.js";
import type {
  MemoryQuery,
  MemoryResponse,
  MemoryConfig,
  MemoryLayer,
  L0Identity,
} from "./types.js";

const logger = createLogger("memory:router");

// ---------------------------------------------------------------------------
// Token counting (approximate: chars / 4)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Session ID detection
// ---------------------------------------------------------------------------

/**
 * Detect if the query references a specific session ID (UUID-like pattern).
 */
function detectSessionId(query: string): string | null {
  const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const match = query.match(uuidPattern);
  return match ? match[0] : null;
}

/**
 * Detect if the query is conversational (asking about past discussions).
 */
function isConversationalQuery(query: string): boolean {
  const conversationalPatterns = [
    /what did (we|i|you) (discuss|talk|say|mention)/i,
    /when did (we|i|you)/i,
    /last time (we|i|you)/i,
    /previous (session|conversation|discussion)/i,
    /remember when/i,
    /history of/i,
    /earlier (we|i|you)/i,
    /in a past/i,
  ];

  return conversationalPatterns.some(p => p.test(query));
}

// ---------------------------------------------------------------------------
// Layer inclusion checks
// ---------------------------------------------------------------------------

function shouldIncludeLayer(
  layer: MemoryLayer,
  requestedLayers?: MemoryLayer[]
): boolean {
  if (!requestedLayers || requestedLayers.length === 0) return true;
  return requestedLayers.includes(layer);
}

// ---------------------------------------------------------------------------
// Route query
// ---------------------------------------------------------------------------

/**
 * Route a memory query through the appropriate layers.
 *
 * Always includes L0 + L1. Routes to L2/L3/L4 based on query analysis
 * and token budget.
 */
export async function routeQuery(
  query: MemoryQuery,
  config: MemoryConfig
): Promise<MemoryResponse> {
  const response: MemoryResponse = {
    layers: {},
    totalTokens: 0,
    routingDecision: "",
  };

  const decisions: string[] = [];
  const maxTokens = query.maxTokens ?? Infinity;
  let tokensUsed = 0;

  // -----------------------------------------------------------------------
  // L0 — Identity (always loaded)
  // -----------------------------------------------------------------------

  if (shouldIncludeLayer("L0", query.maxLayers)) {
    try {
      let identity: L0Identity;
      if (existsSync(config.l0Path)) {
        identity = loadIdentity(config.l0Path);
      } else {
        identity = createDefaultIdentity("Developer");
      }
      response.layers.L0 = identity;
      tokensUsed += estimateTokens(generateIdentityPrompt(identity));
      decisions.push("L0: loaded identity");
    } catch (err) {
      decisions.push(`L0: failed to load — ${(err as Error).message}`);
      logger.warn({ err }, "Failed to load L0 identity");
    }
  }

  // -----------------------------------------------------------------------
  // L1 — Essential Story (always generated)
  // -----------------------------------------------------------------------

  if (shouldIncludeLayer("L1", query.maxLayers) && tokensUsed < maxTokens) {
    try {
      const story = generateEssentialStory(
        config.l2WikiDir,
        existsSync(config.l4SessionStorePath) ? config.l4SessionStorePath : undefined
      );
      response.layers.L1 = story;
      tokensUsed += story.tokenCount;
      decisions.push(`L1: generated story (${story.tokenCount} tokens)`);
    } catch (err) {
      decisions.push(`L1: failed — ${(err as Error).message}`);
      logger.warn({ err }, "Failed to generate L1 story");
    }
  }

  // -----------------------------------------------------------------------
  // L2 — Wiki search
  // -----------------------------------------------------------------------

  if (shouldIncludeLayer("L2", query.maxLayers) && tokensUsed < maxTokens) {
    try {
      const wikiResult = queryWiki(query.query, config.l2WikiDir, {
        domain: query.domain,
      });

      if (wikiResult.entities.length > 0) {
        response.layers.L2 = wikiResult;
        tokensUsed += wikiResult.tokensUsed;
        decisions.push(`L2: wiki returned ${wikiResult.entities.length} entities (${wikiResult.tokensUsed} tokens)`);
      } else {
        decisions.push("L2: wiki returned no results");
      }
    } catch (err) {
      decisions.push(`L2: failed — ${(err as Error).message}`);
      logger.warn({ err }, "Failed to query L2 wiki");
    }
  }

  // -----------------------------------------------------------------------
  // L3 — Semantic search (if wiki empty or query is conversational)
  // -----------------------------------------------------------------------

  const wikiEmpty = !response.layers.L2 || response.layers.L2.entities.length === 0;
  const isConversational = isConversationalQuery(query.query);

  if (
    shouldIncludeLayer("L3", query.maxLayers) &&
    config.l3Enabled &&
    tokensUsed < maxTokens &&
    (wikiEmpty || isConversational)
  ) {
    try {
      const searchResult = semanticSearch(query.query, config.l3DbPath);

      if (searchResult.matches.length > 0) {
        response.layers.L3 = searchResult;
        tokensUsed += searchResult.tokensUsed;
        decisions.push(
          `L3: semantic search returned ${searchResult.matches.length} matches (${searchResult.tokensUsed} tokens)` +
          (isConversational ? " [conversational query]" : " [wiki empty]")
        );
      } else {
        decisions.push(
          "L3: semantic search returned no matches" +
          (isConversational ? " [conversational query]" : "")
        );
      }
    } catch (err) {
      decisions.push(`L3: failed — ${(err as Error).message}`);
      logger.warn({ err }, "Failed to run L3 semantic search");
    }
  } else if (shouldIncludeLayer("L3", query.maxLayers) && !config.l3Enabled) {
    decisions.push("L3: disabled in config");
  }

  // -----------------------------------------------------------------------
  // L4 — Raw session (only if session ID detected)
  // -----------------------------------------------------------------------

  const sessionId = detectSessionId(query.query);

  if (
    shouldIncludeLayer("L4", query.maxLayers) &&
    sessionId &&
    tokensUsed < maxTokens
  ) {
    try {
      const sessionResult = getSession(sessionId, config.l4SessionStorePath);
      response.layers.L4 = sessionResult;
      tokensUsed += sessionResult.tokensUsed;
      decisions.push(`L4: loaded session ${sessionId} (${sessionResult.tokensUsed} tokens)`);
    } catch (err) {
      decisions.push(`L4: failed — ${(err as Error).message}`);
      logger.warn({ err }, "Failed to load L4 session");
    }
  } else if (shouldIncludeLayer("L4", query.maxLayers) && !sessionId) {
    decisions.push("L4: no session ID in query");
  }

  // -----------------------------------------------------------------------
  // Finalize
  // -----------------------------------------------------------------------

  response.totalTokens = tokensUsed;
  response.routingDecision = decisions.join("; ");

  logger.debug(
    { totalTokens: tokensUsed, decisions },
    "Memory query routed"
  );

  return response;
}
