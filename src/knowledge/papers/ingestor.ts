/**
 * Paper Ingestor — convert research papers into knowledge entities.
 *
 * Follows Karpathy's knowledge compilation pattern:
 *  1. Create entity page with YAML frontmatter
 *  2. Extract key concepts from abstract (via LLM or mock)
 *  3. Update related entities with backlinks
 *  4. Append to ingestion log
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../logger.js";
import { createEntity, updateEntity, listEntities } from "../entities.js";
import type { KnowledgeEntity } from "../../types.js";
import type { ExtractionProvider } from "../extraction.js";
import type { ResearchPaper, IngestResult } from "./types.js";

const log = createLogger("papers:ingestor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Build markdown content for a paper entity.
 */
function buildPaperContent(paper: ResearchPaper, concepts: string[]): string {
  const lines: string[] = [];

  lines.push("## What It Is");
  lines.push("");
  lines.push(paper.abstract);
  lines.push("");

  if (paper.tldr) {
    lines.push("## TL;DR");
    lines.push("");
    lines.push(paper.tldr);
    lines.push("");
  }

  lines.push("## Details");
  lines.push("");
  lines.push(`- **Authors:** ${paper.authors.join(", ")}`);
  lines.push(`- **Published:** ${paper.publishedDate}`);
  if (paper.arxivId) {
    lines.push(`- **ArXiv:** [${paper.arxivId}](https://arxiv.org/abs/${paper.arxivId})`);
  }
  if (paper.citations !== undefined) {
    lines.push(`- **Citations:** ${paper.citations}`);
  }
  lines.push(`- **URL:** ${paper.url}`);
  lines.push("");

  if (concepts.length > 0) {
    lines.push("## Key Concepts");
    lines.push("");
    for (const concept of concepts) {
      lines.push(`- ${concept}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Concept extraction (fallback when no LLM provider)
// ---------------------------------------------------------------------------

/**
 * Extract key concepts from abstract using simple heuristics.
 * Used when no LLM provider is available.
 */
function extractConceptsHeuristic(abstract: string): string[] {
  // Split into sentences and take key ones
  const sentences = abstract
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  // Take first 3–5 meaningful sentences as "concepts"
  return sentences.slice(0, 5).map(s => s.endsWith(".") ? s : `${s}.`);
}

// ---------------------------------------------------------------------------
// Backlink updates
// ---------------------------------------------------------------------------

/**
 * Find existing entities related to the paper's topics and add backlinks.
 */
function updateBacklinks(paperSlug: string, paper: ResearchPaper): void {
  const existingEntities = listEntities();

  for (const entity of existingEntities) {
    const entityTags = (entity.tags ?? []).map(t => t.toLowerCase());
    const hasTopicOverlap = paper.topics.some(topic =>
      entityTags.some(tag => tag.includes(topic.toLowerCase()) || topic.toLowerCase().includes(tag))
    );

    if (hasTopicOverlap) {
      const entitySlug = slugify(entity.title);
      if (entitySlug === paperSlug) continue;

      const existingRelated = entity.related ?? [];
      if (!existingRelated.includes(paperSlug)) {
        try {
          updateEntity(entitySlug, {
            related: [...existingRelated, paperSlug],
            updated: today(),
          });
          log.debug({ entitySlug, paperSlug }, "Added backlink");
        } catch (err) {
          log.warn({ entitySlug, err }, "Failed to update backlink");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ingestion log
// ---------------------------------------------------------------------------

function appendToLog(knowledgeDir: string, paper: ResearchPaper, slug: string): void {
  const logPath = join(knowledgeDir, "ingestion-log.md");
  const entry = `- ${today()} | ${slug} | ${paper.title} | ${paper.source ?? "unknown"}\n`;

  try {
    appendFileSync(logPath, entry, "utf8");
  } catch {
    // Create the file if it doesn't exist
    writeFileSync(logPath, `# Ingestion Log\n\n${entry}`, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Single paper ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest a single research paper into the knowledge wiki.
 *
 * Steps:
 *  1. Create entity page with YAML frontmatter
 *  2. Extract key concepts from abstract
 *  3. Update related entities with backlinks
 *  4. Append to ingestion log
 */
export async function ingestPaper(
  paper: ResearchPaper,
  knowledgeDir: string,
  extractionProvider?: ExtractionProvider,
): Promise<void> {
  const slug = slugify(paper.title);
  log.info({ slug, title: paper.title }, "Ingesting paper");

  // Ensure knowledge dir exists
  if (!existsSync(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true });
  }

  // Extract concepts
  let concepts: string[];
  if (extractionProvider) {
    try {
      const extracted = await extractionProvider.extractEntities(paper.abstract);
      concepts = extracted.map(e => e.title);
    } catch (err) {
      log.warn({ err }, "LLM extraction failed, falling back to heuristics");
      concepts = extractConceptsHeuristic(paper.abstract);
    }
  } else {
    concepts = extractConceptsHeuristic(paper.abstract);
  }

  // Build and create the knowledge entity
  const content = buildPaperContent(paper, concepts);
  const entity: KnowledgeEntity = {
    title: paper.title,
    type: "concept",
    updated: today(),
    tags: [...paper.topics, "paper", paper.source ?? "manual"],
    related: [],
    content,
    created: today(),
    sources: [paper.url],
    source_count: 1,
    status: "draft",
  };

  createEntity(entity);

  // Update backlinks on related entities
  updateBacklinks(slug, paper);

  // Append to ingestion log
  appendToLog(knowledgeDir, paper, slug);

  log.info({ slug }, "Paper ingested successfully");
}

// ---------------------------------------------------------------------------
// Batch ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest a batch of papers. Handles errors gracefully per-paper.
 */
export async function ingestBatch(
  papers: ResearchPaper[],
  knowledgeDir: string,
  extractionProvider?: ExtractionProvider,
): Promise<IngestResult> {
  const result: IngestResult = { ingested: [], skipped: [], errors: [] };

  for (const paper of papers) {
    const slug = slugify(paper.title);
    try {
      await ingestPaper(paper, knowledgeDir, extractionProvider);
      result.ingested.push({ paperId: paper.id, slug });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        result.skipped.push({ paperId: paper.id, reason: "Already ingested" });
      } else {
        result.errors.push({ paperId: paper.id, error: message });
      }
    }
  }

  log.info(
    { ingested: result.ingested.length, skipped: result.skipped.length, errors: result.errors.length },
    "Batch ingestion complete",
  );

  return result;
}
