/**
 * Memory System — clean exports and factory for the 5-layer memory architecture.
 */

import { join } from "node:path";
import { getConfig } from "../config.js";
import { routeQuery } from "./router.js";
import type { MemoryConfig, MemoryQuery, MemoryResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  MemoryLayer,
  MemoryConfig,
  MemoryQuery,
  MemoryResponse,
  L0Identity,
  L1EssentialStory,
  L2WikiResult,
  L3SearchResult,
  L4SessionResult,
} from "./types.js";

export {
  loadIdentity,
  generateIdentityPrompt,
  createDefaultIdentity,
  saveIdentity,
} from "./layers/l0-identity.js";

export {
  generateEssentialStory,
  storyToPrompt,
} from "./layers/l1-story.js";

export { queryWiki } from "./layers/l2-wiki.js";

export {
  indexSessions,
  semanticSearch,
  rebuildIndex,
  getIndexStats,
} from "./layers/l3-semantic.js";

export {
  getSession,
  listRecentSessions,
} from "./layers/l4-sessions.js";

export { routeQuery } from "./router.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a memory system with the given configuration.
 * Returns a query function that routes through all layers.
 */
export function createMemorySystem(config: MemoryConfig) {
  return {
    query: (q: MemoryQuery): Promise<MemoryResponse> => routeQuery(q, config),
    config,
  };
}

/**
 * Create a memory system using default DevContext configuration.
 */
export function createDefaultMemorySystem() {
  const home = getConfig().home;

  const config: MemoryConfig = {
    l0Path: join(home, "identity.yaml"),
    l1AutoGenerate: true,
    l2WikiDir: join(home, "knowledge"),
    l3Enabled: true,
    l3DbPath: join(home, "memory", "session-index.db"),
    l4SessionStorePath: join(home, "session_store.db"),
  };

  return createMemorySystem(config);
}
