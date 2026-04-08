/**
 * STRESS TEST 2: FTS5 Injection — chaos engineering for search query handling.
 *
 * Tests: FTS5 syntax injection, SQL injection, special characters, empty queries,
 * very long queries, reserved words.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import {
  KnowledgeSearch,
  closeSearchDb,
  searchEntities,
  indexEntity,
  searchByType,
} from "../../src/knowledge/search.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;
let search: KnowledgeSearch;

function mockEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Test Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["testing"],
    related: [],
    content: "Searchable content for stress testing FTS5 queries.",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-stress-fts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();

  search = new KnowledgeSearch();
  // Seed with test data so queries have something to match against
  search.indexEntity("entity-alpha", mockEntity({ title: "Alpha Framework", content: "Alpha is a distributed systems framework for building resilient microservices." }));
  search.indexEntity("entity-beta", mockEntity({ title: "Beta Library", content: "Beta provides caching and memoization for performance optimization." }));
  search.indexEntity("entity-gamma", mockEntity({ title: "Gamma Platform", content: "Gamma is a deployment platform using Docker and Kubernetes." }));
});

afterEach(() => {
  search.close();
  closeSearchDb();
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// FTS5 operators injection
// ---------------------------------------------------------------------------

describe("FTS5 operator injection", () => {
  test("query with double quotes: '\"exact match\"'", () => {
    const results = search.search('"Alpha Framework"');
    // Should not crash — quotes are stripped by sanitizer
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  test("query with wildcard: 'Alpha*'", () => {
    const results = search.search("Alpha*");
    expect(results).toBeDefined();
  });

  test("query with AND operator: 'Alpha AND Beta'", () => {
    const results = search.search("Alpha AND Beta");
    // AND is a reserved word — should be stripped
    expect(results).toBeDefined();
  });

  test("query with OR operator: 'Alpha OR Beta'", () => {
    const results = search.search("Alpha OR Beta");
    expect(results).toBeDefined();
  });

  test("query with NOT operator: 'NOT Alpha'", () => {
    const results = search.search("NOT Alpha");
    // NOT is stripped, should search for Alpha
    expect(results).toBeDefined();
  });

  test("query with NEAR operator: 'NEAR(Alpha Beta)'", () => {
    const results = search.search("NEAR(Alpha Beta)");
    expect(results).toBeDefined();
  });

  test("query with NEAR/N: 'NEAR(Alpha Beta, 5)'", () => {
    const results = search.search("NEAR(Alpha Beta, 5)");
    expect(results).toBeDefined();
  });

  test("query with column filter: 'title:Alpha'", () => {
    const results = search.search("title:Alpha");
    expect(results).toBeDefined();
  });

  test("query with caret prefix: '^Alpha'", () => {
    const results = search.search("^Alpha");
    expect(results).toBeDefined();
  });

  test("query with curly braces: '{Alpha Beta}'", () => {
    const results = search.search("{Alpha Beta}");
    expect(results).toBeDefined();
  });

  test("query with parentheses: '(Alpha OR Beta) AND Gamma'", () => {
    const results = search.search("(Alpha OR Beta) AND Gamma");
    expect(results).toBeDefined();
  });

  test("query combining all operators", () => {
    const results = search.search('NOT "Alpha*" AND (Beta OR NEAR(Gamma, 3)) ^title:test {group}');
    expect(results).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Only special characters
// ---------------------------------------------------------------------------

describe("FTS5 queries — only special characters", () => {
  test("query: ***", () => {
    const results = search.search("***");
    expect(results).toEqual([]);
  });

  test('query: ""', () => {
    const results = search.search('""');
    expect(results).toEqual([]);
  });

  test("query: )()()", () => {
    const results = search.search(")()()" );
    expect(results).toEqual([]);
  });

  test("query: !!!###$$$", () => {
    const results = search.search("!!!###$$$");
    expect(results).toEqual([]);
  });

  test("query: single asterisk *", () => {
    const results = search.search("*");
    expect(results).toEqual([]);
  });

  test("query: >>><<<", () => {
    const results = search.search(">>><<<");
    expect(results).toEqual([]);
  });

  test("query: ^^^^^", () => {
    const results = search.search("^^^^^");
    expect(results).toEqual([]);
  });

  test("query: :::::", () => {
    const results = search.search(":::::");
    expect(results).toEqual([]);
  });

  test("query: {}{}{}", () => {
    const results = search.search("{}{}{}");
    expect(results).toEqual([]);
  });

  test("query: mixed special: *\"()^:{}", () => {
    const results = search.search('*"()^:{}');
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Very long queries
// ---------------------------------------------------------------------------

describe("FTS5 queries — very long queries", () => {
  test("query with 10,000 characters", () => {
    const longQuery = "Alpha ".repeat(1667); // ~10,002 chars
    const results = search.search(longQuery);
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  test("query with 100,000 characters", () => {
    const veryLongQuery = "test ".repeat(20000);
    const results = search.search(veryLongQuery);
    expect(results).toBeDefined();
  });

  test("query with 10,000 unique terms", () => {
    const terms = Array.from({ length: 10000 }, (_, i) => `term${i}`).join(" ");
    const results = search.search(terms);
    expect(results).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty and whitespace queries
// ---------------------------------------------------------------------------

describe("FTS5 queries — empty and whitespace", () => {
  test("empty string query", () => {
    expect(search.search("")).toEqual([]);
  });

  test("whitespace-only query", () => {
    expect(search.search("   ")).toEqual([]);
  });

  test("tab-only query", () => {
    expect(search.search("\t\t")).toEqual([]);
  });

  test("newline-only query", () => {
    expect(search.search("\n\n")).toEqual([]);
  });

  test("mixed whitespace query", () => {
    expect(search.search(" \t \n \r ")).toEqual([]);
  });

  test("null byte query", () => {
    const results = search.search("\x00");
    expect(results).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SQL injection attempts
// ---------------------------------------------------------------------------

describe("FTS5 queries — SQL injection", () => {
  test("classic SQL injection: '; DROP TABLE--", () => {
    const results = search.search("'; DROP TABLE knowledge_fts; --");
    expect(results).toBeDefined();
    // Verify table still exists
    const db = search.getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe("knowledge_fts");
  });

  test("UNION injection: ' UNION SELECT * FROM sqlite_master--", () => {
    const results = search.search("' UNION SELECT * FROM sqlite_master--");
    expect(results).toBeDefined();
  });

  test("comment injection: Alpha -- rest of query", () => {
    const results = search.search("Alpha -- rest of query");
    expect(results).toBeDefined();
  });

  test("semicolon injection: Alpha; DELETE FROM knowledge_fts", () => {
    const results = search.search("Alpha; DELETE FROM knowledge_fts");
    expect(results).toBeDefined();
    // Verify data still exists
    const count = search.getDb().prepare("SELECT COUNT(*) as n FROM knowledge_fts").get() as { n: number };
    expect(count.n).toBe(3);
  });

  test("hex injection: 0x414141", () => {
    const results = search.search("0x414141");
    expect(results).toBeDefined();
  });

  test("nested quotes: Alpha'''Beta", () => {
    const results = search.search("Alpha'''Beta");
    expect(results).toBeDefined();
  });

  test("backslash injection: Alpha\\'; DROP TABLE--", () => {
    const results = search.search("Alpha\\'; DROP TABLE knowledge_fts; --");
    expect(results).toBeDefined();
    // Table still exists
    const tables = search.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe("knowledge_fts");
  });
});

// ---------------------------------------------------------------------------
// Unicode and encoding edge cases
// ---------------------------------------------------------------------------

describe("FTS5 queries — unicode edge cases", () => {
  test("query with CJK characters: 日本語", () => {
    const results = search.search("日本語");
    expect(results).toBeDefined();
  });

  test("query with emoji: 🚀🔥", () => {
    const results = search.search("🚀🔥");
    expect(results).toBeDefined();
  });

  test("query with RTL characters: مرحبا", () => {
    const results = search.search("مرحبا");
    expect(results).toBeDefined();
  });

  test("query with zero-width space", () => {
    const results = search.search("Alpha\u200BBeta");
    expect(results).toBeDefined();
  });

  test("query with combining diacriticals: café", () => {
    const results = search.search("café");
    expect(results).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Search with empty index
// ---------------------------------------------------------------------------

describe("FTS5 search — empty index", () => {
  test("search on empty index returns empty array", () => {
    const emptyDbPath = join(testDir, "empty-search.db");
    const emptySearch = new KnowledgeSearch(emptyDbPath);
    const results = emptySearch.search("anything");
    expect(results).toEqual([]);
    emptySearch.close();
  });

  test("searchByType on empty index returns empty array", () => {
    const emptyDbPath = join(testDir, "empty-search2.db");
    const emptySearch = new KnowledgeSearch(emptyDbPath);
    const results = emptySearch.searchByType("concept");
    expect(results).toEqual([]);
    emptySearch.close();
  });
});

// ---------------------------------------------------------------------------
// Limit parameter edge cases
// ---------------------------------------------------------------------------

describe("FTS5 search — limit edge cases", () => {
  test("limit of 0", () => {
    const results = search.search("Alpha", 0);
    expect(results).toEqual([]);
  });

  test("limit of -1", () => {
    // Negative limit — SQLite may return all or none
    const results = search.search("Alpha", -1);
    expect(results).toBeDefined();
  });

  test("limit of 1000000", () => {
    const results = search.search("Alpha", 1000000);
    expect(results).toBeDefined();
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("limit of Infinity", () => {
    // May cause issues with SQLite binding
    try {
      const results = search.search("Alpha", Infinity);
      expect(results).toBeDefined();
    } catch (err) {
      // Acceptable to throw on Infinity
      expect(err).toBeDefined();
    }
  });

  test("limit of NaN", () => {
    try {
      const results = search.search("Alpha", NaN);
      expect(results).toBeDefined();
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Index entity with special content
// ---------------------------------------------------------------------------

describe("FTS5 indexing — special content", () => {
  test("index entity with FTS5 operators in content", () => {
    expect(() => {
      search.indexEntity("fts-ops", mockEntity({
        title: "AND OR NOT NEAR",
        content: 'This has "quoted" and *wildcard* and (grouped) content',
      }));
    }).not.toThrow();

    const results = search.search("quoted");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("index entity with SQL in content", () => {
    expect(() => {
      search.indexEntity("sql-content", mockEntity({
        content: "SELECT * FROM users WHERE 1=1; DROP TABLE users; --",
      }));
    }).not.toThrow();
  });

  test("index entity with empty content", () => {
    expect(() => {
      search.indexEntity("empty-content", mockEntity({ content: "" }));
    }).not.toThrow();
  });

  test("index entity with very long content (100KB)", () => {
    expect(() => {
      search.indexEntity("big-content", mockEntity({ content: "word ".repeat(20000) }));
    }).not.toThrow();
  });

  test("index entity with null bytes in content", () => {
    expect(() => {
      search.indexEntity("null-bytes", mockEntity({ content: "hello\x00world" }));
    }).not.toThrow();
  });

  test("index entity with unicode content", () => {
    expect(() => {
      search.indexEntity("unicode", mockEntity({
        title: "日本語ドキュメント",
        content: "これは日本語のテストコンテンツです。🚀",
      }));
    }).not.toThrow();
  });
});
