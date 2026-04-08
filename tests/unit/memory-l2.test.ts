/**
 * Unit tests for src/memory/layers/l2-wiki.ts — L2 Wiki layer
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import { queryWiki } from "../../src/memory/layers/l2-wiki.js";
import type { KnowledgeEntity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-l2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeEntity(dir: string, slug: string, entity: Partial<KnowledgeEntity>): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const frontmatter = {
    title: entity.title ?? slug,
    type: entity.type ?? "concept",
    updated: entity.updated ?? "2025-01-15",
    tags: entity.tags ?? [],
    related: entity.related ?? [],
  };
  const content = matter.stringify(entity.content ?? "", frontmatter);
  writeFileSync(join(dir, `${slug}.md`), content, "utf8");
}

// ---------------------------------------------------------------------------
// queryWiki
// ---------------------------------------------------------------------------

describe("queryWiki", () => {
  test("returns empty result for non-existent wiki directory", () => {
    const result = queryWiki("test", join(testDir, "nonexistent"));
    expect(result.entities).toEqual([]);
    expect(result.source).toBe("wiki");
    expect(result.tokensUsed).toBe(0);
  });

  test("returns empty result for empty wiki directory", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = queryWiki("test", wikiDir);
    expect(result.entities).toEqual([]);
  });

  test("finds entity by slug via domain routing", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "retry-patterns", {
      title: "Retry Patterns",
      type: "concept",
      content: "Exponential backoff and jitter strategies.",
    });

    const result = queryWiki("retry-patterns", wikiDir);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    expect(result.entities[0].slug).toBe("retry-patterns");
  });

  test("finds entity by title match", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "circuit-breaker", {
      title: "Circuit Breaker",
      type: "concept",
      content: "Prevents cascading failures.",
    });

    const result = queryWiki("circuit breaker", wikiDir);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    const found = result.entities.find(e => e.slug === "circuit-breaker");
    expect(found).toBeTruthy();
  });

  test("uses FTS5 search for content matching", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "observability", {
      title: "Observability",
      type: "concept",
      content: "Metrics, logs, and traces for distributed systems monitoring.",
    });

    const result = queryWiki("distributed systems monitoring", wikiDir);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  test("uses domain hint for direct loading", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "my-project", {
      title: "My Project",
      type: "repo",
      content: "A sample project.",
    });

    const result = queryWiki("anything", wikiDir, { domain: "my-project" });
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    expect(result.entities[0].slug).toBe("my-project");
  });

  test("respects maxResults option", () => {
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 5; i++) {
      writeEntity(wikiDir, `entity-${i}`, {
        title: `Entity ${i}`,
        content: `Content about testing entity ${i}`,
      });
    }

    const result = queryWiki("entity", wikiDir, { maxResults: 2 });
    expect(result.entities.length).toBeLessThanOrEqual(2);
  });

  test("deduplicates domain matches and FTS results", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "retry-patterns", {
      title: "Retry Patterns",
      content: "Retry logic with backoff.",
    });

    const result = queryWiki("retry-patterns retry logic", wikiDir);
    const slugs = result.entities.map(e => e.slug);
    const uniqueSlugs = [...new Set(slugs)];
    expect(slugs.length).toBe(uniqueSlugs.length);
  });

  test("calculates token usage", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "tokens", {
      title: "Token Test",
      content: "Some content to measure tokens.",
    });

    const result = queryWiki("token test", wikiDir);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  test("source is always 'wiki'", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const result = queryWiki("test", wikiDir);
    expect(result.source).toBe("wiki");
  });

  test("handles entities with empty content", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "empty-content", {
      title: "Empty Content",
      content: "",
    });

    const result = queryWiki("empty content", wikiDir);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  test("handles multiple entity types", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "api-service", { title: "API Service", type: "system" });
    writeEntity(wikiDir, "react-tool", { title: "React", type: "tool" });
    writeEntity(wikiDir, "alice-dev", { title: "Alice", type: "person" });

    const result = queryWiki("api service react alice", wikiDir);
    const types = result.entities.map(e => e.type);
    expect(types.length).toBeGreaterThan(0);
  });

  test("returns excerpts truncated to 300 chars for domain matches", () => {
    const wikiDir = join(testDir, "knowledge");
    const longContent = "A".repeat(500);
    writeEntity(wikiDir, "long-entity", {
      title: "Long Entity",
      content: longContent,
    });

    const result = queryWiki("long-entity", wikiDir);
    if (result.entities.length > 0) {
      expect(result.entities[0].excerpt.length).toBeLessThanOrEqual(300);
    }
  });

  test("handles empty query string", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "something", { title: "Something" });

    const result = queryWiki("", wikiDir);
    // Empty query may return nothing or only domain matches
    expect(result.source).toBe("wiki");
  });

  test("handles query with special FTS5 characters", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "special", {
      title: "Special Chars",
      content: "Content with special chars.",
    });

    // Should not throw even with special characters
    const result = queryWiki('test AND (foo OR "bar")', wikiDir);
    expect(result.source).toBe("wiki");
  });

  test("handles domain hint that does not match any entity", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "exists", { title: "Exists" });

    const result = queryWiki("test", wikiDir, { domain: "nonexistent" });
    // Should still work, just no domain match
    expect(result.source).toBe("wiki");
  });

  test("returns correct entity type in results", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "my-tool", {
      title: "My Tool",
      type: "tool",
      content: "A helpful tool.",
    });

    const result = queryWiki("my-tool", wikiDir);
    const tool = result.entities.find(e => e.slug === "my-tool");
    expect(tool?.type).toBe("tool");
  });

  test("returns correct title in results", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "titled-entity", {
      title: "My Titled Entity",
      content: "Content.",
    });

    const result = queryWiki("titled-entity", wikiDir);
    const entity = result.entities.find(e => e.slug === "titled-entity");
    expect(entity?.title).toBe("My Titled Entity");
  });
});
