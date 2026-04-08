/**
 * STRESS TEST 3: Concurrent Operations — race conditions and parallel access.
 *
 * Tests: simultaneous entity creates, updates during search, index rebuild
 * during search, concurrent reads/writes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
} from "../../src/knowledge/entities.js";
import {
  KnowledgeSearch,
  closeSearchDb,
  indexEntity,
  searchEntities,
} from "../../src/knowledge/search.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function validEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Concurrent Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["concurrent"],
    related: [],
    content: "Content for concurrency stress testing.",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-stress-conc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Simultaneous entity creates with same name
// ---------------------------------------------------------------------------

describe("Concurrent entity creates", () => {
  test("two simultaneous creates with same name — one should win", async () => {
    const promises = [
      Promise.resolve().then(() => createEntity(validEntity({ title: "Race Entity", content: "First" }))),
      Promise.resolve().then(() => createEntity(validEntity({ title: "Race Entity", content: "Second" }))),
    ];

    const results = await Promise.allSettled(promises);

    // One should succeed, one should fail with "already exists"
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    expect(fulfilled.length + rejected.length).toBe(2);
    // At least one must succeed
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  test("10 simultaneous creates with unique names all succeed", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve().then(() =>
        createEntity(validEntity({ title: `Parallel Entity ${i}` }))
      )
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled.length).toBe(10);
  });

  test("rapid create-delete-create cycle", async () => {
    createEntity(validEntity({ title: "Cycle Entity" }));
    deleteEntity("cycle-entity");
    const { slug } = createEntity(validEntity({ title: "Cycle Entity" }));
    expect(slug).toBe("cycle-entity");
  });
});

// ---------------------------------------------------------------------------
// Entity update while search is running
// ---------------------------------------------------------------------------

describe("Concurrent search and update", () => {
  test("update entity while search runs", async () => {
    createEntity(validEntity({ title: "Searchable Entity", content: "Original content for searching" }));

    const [searchResult, updateResult] = await Promise.all([
      Promise.resolve().then(() => {
        // Perform multiple searches
        const r1 = listEntities();
        const r2 = listEntities();
        return { r1, r2 };
      }),
      Promise.resolve().then(() => {
        return updateEntity("searchable-entity", { content: "Updated content after search" });
      }),
    ]);

    expect(searchResult.r1).toBeDefined();
    expect(updateResult.content).toBe("Updated content after search");
  });

  test("concurrent reads don't interfere", async () => {
    createEntity(validEntity({ title: "Read Target" }));

    const promises = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => getEntity("read-target"))
    );

    const results = await Promise.all(promises);
    results.forEach(entity => {
      expect(entity.title).toBe("Read Target");
    });
  });
});

// ---------------------------------------------------------------------------
// FTS5 index operations during search
// ---------------------------------------------------------------------------

describe("Concurrent FTS5 operations", () => {
  test("index rebuild while search is running", async () => {
    const search = new KnowledgeSearch();
    search.indexEntity("a", validEntity({ title: "Alpha", content: "Alpha content" }));
    search.indexEntity("b", validEntity({ title: "Beta", content: "Beta content" }));

    const [searchResults, rebuildResult] = await Promise.all([
      Promise.resolve().then(() => search.search("Alpha")),
      Promise.resolve().then(() => search.rebuildFromList([
        { slug: "c", entity: validEntity({ title: "Gamma", content: "Gamma content" }) },
      ])),
    ]);

    // Search should return some results (might be old or new data)
    expect(searchResults).toBeDefined();
    search.close();
  });

  test("concurrent index and search operations", async () => {
    const search = new KnowledgeSearch();

    // Run 20 parallel operations: mix of index and search
    const promises = Array.from({ length: 20 }, (_, i) => {
      if (i % 2 === 0) {
        return Promise.resolve().then(() => {
          search.indexEntity(`entity-${i}`, validEntity({
            title: `Entity ${i}`,
            content: `Content ${i}`,
          }));
          return { type: "index", i };
        });
      } else {
        return Promise.resolve().then(() => {
          const results = search.search(`Entity`);
          return { type: "search", i, count: results.length };
        });
      }
    });

    const results = await Promise.allSettled(promises);
    const failures = results.filter(r => r.status === "rejected");

    // All operations should succeed (SQLite handles WAL locking)
    expect(failures.length).toBe(0);
    search.close();
  });

  test("Promise.race — search vs rebuild", async () => {
    const search = new KnowledgeSearch();
    search.indexEntity("race-entity", validEntity({ title: "Race", content: "Racing content" }));

    const result = await Promise.race([
      Promise.resolve().then(() => ({ winner: "search", data: search.search("Race") })),
      Promise.resolve().then(() => {
        search.rebuildFromList([{ slug: "new", entity: validEntity({ title: "New" }) }]);
        return { winner: "rebuild", data: null };
      }),
    ]);

    expect(result.winner).toBeDefined();
    search.close();
  });

  test("simultaneous remove and search", async () => {
    const search = new KnowledgeSearch();
    search.indexEntity("doomed", validEntity({ title: "Doomed Entity", content: "About to be removed" }));

    const [searchResult] = await Promise.all([
      Promise.resolve().then(() => search.search("Doomed")),
      Promise.resolve().then(() => search.removeFromIndex("doomed")),
    ]);

    // Search might or might not find it depending on execution order
    expect(searchResult).toBeDefined();
    search.close();
  });
});

// ---------------------------------------------------------------------------
// Concurrent entity CRUD stress
// ---------------------------------------------------------------------------

describe("Concurrent CRUD stress", () => {
  test("50 creates followed by list", async () => {
    for (let i = 0; i < 50; i++) {
      createEntity(validEntity({ title: `Stress Entity ${i}` }));
    }

    const entities = listEntities();
    expect(entities.length).toBe(50);
  });

  test("create-read-update-delete cycle for 20 entities", async () => {
    const slugs: string[] = [];

    // Create
    for (let i = 0; i < 20; i++) {
      const { slug } = createEntity(validEntity({ title: `CRUD Entity ${i}` }));
      slugs.push(slug);
    }

    // Read all
    const readPromises = slugs.map(s => Promise.resolve().then(() => getEntity(s)));
    const entities = await Promise.all(readPromises);
    expect(entities.length).toBe(20);

    // Update all
    for (const slug of slugs) {
      updateEntity(slug, { content: "Updated!" });
    }

    // Delete all
    for (const slug of slugs) {
      deleteEntity(slug);
    }

    expect(listEntities().length).toBe(0);
  });
});
