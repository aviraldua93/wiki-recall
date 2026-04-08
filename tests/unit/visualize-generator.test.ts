/**
 * Unit tests for src/knowledge/visualize/generator.ts — end-to-end generation
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import type { KnowledgeEntity } from "../../src/types.js";
import type { VisualizationConfig } from "../../src/knowledge/visualize/types.js";
import { generateVisualization, loadEntitiesFromDir } from "../../src/knowledge/visualize/generator.js";

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let testDir: string;
let knowledgeDir: string;
let outputPath: string;

function mockEntity(overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    title: "Test Concept",
    type: "concept",
    updated: "2025-01-15",
    tags: ["testing"],
    related: [],
    content: "A test entity.",
    ...overrides,
  };
}

function writeEntityFile(dir: string, slug: string, entity: KnowledgeEntity): void {
  const frontmatter = {
    title: entity.title,
    type: entity.type,
    updated: entity.updated,
    tags: entity.tags ?? [],
    related: entity.related ?? [],
    ...(entity.created && { created: entity.created }),
  };
  const content = matter.stringify(entity.content ?? "", frontmatter);
  writeFileSync(join(dir, `${slug}.md`), content, "utf8");
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-viz-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  knowledgeDir = join(testDir, "knowledge");
  outputPath = join(testDir, "output", "graph.html");
  mkdirSync(knowledgeDir, { recursive: true });
});

afterEach(() => {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors on Windows
  }
});

// ---------------------------------------------------------------------------
// loadEntitiesFromDir
// ---------------------------------------------------------------------------

describe("loadEntitiesFromDir", () => {
  test("loads entities from markdown files", () => {
    writeEntityFile(knowledgeDir, "retry-patterns", mockEntity({ title: "Retry Patterns" }));
    writeEntityFile(knowledgeDir, "circuit-breakers", mockEntity({ title: "Circuit Breakers" }));

    const entities = loadEntitiesFromDir(knowledgeDir);
    expect(entities.length).toBe(2);
  });

  test("returns empty for non-existent directory", () => {
    const entities = loadEntitiesFromDir(join(testDir, "nope"));
    expect(entities).toEqual([]);
  });

  test("returns empty for directory with no .md files", () => {
    writeFileSync(join(knowledgeDir, "readme.txt"), "not markdown");
    const entities = loadEntitiesFromDir(knowledgeDir);
    expect(entities).toEqual([]);
  });

  test("parses frontmatter correctly", () => {
    writeEntityFile(knowledgeDir, "test", mockEntity({
      title: "My Test",
      type: "tool",
      tags: ["dev", "test"],
      updated: "2025-06-01",
    }));
    const entities = loadEntitiesFromDir(knowledgeDir);
    expect(entities[0].title).toBe("My Test");
    expect(entities[0].type).toBe("tool");
    expect(entities[0].tags).toEqual(["dev", "test"]);
  });

  test("parses content body", () => {
    writeEntityFile(knowledgeDir, "content-test", mockEntity({
      title: "Content Test",
      content: "## Details\n\nSome content here.",
    }));
    const entities = loadEntitiesFromDir(knowledgeDir);
    expect(entities[0].content).toContain("Details");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — knowledge-graph
// ---------------------------------------------------------------------------

describe("generateVisualization — knowledge-graph", () => {
  test("generates HTML file on disk", async () => {
    writeEntityFile(knowledgeDir, "test-entity", mockEntity());
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Test Graph",
      outputPath,
      interactive: true,
    };
    await generateVisualization(config, knowledgeDir);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("returns HTML string", async () => {
    writeEntityFile(knowledgeDir, "test-entity", mockEntity());
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Test Graph",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toStartWith("<!DOCTYPE html>");
  });

  test("written file matches returned HTML", async () => {
    writeEntityFile(knowledgeDir, "test-entity", mockEntity());
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Test Graph",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    const fileContent = readFileSync(outputPath, "utf8");
    expect(fileContent).toBe(html);
  });

  test("creates output directory if it does not exist", async () => {
    const deepOutput = join(testDir, "deep", "nested", "output.html");
    writeEntityFile(knowledgeDir, "test-entity", mockEntity());
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Test",
      outputPath: deepOutput,
      interactive: true,
    };
    await generateVisualization(config, knowledgeDir);
    expect(existsSync(deepOutput)).toBe(true);
  });

  test("throws on empty knowledge directory", async () => {
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Empty",
      outputPath,
      interactive: true,
    };
    expect(generateVisualization(config, knowledgeDir)).rejects.toThrow("No knowledge entities");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — topic-clusters
// ---------------------------------------------------------------------------

describe("generateVisualization — topic-clusters", () => {
  test("generates cluster HTML", async () => {
    writeEntityFile(knowledgeDir, "a", mockEntity({ title: "A", tags: ["alpha"] }));
    writeEntityFile(knowledgeDir, "b", mockEntity({ title: "B", tags: ["beta"] }));
    const config: VisualizationConfig = {
      type: "topic-clusters",
      title: "Clusters",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — timeline
// ---------------------------------------------------------------------------

describe("generateVisualization — timeline", () => {
  test("generates timeline HTML", async () => {
    writeEntityFile(knowledgeDir, "a", mockEntity({ title: "A", updated: "2025-01-01" }));
    writeEntityFile(knowledgeDir, "b", mockEntity({ title: "B", updated: "2025-02-01" }));
    const config: VisualizationConfig = {
      type: "timeline",
      title: "Timeline",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toContain("2025-01-01");
    expect(html).toContain("2025-02-01");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — research-landscape
// ---------------------------------------------------------------------------

describe("generateVisualization — research-landscape", () => {
  test("generates research landscape HTML with tabs", async () => {
    writeEntityFile(knowledgeDir, "a", mockEntity({ title: "A", tags: ["x"] }));
    writeEntityFile(knowledgeDir, "b", mockEntity({ title: "B", tags: ["y"], related: ["a"] }));
    const config: VisualizationConfig = {
      type: "research-landscape",
      title: "Landscape",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toContain("Knowledge Graph");
    expect(html).toContain("Topic Clusters");
    expect(html).toContain("vis-network");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — entity-connections
// ---------------------------------------------------------------------------

describe("generateVisualization — entity-connections", () => {
  test("generates same output as knowledge-graph", async () => {
    writeEntityFile(knowledgeDir, "a", mockEntity({ title: "A" }));
    const config: VisualizationConfig = {
      type: "entity-connections",
      title: "Connections",
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toContain("vis-network");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — with pre-loaded entities
// ---------------------------------------------------------------------------

describe("generateVisualization — pre-loaded entities", () => {
  test("uses provided entities instead of loading from disk", async () => {
    const entities = [
      mockEntity({ title: "Injected Entity", type: "tool" }),
    ];
    const config: VisualizationConfig = {
      type: "knowledge-graph",
      title: "Injected",
      entities,
      outputPath,
      interactive: true,
    };
    const html = await generateVisualization(config, knowledgeDir);
    expect(html).toContain("Injected Entity");
  });
});

// ---------------------------------------------------------------------------
// generateVisualization — unknown type
// ---------------------------------------------------------------------------

describe("generateVisualization — error handling", () => {
  test("throws on unknown visualization type", async () => {
    writeEntityFile(knowledgeDir, "a", mockEntity());
    const config = {
      type: "nonexistent" as any,
      title: "Bad",
      outputPath,
      interactive: true,
    };
    expect(generateVisualization(config, knowledgeDir)).rejects.toThrow("Unknown visualization type");
  });
});
