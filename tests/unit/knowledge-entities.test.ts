/**
 * Unit tests for src/knowledge/entities.ts — Knowledge entity CRUD
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  validateEntityFrontmatter,
} from "../../src/knowledge/entities.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function validEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Test Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["testing", "unit-test"],
    related: [],
    content: "## What It Is\n\nA test entity for unit testing.",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-entities-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors — SQLite WAL files may still be locked briefly on Windows
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// createEntity
// ---------------------------------------------------------------------------

describe("createEntity", () => {
  test("creates an entity file on disk", () => {
    const { slug } = createEntity(validEntity());
    expect(slug).toBe("test-entity");

    const filePath = join(testDir, "knowledge", "test-entity.md");
    expect(existsSync(filePath)).toBe(true);
  });

  test("stores correct frontmatter", () => {
    createEntity(validEntity());
    const filePath = join(testDir, "knowledge", "test-entity.md");
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);

    expect(parsed.data.title).toBe("Test Entity");
    expect(parsed.data.type).toBe("concept");
    expect(parsed.data.updated).toBe("2025-01-15");
    expect(parsed.data.tags).toEqual(["testing", "unit-test"]);
  });

  test("stores Markdown content in body", () => {
    createEntity(validEntity());
    const filePath = join(testDir, "knowledge", "test-entity.md");
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);

    expect(parsed.content).toContain("What It Is");
  });

  test("throws if entity already exists", () => {
    createEntity(validEntity());
    expect(() => createEntity(validEntity())).toThrow("already exists");
  });

  test("throws on invalid entity (missing title)", () => {
    const bad = { type: "concept", updated: "2025-01-15" } as unknown as KnowledgeEntity;
    expect(() => createEntity(bad)).toThrow("Invalid entity");
  });

  test("throws on invalid entity (bad type)", () => {
    expect(() => createEntity(validEntity({ type: "invalid" as any }))).toThrow("Invalid entity");
  });

  test("throws on invalid entity (bad date format)", () => {
    expect(() => createEntity(validEntity({ updated: "not-a-date" }))).toThrow("Invalid entity");
  });

  test("slugifies title correctly", () => {
    const { slug } = createEntity(validEntity({ title: "My Complex Entity Name" }));
    expect(slug).toBe("my-complex-entity-name");
  });

  test("handles entity with all 7 types", () => {
    const types = ["platform", "system", "repo", "tool", "concept", "person", "team"] as const;
    for (const type of types) {
      const { slug } = createEntity(validEntity({ title: `Entity ${type}`, type }));
      expect(slug).toBe(`entity-${type}`);
    }
  });
});

// ---------------------------------------------------------------------------
// getEntity
// ---------------------------------------------------------------------------

describe("getEntity", () => {
  test("reads an existing entity", () => {
    createEntity(validEntity());
    const entity = getEntity("test-entity");

    expect(entity.title).toBe("Test Entity");
    expect(entity.type).toBe("concept");
    expect(entity.content).toContain("What It Is");
  });

  test("throws if entity does not exist", () => {
    expect(() => getEntity("nonexistent")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// updateEntity
// ---------------------------------------------------------------------------

describe("updateEntity", () => {
  test("updates entity title", () => {
    createEntity(validEntity());
    const updated = updateEntity("test-entity", { title: "Updated Title" });
    expect(updated.title).toBe("Updated Title");
  });

  test("updates entity content", () => {
    createEntity(validEntity());
    const updated = updateEntity("test-entity", { content: "New content here." });
    expect(updated.content).toBe("New content here.");
  });

  test("updates entity tags", () => {
    createEntity(validEntity());
    const updated = updateEntity("test-entity", { tags: ["new-tag"] });
    expect(updated.tags).toEqual(["new-tag"]);
  });

  test("persists updates to disk", () => {
    createEntity(validEntity());
    updateEntity("test-entity", { title: "Persisted Title" });
    const reloaded = getEntity("test-entity");
    expect(reloaded.title).toBe("Persisted Title");
  });

  test("throws if entity does not exist", () => {
    expect(() => updateEntity("nonexistent", { title: "test" })).toThrow("not found");
  });

  test("throws on invalid update (bad type)", () => {
    createEntity(validEntity());
    expect(() => updateEntity("test-entity", { type: "invalid" as any })).toThrow("Invalid entity");
  });
});

// ---------------------------------------------------------------------------
// deleteEntity
// ---------------------------------------------------------------------------

describe("deleteEntity", () => {
  test("deletes an entity from disk", () => {
    createEntity(validEntity());
    deleteEntity("test-entity");

    const filePath = join(testDir, "knowledge", "test-entity.md");
    expect(existsSync(filePath)).toBe(false);
  });

  test("throws if entity does not exist", () => {
    expect(() => deleteEntity("nonexistent")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// listEntities
// ---------------------------------------------------------------------------

describe("listEntities", () => {
  test("returns empty array when no entities exist", () => {
    expect(listEntities()).toEqual([]);
  });

  test("lists all entities", () => {
    createEntity(validEntity({ title: "Alpha Entity" }));
    createEntity(validEntity({ title: "Beta Entity" }));

    const entities = listEntities();
    expect(entities).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// validateEntityFrontmatter
// ---------------------------------------------------------------------------

describe("validateEntityFrontmatter", () => {
  test("validates correct frontmatter", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "2025-01-15",
    });
    expect(result.valid).toBe(true);
  });

  test("rejects missing required fields", () => {
    const result = validateEntityFrontmatter({});
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("rejects invalid type", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "invalid",
      updated: "2025-01-15",
    });
    expect(result.valid).toBe(false);
  });

  test("rejects invalid date format", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "not-a-date",
    });
    expect(result.valid).toBe(false);
  });

  test("rejects extra properties", () => {
    const result = validateEntityFrontmatter({
      title: "Test",
      type: "concept",
      updated: "2025-01-15",
      extraField: "nope",
    });
    expect(result.valid).toBe(false);
  });
});
