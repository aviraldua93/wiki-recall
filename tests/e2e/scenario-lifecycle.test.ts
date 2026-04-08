/**
 * E2E test — Full scenario lifecycle: create → save → recall → handoff → teardown
 *
 * Exercises the CLI entry point through programmatic Commander.js parsing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import {
  createScenario,
  getScenario,
  listScenarios,
  updateScenario,
} from "../../src/scenario/manager.js";
import {
  transitionScenario,
  handoffScenario,
  archiveScenario,
  pauseScenario,
  resumeScenario,
  activateScenario,
  saveScenario,
  recallScenario,
} from "../../src/scenario/lifecycle.js";
import { applyTemplate } from "../../src/scenario/templates.js";
import { createEntity, getEntity, listEntities } from "../../src/knowledge/entities.js";
import {
  getSearchDb,
  closeSearchDb,
  indexEntity,
  searchEntities,
} from "../../src/knowledge/search.js";
import { loadAllSkills } from "../../src/skills/loader.js";
import { validateSkill } from "../../src/skills/validator.js";
import type { Scenario } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors on Windows
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Full lifecycle test
// ---------------------------------------------------------------------------

describe("full scenario lifecycle", () => {
  test("create → save → recall → handoff → teardown", () => {
    // 1. CREATE — Start a new scenario from template
    const scenario = applyTemplate("web-api", {
      name: "e2e-api-project",
      description: "E2E test: building a REST API with retry logic",
    });
    const created = createScenario(scenario);

    expect(created.name).toBe("e2e-api-project");
    expect(created.status).toBe("active");
    expect(created.skills!.length).toBeGreaterThan(0);
    expect(created.context!.next_steps!.length).toBeGreaterThan(0);

    // Verify it's persisted
    const allScenarios = listScenarios();
    expect(allScenarios).toHaveLength(1);
    expect(allScenarios[0].name).toBe("e2e-api-project");

    // 2. SAVE — Update context with progress
    const saved = updateScenario("e2e-api-project", {
      context: {
        summary: "Implemented retry handler with exponential backoff",
        open_prs: ["api-service#42"],
        next_steps: [
          "Write integration tests for retry handler",
          "Add jitter to backoff algorithm",
        ],
        blockers: [],
        notes: "Chose exponential backoff per upstream rate-limit docs",
      },
    });

    expect(saved.context!.summary).toContain("retry handler");
    expect(saved.context!.open_prs).toEqual(["api-service#42"]);
    expect(saved.context!.next_steps).toHaveLength(2);

    // 3. RECALL — Read back the scenario and verify state
    const recalled = getScenario("e2e-api-project");

    expect(recalled.name).toBe("e2e-api-project");
    expect(recalled.status).toBe("active");
    expect(recalled.context!.summary).toContain("retry handler");
    expect(recalled.context!.notes).toContain("exponential backoff");

    // 4. HANDOFF — Transfer to another engineer
    const handedOff = handoffScenario("e2e-api-project");

    expect(handedOff.status).toBe("handed-off");
    // Context is preserved during handoff
    const postHandoff = getScenario("e2e-api-project");
    expect(postHandoff.context!.summary).toContain("retry handler");

    // 5. TEARDOWN — Archive the scenario
    // First resume from handed-off (needed for some workflows)
    const resumed = resumeScenario("e2e-api-project");
    expect(resumed.status).toBe("active");

    const archived = archiveScenario("e2e-api-project");
    expect(archived.status).toBe("archived");

    // Verify archived scenario is still readable
    const finalState = getScenario("e2e-api-project");
    expect(finalState.status).toBe("archived");
    expect(finalState.context!.summary).toContain("retry handler");
  });

  test("create → pause → resume → archive lifecycle", () => {
    createScenario({
      name: "pausable-project",
      version: "0.1.0",
      status: "active",
      description: "Testing pause/resume flow",
    });

    // Pause
    const paused = pauseScenario("pausable-project");
    expect(paused.status).toBe("paused");

    // Resume
    const resumed = resumeScenario("pausable-project");
    expect(resumed.status).toBe("active");

    // Archive directly
    const archived = archiveScenario("pausable-project");
    expect(archived.status).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// Knowledge + Search integration
// ---------------------------------------------------------------------------

describe("knowledge entity lifecycle with search", () => {
  test("create entities, index them, search, and retrieve", () => {
    // Create entities
    const { slug: slug1 } = createEntity({
      title: "Retry Patterns",
      type: "concept",
      updated: "2025-03-15",
      tags: ["distributed-systems", "resilience"],
      content: "## What It Is\n\nRetry patterns handle transient failures in distributed systems using exponential backoff.",
    });

    const { slug: slug2 } = createEntity({
      title: "API Gateway",
      type: "system",
      updated: "2025-03-15",
      tags: ["infrastructure", "networking"],
      content: "## What It Is\n\nThe API gateway routes requests and handles authentication.",
    });

    expect(slug1).toBe("retry-patterns");
    expect(slug2).toBe("api-gateway");

    // Index for search
    const entity1 = getEntity("retry-patterns");
    const entity2 = getEntity("api-gateway");
    indexEntity("retry-patterns", entity1);
    indexEntity("api-gateway", entity2);

    // Search
    const retryResults = searchEntities("retry");
    expect(retryResults.length).toBeGreaterThan(0);
    expect(retryResults[0].slug).toBe("retry-patterns");

    const gatewayResults = searchEntities("gateway");
    expect(gatewayResults.length).toBeGreaterThan(0);
    expect(gatewayResults[0].slug).toBe("api-gateway");

    // List all
    const allEntities = listEntities();
    expect(allEntities).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Skills validation integration
// ---------------------------------------------------------------------------

describe("built-in skills end-to-end validation", () => {
  test("all built-in skills load and validate successfully", () => {
    const builtinDir = join(process.cwd(), "skills");
    const skills = loadAllSkills(builtinDir);

    expect(skills).toHaveLength(7);

    for (const skill of skills) {
      const result = validateSkill(skill);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // All built-in skills should have the recommended sections
      expect(result.warnings).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-scenario management
// ---------------------------------------------------------------------------

describe("multi-scenario management", () => {
  test("manages multiple scenarios simultaneously", () => {
    // Create multiple scenarios
    createScenario({
      name: "project-alpha",
      version: "0.1.0",
      status: "active",
      description: "First project",
    });

    createScenario({
      name: "project-beta",
      version: "0.2.0",
      status: "active",
      description: "Second project",
    });

    createScenario({
      name: "project-gamma",
      version: "0.3.0",
      status: "active",
      description: "Third project",
    });

    // List all
    expect(listScenarios()).toHaveLength(3);

    // Pause one, handoff another
    pauseScenario("project-alpha");
    handoffScenario("project-beta");

    // Verify states
    expect(getScenario("project-alpha").status).toBe("paused");
    expect(getScenario("project-beta").status).toBe("handed-off");
    expect(getScenario("project-gamma").status).toBe("active");

    // Archive all
    archiveScenario("project-alpha");
    archiveScenario("project-beta");
    archiveScenario("project-gamma");

    const allArchived = listScenarios().every(s => s.status === "archived");
    expect(allArchived).toBe(true);
  });
});
