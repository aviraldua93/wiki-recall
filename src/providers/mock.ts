/**
 * Mock Provider — mock LLM provider for testing knowledge extraction.
 *
 * Returns deterministic, configurable responses without making API calls.
 * Zero API keys required for tests.
 */

import type { KnowledgeEntity, KnowledgeEntityType } from "../types.js";
import type { ExtractionProvider } from "../knowledge/extraction.js";

// ---------------------------------------------------------------------------
// Mock extraction provider
// ---------------------------------------------------------------------------

export interface MockProviderOptions {
  /** Entities to return from extract(). */
  entities?: KnowledgeEntity[];
  /** If true, extract() will throw an error. */
  shouldError?: boolean;
  /** Error message when shouldError is true. */
  errorMessage?: string;
  /** Artificial delay in milliseconds. */
  delay?: number;
}

/**
 * Mock extraction provider class for testing.
 * Implements the full ExtractionProvider interface with both
 * extract() and extractEntities() methods.
 */
export class MockProvider implements ExtractionProvider {
  readonly name = "mock";

  private entities: KnowledgeEntity[];
  private shouldError: boolean;
  private errorMessage: string;
  private delayMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.entities = options.entities ?? [];
    this.shouldError = options.shouldError ?? false;
    this.errorMessage = options.errorMessage ?? "Mock provider error";
    this.delayMs = options.delay ?? 0;
  }

  async extractEntities(_text: string): Promise<KnowledgeEntity[]> {
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }
    if (this.shouldError) {
      throw new Error(this.errorMessage);
    }
    return this.entities;
  }

  /** Alias for backward compatibility. */
  async extract(text: string): Promise<KnowledgeEntity[]> {
    return this.extractEntities(text);
  }
}

/**
 * Create a mock extraction provider for testing.
 */
export function createMockProvider(options: MockProviderOptions = {}): MockProvider {
  return new MockProvider(options);
}

/**
 * Create a mock entity for testing.
 */
export function createMockEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: overrides.title ?? "Test Entity",
    type: overrides.type ?? "concept",
    updated: overrides.updated ?? "2025-01-15",
    tags: overrides.tags ?? ["test"],
    related: overrides.related ?? [],
    content: overrides.content ?? "This is a test entity for unit testing.",
  };
}

/**
 * Create multiple mock entities for testing.
 */
export function createMockEntities(count: number): KnowledgeEntity[] {
  const types: KnowledgeEntityType[] = ["platform", "system", "repo", "tool", "concept", "person", "team"];
  return Array.from({ length: count }, (_, i) => ({
    title: `Entity ${i + 1}`,
    type: types[i % types.length],
    updated: "2025-01-15",
    tags: [`tag-${i + 1}`],
    related: [],
    content: `Content for entity ${i + 1}.`,
  }));
}
