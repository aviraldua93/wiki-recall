/**
 * Unit tests for benchmarks/generators.ts — mock data generation.
 */

import { describe, test, expect } from "bun:test";
import { generateMockEntities, generateMockSessions, generateTestQueries } from "../../benchmarks/generators.js";
import type { KnowledgeEntityType } from "../../src/types.js";

// ---------------------------------------------------------------------------
// generateMockEntities
// ---------------------------------------------------------------------------

describe("generateMockEntities", () => {
  test("generates the requested number of entities", () => {
    const entities = generateMockEntities(10, 42);
    expect(entities).toHaveLength(10);
  });

  test("generates zero entities when count is 0", () => {
    const entities = generateMockEntities(0, 42);
    expect(entities).toHaveLength(0);
  });

  test("generates large batches correctly", () => {
    const entities = generateMockEntities(100, 42);
    expect(entities).toHaveLength(100);
  });

  test("all entities have required fields", () => {
    const entities = generateMockEntities(20, 42);
    for (const e of entities) {
      expect(e.title).toBeTruthy();
      expect(e.type).toBeTruthy();
      expect(e.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(e.tags)).toBe(true);
    }
  });

  test("entities have diverse types", () => {
    const entities = generateMockEntities(50, 42);
    const types = new Set(entities.map(e => e.type));
    expect(types.size).toBeGreaterThanOrEqual(3);
  });

  test("entity types are valid KnowledgeEntityType", () => {
    const validTypes: KnowledgeEntityType[] = ["platform", "system", "repo", "tool", "concept", "person", "team"];
    const entities = generateMockEntities(30, 42);
    for (const e of entities) {
      expect(validTypes).toContain(e.type);
    }
  });

  test("entities have tags", () => {
    const entities = generateMockEntities(20, 42);
    const withTags = entities.filter(e => (e.tags?.length ?? 0) > 0);
    expect(withTags.length).toBeGreaterThan(0);
  });

  test("entities have content with wikilinks", () => {
    const entities = generateMockEntities(20, 42);
    const withLinks = entities.filter(e => (e.content ?? "").includes("[["));
    expect(withLinks.length).toBeGreaterThan(0);
  });

  test("entities have content with tags (hashtags)", () => {
    const entities = generateMockEntities(20, 42);
    const withHashtags = entities.filter(e => (e.content ?? "").includes("#"));
    expect(withHashtags.length).toBeGreaterThan(0);
  });

  test("is deterministic with same seed", () => {
    const a = generateMockEntities(10, 42);
    const b = generateMockEntities(10, 42);
    expect(a.map(e => e.title)).toEqual(b.map(e => e.title));
  });

  test("different seeds produce different results", () => {
    const a = generateMockEntities(10, 42);
    const b = generateMockEntities(10, 99);
    const titlesA = a.map(e => e.title).join(",");
    const titlesB = b.map(e => e.title).join(",");
    expect(titlesA).not.toBe(titlesB);
  });

  test("entities have valid status values", () => {
    const entities = generateMockEntities(30, 42);
    const validStatuses = ["draft", "reviewed", "needs_update"];
    for (const e of entities) {
      if (e.status) {
        expect(validStatuses).toContain(e.status);
      }
    }
  });

  test("related field contains strings", () => {
    const entities = generateMockEntities(20, 42);
    for (const e of entities) {
      if (e.related && e.related.length > 0) {
        for (const r of e.related) {
          expect(typeof r).toBe("string");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateMockSessions
// ---------------------------------------------------------------------------

describe("generateMockSessions", () => {
  test("generates the requested number of sessions", () => {
    const sessions = generateMockSessions(10, 42);
    expect(sessions).toHaveLength(10);
  });

  test("generates zero sessions when count is 0", () => {
    const sessions = generateMockSessions(0, 42);
    expect(sessions).toHaveLength(0);
  });

  test("all sessions have an id", () => {
    const sessions = generateMockSessions(10, 42);
    for (const s of sessions) {
      expect(s.id).toBeTruthy();
      expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  test("sessions have turns with role and content", () => {
    const sessions = generateMockSessions(10, 42);
    for (const s of sessions) {
      expect(s.turns.length).toBeGreaterThan(0);
      for (const t of s.turns) {
        expect(["user", "assistant"]).toContain(t.role);
        expect(t.content).toBeTruthy();
      }
    }
  });

  test("session turns alternate between user and assistant", () => {
    const sessions = generateMockSessions(5, 42);
    for (const s of sessions) {
      expect(s.turns[0].role).toBe("user");
      expect(s.turns[1].role).toBe("assistant");
    }
  });

  test("is deterministic with same seed", () => {
    const a = generateMockSessions(5, 42);
    const b = generateMockSessions(5, 42);
    expect(a.map(s => s.id)).toEqual(b.map(s => s.id));
  });

  test("different seeds produce different sessions", () => {
    const a = generateMockSessions(5, 42);
    const b = generateMockSessions(5, 99);
    expect(a[0].id).not.toBe(b[0].id);
  });

  test("large batch generation works", () => {
    const sessions = generateMockSessions(100, 42);
    expect(sessions).toHaveLength(100);
  });

  test("session IDs are unique", () => {
    const sessions = generateMockSessions(50, 42);
    const ids = sessions.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// generateTestQueries
// ---------------------------------------------------------------------------

describe("generateTestQueries", () => {
  const entities = generateMockEntities(20, 42);
  const sessions = generateMockSessions(10, 42);

  test("generates the requested number of queries", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    expect(queries).toHaveLength(50);
  });

  test("generates fewer queries if count exceeds possible", () => {
    const queries = generateTestQueries(entities, sessions, 200);
    expect(queries.length).toBeLessThanOrEqual(200);
    expect(queries.length).toBeGreaterThan(0);
  });

  test("all queries have required fields", () => {
    const queries = generateTestQueries(entities, sessions, 30);
    for (const q of queries) {
      expect(q.query).toBeTruthy();
      expect(["L0", "L1", "L2", "L3", "L4"]).toContain(q.expectedLayer);
      expect(q.groundTruth).toBeTruthy();
    }
  });

  test("includes L0 identity queries", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l0 = queries.filter(q => q.expectedLayer === "L0");
    expect(l0.length).toBeGreaterThan(0);
  });

  test("includes L1 story queries", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l1 = queries.filter(q => q.expectedLayer === "L1");
    expect(l1.length).toBeGreaterThan(0);
  });

  test("includes L2 wiki queries", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l2 = queries.filter(q => q.expectedLayer === "L2");
    expect(l2.length).toBeGreaterThan(0);
  });

  test("includes L3 search queries", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l3 = queries.filter(q => q.expectedLayer === "L3");
    expect(l3.length).toBeGreaterThan(0);
  });

  test("includes L4 session queries with UUIDs", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l4 = queries.filter(q => q.expectedLayer === "L4");
    expect(l4.length).toBeGreaterThan(0);
    for (const q of l4) {
      expect(q.query).toContain("session");
    }
  });

  test("L2 queries reference entity titles", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l2 = queries.filter(q => q.expectedLayer === "L2");
    expect(l2.length).toBeGreaterThan(0);
  });

  test("L3 queries are conversational", () => {
    const queries = generateTestQueries(entities, sessions, 50);
    const l3 = queries.filter(q => q.expectedLayer === "L3");
    const conversationalPatterns = [/discuss/, /talk/, /remember/, /previous/, /last time/, /history/, /what did/, /when did/, /conversation/];
    for (const q of l3) {
      const matches = conversationalPatterns.some(p => p.test(q.query));
      expect(matches).toBe(true);
    }
  });
});
