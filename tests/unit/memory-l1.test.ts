/**
 * Unit tests for src/memory/layers/l1-story.ts — L1 Essential Story layer
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import matter from "gray-matter";
import { resetConfig } from "../../src/config.js";
import {
  generateEssentialStory,
  storyToPrompt,
} from "../../src/memory/layers/l1-story.js";
import type { KnowledgeEntity } from "../../src/types.js";
import type { L1EssentialStory } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-l1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
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
    ...(entity.status && { status: entity.status }),
  };
  const content = matter.stringify(entity.content ?? "", frontmatter);
  writeFileSync(join(dir, `${slug}.md`), content, "utf8");
}

function createSessionStore(path: string, sessions: number, turnsPerSession: number): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      summary TEXT,
      branch TEXT,
      repository TEXT,
      cwd TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE turns (
      session_id TEXT,
      turn_index INTEGER,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT
    );
  `);

  const insertSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertTurn = db.prepare("INSERT INTO turns VALUES (?, ?, ?, ?, ?)");

  for (let i = 0; i < sessions; i++) {
    const id = `session-${i}`;
    const date = `2025-01-${String(15 + i).padStart(2, "0")}T00:00:00Z`;
    insertSession.run(id, `Session ${i} summary`, "main", "org/repo", "/tmp", date, date);

    for (let j = 0; j < turnsPerSession; j++) {
      insertTurn.run(id, j, `User message ${j}`, `Assistant response ${j}`, date);
    }
  }

  db.close();
}

// ---------------------------------------------------------------------------
// generateEssentialStory
// ---------------------------------------------------------------------------

describe("generateEssentialStory", () => {
  test("generates story from empty wiki directory", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments).toEqual([]);
    expect(story.activeProjects).toEqual([]);
    expect(story.keyMetrics).toBeDefined();
    expect(story.generatedAt).toBeTruthy();
    expect(story.tokenCount).toBeGreaterThanOrEqual(0);
  });

  test("generates story from non-existent wiki directory", () => {
    const story = generateEssentialStory(join(testDir, "nonexistent"));
    expect(story.topMoments).toEqual([]);
    expect(story.keyMetrics.find(m => m.label === "Knowledge entities")?.value).toBe("0");
  });

  test("extracts top moments from entities sorted by date", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "old-entity", { title: "Old", updated: "2024-01-01" });
    writeEntity(wikiDir, "new-entity", { title: "New", updated: "2025-06-01" });
    writeEntity(wikiDir, "mid-entity", { title: "Mid", updated: "2025-03-01" });

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments.length).toBe(3);
    expect(story.topMoments[0].event).toContain("New");
    expect(story.topMoments[1].event).toContain("Mid");
    expect(story.topMoments[2].event).toContain("Old");
  });

  test("limits top moments to 5", () => {
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 10; i++) {
      writeEntity(wikiDir, `entity-${i}`, {
        title: `Entity ${i}`,
        updated: `2025-01-${String(i + 1).padStart(2, "0")}`,
      });
    }

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments.length).toBe(5);
  });

  test("sorts by connection count when dates are equal", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "popular", {
      title: "Popular",
      updated: "2025-01-15",
      related: ["a", "b", "c"],
    });
    writeEntity(wikiDir, "lonely", {
      title: "Lonely",
      updated: "2025-01-15",
      related: [],
    });

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments[0].event).toContain("Popular");
  });

  test("identifies active projects from repo-type entities", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "my-api", { title: "My API", type: "repo", updated: "2025-01-15" });
    writeEntity(wikiDir, "a-concept", { title: "A Concept", type: "concept", updated: "2025-01-15" });

    const story = generateEssentialStory(wikiDir);
    expect(story.activeProjects.length).toBeGreaterThanOrEqual(1);
    expect(story.activeProjects.find(p => p.name === "My API")).toBeTruthy();
  });

  test("identifies active projects from system-type entities", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "platform-x", { title: "Platform X", type: "system", updated: "2025-01-15" });

    const story = generateEssentialStory(wikiDir);
    expect(story.activeProjects.find(p => p.name === "Platform X")).toBeTruthy();
  });

  test("includes entity count in key metrics", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "e1", { title: "E1" });
    writeEntity(wikiDir, "e2", { title: "E2" });

    const story = generateEssentialStory(wikiDir);
    const entityMetric = story.keyMetrics.find(m => m.label === "Knowledge entities");
    expect(entityMetric?.value).toBe("2");
  });

  test("includes session stats when session store exists", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });
    const storePath = join(testDir, "session_store.db");
    createSessionStore(storePath, 3, 5);

    const story = generateEssentialStory(wikiDir, storePath);
    const sessionMetric = story.keyMetrics.find(m => m.label === "Sessions");
    expect(sessionMetric?.value).toBe("3");
  });

  test("handles missing session store gracefully", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const story = generateEssentialStory(wikiDir, join(testDir, "nonexistent.db"));
    const sessionMetric = story.keyMetrics.find(m => m.label === "Sessions");
    expect(sessionMetric?.value).toBe("0");
  });

  test("sets generatedAt to ISO timestamp", () => {
    const wikiDir = join(testDir, "knowledge");
    mkdirSync(wikiDir, { recursive: true });

    const before = new Date().toISOString();
    const story = generateEssentialStory(wikiDir);
    const after = new Date().toISOString();

    expect(story.generatedAt >= before).toBe(true);
    expect(story.generatedAt <= after).toBe(true);
  });

  test("calculates token count from prompt", () => {
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 5; i++) {
      writeEntity(wikiDir, `e-${i}`, { title: `Entity ${i}` });
    }

    const story = generateEssentialStory(wikiDir);
    expect(story.tokenCount).toBeGreaterThan(0);
    // Token count should roughly match chars / 4 of the prompt
    const prompt = storyToPrompt(story);
    expect(story.tokenCount).toBe(Math.ceil(prompt.length / 4));
  });

  test("limits active projects to 5", () => {
    const wikiDir = join(testDir, "knowledge");
    for (let i = 0; i < 10; i++) {
      writeEntity(wikiDir, `repo-${i}`, { title: `Repo ${i}`, type: "repo" });
    }

    const story = generateEssentialStory(wikiDir);
    expect(story.activeProjects.length).toBeLessThanOrEqual(5);
  });

  test("includes significance with connection count", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "connected", {
      title: "Connected",
      type: "tool",
      related: ["a", "b"],
    });

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments[0].significance).toContain("2 connections");
  });

  test("handles entities with missing updated date", () => {
    const wikiDir = join(testDir, "knowledge");
    writeEntity(wikiDir, "no-date", { title: "No Date", updated: "" });

    const story = generateEssentialStory(wikiDir);
    expect(story.topMoments.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// storyToPrompt
// ---------------------------------------------------------------------------

describe("storyToPrompt", () => {
  test("formats story with all sections", () => {
    const story: L1EssentialStory = {
      topMoments: [{ date: "2025-01-15", event: "Updated API docs", significance: "concept" }],
      activeProjects: [{ name: "My API", status: "repo", lastActivity: "2025-01-15" }],
      keyMetrics: [{ label: "Entities", value: "42" }],
      generatedAt: "2025-01-15T00:00:00Z",
      tokenCount: 100,
    };

    const prompt = storyToPrompt(story);
    expect(prompt).toContain("## Recent Activity");
    expect(prompt).toContain("Updated API docs");
    expect(prompt).toContain("## Active Projects");
    expect(prompt).toContain("My API");
    expect(prompt).toContain("## Key Metrics");
    expect(prompt).toContain("Entities: 42");
  });

  test("omits sections that are empty", () => {
    const story: L1EssentialStory = {
      topMoments: [],
      activeProjects: [],
      keyMetrics: [{ label: "Entities", value: "0" }],
      generatedAt: "2025-01-15T00:00:00Z",
      tokenCount: 0,
    };

    const prompt = storyToPrompt(story);
    expect(prompt).not.toContain("## Recent Activity");
    expect(prompt).not.toContain("## Active Projects");
    expect(prompt).toContain("## Key Metrics");
  });

  test("returns empty string for completely empty story", () => {
    const story: L1EssentialStory = {
      topMoments: [],
      activeProjects: [],
      keyMetrics: [],
      generatedAt: "",
      tokenCount: 0,
    };

    const prompt = storyToPrompt(story);
    expect(prompt).toBe("");
  });

  test("formats multiple moments as bullet list", () => {
    const story: L1EssentialStory = {
      topMoments: [
        { date: "2025-01-15", event: "Event A", significance: "sig A" },
        { date: "2025-01-14", event: "Event B", significance: "sig B" },
      ],
      activeProjects: [],
      keyMetrics: [],
      generatedAt: "",
      tokenCount: 0,
    };

    const prompt = storyToPrompt(story);
    expect(prompt).toContain("- [2025-01-15] Event A — sig A");
    expect(prompt).toContain("- [2025-01-14] Event B — sig B");
  });

  test("formats projects with status and lastActivity", () => {
    const story: L1EssentialStory = {
      topMoments: [],
      activeProjects: [
        { name: "API", status: "active", lastActivity: "2025-01-15" },
      ],
      keyMetrics: [],
      generatedAt: "",
      tokenCount: 0,
    };

    const prompt = storyToPrompt(story);
    expect(prompt).toContain("- API (active, last: 2025-01-15)");
  });

  test("prompt stays within reasonable token bounds", () => {
    const story: L1EssentialStory = {
      topMoments: Array.from({ length: 5 }, (_, i) => ({
        date: `2025-01-${i + 1}`,
        event: `Event ${i}`,
        significance: "important",
      })),
      activeProjects: Array.from({ length: 5 }, (_, i) => ({
        name: `Project ${i}`,
        status: "active",
        lastActivity: "2025-01-15",
      })),
      keyMetrics: [
        { label: "Entities", value: "100" },
        { label: "Sessions", value: "50" },
      ],
      generatedAt: "2025-01-15T00:00:00Z",
      tokenCount: 0,
    };

    const prompt = storyToPrompt(story);
    const tokenEstimate = Math.ceil(prompt.length / 4);
    expect(tokenEstimate).toBeLessThan(500);
  });
});
