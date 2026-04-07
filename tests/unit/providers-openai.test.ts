/**
 * Unit tests for src/providers/openai.ts — OpenAI LLM provider
 *
 * Tests the parsing logic and provider construction. Actual API calls
 * are NOT made — we test parseExtractionResponse and constructor behavior.
 */

import { describe, test, expect } from "bun:test";
import { parseExtractionResponse, OpenAIProvider } from "../../src/providers/openai.js";

// ---------------------------------------------------------------------------
// parseExtractionResponse
// ---------------------------------------------------------------------------

describe("parseExtractionResponse", () => {
  test("parses a valid JSON array", () => {
    const json = JSON.stringify([
      {
        title: "React",
        type: "tool",
        updated: "2025-04-07",
        tags: ["frontend", "ui"],
        related: ["javascript"],
        content: "## What It Is\n\nA UI library.",
      },
    ]);

    const result = parseExtractionResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("React");
    expect(result[0].type).toBe("tool");
    expect(result[0].tags).toEqual(["frontend", "ui"]);
    expect(result[0].content).toContain("UI library");
  });

  test("handles markdown code fences", () => {
    const fenced = "```json\n" + JSON.stringify([{ title: "Fenced", type: "concept", updated: "2025-01-01" }]) + "\n```";
    const result = parseExtractionResponse(fenced);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fenced");
  });

  test("handles code fence without json language tag", () => {
    const fenced = "```\n" + JSON.stringify([{ title: "Plain", type: "tool" }]) + "\n```";
    const result = parseExtractionResponse(fenced);
    expect(result).toHaveLength(1);
  });

  test("defaults invalid type to concept", () => {
    const json = JSON.stringify([{ title: "Bad Type", type: "invalid-type", updated: "2025-01-01" }]);
    const result = parseExtractionResponse(json);
    expect(result[0].type).toBe("concept");
  });

  test("defaults missing date to today", () => {
    const json = JSON.stringify([{ title: "No Date", type: "tool" }]);
    const result = parseExtractionResponse(json);
    expect(result[0].updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("defaults invalid date to today", () => {
    const json = JSON.stringify([{ title: "Bad Date", type: "tool", updated: "not-a-date" }]);
    const result = parseExtractionResponse(json);
    expect(result[0].updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result[0].updated).not.toBe("not-a-date");
  });

  test("filters out entries without title", () => {
    const json = JSON.stringify([
      { title: "Valid", type: "tool" },
      { type: "tool" },  // no title
      42,  // not an object
      null,  // null
    ]);
    const result = parseExtractionResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
  });

  test("handles empty tags and related", () => {
    const json = JSON.stringify([{ title: "Bare", type: "concept" }]);
    const result = parseExtractionResponse(json);
    expect(result[0].tags).toEqual([]);
    expect(result[0].related).toEqual([]);
    expect(result[0].content).toBe("");
  });

  test("truncates long titles", () => {
    const longTitle = "A".repeat(300);
    const json = JSON.stringify([{ title: longTitle, type: "concept" }]);
    const result = parseExtractionResponse(json);
    expect(result[0].title).toHaveLength(256);
  });

  test("filters non-string tags", () => {
    const json = JSON.stringify([{
      title: "Mixed Tags",
      type: "tool",
      tags: ["valid", 42, null, "also-valid"],
    }]);
    const result = parseExtractionResponse(json);
    expect(result[0].tags).toEqual(["valid", "also-valid"]);
  });

  test("throws on invalid JSON", () => {
    expect(() => parseExtractionResponse("not json")).toThrow("Failed to parse");
  });

  test("throws on non-array JSON", () => {
    expect(() => parseExtractionResponse('{"title":"not an array"}')).toThrow("not a JSON array");
  });

  test("handles empty array", () => {
    const result = parseExtractionResponse("[]");
    expect(result).toEqual([]);
  });

  test("parses multiple entities", () => {
    const json = JSON.stringify([
      { title: "Entity A", type: "platform", updated: "2025-01-01", tags: ["a"], related: [], content: "A" },
      { title: "Entity B", type: "system", updated: "2025-02-01", tags: ["b"], related: ["entity-a"], content: "B" },
      { title: "Entity C", type: "repo", updated: "2025-03-01", tags: ["c"], related: [], content: "C" },
    ]);
    const result = parseExtractionResponse(json);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.type)).toEqual(["platform", "system", "repo"]);
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider constructor
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {
  test("throws without API key", () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => new OpenAIProvider()).toThrow("API key required");

    if (orig) process.env.OPENAI_API_KEY = orig;
  });

  test("accepts apiKey option", () => {
    const provider = new OpenAIProvider({ apiKey: "test-key-123" });
    expect(provider.name).toBe("openai");
  });

  test("has extractEntities method", () => {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    expect(typeof provider.extractEntities).toBe("function");
  });

  test("has extract method (backward compat)", () => {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    expect(typeof provider.extract).toBe("function");
  });
});
