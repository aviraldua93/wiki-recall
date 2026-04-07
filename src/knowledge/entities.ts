/**
 * Knowledge Entities — CRUD operations for Karpathy-style knowledge entities.
 *
 * Entities are stored as Markdown files with YAML frontmatter in the
 * knowledge directory. Uses gray-matter for parsing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import matter from "gray-matter";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getConfig } from "../config.js";
import type { KnowledgeEntity } from "../types.js";
import entitySchema from "../../schemas/knowledge-entity.schema.json";

// ---------------------------------------------------------------------------
// Schema validator (singleton)
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateEntity = ajv.compile(entitySchema);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function knowledgeDir(): string {
  return join(getConfig().home, "knowledge");
}

function entityPath(name: string): string {
  return join(knowledgeDir(), `${name}.md`);
}

function ensureKnowledgeDir(): void {
  const dir = knowledgeDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge entity.
 * Returns the entity with its generated slug.
 */
export function createEntity(entity: KnowledgeEntity): { slug: string; entity: KnowledgeEntity } {
  const frontmatter = {
    title: entity.title,
    type: entity.type,
    updated: entity.updated,
    tags: entity.tags ?? [],
    related: entity.related ?? [],
  };

  const valid = validateEntity(frontmatter);
  if (!valid) {
    const errors = validateEntity.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Invalid entity: ${errors}`);
  }

  const slug = slugify(entity.title);
  ensureKnowledgeDir();
  const filePath = entityPath(slug);

  if (existsSync(filePath)) {
    throw new Error(`Entity '${slug}' already exists`);
  }

  const content = matter.stringify(entity.content ?? "", frontmatter);
  writeFileSync(filePath, content, "utf8");
  return { slug, entity };
}

/**
 * Read a knowledge entity by slug.
 */
export function getEntity(slug: string): KnowledgeEntity {
  const filePath = entityPath(slug);
  if (!existsSync(filePath)) {
    throw new Error(`Entity '${slug}' not found`);
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  return {
    title: parsed.data.title,
    type: parsed.data.type,
    updated: parsed.data.updated,
    tags: parsed.data.tags ?? [],
    related: parsed.data.related ?? [],
    content: parsed.content.trim(),
  };
}

/**
 * Update an existing knowledge entity.
 */
export function updateEntity(slug: string, updates: Partial<KnowledgeEntity>): KnowledgeEntity {
  const existing = getEntity(slug);
  const updated: KnowledgeEntity = { ...existing, ...updates };

  const frontmatter = {
    title: updated.title,
    type: updated.type,
    updated: updated.updated,
    tags: updated.tags ?? [],
    related: updated.related ?? [],
  };

  const valid = validateEntity(frontmatter);
  if (!valid) {
    const errors = validateEntity.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Invalid entity update: ${errors}`);
  }

  const content = matter.stringify(updated.content ?? "", frontmatter);
  writeFileSync(entityPath(slug), content, "utf8");
  return updated;
}

/**
 * Delete a knowledge entity by slug.
 */
export function deleteEntity(slug: string): void {
  const filePath = entityPath(slug);
  if (!existsSync(filePath)) {
    throw new Error(`Entity '${slug}' not found`);
  }
  rmSync(filePath);
}

/**
 * List all knowledge entities.
 */
export function listEntities(): KnowledgeEntity[] {
  const dir = knowledgeDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = matter(raw);
      return {
        title: parsed.data.title,
        type: parsed.data.type,
        updated: parsed.data.updated,
        tags: parsed.data.tags ?? [],
        related: parsed.data.related ?? [],
        content: parsed.content.trim(),
      } as KnowledgeEntity;
    });
}

/**
 * Validate knowledge entity frontmatter against the JSON Schema.
 */
export function validateEntityFrontmatter(data: unknown): { valid: boolean; errors?: string[] } {
  const valid = validateEntity(data);
  if (valid) return { valid: true };

  const errors = validateEntity.errors?.map(e => `${e.instancePath || "/"} ${e.message}`) ?? [];
  return { valid: false, errors };
}
