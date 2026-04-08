/**
 * Memory Architecture Types — 5-layer memory system for DevContext.
 *
 * Inspired by MemPalace's layered approach combined with Karpathy's compiled
 * wiki. Key insight: "Compiled knowledge for speed + verbatim search for
 * completeness."
 *
 * Layers:
 *   L0 — Identity (always loaded, ~50 tokens)
 *   L1 — Essential Story (compiled summary, ~500 tokens)
 *   L2 — Wiki (FTS5 entity search)
 *   L3 — Semantic Search (BM25 over raw sessions)
 *   L4 — Raw Sessions (verbatim turn history)
 */

// ---------------------------------------------------------------------------
// Layer identifiers
// ---------------------------------------------------------------------------

export type MemoryLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

// ---------------------------------------------------------------------------
// L0 — Identity (always loaded, ~50 tokens)
// ---------------------------------------------------------------------------

export interface L0Identity {
  name: string;
  roles: string[];
  accounts: { platform: string; username: string }[];
  coreContext: string; // ~50 tokens max
}

// ---------------------------------------------------------------------------
// L1 — Essential Story (compiled summary, ~500 tokens)
// ---------------------------------------------------------------------------

export interface L1EssentialStory {
  topMoments: { date: string; event: string; significance: string }[];
  activeProjects: { name: string; status: string; lastActivity: string }[];
  keyMetrics: { label: string; value: string }[];
  generatedAt: string;
  tokenCount: number; // target ~500 tokens
}

// ---------------------------------------------------------------------------
// L2 — Wiki (FTS5 entity search results)
// ---------------------------------------------------------------------------

export interface L2WikiResult {
  entities: { slug: string; title: string; type: string; excerpt: string }[];
  source: 'wiki';
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// L3 — Semantic Search (BM25 over raw session data)
// ---------------------------------------------------------------------------

export interface L3SearchResult {
  matches: { content: string; score: number; source: string; sessionId?: string }[];
  source: 'semantic-search';
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// L4 — Raw Sessions (verbatim turn history)
// ---------------------------------------------------------------------------

export interface L4SessionResult {
  sessionId: string;
  turns: { role: string; content: string }[];
  source: 'raw-session';
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Query & Response
// ---------------------------------------------------------------------------

export interface MemoryQuery {
  query: string;
  maxLayers?: MemoryLayer[]; // which layers to search, default all
  maxTokens?: number; // token budget
  domain?: string; // domain routing hint for L2
}

export interface MemoryResponse {
  layers: {
    L0?: L0Identity;
    L1?: L1EssentialStory;
    L2?: L2WikiResult;
    L3?: L3SearchResult;
    L4?: L4SessionResult;
  };
  totalTokens: number;
  routingDecision: string; // why these layers were chosen
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  l0Path: string; // path to identity.yaml
  l1AutoGenerate: boolean;
  l2WikiDir: string;
  l3Enabled: boolean;
  l3DbPath: string; // SQLite path for session search index
  l4SessionStorePath: string;
}
