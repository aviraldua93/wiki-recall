/**
 * Unit tests for src/knowledge/extraction.ts — knowledge extraction engine
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import {
  setExtractionProvider,
  getExtractionProvider,
  resetExtractionProvider,
  extractEntities,
  extractFromSources,
  extractAndPersist,
  extractFromSourcesAndPersist,
} from "../../src/knowledge/extraction.js";
import { getEntity, listEntities } from "../../src/knowledge/entities.js";
import { createMockProvider, createMockEntity, createMockEntities } from "../../src/providers/mock.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
  resetExtractionProvider();
});

afterEach(() => {
  resetExtractionProvider();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Provider management
// ---------------------------------------------------------------------------

describe("extraction provider management", () => {
  test("throws when no provider is configured", () => {
    expect(() => getExtractionProvider()).toThrow("No extraction provider configured");
  });

  test("sets and gets a provider", () => {
    const provider = createMockProvider();
    setExtractionProvider(provider);
    expect(getExtractionProvider().name).toBe("mock");
  });

  test("resetExtractionProvider clears the provider", () => {
    setExtractionProvider(createMockProvider());
    resetExtractionProvider();
    expect(() => getExtractionProvider()).toThrow("No extraction provider configured");
  });
});

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe("extractEntities", () => {
  test("returns entities from mock provider", async () => {
    const mockEntities = [createMockEntity({ title: "Extracted Entity" })];
    setExtractionProvider(createMockProvider({ entities: mockEntities }));

    const result = await extractEntities("some text to analyze");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Extracted Entity");
  });

  test("returns empty array when provider returns nothing", async () => {
    setExtractionProvider(createMockProvider({ entities: [] }));

    const result = await extractEntities("some text");
    expect(result).toEqual([]);
  });

  test("throws when provider errors", async () => {
    setExtractionProvider(createMockProvider({
      shouldError: true,
      errorMessage: "API rate limit exceeded",
    }));

    await expect(extractEntities("some text")).rejects.toThrow("API rate limit exceeded");
  });

  test("throws when no provider is set", async () => {
    await expect(extractEntities("some text")).rejects.toThrow("No extraction provider configured");
  });
});

// ---------------------------------------------------------------------------
// extractFromSources
// ---------------------------------------------------------------------------

describe("extractFromSources", () => {
  test("extracts from multiple sources", async () => {
    const entities = createMockEntities(3);
    setExtractionProvider(createMockProvider({ entities }));

    const result = await extractFromSources(["source 1", "source 2"]);
    // Both sources return same entities, but deduplication by title keeps unique ones
    expect(result).toHaveLength(3);
  });

  test("deduplicates by title (case-insensitive)", async () => {
    const provider = createMockProvider({
      entities: [
        createMockEntity({ title: "Same Entity" }),
        createMockEntity({ title: "same entity" }),
      ],
    });
    setExtractionProvider(provider);

    const result = await extractFromSources(["source"]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Same Entity");
  });

  test("handles empty sources array", async () => {
    setExtractionProvider(createMockProvider({ entities: [createMockEntity()] }));

    const result = await extractFromSources([]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractAndPersist — extraction + entity CRUD persistence
// ---------------------------------------------------------------------------

describe("extractAndPersist", () => {
  test("extracts and creates entities on disk", async () => {
    const mockEntities = [
      createMockEntity({ title: "Persisted Alpha", type: "tool" }),
      createMockEntity({ title: "Persisted Beta", type: "concept" }),
    ];
    setExtractionProvider(createMockProvider({ entities: mockEntities }));

    const result = await extractAndPersist("session notes about tools");
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    // Verify entities are on disk
    const alpha = getEntity("persisted-alpha");
    expect(alpha.title).toBe("Persisted Alpha");
    expect(alpha.type).toBe("tool");

    const beta = getEntity("persisted-beta");
    expect(beta.title).toBe("Persisted Beta");
  });

  test("skips entities that already exist", async () => {
    const mockEntities = [createMockEntity({ title: "Duplicate Entity" })];
    setExtractionProvider(createMockProvider({ entities: mockEntities }));

    // First extraction creates the entity
    const first = await extractAndPersist("first pass");
    expect(first.created).toHaveLength(1);

    // Second extraction skips it
    const second = await extractAndPersist("second pass");
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0].reason).toContain("already exists");
  });

  test("returns empty results for empty extraction", async () => {
    setExtractionProvider(createMockProvider({ entities: [] }));
    const result = await extractAndPersist("nothing here");
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractFromSourcesAndPersist
// ---------------------------------------------------------------------------

describe("extractFromSourcesAndPersist", () => {
  test("extracts from multiple sources and persists", async () => {
    const mockEntities = [
      createMockEntity({ title: "Multi Source Entity" }),
    ];
    setExtractionProvider(createMockProvider({ entities: mockEntities }));

    const result = await extractFromSourcesAndPersist(["source 1", "source 2"]);
    // Deduplication means only 1 entity created even though 2 sources return it
    expect(result.created).toHaveLength(1);

    const entities = listEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0].title).toBe("Multi Source Entity");
  });
});
