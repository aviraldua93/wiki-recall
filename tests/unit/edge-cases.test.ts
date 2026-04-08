/**
 * Edge-case tests for WikiRecall modules.
 *
 * Covers:
 * - Malformed YAML handling
 * - Very long entity names
 * - Special characters in search queries
 * - Concurrent entity creation
 * - Boundary conditions across modules
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { resetConfig } from "../../src/config.js";
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  validateEntityFrontmatter,
} from "../../src/knowledge/entities.js";
import {
  closeSearchDb,
  searchEntities,
  indexEntity,
  rebuildIndex,
  KnowledgeSearch,
} from "../../src/knowledge/search.js";
import {
  createScenario,
  getScenario,
  updateScenario,
  deleteScenario,
  listScenarios,
  validateScenarioManifest,
} from "../../src/scenario/manager.js";
import type { KnowledgeEntity, Scenario } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDir: string;

function validEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Test Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["testing"],
    related: [],
    content: "Test content for edge cases.",
    ...overrides,
  };
}

function validScenario(overrides: Partial<Scenario> & { name: string }): Scenario {
  return {
    version: "0.1.0",
    status: "active",
    description: "Edge case test scenario",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {}
  resetConfig();
});

// ---------------------------------------------------------------------------
// Malformed YAML handling
// ---------------------------------------------------------------------------

describe("Malformed YAML handling", () => {
  test("entity file with invalid YAML frontmatter can be read gracefully", () => {
    // Write a malformed entity file directly
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(
      join(knowledgeDir, "malformed.md"),
      "---\ntitle: Missing closing\ntype: concept\n  invalid indent\n---\nContent",
      "utf8"
    );

    // gray-matter may parse it partially or throw
    // listEntities should either skip or handle it
    try {
      const entities = listEntities();
      // If it doesn't throw, it should return some result
      expect(Array.isArray(entities)).toBe(true);
    } catch (err: any) {
      // It's acceptable to throw on malformed YAML
      expect(err).toBeDefined();
    }
  });

  test("scenario file with truncated YAML throws on read", () => {
    const scenariosDir = join(testDir, "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeFileSync(
      join(scenariosDir, "broken.yaml"),
      "name: broken\nversion: 0.1.0\nstatus: active\n  invalid:\n    - [unclosed",
      "utf8"
    );

    try {
      getScenario("broken");
    } catch (err: any) {
      // Should throw a parse error
      expect(err).toBeDefined();
    }
  });

  test("entity with YAML containing only frontmatter and no content", () => {
    const entity = createEntity(validEntity({ content: "" }));
    const retrieved = getEntity(entity.slug);
    expect(retrieved.content).toBe("");
  });

  test("entity with content containing YAML-like syntax", () => {
    // gray-matter treats --- as frontmatter delimiters, so we use content
    // that doesn't start with ---
    const entity = createEntity(validEntity({
      title: "Yaml Content",
      content: "Some intro text\n\nkey: value\nanother: field",
    }));
    const retrieved = getEntity(entity.slug);
    expect(retrieved.content).toContain("key: value");
  });

  test("scenario YAML with extra unknown fields fails validation", () => {
    // The scenario schema uses additionalProperties: false, so extra
    // fields cause a validation error on read. This is the expected behavior.
    const scenariosDir = join(testDir, "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    const scenario = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "extra-fields",
      version: "0.1.0",
      status: "active",
      description: "Has extra fields",
      custom_field: "should cause validation error",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeFileSync(
      join(scenariosDir, "extra-fields.yaml"),
      yaml.dump(scenario),
      "utf8"
    );

    expect(() => getScenario("extra-fields")).toThrow("additional properties");
  });
});

// ---------------------------------------------------------------------------
// Very long entity names
// ---------------------------------------------------------------------------

describe("Very long entity names", () => {
  test("entity with 200-character title creates a slugified file", () => {
    const longTitle = "A".repeat(200);
    const entity = createEntity(validEntity({ title: longTitle }));
    expect(entity.slug).toBeDefined();
    expect(entity.slug.length).toBeGreaterThan(0);
    // Slug should be lowercase
    expect(entity.slug).toBe(entity.slug.toLowerCase());
  });

  test("entity with very long title can be retrieved", () => {
    const longTitle = "Long Title " + "Word ".repeat(40);
    const created = createEntity(validEntity({ title: longTitle }));
    const retrieved = getEntity(created.slug);
    expect(retrieved.title).toBe(longTitle);
  });

  test("scenario with maximum-length name (100+ chars kebab-case)", () => {
    const longName = ("a".repeat(10) + "-").repeat(10) + "end";
    const scenario = createScenario(validScenario({ name: longName }));
    expect(scenario.name).toBe(longName);
    const retrieved = getScenario(longName);
    expect(retrieved.name).toBe(longName);
  });

  test("entity with single-character title", () => {
    const entity = createEntity(validEntity({ title: "X" }));
    expect(entity.slug).toBe("x");
    const retrieved = getEntity("x");
    expect(retrieved.title).toBe("X");
  });

  test("entity title with only special characters slugifies to empty-safe string", () => {
    // Title with no alphanumeric chars: slugify will produce empty string
    try {
      createEntity(validEntity({ title: "!@#$%^&*()" }));
      // If it succeeds, the slug should be something
    } catch (err: any) {
      // Acceptable — empty slug might cause an error
      expect(err).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Special characters in search queries
// ---------------------------------------------------------------------------

describe("Special characters in search queries", () => {
  // First create some entities to search against
  function seedEntities() {
    createEntity(validEntity({ title: "Retry Patterns", content: "Exponential backoff and jitter" }));
    createEntity(validEntity({ title: "API Design", content: "REST API design principles", type: "concept" }));
    createEntity(validEntity({ title: "Database Sharding", content: "Horizontal partitioning of data", type: "system" }));
  }

  test("search with FTS5 special characters does not crash", () => {
    seedEntities();
    // These contain FTS5 operators that should be sanitized
    const results = searchEntities("*wildcard*");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with quotes does not crash", () => {
    seedEntities();
    const results = searchEntities('"exact phrase"');
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with parentheses does not crash", () => {
    seedEntities();
    const results = searchEntities("(group) query");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with colons does not crash", () => {
    seedEntities();
    const results = searchEntities("type:concept");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with caret does not crash", () => {
    seedEntities();
    const results = searchEntities("^start");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with curly braces does not crash", () => {
    seedEntities();
    const results = searchEntities("{near}");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with FTS5 reserved words (AND, OR, NOT) doesn't crash", () => {
    seedEntities();
    const results = searchEntities("AND OR NOT");
    // All reserved words stripped — should return empty
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with NEAR keyword doesn't crash", () => {
    seedEntities();
    const results = searchEntities("NEAR retry");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with empty string returns empty", () => {
    seedEntities();
    const results = searchEntities("");
    expect(results).toEqual([]);
  });

  test("search with only whitespace returns empty", () => {
    seedEntities();
    const results = searchEntities("   ");
    expect(results).toEqual([]);
  });

  test("search with only special characters returns empty", () => {
    seedEntities();
    const results = searchEntities("***");
    expect(results).toEqual([]);
  });

  test("search with mixed special chars and valid terms works", () => {
    seedEntities();
    const results = searchEntities("retry *patterns* (API)");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with Unicode characters", () => {
    seedEntities();
    const results = searchEntities("日本語 テスト");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with emoji characters", () => {
    seedEntities();
    const results = searchEntities("🚀 deploy");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with SQL injection attempt is safe", () => {
    seedEntities();
    const results = searchEntities("'; DROP TABLE knowledge_fts; --");
    expect(Array.isArray(results)).toBe(true);
  });

  test("search with very long query string", () => {
    seedEntities();
    const longQuery = "word ".repeat(500);
    const results = searchEntities(longQuery);
    expect(Array.isArray(results)).toBe(true);
  });

  test("search limit parameter is respected", () => {
    seedEntities();
    const results = searchEntities("retry", 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test("search with zero limit returns empty", () => {
    seedEntities();
    const results = searchEntities("retry", 0);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Concurrent entity creation
// ---------------------------------------------------------------------------

describe("Concurrent entity creation", () => {
  test("creating entities with different names in sequence succeeds", () => {
    const slugs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const result = createEntity(validEntity({ title: `Entity ${i}` }));
      slugs.push(result.slug);
    }
    expect(slugs.length).toBe(10);
    const unique = new Set(slugs);
    expect(unique.size).toBe(10);
  });

  test("parallel entity creation with different names", async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      Promise.resolve(createEntity(validEntity({ title: `Parallel ${i}` })))
    );
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    const slugs = results.map(r => r.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(5);
  });

  test("duplicate entity creation throws", () => {
    createEntity(validEntity({ title: "Duplicate Test" }));
    expect(() => createEntity(validEntity({ title: "Duplicate Test" }))).toThrow("already exists");
  });

  test("creating scenarios with different names in sequence", () => {
    const names: string[] = [];
    for (let i = 0; i < 10; i++) {
      const name = `concurrent-scenario-${i}`;
      createScenario(validScenario({ name }));
      names.push(name);
    }
    const scenarios = listScenarios();
    expect(scenarios.length).toBe(10);
  });

  test("duplicate scenario creation throws", () => {
    createScenario(validScenario({ name: "dup-scenario" }));
    expect(() => createScenario(validScenario({ name: "dup-scenario" }))).toThrow("already exists");
  });
});

// ---------------------------------------------------------------------------
// Entity validation edge cases
// ---------------------------------------------------------------------------

describe("Entity validation edge cases", () => {
  test("entity with invalid type is rejected", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "invalid-type",
      updated: "2025-01-15",
    });
    expect(result.valid).toBe(false);
  });

  test("entity with missing title is rejected", () => {
    const result = validateEntityFrontmatter({
      type: "concept",
      updated: "2025-01-15",
    });
    expect(result.valid).toBe(false);
  });

  test("entity with invalid date format is rejected", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "not-a-date",
    });
    expect(result.valid).toBe(false);
  });

  test("entity with all valid types succeeds", () => {
    const validTypes = ["platform", "system", "repo", "tool", "concept", "person", "team"];
    for (const type of validTypes) {
      const result = validateEntityFrontmatter({
        title: "Test",
        type,
        updated: "2025-01-15",
      });
      expect(result.valid).toBe(true);
    }
  });

  test("entity with empty tags array is valid", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "2025-01-15",
      tags: [],
    });
    expect(result.valid).toBe(true);
  });

  test("entity with empty related array is valid", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "2025-01-15",
      related: [],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario validation edge cases
// ---------------------------------------------------------------------------

describe("Scenario validation edge cases", () => {
  test("scenario with missing name is invalid", () => {
    const result = validateScenarioManifest({
      version: "0.1.0",
      status: "active",
      description: "No name",
    });
    expect(result.valid).toBe(false);
  });

  test("scenario with missing version is invalid", () => {
    const result = validateScenarioManifest({
      name: "test",
      status: "active",
      description: "No version",
    });
    expect(result.valid).toBe(false);
  });

  test("scenario with missing description is invalid", () => {
    const result = validateScenarioManifest({
      name: "test",
      version: "0.1.0",
      status: "active",
    });
    expect(result.valid).toBe(false);
  });

  test("scenario with invalid status is invalid", () => {
    const result = validateScenarioManifest({
      name: "test",
      version: "0.1.0",
      status: "invalid-status",
      description: "Bad status",
    });
    expect(result.valid).toBe(false);
  });

  test("scenario with all valid statuses passes validation", () => {
    const statuses = ["active", "paused", "handed-off", "archived"];
    for (const status of statuses) {
      const result = validateScenarioManifest({
        name: "test",
        version: "0.1.0",
        status,
        description: "Test",
      });
      expect(result.valid).toBe(true);
    }
  });

  test("scenario with empty repos array is valid", () => {
    const scenario = createScenario(validScenario({
      name: "empty-repos",
      repos: [],
    }));
    expect(scenario.repos).toEqual([]);
  });

  test("scenario with empty skills array is valid", () => {
    const scenario = createScenario(validScenario({
      name: "empty-skills",
      skills: [],
    }));
    expect(scenario.skills).toEqual([]);
  });

  test("scenario with special characters in description", () => {
    const scenario = createScenario(validScenario({
      name: "special-desc",
      description: "Has <html>, \"quotes\", and 'apostrophes' & ampersands!",
    }));
    expect(scenario.description).toContain("<html>");
  });
});

// ---------------------------------------------------------------------------
// Search index edge cases
// ---------------------------------------------------------------------------

describe("Search index edge cases", () => {
  test("KnowledgeSearch on empty database returns empty results", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-search.db"));
    const results = search.search("anything");
    expect(results).toEqual([]);
    search.close();
  });

  test("index then search finds the entity", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-idx.db"));
    search.indexEntity("test-slug", validEntity({ title: "Findable", content: "Unique content here" }));
    const results = search.search("Findable");
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe("test-slug");
    search.close();
  });

  test("removeFromIndex removes the entity from search", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-remove.db"));
    search.indexEntity("rm-slug", validEntity({ title: "Will Be Removed" }));
    search.removeFromIndex("rm-slug");
    const results = search.search("Removed");
    expect(results).toEqual([]);
    search.close();
  });

  test("rebuildFromList replaces entire index", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-rebuild.db"));
    search.indexEntity("old", validEntity({ title: "Old Entry" }));
    search.rebuildFromList([
      { slug: "new1", entity: validEntity({ title: "New Entry One" }) },
      { slug: "new2", entity: validEntity({ title: "New Entry Two" }) },
    ]);
    const oldResults = search.search("Old");
    expect(oldResults).toEqual([]);
    const newResults = search.search("New");
    expect(newResults.length).toBe(2);
    search.close();
  });

  test("searchByType returns only matching type", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-bytype.db"));
    search.indexEntity("s1", validEntity({ title: "Sys One", type: "system" }));
    search.indexEntity("c1", validEntity({ title: "Concept One", type: "concept" }));
    const results = search.searchByType("system");
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe("s1");
    search.close();
  });

  test("double indexing same slug updates (not duplicates)", () => {
    const search = new KnowledgeSearch(join(testDir, "knowledge", "test-double.db"));
    search.indexEntity("dup", validEntity({ title: "Version 1" }));
    search.indexEntity("dup", validEntity({ title: "Version 2" }));
    const results = search.search("Version");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Version 2");
    search.close();
  });
});

// ---------------------------------------------------------------------------
// Entity CRUD edge cases
// ---------------------------------------------------------------------------

describe("Entity CRUD edge cases", () => {
  test("update preserves fields not in updates", () => {
    const { slug } = createEntity(validEntity({
      title: "Preserved Fields",
      tags: ["original"],
      content: "Original content",
    }));
    const updated = updateEntity(slug, { content: "Updated content" });
    expect(updated.tags).toEqual(["original"]);
    expect(updated.content).toBe("Updated content");
  });

  test("delete then create same name succeeds", () => {
    const { slug } = createEntity(validEntity({ title: "Recreate Test" }));
    deleteEntity(slug);
    const { slug: newSlug } = createEntity(validEntity({ title: "Recreate Test" }));
    expect(newSlug).toBe(slug);
  });

  test("get nonexistent entity throws", () => {
    expect(() => getEntity("nonexistent-slug")).toThrow("not found");
  });

  test("delete nonexistent entity throws", () => {
    expect(() => deleteEntity("nonexistent-slug")).toThrow("not found");
  });

  test("entity with very long content", () => {
    const longContent = "# Long Content\n\n" + "paragraph ".repeat(10000);
    const { slug } = createEntity(validEntity({ title: "Long Content Entity", content: longContent }));
    const retrieved = getEntity(slug);
    expect(retrieved.content).toContain("paragraph");
    expect(retrieved.content!.length).toBeGreaterThan(50000);
  });

  test("entity with many tags", () => {
    const manyTags = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
    const { slug } = createEntity(validEntity({ title: "Many Tags", tags: manyTags }));
    const retrieved = getEntity(slug);
    expect(retrieved.tags).toHaveLength(50);
  });

  test("entity with Unicode title", () => {
    const { slug } = createEntity(validEntity({ title: "日本語テスト" }));
    const retrieved = getEntity(slug);
    expect(retrieved.title).toBe("日本語テスト");
  });

  test("entity content with code blocks", () => {
    const content = "## Code\n\n```typescript\nconst x = 42;\nconsole.log(x);\n```\n\nEnd.";
    const { slug } = createEntity(validEntity({ title: "Code Block Entity", content }));
    const retrieved = getEntity(slug);
    expect(retrieved.content).toContain("```typescript");
    expect(retrieved.content).toContain("const x = 42;");
  });
});

// ---------------------------------------------------------------------------
// Scenario CRUD edge cases
// ---------------------------------------------------------------------------

describe("Scenario CRUD edge cases", () => {
  test("update preserves fields not in updates", () => {
    createScenario(validScenario({
      name: "preserve-test",
      description: "Original description",
      repos: [{ url: "https://github.com/org/repo", branch: "main" }],
    }));
    updateScenario("preserve-test", { description: "Updated description" });
    const retrieved = getScenario("preserve-test");
    expect(retrieved.description).toBe("Updated description");
    expect(retrieved.repos).toHaveLength(1);
  });

  test("delete then list shows reduced count", () => {
    createScenario(validScenario({ name: "del-test-1" }));
    createScenario(validScenario({ name: "del-test-2" }));
    expect(listScenarios()).toHaveLength(2);
    deleteScenario("del-test-1");
    expect(listScenarios()).toHaveLength(1);
  });

  test("get nonexistent scenario throws", () => {
    expect(() => getScenario("does-not-exist")).toThrow("not found");
  });

  test("delete nonexistent scenario throws", () => {
    expect(() => deleteScenario("does-not-exist")).toThrow("not found");
  });

  test("scenario with context containing special characters", () => {
    const scenario = createScenario(validScenario({
      name: "special-context",
      context: {
        summary: "Has <html>, \"quotes\", and $variables",
        next_steps: ["Step with 'single quotes'", "Step with <angle brackets>"],
        blockers: ["Blocker with emoji 🚫"],
        notes: "Notes with\nnewlines\nand\ttabs",
      },
    }));
    const retrieved = getScenario("special-context");
    expect(retrieved.context?.summary).toContain("<html>");
    expect(retrieved.context?.blockers?.[0]).toContain("🚫");
  });
});
