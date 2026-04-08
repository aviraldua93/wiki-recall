/**
 * Unit tests for src/knowledge/papers/ingestor.ts — paper to entity conversion
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import { ingestPaper, ingestBatch } from "../../src/knowledge/papers/ingestor.js";
import { getEntity, listEntities, createEntity } from "../../src/knowledge/entities.js";
import { createMockPaper, createMockPapers } from "../../src/knowledge/papers/mock.js";
import { createMockProvider } from "../../src/providers/mock.js";
import type { ResearchPaper } from "../../src/knowledge/papers/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;
let knowledgeDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-ingestor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  knowledgeDir = join(testDir, "knowledge");
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
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
// ingestPaper
// ---------------------------------------------------------------------------

describe("ingestPaper", () => {
  test("creates a knowledge entity from a paper", async () => {
    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.title).toBe("Attention Is All You Need");
    expect(entity.type).toBe("concept");
    expect(entity.tags).toContain("paper");
  });

  test("entity contains paper abstract in content", async () => {
    const paper = createMockPaper({
      abstract: "We propose a novel approach to sequence modeling.",
    });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("We propose a novel approach");
  });

  test("entity has correct YAML frontmatter", async () => {
    const paper = createMockPaper({ topics: ["cs.CL", "cs.LG"] });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.type).toBe("concept");
    expect(entity.tags).toContain("cs.CL");
    expect(entity.tags).toContain("cs.LG");
    expect(entity.tags).toContain("paper");
    expect(entity.sources).toContain(paper.url);
    expect(entity.status).toBe("draft");
  });

  test("entity content includes author list", async () => {
    const paper = createMockPaper({
      authors: ["Alice Smith", "Bob Jones"],
    });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("Alice Smith");
    expect(entity.content).toContain("Bob Jones");
  });

  test("entity content includes tldr when available", async () => {
    const paper = createMockPaper({
      tldr: "This paper introduces a new architecture.",
    });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("TL;DR");
    expect(entity.content).toContain("This paper introduces a new architecture.");
  });

  test("entity content includes ArXiv ID when available", async () => {
    const paper = createMockPaper({ arxivId: "2301.07041" });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("2301.07041");
  });

  test("entity content includes citation count", async () => {
    const paper = createMockPaper({ citations: 90000 });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("90000");
  });

  test("creates knowledge directory if it doesn't exist", async () => {
    const newDir = join(testDir, "new-knowledge");
    expect(existsSync(newDir)).toBe(false);
    await ingestPaper(createMockPaper(), newDir);
    expect(existsSync(newDir)).toBe(true);
  });

  test("appends to ingestion log", async () => {
    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir);

    const logPath = join(knowledgeDir, "ingestion-log.md");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("attention-is-all-you-need");
  });

  test("throws when paper already ingested", async () => {
    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir);
    await expect(ingestPaper(paper, knowledgeDir)).rejects.toThrow("already exists");
  });

  test("uses extraction provider when available", async () => {
    const provider = createMockProvider({
      entities: [
        { title: "Transformer", type: "concept", updated: "2024-01-01", tags: [], content: "" },
        { title: "Self-Attention", type: "concept", updated: "2024-01-01", tags: [], content: "" },
      ],
    });

    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir, provider);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toContain("Key Concepts");
    expect(entity.content).toContain("Transformer");
    expect(entity.content).toContain("Self-Attention");
  });

  test("falls back to heuristics when provider fails", async () => {
    const provider = createMockProvider({
      shouldError: true,
      errorMessage: "LLM unavailable",
    });

    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir, provider);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.content).toBeTruthy();
  });

  test("paper source tag is included", async () => {
    const paper = createMockPaper({ source: "semantic-scholar" });
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.tags).toContain("semantic-scholar");
  });

  test("entity has source_count of 1", async () => {
    const paper = createMockPaper();
    await ingestPaper(paper, knowledgeDir);

    const slug = "attention-is-all-you-need";
    const entity = getEntity(slug);
    expect(entity.source_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ingestPaper — backlinks
// ---------------------------------------------------------------------------

describe("ingestPaper backlinks", () => {
  test("adds backlinks to related existing entities", async () => {
    // Create an existing entity with matching tags
    createEntity({
      title: "Machine Learning Basics",
      type: "concept",
      updated: "2024-01-01",
      tags: ["cs.LG"],
      related: [],
      content: "ML fundamentals.",
    });

    const paper = createMockPaper({ topics: ["cs.LG", "cs.CL"] });
    await ingestPaper(paper, knowledgeDir);

    const existing = getEntity("machine-learning-basics");
    expect(existing.related).toContain("attention-is-all-you-need");
  });

  test("does not add duplicate backlinks", async () => {
    createEntity({
      title: "NLP Concepts",
      type: "concept",
      updated: "2024-01-01",
      tags: ["cs.CL"],
      related: ["attention-is-all-you-need"],
      content: "NLP entity.",
    });

    const paper = createMockPaper({ topics: ["cs.CL"] });
    await ingestPaper(paper, knowledgeDir);

    const existing = getEntity("nlp-concepts");
    const backlinkCount = existing.related!.filter(r => r === "attention-is-all-you-need").length;
    expect(backlinkCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ingestBatch
// ---------------------------------------------------------------------------

describe("ingestBatch", () => {
  test("ingests multiple papers", async () => {
    const papers = [
      createMockPaper({ id: "p1", title: "Paper One" }),
      createMockPaper({ id: "p2", title: "Paper Two" }),
      createMockPaper({ id: "p3", title: "Paper Three" }),
    ];

    const result = await ingestBatch(papers, knowledgeDir);
    expect(result.ingested).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("skips already ingested papers", async () => {
    const paper = createMockPaper({ id: "p1", title: "First Paper" });
    await ingestPaper(paper, knowledgeDir);

    const papers = [
      createMockPaper({ id: "p1", title: "First Paper" }),
      createMockPaper({ id: "p2", title: "Second Paper" }),
    ];

    const result = await ingestBatch(papers, knowledgeDir);
    expect(result.ingested).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("Already ingested");
  });

  test("returns correct result structure", async () => {
    const result = await ingestBatch([], knowledgeDir);
    expect(result.ingested).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("ingested result includes slugs", async () => {
    const papers = [createMockPaper({ id: "p1", title: "Test Paper Title" })];
    const result = await ingestBatch(papers, knowledgeDir);
    expect(result.ingested[0].slug).toBe("test-paper-title");
    expect(result.ingested[0].paperId).toBe("p1");
  });

  test("handles mixed success and failure", async () => {
    // First paper will succeed
    const papers = [
      createMockPaper({ id: "p1", title: "Good Paper" }),
      createMockPaper({ id: "p2", title: "Good Paper" }), // duplicate title — will fail
    ];

    const result = await ingestBatch(papers, knowledgeDir);
    expect(result.ingested).toHaveLength(1);
    expect(result.skipped.length + result.errors.length).toBe(1);
  });

  test("appends all ingested papers to log", async () => {
    const papers = [
      createMockPaper({ id: "p1", title: "Log Paper One" }),
      createMockPaper({ id: "p2", title: "Log Paper Two" }),
    ];

    await ingestBatch(papers, knowledgeDir);

    const logPath = join(knowledgeDir, "ingestion-log.md");
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("log-paper-one");
    expect(log).toContain("log-paper-two");
  });
});
