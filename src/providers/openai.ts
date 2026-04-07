/**
 * OpenAI Provider — LLM-powered knowledge entity extraction.
 *
 * Calls the OpenAI chat completions API to analyze session text and
 * extract structured knowledge entities. Requires OPENAI_API_KEY env var.
 */

import OpenAI from "openai";
import type { KnowledgeEntity, KnowledgeEntityType } from "../types.js";
import type { ExtractionProvider } from "../knowledge/extraction.js";

// ---------------------------------------------------------------------------
// System prompt for entity extraction
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Analyze the provided text and extract structured knowledge entities.

Each entity should represent a distinct concept, tool, system, platform, person, team, or repository mentioned in the text.

Return a JSON array of entities. Each entity must have:
- "title": Human-readable name (string, 1-256 chars)
- "type": One of "platform", "system", "repo", "tool", "concept", "person", "team"
- "updated": Today's date in YYYY-MM-DD format
- "tags": Array of relevant tags (strings)
- "related": Array of related entity IDs in kebab-case (strings)
- "content": Markdown body with "## What It Is" section and key details

Return ONLY a valid JSON array. No markdown fencing, no explanation.`;

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const VALID_TYPES: Set<string> = new Set([
  "platform", "system", "repo", "tool", "concept", "person", "team",
]);

function parseExtractionResponse(responseText: string): KnowledgeEntity[] {
  // Strip markdown code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse extraction response as JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Extraction response is not a JSON array");
  }

  const today = new Date().toISOString().split("T")[0];

  return parsed
    .filter((item: unknown): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).title === "string"
    )
    .map((item) => ({
      title: String(item.title).slice(0, 256),
      type: (VALID_TYPES.has(String(item.type)) ? String(item.type) : "concept") as KnowledgeEntityType,
      updated: typeof item.updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.updated)
        ? item.updated
        : today,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === "string") : [],
      related: Array.isArray(item.related) ? item.related.filter((r: unknown) => typeof r === "string") : [],
      content: typeof item.content === "string" ? item.content : "",
    }));
}

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

export interface OpenAIProviderOptions {
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model to use for extraction. Defaults to "gpt-4o-mini". */
  model?: string;
  /** Maximum tokens for the response. Defaults to 4096. */
  maxTokens?: number;
  /** Temperature for sampling. Defaults to 0.2 (low for determinism). */
  temperature?: number;
}

/**
 * OpenAI-powered extraction provider.
 *
 * Calls the OpenAI chat completions API to extract knowledge entities
 * from session text.
 */
export class OpenAIProvider implements ExtractionProvider {
  readonly name = "openai";

  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key required. Set OPENAI_API_KEY env var or pass apiKey option."
      );
    }

    this.client = new OpenAI({ apiKey });
    this.model = options.model ?? "gpt-4o-mini";
    this.maxTokens = options.maxTokens ?? 4096;
    this.temperature = options.temperature ?? 0.2;
  }

  /**
   * Extract knowledge entities from a block of text using OpenAI.
   */
  async extractEntities(text: string): Promise<KnowledgeEntity[]> {
    if (!text.trim()) return [];

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    return parseExtractionResponse(content);
  }

  /** Alias for backward compatibility with ExtractionProvider.extract(). */
  async extract(text: string): Promise<KnowledgeEntity[]> {
    return this.extractEntities(text);
  }
}

/**
 * Create an OpenAI extraction provider.
 */
export function createOpenAIProvider(options: OpenAIProviderOptions = {}): OpenAIProvider {
  return new OpenAIProvider(options);
}

// Re-export the parsing utility for testing
export { parseExtractionResponse };
