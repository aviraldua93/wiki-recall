/**
 * MCP Tool Handlers — implementations that bridge MCP tool calls to
 * existing WikiRecall modules (knowledge, scenario, papers, visualization).
 *
 * Each handler receives the tool arguments and returns an McpToolResult.
 * Memory tools return placeholder responses when the memory module is
 * not yet implemented.
 */

import type { McpToolResult, McpToolCall } from "./types.js";
import type { KnowledgeEntity, KnowledgeEntityType, ScenarioStatus, ScenarioContext } from "../types.js";

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(data: unknown): McpToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ---------------------------------------------------------------------------
// Knowledge handlers
// ---------------------------------------------------------------------------

async function handleKnowledgeSearch(args: Record<string, unknown>): Promise<McpToolResult> {
  const query = args.query as string;
  const limit = (args.limit as number) ?? 20;

  if (!query) return errorResult("Missing required parameter: query");

  const { searchEntities } = await import("../knowledge/search.js");
  const results = searchEntities(query, limit);
  return jsonResult({ results, count: results.length });
}

async function handleKnowledgeGetEntity(args: Record<string, unknown>): Promise<McpToolResult> {
  const slug = args.slug as string;

  if (!slug) return errorResult("Missing required parameter: slug");

  const { getEntity } = await import("../knowledge/entities.js");
  try {
    const entity = getEntity(slug);
    return jsonResult(entity);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function handleKnowledgeListEntities(args: Record<string, unknown>): Promise<McpToolResult> {
  const typeFilter = args.type as KnowledgeEntityType | undefined;

  const { listEntities } = await import("../knowledge/entities.js");
  let entities = listEntities();

  if (typeFilter) {
    entities = entities.filter((e) => e.type === typeFilter);
  }

  const summary = entities.map((e) => ({
    title: e.title,
    type: e.type,
    updated: e.updated,
    tags: e.tags,
  }));

  return jsonResult({ entities: summary, count: summary.length });
}

async function handleKnowledgeCreateEntity(args: Record<string, unknown>): Promise<McpToolResult> {
  const title = args.title as string;
  const type = args.type as KnowledgeEntityType;

  if (!title) return errorResult("Missing required parameter: title");
  if (!type) return errorResult("Missing required parameter: type");

  const entity: KnowledgeEntity = {
    title,
    type,
    updated: new Date().toISOString().split("T")[0],
    content: (args.content as string) ?? "",
    tags: (args.tags as string[]) ?? [],
    related: (args.related as string[]) ?? [],
  };

  const { createEntity } = await import("../knowledge/entities.js");
  try {
    const result = createEntity(entity);
    return jsonResult({ slug: result.slug, entity: result.entity });
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function handleKnowledgeUpdateEntity(args: Record<string, unknown>): Promise<McpToolResult> {
  const slug = args.slug as string;

  if (!slug) return errorResult("Missing required parameter: slug");

  const updates: Partial<KnowledgeEntity> = {};
  if (args.title !== undefined) updates.title = args.title as string;
  if (args.type !== undefined) updates.type = args.type as KnowledgeEntityType;
  if (args.content !== undefined) updates.content = args.content as string;
  if (args.tags !== undefined) updates.tags = args.tags as string[];
  if (args.related !== undefined) updates.related = args.related as string[];
  updates.updated = new Date().toISOString().split("T")[0];

  const { updateEntity } = await import("../knowledge/entities.js");
  try {
    const result = updateEntity(slug, updates);
    return jsonResult(result);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Scenario handlers
// ---------------------------------------------------------------------------

async function handleScenarioList(args: Record<string, unknown>): Promise<McpToolResult> {
  const statusFilter = args.status as ScenarioStatus | undefined;

  const { listScenarios } = await import("../scenario/manager.js");
  let scenarios = listScenarios();

  if (statusFilter) {
    scenarios = scenarios.filter((s) => s.status === statusFilter);
  }

  const summary = scenarios.map((s) => ({
    name: s.name,
    status: s.status,
    description: s.description,
    version: s.version,
    updated_at: s.updated_at,
  }));

  return jsonResult({ scenarios: summary, count: summary.length });
}

async function handleScenarioGet(args: Record<string, unknown>): Promise<McpToolResult> {
  const name = args.name as string;

  if (!name) return errorResult("Missing required parameter: name");

  const { getScenario } = await import("../scenario/manager.js");
  try {
    const scenario = getScenario(name);
    return jsonResult(scenario);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function handleScenarioCreate(args: Record<string, unknown>): Promise<McpToolResult> {
  const name = args.name as string;
  const description = args.description as string;
  const templateId = args.template as string | undefined;

  if (!name) return errorResult("Missing required parameter: name");
  if (!description) return errorResult("Missing required parameter: description");

  try {
    if (templateId) {
      const { instantiateTemplate } = await import("../scenario/templates.js");
      const scenario = instantiateTemplate(templateId, { name, description });
      return jsonResult(scenario);
    } else {
      const { createScenario } = await import("../scenario/manager.js");
      const scenario = createScenario({
        name,
        version: "0.1.0",
        status: "active",
        description,
      });
      return jsonResult(scenario);
    }
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function handleScenarioSave(args: Record<string, unknown>): Promise<McpToolResult> {
  const name = args.name as string;

  if (!name) return errorResult("Missing required parameter: name");

  const context: ScenarioContext = {};
  if (args.summary !== undefined) context.summary = args.summary as string;
  if (args.next_steps !== undefined) context.next_steps = args.next_steps as string[];
  if (args.blockers !== undefined) context.blockers = args.blockers as string[];
  if (args.notes !== undefined) context.notes = args.notes as string;
  if (args.open_prs !== undefined) context.open_prs = args.open_prs as string[];

  const { saveScenario } = await import("../scenario/lifecycle.js");
  try {
    const result = saveScenario(name, context);
    return jsonResult(result);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Memory handlers (placeholder — memory module not yet implemented)
// ---------------------------------------------------------------------------

async function handleMemoryQuery(args: Record<string, unknown>): Promise<McpToolResult> {
  const query = args.query as string;
  if (!query) return errorResult("Missing required parameter: query");

  return jsonResult({
    message: "Memory module not yet implemented. Query received.",
    query,
    layers: ["L0-identity", "L1-knowledge", "L2-scenario", "L3-session", "L4-web"],
  });
}

async function handleMemoryIdentity(_args: Record<string, unknown>): Promise<McpToolResult> {
  return jsonResult({
    message: "Memory module not yet implemented.",
    layer: "L0-identity",
    description: "The identity layer defines who you are and your core principles.",
  });
}

async function handleMemoryStats(_args: Record<string, unknown>): Promise<McpToolResult> {
  // Gather what stats we can from existing modules
  const { listEntities } = await import("../knowledge/entities.js");
  const { listScenarios } = await import("../scenario/manager.js");

  let entityCount = 0;
  let scenarioCount = 0;

  try { entityCount = listEntities().length; } catch { /* dir may not exist */ }
  try { scenarioCount = listScenarios().length; } catch { /* dir may not exist */ }

  return jsonResult({
    layers: {
      L0_identity: { status: "not_implemented" },
      L1_knowledge: { entityCount },
      L2_scenario: { scenarioCount },
      L3_session: { status: "not_implemented" },
      L4_web: { status: "not_implemented" },
    },
  });
}

// ---------------------------------------------------------------------------
// Paper handlers
// ---------------------------------------------------------------------------

async function handlePapersSearch(args: Record<string, unknown>): Promise<McpToolResult> {
  const query = args.query as string;
  const maxResults = (args.maxResults as number) ?? 10;
  const topics = args.topics as string[] | undefined;

  if (!query) return errorResult("Missing required parameter: query");

  try {
    const { createArxivClient } = await import("../knowledge/papers/arxiv.js");
    const client = createArxivClient();
    const result = await client.searchPapers({ query, maxResults, topics });

    const papers = result.papers.map((p) => ({
      title: p.title,
      authors: p.authors,
      publishedDate: p.publishedDate,
      url: p.url,
      topics: p.topics,
      tldr: p.tldr,
    }));

    return jsonResult({ papers, count: papers.length, source: "arxiv" });
  } catch (err) {
    return errorResult(`Paper search failed: ${(err as Error).message}`);
  }
}

async function handlePapersCurate(args: Record<string, unknown>): Promise<McpToolResult> {
  const topics = args.topics as string[];
  const keywords = args.keywords as string[];

  if (!topics?.length) return errorResult("Missing required parameter: topics");
  if (!keywords?.length) return errorResult("Missing required parameter: keywords");

  try {
    const { curatePapers } = await import("../knowledge/papers/curator.js");
    const config = {
      topics,
      keywords,
      minRelevanceScore: (args.minRelevanceScore as number) ?? 0.3,
      maxPapersPerDay: (args.maxPapers as number) ?? 20,
      sources: ["arxiv" as const],
    };

    const papers = await curatePapers(config);

    const summary = papers.map((p) => ({
      title: p.title,
      authors: p.authors,
      publishedDate: p.publishedDate,
      url: p.url,
      topics: p.topics,
    }));

    return jsonResult({ papers: summary, count: summary.length });
  } catch (err) {
    return errorResult(`Curation failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Visualization handler
// ---------------------------------------------------------------------------

async function handleVisualizeKnowledge(args: Record<string, unknown>): Promise<McpToolResult> {
  const type = args.type as string;
  const outputPath = args.outputPath as string;

  if (!type) return errorResult("Missing required parameter: type");
  if (!outputPath) return errorResult("Missing required parameter: outputPath");

  try {
    const { join } = await import("node:path");
    const { getConfig } = await import("../config.js");
    const { generateVisualization } = await import("../knowledge/visualize/generator.js");

    const config = {
      type: type as import("../knowledge/visualize/types.js").VisualizationType,
      title: (args.title as string) ?? "Knowledge Graph",
      outputPath,
      interactive: true,
      query: args.query as string | undefined,
    };

    const knowledgeDir = join(getConfig().home, "knowledge");
    const html = await generateVisualization(config, knowledgeDir);

    return jsonResult({
      message: `Visualization generated at ${outputPath}`,
      type,
      size: html.length,
    });
  } catch (err) {
    return errorResult(`Visualization failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler dispatch map
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>;

const HANDLERS: Record<string, ToolHandler> = {
  knowledge_search: handleKnowledgeSearch,
  knowledge_get_entity: handleKnowledgeGetEntity,
  knowledge_list_entities: handleKnowledgeListEntities,
  knowledge_create_entity: handleKnowledgeCreateEntity,
  knowledge_update_entity: handleKnowledgeUpdateEntity,
  scenario_list: handleScenarioList,
  scenario_get: handleScenarioGet,
  scenario_create: handleScenarioCreate,
  scenario_save: handleScenarioSave,
  memory_query: handleMemoryQuery,
  memory_identity: handleMemoryIdentity,
  memory_stats: handleMemoryStats,
  papers_search: handlePapersSearch,
  papers_curate: handlePapersCurate,
  visualize_knowledge: handleVisualizeKnowledge,
};

/**
 * Dispatch a tool call to the appropriate handler.
 * Returns an error result if the tool is not registered.
 */
export async function dispatchToolCall(call: McpToolCall): Promise<McpToolResult> {
  const handler = HANDLERS[call.name];
  if (!handler) {
    return errorResult(`Unknown tool: ${call.name}`);
  }

  try {
    return await handler(call.arguments);
  } catch (err) {
    return errorResult(`Tool '${call.name}' failed: ${(err as Error).message}`);
  }
}

/**
 * Get the list of all registered handler names.
 */
export function getRegisteredHandlers(): string[] {
  return Object.keys(HANDLERS);
}
