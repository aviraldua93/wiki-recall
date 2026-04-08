/**
 * Unit tests for src/mcp/handlers.ts — MCP tool handler implementations
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import { dispatchToolCall, getRegisteredHandlers } from "../../src/mcp/handlers.js";
import type { McpToolCall, McpToolResult } from "../../src/mcp/types.js";

// ---------------------------------------------------------------------------
// Setup — each test gets a fresh temp directory for WIKIRECALL_HOME
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-mcp-handlers-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
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
    // Ignore cleanup on Windows — WAL files may still be locked
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
  return dispatchToolCall({ name, arguments: args });
}

function parseResult(result: McpToolResult): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

describe("handler registry", () => {
  test("getRegisteredHandlers returns all handlers", () => {
    const handlers = getRegisteredHandlers();
    expect(handlers).toBeArray();
    expect(handlers.length).toBeGreaterThanOrEqual(15);
  });

  test("every registered handler matches a tool name", () => {
    const { ALL_TOOLS } = require("../../src/mcp/tools.js");
    const toolNames = ALL_TOOLS.map((t: { name: string }) => t.name);
    const handlers = getRegisteredHandlers();
    for (const handler of handlers) {
      expect(toolNames).toContain(handler);
    }
  });

  test("unknown tool returns error result", async () => {
    const result = await callTool("nonexistent_tool", {});
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("Unknown tool");
  });
});

// ---------------------------------------------------------------------------
// knowledge_search handler
// ---------------------------------------------------------------------------

describe("knowledge_search handler", () => {
  test("returns error when query is missing", async () => {
    const result = await callTool("knowledge_search", {});
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("query");
  });

  test("returns empty results on fresh workspace", async () => {
    const result = await callTool("knowledge_search", { query: "test" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { results: unknown[]; count: number };
    expect(data.count).toBe(0);
    expect(data.results).toBeArray();
  });

  test("returns results after entity creation", async () => {
    // Create an entity first
    await callTool("knowledge_create_entity", {
      title: "Retry Pattern",
      type: "concept",
      content: "Retry with exponential backoff",
      tags: ["resilience"],
    });

    const result = await callTool("knowledge_search", { query: "retry" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { results: unknown[]; count: number };
    expect(data.count).toBeGreaterThan(0);
  });

  test("respects limit parameter", async () => {
    const result = await callTool("knowledge_search", { query: "test", limit: 5 });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// knowledge_get_entity handler
// ---------------------------------------------------------------------------

describe("knowledge_get_entity handler", () => {
  test("returns error when slug is missing", async () => {
    const result = await callTool("knowledge_get_entity", {});
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("slug");
  });

  test("returns error for nonexistent entity", async () => {
    const result = await callTool("knowledge_get_entity", { slug: "does-not-exist" });
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("not found");
  });

  test("returns entity after creation", async () => {
    await callTool("knowledge_create_entity", {
      title: "Test Entity",
      type: "concept",
      content: "Test content",
    });

    const result = await callTool("knowledge_get_entity", { slug: "test-entity" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { title: string; type: string };
    expect(data.title).toBe("Test Entity");
    expect(data.type).toBe("concept");
  });
});

// ---------------------------------------------------------------------------
// knowledge_list_entities handler
// ---------------------------------------------------------------------------

describe("knowledge_list_entities handler", () => {
  test("returns empty list on fresh workspace", async () => {
    const result = await callTool("knowledge_list_entities", {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { entities: unknown[]; count: number };
    expect(data.count).toBe(0);
  });

  test("lists created entities", async () => {
    await callTool("knowledge_create_entity", { title: "Alpha", type: "concept" });
    await callTool("knowledge_create_entity", { title: "Beta", type: "tool" });

    const result = await callTool("knowledge_list_entities", {});
    const data = parseResult(result) as { entities: unknown[]; count: number };
    expect(data.count).toBe(2);
  });

  test("filters by type", async () => {
    await callTool("knowledge_create_entity", { title: "Alpha", type: "concept" });
    await callTool("knowledge_create_entity", { title: "Beta", type: "tool" });

    const result = await callTool("knowledge_list_entities", { type: "tool" });
    const data = parseResult(result) as { entities: Array<{ type: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.entities[0].type).toBe("tool");
  });
});

// ---------------------------------------------------------------------------
// knowledge_create_entity handler
// ---------------------------------------------------------------------------

describe("knowledge_create_entity handler", () => {
  test("returns error when title is missing", async () => {
    const result = await callTool("knowledge_create_entity", { type: "concept" });
    expect(result.isError).toBeTrue();
  });

  test("returns error when type is missing", async () => {
    const result = await callTool("knowledge_create_entity", { title: "Test" });
    expect(result.isError).toBeTrue();
  });

  test("creates entity and returns slug", async () => {
    const result = await callTool("knowledge_create_entity", {
      title: "Circuit Breaker",
      type: "concept",
      content: "Pattern for fault tolerance",
      tags: ["resilience", "patterns"],
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { slug: string };
    expect(data.slug).toBe("circuit-breaker");
  });

  test("returns error for duplicate entity", async () => {
    await callTool("knowledge_create_entity", { title: "Unique", type: "concept" });
    const result = await callTool("knowledge_create_entity", { title: "Unique", type: "concept" });
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("already exists");
  });
});

// ---------------------------------------------------------------------------
// knowledge_update_entity handler
// ---------------------------------------------------------------------------

describe("knowledge_update_entity handler", () => {
  test("returns error when slug is missing", async () => {
    const result = await callTool("knowledge_update_entity", { title: "New Title" });
    expect(result.isError).toBeTrue();
  });

  test("returns error for nonexistent entity", async () => {
    const result = await callTool("knowledge_update_entity", { slug: "nope", title: "New" });
    expect(result.isError).toBeTrue();
  });

  test("updates entity content", async () => {
    await callTool("knowledge_create_entity", {
      title: "Updatable",
      type: "concept",
      content: "Original",
    });

    const result = await callTool("knowledge_update_entity", {
      slug: "updatable",
      content: "Updated content",
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { content: string };
    expect(data.content).toBe("Updated content");
  });
});

// ---------------------------------------------------------------------------
// scenario_list handler
// ---------------------------------------------------------------------------

describe("scenario_list handler", () => {
  test("returns empty list on fresh workspace", async () => {
    const result = await callTool("scenario_list", {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { scenarios: unknown[]; count: number };
    expect(data.count).toBe(0);
  });

  test("lists created scenarios", async () => {
    await callTool("scenario_create", {
      name: "my-api",
      description: "Test API project",
    });

    const result = await callTool("scenario_list", {});
    const data = parseResult(result) as { scenarios: Array<{ name: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.scenarios[0].name).toBe("my-api");
  });

  test("filters by status", async () => {
    await callTool("scenario_create", {
      name: "active-proj",
      description: "Active project",
    });

    const result = await callTool("scenario_list", { status: "archived" });
    const data = parseResult(result) as { scenarios: unknown[]; count: number };
    expect(data.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scenario_get handler
// ---------------------------------------------------------------------------

describe("scenario_get handler", () => {
  test("returns error when name is missing", async () => {
    const result = await callTool("scenario_get", {});
    expect(result.isError).toBeTrue();
  });

  test("returns error for nonexistent scenario", async () => {
    const result = await callTool("scenario_get", { name: "nope" });
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("not found");
  });

  test("returns scenario after creation", async () => {
    await callTool("scenario_create", {
      name: "my-api",
      description: "Test API project",
    });

    const result = await callTool("scenario_get", { name: "my-api" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { name: string; description: string };
    expect(data.name).toBe("my-api");
    expect(data.description).toBe("Test API project");
  });
});

// ---------------------------------------------------------------------------
// scenario_create handler
// ---------------------------------------------------------------------------

describe("scenario_create handler", () => {
  test("returns error when name is missing", async () => {
    const result = await callTool("scenario_create", { description: "test" });
    expect(result.isError).toBeTrue();
  });

  test("returns error when description is missing", async () => {
    const result = await callTool("scenario_create", { name: "test" });
    expect(result.isError).toBeTrue();
  });

  test("creates scenario without template", async () => {
    const result = await callTool("scenario_create", {
      name: "new-proj",
      description: "A new project",
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { name: string; status: string };
    expect(data.name).toBe("new-proj");
    expect(data.status).toBe("active");
  });

  test("returns error for duplicate scenario", async () => {
    await callTool("scenario_create", { name: "dup", description: "first" });
    const result = await callTool("scenario_create", { name: "dup", description: "second" });
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("already exists");
  });
});

// ---------------------------------------------------------------------------
// scenario_save handler
// ---------------------------------------------------------------------------

describe("scenario_save handler", () => {
  test("returns error when name is missing", async () => {
    const result = await callTool("scenario_save", { summary: "work done" });
    expect(result.isError).toBeTrue();
  });

  test("returns error for nonexistent scenario", async () => {
    const result = await callTool("scenario_save", { name: "nope", summary: "work" });
    expect(result.isError).toBeTrue();
  });

  test("saves context to existing scenario", async () => {
    await callTool("scenario_create", { name: "my-proj", description: "test" });

    const result = await callTool("scenario_save", {
      name: "my-proj",
      summary: "Finished auth module",
      next_steps: ["Add tests", "Deploy"],
      blockers: [],
      notes: "Going well",
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { context: { summary: string; next_steps: string[] } };
    expect(data.context.summary).toBe("Finished auth module");
    expect(data.context.next_steps).toContain("Add tests");
  });
});

// ---------------------------------------------------------------------------
// memory_query handler
// ---------------------------------------------------------------------------

describe("memory_query handler", () => {
  test("returns error when query is missing", async () => {
    const result = await callTool("memory_query", {});
    expect(result.isError).toBeTrue();
  });

  test("returns placeholder response with query echo", async () => {
    const result = await callTool("memory_query", { query: "who am I?" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { query: string; layers: string[] };
    expect(data.query).toBe("who am I?");
    expect(data.layers).toBeArray();
    expect(data.layers.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// memory_identity handler
// ---------------------------------------------------------------------------

describe("memory_identity handler", () => {
  test("returns identity layer info", async () => {
    const result = await callTool("memory_identity", {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { layer: string };
    expect(data.layer).toBe("L0-identity");
  });
});

// ---------------------------------------------------------------------------
// memory_stats handler
// ---------------------------------------------------------------------------

describe("memory_stats handler", () => {
  test("returns layer statistics", async () => {
    const result = await callTool("memory_stats", {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { layers: Record<string, unknown> };
    expect(data.layers).toBeDefined();
    expect(data.layers.L1_knowledge).toBeDefined();
    expect(data.layers.L2_scenario).toBeDefined();
  });

  test("entity count reflects created entities", async () => {
    await callTool("knowledge_create_entity", { title: "Stats Test", type: "concept" });

    const result = await callTool("memory_stats", {});
    const data = parseResult(result) as { layers: { L1_knowledge: { entityCount: number } } };
    expect(data.layers.L1_knowledge.entityCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// papers_search handler
// ---------------------------------------------------------------------------

describe("papers_search handler", () => {
  test("returns error when query is missing", async () => {
    const result = await callTool("papers_search", {});
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("query");
  });
});

// ---------------------------------------------------------------------------
// papers_curate handler
// ---------------------------------------------------------------------------

describe("papers_curate handler", () => {
  test("returns error when topics is missing", async () => {
    const result = await callTool("papers_curate", { keywords: ["test"] });
    expect(result.isError).toBeTrue();
  });

  test("returns error when keywords is missing", async () => {
    const result = await callTool("papers_curate", { topics: ["AI"] });
    expect(result.isError).toBeTrue();
  });

  test("returns error for empty topics array", async () => {
    const result = await callTool("papers_curate", { topics: [], keywords: ["test"] });
    expect(result.isError).toBeTrue();
  });

  test("returns error for empty keywords array", async () => {
    const result = await callTool("papers_curate", { topics: ["AI"], keywords: [] });
    expect(result.isError).toBeTrue();
  });
});

// ---------------------------------------------------------------------------
// visualize_knowledge handler
// ---------------------------------------------------------------------------

describe("visualize_knowledge handler", () => {
  test("returns error when type is missing", async () => {
    const result = await callTool("visualize_knowledge", { outputPath: "out.html" });
    expect(result.isError).toBeTrue();
  });

  test("returns error when outputPath is missing", async () => {
    const result = await callTool("visualize_knowledge", { type: "knowledge-graph" });
    expect(result.isError).toBeTrue();
  });

  test("returns error when no entities exist", async () => {
    const result = await callTool("visualize_knowledge", {
      type: "knowledge-graph",
      outputPath: join(testDir, "graph.html"),
    });
    expect(result.isError).toBeTrue();
    expect(result.content[0].text).toContain("No knowledge entities");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  test("dispatchToolCall catches handler exceptions", async () => {
    // This exercises the catch block in dispatchToolCall via an unknown tool
    const result = await dispatchToolCall({
      name: "definitely_not_a_tool",
      arguments: {},
    });
    expect(result.isError).toBeTrue();
  });

  test("result format has content array with text type", async () => {
    const result = await callTool("memory_identity", {});
    expect(result.content).toBeArray();
    expect(result.content.length).toBe(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBeString();
  });

  test("error results have isError true", async () => {
    const result = await callTool("knowledge_get_entity", { slug: "nope" });
    expect(result.isError).toBeTrue();
    expect(result.content[0].type).toBe("text");
  });
});
