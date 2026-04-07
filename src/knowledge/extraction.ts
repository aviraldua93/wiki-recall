/**
 * Knowledge Extraction — extract knowledge entities from session context.
 *
 * Uses LLM providers (or mock for testing) to analyze text and extract
 * structured knowledge entities. Can persist extracted entities via the
 * entity CRUD operations.
 */

import type { KnowledgeEntity, KnowledgeEntityType } from "../types.js";
import { createEntity } from "./entities.js";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface ExtractionProvider {
  /** Provider name for logging. */
  name: string;

  /**
   * Extract knowledge entities from a block of text.
   * Returns an array of extracted entities.
   */
  extractEntities(text: string): Promise<KnowledgeEntity[]>;

  /**
   * Alias for extractEntities — backward compatibility.
   */
  extract(text: string): Promise<KnowledgeEntity[]>;
}

// ---------------------------------------------------------------------------
// Extraction engine
// ---------------------------------------------------------------------------

let _provider: ExtractionProvider | undefined;

/**
 * Set the extraction provider.
 */
export function setExtractionProvider(provider: ExtractionProvider): void {
  _provider = provider;
}

/**
 * Get the current extraction provider.
 * Throws if no provider is configured.
 */
export function getExtractionProvider(): ExtractionProvider {
  if (!_provider) {
    throw new Error("No extraction provider configured. Call setExtractionProvider() first.");
  }
  return _provider;
}

/**
 * Reset the extraction provider — useful for tests.
 */
export function resetExtractionProvider(): void {
  _provider = undefined;
}

/**
 * Extract knowledge entities from a text block using the configured provider.
 */
export async function extractEntities(text: string): Promise<KnowledgeEntity[]> {
  const provider = getExtractionProvider();
  return provider.extractEntities(text);
}

/**
 * Extract entities from multiple text sources and deduplicate by title.
 */
export async function extractFromSources(sources: string[]): Promise<KnowledgeEntity[]> {
  const provider = getExtractionProvider();
  const allEntities: KnowledgeEntity[] = [];

  for (const source of sources) {
    const entities = await provider.extractEntities(source);
    allEntities.push(...entities);
  }

  // Deduplicate by title (case-insensitive)
  const seen = new Set<string>();
  return allEntities.filter(entity => {
    const key = entity.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Extraction + persistence
// ---------------------------------------------------------------------------

export interface PersistResult {
  /** Entities that were successfully created. */
  created: Array<{ slug: string; entity: KnowledgeEntity }>;
  /** Entities that were skipped (already exist). */
  skipped: Array<{ title: string; reason: string }>;
  /** Entities that failed to persist. */
  errors: Array<{ title: string; error: string }>;
}

/**
 * Extract entities from scenario context/notes and persist them via entity CRUD.
 * Skips entities that already exist. Returns a summary of results.
 */
export async function extractAndPersist(text: string): Promise<PersistResult> {
  const entities = await extractEntities(text);
  return persistEntities(entities);
}

/**
 * Extract from multiple sources, deduplicate, and persist.
 */
export async function extractFromSourcesAndPersist(sources: string[]): Promise<PersistResult> {
  const entities = await extractFromSources(sources);
  return persistEntities(entities);
}

/**
 * Persist a list of entities, handling conflicts gracefully.
 */
function persistEntities(entities: KnowledgeEntity[]): PersistResult {
  const result: PersistResult = { created: [], skipped: [], errors: [] };

  for (const entity of entities) {
    try {
      const { slug } = createEntity(entity);
      result.created.push({ slug, entity });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        result.skipped.push({ title: entity.title, reason: "Entity already exists" });
      } else {
        result.errors.push({ title: entity.title, error: message });
      }
    }
  }

  return result;
}
