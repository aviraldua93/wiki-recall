/**
 * MCP Tool Definitions — declares every tool the WikiRecall MCP server exposes.
 *
 * Each entry carries a name, description, and JSON Schema for the input
 * parameters. The handler implementations live in handlers.ts.
 */

import type { McpTool } from "./types.js";

// ---------------------------------------------------------------------------
// Knowledge tools
// ---------------------------------------------------------------------------

const knowledgeSearch: McpTool = {
  name: "knowledge_search",
  description: "Full-text search across all knowledge entities using FTS5. Returns ranked results with snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text" },
      limit: { type: "number", description: "Maximum results to return (default 20)" },
    },
    required: ["query"],
  },
};

const knowledgeGetEntity: McpTool = {
  name: "knowledge_get_entity",
  description: "Retrieve a specific knowledge entity by its slug identifier.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Entity slug (kebab-case identifier)" },
    },
    required: ["slug"],
  },
};

const knowledgeListEntities: McpTool = {
  name: "knowledge_list_entities",
  description: "List all knowledge entities, with optional type filter.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Filter by entity type",
        enum: ["platform", "system", "repo", "tool", "concept", "person", "team"],
      },
    },
  },
};

const knowledgeCreateEntity: McpTool = {
  name: "knowledge_create_entity",
  description: "Create a new knowledge entity in the wiki.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Entity title" },
      type: {
        type: "string",
        description: "Entity type classification",
        enum: ["platform", "system", "repo", "tool", "concept", "person", "team"],
      },
      content: { type: "string", description: "Markdown body content" },
      tags: { type: "array", items: { type: "string" }, description: "Searchable tags" },
      related: { type: "array", items: { type: "string" }, description: "Related entity slugs" },
    },
    required: ["title", "type"],
  },
};

const knowledgeUpdateEntity: McpTool = {
  name: "knowledge_update_entity",
  description: "Update an existing knowledge entity by slug.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Entity slug to update" },
      title: { type: "string", description: "Updated title" },
      type: {
        type: "string",
        description: "Updated type",
        enum: ["platform", "system", "repo", "tool", "concept", "person", "team"],
      },
      content: { type: "string", description: "Updated markdown body" },
      tags: { type: "array", items: { type: "string" }, description: "Updated tags" },
      related: { type: "array", items: { type: "string" }, description: "Updated related slugs" },
    },
    required: ["slug"],
  },
};

// ---------------------------------------------------------------------------
// Scenario tools
// ---------------------------------------------------------------------------

const scenarioList: McpTool = {
  name: "scenario_list",
  description: "List all scenarios with their status, description, and metadata.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by lifecycle status",
        enum: ["active", "paused", "handed-off", "archived"],
      },
    },
  },
};

const scenarioGet: McpTool = {
  name: "scenario_get",
  description: "Get a specific scenario by name with full details.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Scenario name (kebab-case)" },
    },
    required: ["name"],
  },
};

const scenarioCreate: McpTool = {
  name: "scenario_create",
  description: "Create a new scenario, optionally from a template.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Scenario name (kebab-case)" },
      description: { type: "string", description: "One-line description" },
      template: {
        type: "string",
        description: "Template ID to use",
        enum: ["web-api", "frontend-app", "infra-pipeline", "research-paper", "multi-agent"],
      },
    },
    required: ["name", "description"],
  },
};

const scenarioSave: McpTool = {
  name: "scenario_save",
  description: "Save context (summary, next steps, blockers, notes) to a scenario.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Scenario name" },
      summary: { type: "string", description: "Current work summary" },
      next_steps: { type: "array", items: { type: "string" }, description: "Ordered next actions" },
      blockers: { type: "array", items: { type: "string" }, description: "Current blockers" },
      notes: { type: "string", description: "Free-form notes" },
      open_prs: { type: "array", items: { type: "string" }, description: "Open PR references" },
    },
    required: ["name"],
  },
};

// ---------------------------------------------------------------------------
// Memory tools
// ---------------------------------------------------------------------------

const memoryQuery: McpTool = {
  name: "memory_query",
  description: "Route a query through the 5-layer memory stack (L0 identity → L4 web).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language query to route" },
    },
    required: ["query"],
  },
};

const memoryIdentity: McpTool = {
  name: "memory_identity",
  description: "Get the L0 identity layer — who you are and core principles.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

const memoryStats: McpTool = {
  name: "memory_stats",
  description: "Get statistics about each memory layer (entity counts, last updated).",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

// ---------------------------------------------------------------------------
// Paper tools
// ---------------------------------------------------------------------------

const papersSearch: McpTool = {
  name: "papers_search",
  description: "Search for research papers across arXiv and Semantic Scholar.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query for papers" },
      maxResults: { type: "number", description: "Maximum papers to return (default 10)" },
      topics: { type: "array", items: { type: "string" }, description: "Topic filters" },
    },
    required: ["query"],
  },
};

const papersCurate: McpTool = {
  name: "papers_curate",
  description: "Run automated paper curation — search, deduplicate, score, and rank papers by relevance.",
  inputSchema: {
    type: "object",
    properties: {
      topics: { type: "array", items: { type: "string" }, description: "Topics of interest" },
      keywords: { type: "array", items: { type: "string" }, description: "Keywords to search" },
      minRelevanceScore: { type: "number", description: "Minimum relevance score 0–1 (default 0.3)" },
      maxPapers: { type: "number", description: "Maximum papers to return (default 20)" },
    },
    required: ["topics", "keywords"],
  },
};

// ---------------------------------------------------------------------------
// Visualization tools
// ---------------------------------------------------------------------------

const visualizeKnowledge: McpTool = {
  name: "visualize_knowledge",
  description: "Generate an interactive HTML visualization of the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Visualization type",
        enum: ["knowledge-graph", "topic-clusters", "timeline", "research-landscape", "entity-connections"],
      },
      title: { type: "string", description: "Title for the visualization" },
      outputPath: { type: "string", description: "File path for HTML output" },
      query: { type: "string", description: "Optional FTS5 query to filter entities" },
    },
    required: ["type", "outputPath"],
  },
};

// ---------------------------------------------------------------------------
// Full tool registry
// ---------------------------------------------------------------------------

export const ALL_TOOLS: McpTool[] = [
  knowledgeSearch,
  knowledgeGetEntity,
  knowledgeListEntities,
  knowledgeCreateEntity,
  knowledgeUpdateEntity,
  scenarioList,
  scenarioGet,
  scenarioCreate,
  scenarioSave,
  memoryQuery,
  memoryIdentity,
  memoryStats,
  papersSearch,
  papersCurate,
  visualizeKnowledge,
];

/**
 * Retrieve a tool definition by name.
 */
export function getToolByName(name: string): McpTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
