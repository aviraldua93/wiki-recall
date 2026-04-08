/**
 * Visualization Generator — main entry point for creating HTML visualizations.
 *
 * Loads entities from a knowledge directory, builds the appropriate data
 * structures, renders them to self-contained HTML, and writes to disk.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import matter from "gray-matter";
import type { KnowledgeEntity } from "../../types.js";
import type { VisualizationConfig } from "./types.js";
import { buildKnowledgeGraph, buildTopicClusters, buildTimeline } from "./graph-builder.js";
import {
  renderKnowledgeGraph,
  renderTopicClusters,
  renderTimeline,
  renderResearchLandscape,
} from "./html-renderer.js";

// ---------------------------------------------------------------------------
// Entity loader
// ---------------------------------------------------------------------------

/**
 * Load all knowledge entities from a directory of Markdown files.
 */
export function loadEntitiesFromDir(knowledgeDir: string): KnowledgeEntity[] {
  if (!existsSync(knowledgeDir)) return [];

  return readdirSync(knowledgeDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(knowledgeDir, f), "utf8");
      const parsed = matter(raw);
      return {
        title: parsed.data.title ?? basename(f, ".md"),
        type: parsed.data.type ?? "concept",
        updated: parsed.data.updated ?? "unknown",
        tags: parsed.data.tags ?? [],
        related: parsed.data.related ?? [],
        content: parsed.content?.trim() ?? "",
        ...(parsed.data.created && { created: parsed.data.created }),
        ...(parsed.data.sources && { sources: parsed.data.sources }),
        ...(parsed.data.source_count !== undefined && { source_count: parsed.data.source_count }),
        ...(parsed.data.status && { status: parsed.data.status }),
      } as KnowledgeEntity;
    });
}

// ---------------------------------------------------------------------------
// generateVisualization
// ---------------------------------------------------------------------------

/**
 * Generate a visualization from knowledge entities and write to disk.
 *
 * @param config  Visualization configuration.
 * @param knowledgeDir  Path to the directory containing entity .md files.
 * @returns The rendered HTML string.
 */
export async function generateVisualization(
  config: VisualizationConfig,
  knowledgeDir: string,
): Promise<string> {
  // Load entities — use provided entities or load from disk
  const entities = config.entities ?? loadEntitiesFromDir(knowledgeDir);

  if (entities.length === 0) {
    throw new Error("No knowledge entities found. Create entities first with: wikirecall knowledge create");
  }

  let html: string;

  switch (config.type) {
    case "knowledge-graph":
    case "entity-connections": {
      const graph = buildKnowledgeGraph(entities);
      html = renderKnowledgeGraph(graph, config);
      break;
    }

    case "topic-clusters": {
      const { clusters } = buildTopicClusters(entities);
      html = renderTopicClusters(clusters, config);
      break;
    }

    case "timeline": {
      const { events } = buildTimeline(entities);
      html = renderTimeline(events, config);
      break;
    }

    case "research-landscape": {
      const graph = buildKnowledgeGraph(entities);
      const { clusters } = buildTopicClusters(entities);
      html = renderResearchLandscape(graph, clusters, config);
      break;
    }

    default:
      throw new Error(`Unknown visualization type: ${config.type}`);
  }

  // Ensure output directory exists and write
  const outDir = dirname(config.outputPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(config.outputPath, html, "utf8");

  return html;
}
