/**
 * Unit tests for src/knowledge/search.ts — FTS5 search indexing and querying
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import {
  KnowledgeSearch,
  getSearchDb,
  closeSearchDb,
  indexEntity,
  removeFromIndex,
  rebuildIndex,
  searchEntities,
  searchByType,
} from "../../src/knowledge/search.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function mockEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Test Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["testing"],
    related: [],
    content: "This is test content for FTS5 search.",
    ...overrides,
  };
}

/** Write a knowledge entity .md file to disk for rebuildIndex tests. */
function writeEntityFile(dir: string, slug: string, entity: KnowledgeEntity): void {
  const knowledgeDir = join(dir, "knowledge");
  if (!existsSync(knowledgeDir)) mkdirSync(knowledgeDir, { recursive: true });

  const frontmatter = {
    title: entity.title,
    type: entity.type,
    updated: entity.updated,
    tags: entity.tags ?? [],
    related: entity.related ?? [],
  };
  const content = matter.stringify(entity.content ?? "", frontmatter);
  writeFileSync(join(knowledgeDir, `${slug}.md`), content, "utf8");
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();
});

afterEach(() => {
  closeSearchDb();
  // On Windows, SQLite WAL files may still be locked briefly after close.
  // Use try/catch to avoid EBUSY errors in cleanup.
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors — temp files will be cleaned by OS
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

describe("search database", () => {
  test("creates database and FTS5 table", () => {
    const db = getSearchDb();
    expect(db).toBeDefined();

    // Verify the FTS5 table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe("knowledge_fts");
  });

  test("closeSearchDb closes and allows re-opening", () => {
    getSearchDb();
    closeSearchDb();
    // Should be able to get a new db connection
    const db = getSearchDb();
    expect(db).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// indexEntity
// ---------------------------------------------------------------------------

describe("indexEntity", () => {
  test("indexes an entity", () => {
    indexEntity("test-entity", mockEntity());

    const results = searchEntities("test");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("test-entity");
  });

  test("re-indexes an entity (replaces existing)", () => {
    indexEntity("test-entity", mockEntity({ title: "Original" }));
    indexEntity("test-entity", mockEntity({ title: "Updated" }));

    const results = searchEntities("Updated");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Updated");
  });

  test("indexes entity tags", () => {
    indexEntity("tagged-entity", mockEntity({
      title: "Tagged",
      tags: ["typescript", "nodejs"],
      content: "Some content",
    }));

    const results = searchEntities("typescript");
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeFromIndex
// ---------------------------------------------------------------------------

describe("removeFromIndex", () => {
  test("removes an entity from the index", () => {
    indexEntity("test-entity", mockEntity());
    removeFromIndex("test-entity");

    const results = searchEntities("test");
    expect(results).toHaveLength(0);
  });

  test("does nothing if entity is not indexed", () => {
    // Should not throw
    removeFromIndex("nonexistent");
  });
});

// ---------------------------------------------------------------------------
// rebuildIndex
// ---------------------------------------------------------------------------

describe("rebuildIndex", () => {
  test("rebuilds the index from scratch", () => {
    // Index some entities
    indexEntity("old-entity", mockEntity({ title: "Old" }));

    // Rebuild with new data
    rebuildIndex([
      { slug: "new-a", entity: mockEntity({ title: "Alpha Entity", content: "Alpha content" }) },
      { slug: "new-b", entity: mockEntity({ title: "Beta Entity", content: "Beta content" }) },
    ]);

    // Old entity should be gone
    const oldResults = searchEntities("Old");
    expect(oldResults).toHaveLength(0);

    // New entities should be present
    const alphaResults = searchEntities("Alpha");
    expect(alphaResults).toHaveLength(1);

    const betaResults = searchEntities("Beta");
    expect(betaResults).toHaveLength(1);
  });

  test("handles empty entity list", () => {
    indexEntity("existing", mockEntity());
    rebuildIndex([]);

    const results = searchEntities("test");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// searchEntities
// ---------------------------------------------------------------------------

describe("searchEntities", () => {
  test("returns empty array for empty query", () => {
    expect(searchEntities("")).toEqual([]);
    expect(searchEntities("  ")).toEqual([]);
  });

  test("searches by title", () => {
    indexEntity("react-hooks", mockEntity({ title: "React Hooks", content: "A guide to hooks" }));
    indexEntity("vue-setup", mockEntity({ title: "Vue Setup", content: "A guide to Vue" }));

    const results = searchEntities("React");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("react-hooks");
  });

  test("searches by content", () => {
    indexEntity("entity-a", mockEntity({ title: "Alpha", content: "Distributed systems design patterns" }));
    indexEntity("entity-b", mockEntity({ title: "Beta", content: "Frontend component architecture" }));

    const results = searchEntities("distributed");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("entity-a");
  });

  test("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      indexEntity(`entity-${i}`, mockEntity({ title: `Entity ${i}`, content: `Common content ${i}` }));
    }

    const results = searchEntities("Entity", 3);
    expect(results).toHaveLength(3);
  });

  test("returns results ranked by relevance", () => {
    indexEntity("primary", mockEntity({
      title: "TypeScript Guide",
      content: "TypeScript TypeScript TypeScript — all about TypeScript",
    }));
    indexEntity("secondary", mockEntity({
      title: "JavaScript",
      content: "Some mention of TypeScript here",
    }));

    const results = searchEntities("TypeScript");
    expect(results.length).toBeGreaterThan(0);
    // Primary should rank higher (more matches)
    expect(results[0].slug).toBe("primary");
  });
});

// ---------------------------------------------------------------------------
// searchByType
// ---------------------------------------------------------------------------

describe("searchByType", () => {
  test("filters entities by type", () => {
    indexEntity("tool-1", mockEntity({ title: "Git", type: "tool" }));
    indexEntity("concept-1", mockEntity({ title: "REST", type: "concept" }));
    indexEntity("tool-2", mockEntity({ title: "Docker", type: "tool" }));

    const tools = searchByType("tool");
    expect(tools).toHaveLength(2);
    expect(tools.map(r => r.slug).sort()).toEqual(["tool-1", "tool-2"]);
  });

  test("returns empty for unknown type", () => {
    const results = searchByType("unknown");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeSearch class
// ---------------------------------------------------------------------------

describe("KnowledgeSearch class", () => {
  let search: KnowledgeSearch;

  beforeEach(() => {
    search = new KnowledgeSearch();
  });

  afterEach(() => {
    search.close();
  });

  test("creates database and FTS5 table via class", () => {
    const db = search.getDb();
    expect(db).toBeDefined();

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe("knowledge_fts");
  });

  test("indexEntity and search via class", () => {
    search.indexEntity("my-entity", mockEntity({ title: "My Entity", content: "Distributed caching" }));
    const results = search.search("caching");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("my-entity");
    expect(results[0].title).toBe("My Entity");
  });

  test("search returns ranked results with snippet", () => {
    search.indexEntity("a", mockEntity({ title: "Alpha", content: "REST API design patterns for microservices" }));
    search.indexEntity("b", mockEntity({ title: "Beta", content: "Frontend component testing" }));
    const results = search.search("REST");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("a");
    expect(typeof results[0].rank).toBe("number");
  });

  test("removeFromIndex via class", () => {
    search.indexEntity("rm-me", mockEntity());
    search.removeFromIndex("rm-me");
    expect(search.search("test")).toHaveLength(0);
  });

  test("searchByType via class", () => {
    search.indexEntity("t1", mockEntity({ title: "Git", type: "tool" }));
    search.indexEntity("c1", mockEntity({ title: "REST", type: "concept" }));
    const tools = search.searchByType("tool");
    expect(tools).toHaveLength(1);
    expect(tools[0].slug).toBe("t1");
  });

  test("rebuildFromList via class", () => {
    search.indexEntity("old", mockEntity({ title: "Old" }));
    search.rebuildFromList([
      { slug: "new-a", entity: mockEntity({ title: "New A", content: "Alpha" }) },
      { slug: "new-b", entity: mockEntity({ title: "New B", content: "Beta" }) },
    ]);

    expect(search.search("Old")).toHaveLength(0);
    expect(search.search("Alpha")).toHaveLength(1);
    expect(search.search("Beta")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeSearch.rebuildIndex — scans entity files from disk
// ---------------------------------------------------------------------------

describe("KnowledgeSearch.rebuildIndex (file scanning)", () => {
  let search: KnowledgeSearch;

  beforeEach(() => {
    search = new KnowledgeSearch();
  });

  afterEach(() => {
    search.close();
  });

  test("indexes entity files from the knowledge directory", () => {
    writeEntityFile(testDir, "react-hooks", mockEntity({
      title: "React Hooks",
      type: "concept",
      content: "useState, useEffect, useContext",
    }));
    writeEntityFile(testDir, "docker-basics", mockEntity({
      title: "Docker Basics",
      type: "tool",
      content: "Containers and images",
    }));

    const count = search.rebuildIndex();
    expect(count).toBe(2);

    const results = search.search("hooks");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("react-hooks");
  });

  test("handles empty knowledge directory", () => {
    mkdirSync(join(testDir, "knowledge"), { recursive: true });
    const count = search.rebuildIndex();
    expect(count).toBe(0);
  });

  test("clears old index entries on rebuild", () => {
    search.indexEntity("stale", mockEntity({ title: "Stale Entry" }));

    writeEntityFile(testDir, "fresh", mockEntity({
      title: "Fresh Entry",
      content: "New content",
    }));

    search.rebuildIndex();
    expect(search.search("Stale")).toHaveLength(0);
    expect(search.search("Fresh")).toHaveLength(1);
  });

  test("handles modifications by re-scanning", () => {
    writeEntityFile(testDir, "evolving", mockEntity({
      title: "Evolving Entity",
      content: "Version one",
    }));
    search.rebuildIndex();
    expect(search.search("Version one")).toHaveLength(1);

    // Overwrite with updated content
    writeEntityFile(testDir, "evolving", mockEntity({
      title: "Evolving Entity",
      content: "Version two updated",
    }));
    search.rebuildIndex();
    expect(search.search("Version two")).toHaveLength(1);
  });

  test("handles deletions by re-scanning", () => {
    writeEntityFile(testDir, "to-delete", mockEntity({
      title: "To Delete",
      content: "Will be removed",
    }));
    search.rebuildIndex();
    expect(search.search("Delete")).toHaveLength(1);

    // Delete the file
    rmSync(join(testDir, "knowledge", "to-delete.md"));
    search.rebuildIndex();
    expect(search.search("Delete")).toHaveLength(0);
  });
});
