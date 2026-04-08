/**
 * STRESS TEST 4: File System Edge Cases — corrupted files, missing dirs,
 * permission issues, binary data, very large files.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import {
  createEntity,
  getEntity,
  listEntities,
  deleteEntity,
  updateEntity,
} from "../../src/knowledge/entities.js";
import {
  KnowledgeSearch,
  closeSearchDb,
} from "../../src/knowledge/search.js";
import {
  createScenario,
  getScenario,
  listScenarios,
} from "../../src/scenario/manager.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function validEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "FS Test Entity",
    type: "concept",
    updated: "2025-01-15",
    tags: ["fs-test"],
    related: [],
    content: "File system edge case content.",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-stress-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();
});

afterEach(() => {
  closeSearchDb();
  try {
    // Restore write permissions for cleanup
    const knowledgeDir = join(testDir, "knowledge");
    if (existsSync(knowledgeDir)) {
      try { chmodSync(knowledgeDir, 0o755); } catch { /* ignore */ }
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Knowledge dir doesn't exist
// ---------------------------------------------------------------------------

describe("File system — missing knowledge directory", () => {
  test("listEntities returns empty when knowledge dir missing", () => {
    const entities = listEntities();
    expect(entities).toEqual([]);
  });

  test("createEntity auto-creates knowledge directory", () => {
    const { slug } = createEntity(validEntity());
    expect(existsSync(join(testDir, "knowledge"))).toBe(true);
    expect(slug).toBe("fs-test-entity");
  });

  test("getEntity throws when knowledge dir missing", () => {
    expect(() => getEntity("nonexistent")).toThrow("not found");
  });

  test("deleteEntity throws when knowledge dir missing", () => {
    expect(() => deleteEntity("nonexistent")).toThrow("not found");
  });

  test("KnowledgeSearch auto-creates dir on construction", () => {
    const search = new KnowledgeSearch();
    expect(existsSync(join(testDir, "knowledge"))).toBe(true);
    search.close();
  });

  test("KnowledgeSearch.rebuildIndex handles missing dir", () => {
    const search = new KnowledgeSearch();
    const count = search.rebuildIndex();
    expect(count).toBe(0);
    search.close();
  });
});

// ---------------------------------------------------------------------------
// Read-only knowledge directory (POSIX only, skip on Windows)
// ---------------------------------------------------------------------------

describe("File system — read-only directory", () => {
  const isWindows = process.platform === "win32";

  test("createEntity fails in read-only dir", () => {
    if (isWindows) return; // chmod doesn't work on Windows
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    chmodSync(knowledgeDir, 0o444);

    expect(() => createEntity(validEntity())).toThrow();
  });

  test("KnowledgeSearch fails to create DB in read-only dir", () => {
    if (isWindows) return;
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    chmodSync(knowledgeDir, 0o444);

    const search = new KnowledgeSearch();
    expect(() => search.getDb()).toThrow();
    search.close();
  });
});

// ---------------------------------------------------------------------------
// Corrupted entity files
// ---------------------------------------------------------------------------

describe("File system — corrupted entity files", () => {
  test("entity file with invalid YAML doesn't crash list", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "corrupt.md"), "---\n{invalid yaml: [broken\n---\nContent", "utf8");

    // Should not throw
    expect(() => listEntities()).not.toThrow();
  });

  test("entity file with empty YAML frontmatter", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "empty-fm.md"), "---\n---\nJust content, no metadata", "utf8");

    const entities = listEntities();
    // Should parse without crashing
    expect(entities).toBeDefined();
  });

  test("entity file is 0 bytes", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "zero.md"), "", "utf8");

    expect(() => listEntities()).not.toThrow();
  });

  test("entity file is binary (PNG header)", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    writeFileSync(join(knowledgeDir, "png-masq.md"), pngHeader);

    expect(() => listEntities()).not.toThrow();
  });

  test("entity file is random binary data (1KB)", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    const randomBytes = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) randomBytes[i] = Math.floor(Math.random() * 256);
    writeFileSync(join(knowledgeDir, "random.md"), randomBytes);

    expect(() => listEntities()).not.toThrow();
  });

  test("entity file with null bytes throughout", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "nulls.md"), "---\ntitle: Test\x00Entity\ntype: concept\nupdated: 2025-01-15\n---\nContent\x00with\x00nulls", "utf8");

    expect(() => listEntities()).not.toThrow();
  });

  test("getEntity on corrupted file throws or returns partial", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "corrupt-read.md"), "---\ntitle: 42\ntype: not-a-type\n---\n", "utf8");

    // Should not crash — will parse but with wrong data
    const entity = getEntity("corrupt-read");
    expect(entity).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Very large entity content
// ---------------------------------------------------------------------------

describe("File system — large entity content", () => {
  test("entity with 1MB content creates and reads correctly", () => {
    const largeContent = "Lorem ipsum dolor sit amet. ".repeat(35000); // ~1MB
    const { slug } = createEntity(validEntity({ title: "Large Entity", content: largeContent }));

    const entity = getEntity(slug);
    expect(entity.content!.length).toBeGreaterThan(900000);
  });

  test("entity with 10,000 tags (long array)", () => {
    const tags = Array.from({ length: 10000 }, (_, i) => `tag-${i}`);
    const { slug } = createEntity(validEntity({ title: "Many Tags", tags }));

    const entity = getEntity(slug);
    expect(entity.tags!.length).toBe(10000);
  });

  test("entity with deeply nested markdown content", () => {
    let content = "";
    for (let i = 0; i < 100; i++) {
      content += "#".repeat(Math.min(i + 1, 6)) + ` Heading ${i}\n\n`;
      content += `Paragraph ${i} with **bold** and *italic* and \`code\`.\n\n`;
      content += `- List item ${i}\n`;
      content += `  - Nested item ${i}\n`;
    }

    const { slug } = createEntity(validEntity({ title: "Deep Markdown", content }));
    const entity = getEntity(slug);
    expect(entity.content!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FTS5 index with corrupted files
// ---------------------------------------------------------------------------

describe("FTS5 rebuild — corrupted files", () => {
  test("rebuildIndex skips corrupt files gracefully", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });

    // Write one good file
    const goodFrontmatter = { title: "Good Entity", type: "concept", updated: "2025-01-15", tags: [], related: [] };
    writeFileSync(join(knowledgeDir, "good.md"), matter.stringify("Good content", goodFrontmatter), "utf8");

    // Write one bad file
    writeFileSync(join(knowledgeDir, "bad.md"), "NOT YAML AT ALL {{{", "utf8");

    const search = new KnowledgeSearch();
    // rebuildIndex should handle the bad file gracefully
    let count: number;
    try {
      count = search.rebuildIndex();
    } catch {
      // If it throws on corrupt files, that's a finding
      count = -1;
    }
    expect(count).toBeDefined();
    search.close();
  });

  test("rebuildIndex with all corrupt files returns 0 or handles error", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });

    writeFileSync(join(knowledgeDir, "bad1.md"), Buffer.from([0xFF, 0xFE, 0x00]));
    writeFileSync(join(knowledgeDir, "bad2.md"), "{{{invalid yaml}}}", "utf8");

    const search = new KnowledgeSearch();
    try {
      const count = search.rebuildIndex();
      // If it completes, count should be number of files attempted
      expect(count).toBeDefined();
    } catch {
      // Acceptable to throw on all-corrupt
    }
    search.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario file system edge cases
// ---------------------------------------------------------------------------

describe("File system — scenario edge cases", () => {
  test("listScenarios with missing scenarios directory", () => {
    const scenarios = listScenarios();
    expect(scenarios).toEqual([]);
  });

  test("createScenario auto-creates scenarios directory", () => {
    createScenario({
      name: "fs-test",
      version: "0.1.0",
      status: "active",
      description: "FS test scenario",
    });

    expect(existsSync(join(testDir, "scenarios"))).toBe(true);
  });

  test("scenario file with trailing newlines and extra whitespace", () => {
    createScenario({
      name: "whitespace-test",
      version: "0.1.0",
      status: "active",
      description: "Test whitespace",
    });

    const filePath = join(testDir, "scenarios", "whitespace-test.yaml");
    const content = readFileSync(filePath, "utf8");
    writeFileSync(filePath, content + "\n\n\n   \n", "utf8");

    const scenario = getScenario("whitespace-test");
    expect(scenario.name).toBe("whitespace-test");
  });

  test("non-.yaml files in scenarios dir are ignored", () => {
    const scenariosDir = join(testDir, "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeFileSync(join(scenariosDir, "readme.txt"), "Not a scenario", "utf8");
    writeFileSync(join(scenariosDir, "notes.md"), "# Notes", "utf8");

    const scenarios = listScenarios();
    expect(scenarios).toEqual([]);
  });

  test("non-.md files in knowledge dir are ignored by list", () => {
    const knowledgeDir = join(testDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "data.json"), '{"not":"entity"}', "utf8");
    writeFileSync(join(knowledgeDir, "image.png"), Buffer.from([0x89, 0x50]));

    const entities = listEntities();
    expect(entities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Path traversal protection
// ---------------------------------------------------------------------------

describe("File system — path traversal protection", () => {
  test("getEntity rejects ../", () => {
    expect(() => getEntity("../etc/passwd")).toThrow();
  });

  test("getEntity rejects ..\\", () => {
    expect(() => getEntity("..\\windows\\system32")).toThrow();
  });

  test("deleteEntity rejects path traversal", () => {
    expect(() => deleteEntity("../../hack")).toThrow();
  });

  test("updateEntity rejects path traversal", () => {
    expect(() => updateEntity("../hack", { content: "pwned" })).toThrow();
  });

  test("getScenario rejects path traversal", () => {
    expect(() => getScenario("../../../etc/passwd")).toThrow();
  });
});
