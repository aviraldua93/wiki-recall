/**
 * Knowledge Search — FTS5-based full-text search for knowledge entities.
 *
 * Uses bun:sqlite with FTS5 extension to index and search knowledge
 * entities by title, tags, type, and content. Exposes both a
 * KnowledgeSearch class and legacy standalone functions for compatibility.
 */

import { Database } from "bun:sqlite";
import { join, basename } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import matter from "gray-matter";
import { getConfig } from "../config.js";
import type { KnowledgeEntity } from "../types.js";

// ---------------------------------------------------------------------------
// Search result type
// ---------------------------------------------------------------------------

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// KnowledgeSearch class
// ---------------------------------------------------------------------------

/**
 * FTS5-powered full-text search engine for knowledge entities.
 *
 * Creates/opens a SQLite database with an FTS5 virtual table and provides
 * indexing, searching, and rebuild capabilities.
 */
export class KnowledgeSearch {
  private db: Database | undefined;
  private dbPath: string;
  private knowledgeDir: string;

  constructor(dbPath?: string) {
    const dir = join(getConfig().home, "knowledge");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.knowledgeDir = dir;
    this.dbPath = dbPath ?? join(dir, "search.db");
  }

  /**
   * Get or create the underlying SQLite database with the FTS5 table.
   */
  getDb(): Database {
    if (this.db) return this.db;

    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        slug,
        title,
        type,
        tags,
        content,
        tokenize='porter unicode61'
      );
    `);

    return this.db;
  }

  /**
   * Close the database connection. Useful for tests and cleanup.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  /**
   * Index (or re-index) a knowledge entity in the FTS5 table.
   * Upserts by removing any existing entry with the same slug first.
   */
  indexEntity(slug: string, entity: KnowledgeEntity): void {
    const db = this.getDb();
    db.prepare("DELETE FROM knowledge_fts WHERE slug = ?").run(slug);
    db.prepare(
      "INSERT INTO knowledge_fts (slug, title, type, tags, content) VALUES (?, ?, ?, ?, ?)"
    ).run(
      slug,
      entity.title,
      entity.type,
      (entity.tags ?? []).join(" "),
      entity.content ?? ""
    );
  }

  /**
   * Remove an entity from the search index.
   */
  removeFromIndex(slug: string): void {
    const db = this.getDb();
    db.prepare("DELETE FROM knowledge_fts WHERE slug = ?").run(slug);
  }

  /**
   * Search knowledge entities using FTS5 MATCH.
   * Returns ranked results with entity name, title, type, snippet, and relevance score.
   */
  search(query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return [];

    const db = this.getDb();
    return db.prepare(`
      SELECT
        slug,
        title,
        type,
        snippet(knowledge_fts, 4, '<mark>', '</mark>', '...', 32) as snippet,
        rank
      FROM knowledge_fts
      WHERE knowledge_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as SearchResult[];
  }

  /**
   * Search entities filtered by type.
   */
  searchByType(type: string): SearchResult[] {
    const db = this.getDb();
    return db.prepare(`
      SELECT slug, title, type, '' as snippet, 0 as rank
      FROM knowledge_fts
      WHERE type = ?
    `).all(type) as SearchResult[];
  }

  /**
   * Rebuild the entire FTS5 index by scanning all entity .md files
   * in the knowledge directory. Handles additions, deletions, and modifications.
   */
  rebuildIndex(): number {
    const db = this.getDb();
    db.prepare("DELETE FROM knowledge_fts").run();

    const dir = this.knowledgeDir;
    if (!existsSync(dir)) return 0;

    const files = readdirSync(dir).filter(f => f.endsWith(".md"));
    const insert = db.prepare(
      "INSERT INTO knowledge_fts (slug, title, type, tags, content) VALUES (?, ?, ?, ?, ?)"
    );

    const tx = db.transaction(() => {
      for (const file of files) {
        const slug = basename(file, ".md");
        const raw = readFileSync(join(dir, file), "utf8");
        const parsed = matter(raw);

        insert.run(
          slug,
          parsed.data.title ?? slug,
          parsed.data.type ?? "",
          (parsed.data.tags ?? []).join(" "),
          parsed.content?.trim() ?? ""
        );
      }
    });

    tx();
    return files.length;
  }

  /**
   * Rebuild from an explicit list of entities (useful for tests and bulk operations).
   */
  rebuildFromList(entities: Array<{ slug: string; entity: KnowledgeEntity }>): void {
    const db = this.getDb();
    db.prepare("DELETE FROM knowledge_fts").run();

    const insert = db.prepare(
      "INSERT INTO knowledge_fts (slug, title, type, tags, content) VALUES (?, ?, ?, ?, ?)"
    );

    const tx = db.transaction(() => {
      for (const { slug, entity } of entities) {
        insert.run(
          slug,
          entity.title,
          entity.type,
          (entity.tags ?? []).join(" "),
          entity.content ?? ""
        );
      }
    });

    tx();
  }
}

// ---------------------------------------------------------------------------
// Singleton instance management (for backward compatibility)
// ---------------------------------------------------------------------------

let _instance: KnowledgeSearch | undefined;

function getInstance(): KnowledgeSearch {
  if (!_instance) {
    _instance = new KnowledgeSearch();
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// Legacy standalone functions — delegate to singleton KnowledgeSearch
// ---------------------------------------------------------------------------

/** Get or create the search database. */
export function getSearchDb(): Database {
  return getInstance().getDb();
}

/** Close the search database. */
export function closeSearchDb(): void {
  if (_instance) {
    _instance.close();
    _instance = undefined;
  }
}

/** Index a knowledge entity for full-text search. */
export function indexEntity(slug: string, entity: KnowledgeEntity): void {
  getInstance().indexEntity(slug, entity);
}

/** Remove an entity from the search index. */
export function removeFromIndex(slug: string): void {
  getInstance().removeFromIndex(slug);
}

/** Rebuild the entire search index from a list of entities. */
export function rebuildIndex(entities: Array<{ slug: string; entity: KnowledgeEntity }>): void {
  getInstance().rebuildFromList(entities);
}

/** Search knowledge entities using FTS5 full-text search. */
export function searchEntities(query: string, limit = 20): SearchResult[] {
  return getInstance().search(query, limit);
}

/** Search entities by type. */
export function searchByType(type: string): SearchResult[] {
  return getInstance().searchByType(type);
}
