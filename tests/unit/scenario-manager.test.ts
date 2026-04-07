/**
 * Unit tests for src/scenario/manager.ts — Scenario CRUD operations
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { resetConfig } from "../../src/config.js";
import {
  createScenario,
  getScenario,
  updateScenario,
  deleteScenario,
  listScenarios,
  validateScenarioManifest,
} from "../../src/scenario/manager.js";
import type { Scenario } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDir: string;

function validScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "test-scenario",
    version: "0.1.0",
    status: "active",
    description: "A test scenario",
    repos: [],
    skills: [],
    knowledge: [],
    context: {
      summary: "",
      open_prs: [],
      next_steps: [],
      blockers: [],
      notes: "",
    },
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// createScenario
// ---------------------------------------------------------------------------

describe("createScenario", () => {
  test("creates a scenario file on disk", () => {
    const scenario = validScenario();
    const result = createScenario(scenario);

    expect(result.name).toBe("test-scenario");
    const filePath = join(testDir, "scenarios", "test-scenario.yaml");
    expect(existsSync(filePath)).toBe(true);
  });

  test("stores valid YAML content", () => {
    createScenario(validScenario());
    const filePath = join(testDir, "scenarios", "test-scenario.yaml");
    const content = readFileSync(filePath, "utf8");
    const parsed = yaml.load(content) as Scenario;

    expect(parsed.name).toBe("test-scenario");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.status).toBe("active");
  });

  test("throws if scenario already exists", () => {
    createScenario(validScenario());
    expect(() => createScenario(validScenario())).toThrow("already exists");
  });

  test("throws on invalid scenario (missing name)", () => {
    const bad = { version: "0.1.0", status: "active", description: "test" } as unknown as Scenario;
    expect(() => createScenario(bad)).toThrow("Invalid scenario");
  });

  test("throws on invalid scenario (bad version format)", () => {
    expect(() => createScenario(validScenario({ version: "not-a-version" }))).toThrow("Invalid scenario");
  });

  test("throws on invalid scenario (bad status)", () => {
    expect(() => createScenario(validScenario({ status: "invalid" as any }))).toThrow("Invalid scenario");
  });

  test("throws on invalid scenario name (uppercase)", () => {
    expect(() => createScenario(validScenario({ name: "BadName" }))).toThrow("Invalid scenario");
  });

  test("creates scenario with full repos, skills, and knowledge", () => {
    const scenario = validScenario({
      repos: [{ url: "https://github.com/org/repo", branch: "main", purpose: "Primary repo" }],
      skills: [{ name: "code-review", source: "root" }],
      knowledge: [{ name: "architecture", scope: "scenario" }],
    });

    const result = createScenario(scenario);
    expect(result.repos).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result.knowledge).toHaveLength(1);
  });

  test("creates scenarios directory if it doesn't exist", () => {
    const scenariosDir = join(testDir, "scenarios");
    expect(existsSync(scenariosDir)).toBe(false);

    createScenario(validScenario());
    expect(existsSync(scenariosDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getScenario
// ---------------------------------------------------------------------------

describe("getScenario", () => {
  test("reads an existing scenario", () => {
    createScenario(validScenario());
    const scenario = getScenario("test-scenario");

    expect(scenario.name).toBe("test-scenario");
    expect(scenario.status).toBe("active");
  });

  test("throws if scenario does not exist", () => {
    expect(() => getScenario("nonexistent")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// updateScenario
// ---------------------------------------------------------------------------

describe("updateScenario", () => {
  test("updates scenario description", () => {
    createScenario(validScenario());
    const updated = updateScenario("test-scenario", { description: "Updated description" });

    expect(updated.description).toBe("Updated description");
    expect(updated.name).toBe("test-scenario");
  });

  test("updates scenario context", () => {
    createScenario(validScenario());
    const updated = updateScenario("test-scenario", {
      context: { summary: "Working on feature X", next_steps: ["Step 1", "Step 2"] },
    });

    expect(updated.context?.summary).toBe("Working on feature X");
    expect(updated.context?.next_steps).toEqual(["Step 1", "Step 2"]);
  });

  test("persists updates to disk", () => {
    createScenario(validScenario());
    updateScenario("test-scenario", { description: "Persisted" });

    const reloaded = getScenario("test-scenario");
    expect(reloaded.description).toBe("Persisted");
  });

  test("throws if scenario does not exist", () => {
    expect(() => updateScenario("nonexistent", { description: "test" })).toThrow("not found");
  });

  test("throws if trying to rename", () => {
    createScenario(validScenario());
    expect(() => updateScenario("test-scenario", { name: "new-name" })).toThrow("Cannot rename");
  });

  test("throws on invalid update (bad status)", () => {
    createScenario(validScenario());
    expect(() => updateScenario("test-scenario", { status: "invalid" as any })).toThrow("Invalid scenario");
  });
});

// ---------------------------------------------------------------------------
// deleteScenario
// ---------------------------------------------------------------------------

describe("deleteScenario", () => {
  test("deletes a scenario from disk", () => {
    createScenario(validScenario());
    deleteScenario("test-scenario");

    const filePath = join(testDir, "scenarios", "test-scenario.yaml");
    expect(existsSync(filePath)).toBe(false);
  });

  test("throws if scenario does not exist", () => {
    expect(() => deleteScenario("nonexistent")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// listScenarios
// ---------------------------------------------------------------------------

describe("listScenarios", () => {
  test("returns empty array when no scenarios exist", () => {
    expect(listScenarios()).toEqual([]);
  });

  test("lists all scenarios", () => {
    createScenario(validScenario({ name: "scenario-a", description: "First" }));
    createScenario(validScenario({ name: "scenario-b", description: "Second" }));

    const scenarios = listScenarios();
    expect(scenarios).toHaveLength(2);
    expect(scenarios.map(s => s.name).sort()).toEqual(["scenario-a", "scenario-b"]);
  });
});

// ---------------------------------------------------------------------------
// validateScenarioManifest
// ---------------------------------------------------------------------------

describe("validateScenarioManifest", () => {
  test("validates a correct scenario", () => {
    const result = validateScenarioManifest(validScenario());
    expect(result.valid).toBe(true);
  });

  test("rejects missing required fields", () => {
    const result = validateScenarioManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("rejects invalid name format", () => {
    const result = validateScenarioManifest({ ...validScenario(), name: "BadName" });
    expect(result.valid).toBe(false);
  });

  test("rejects invalid version format", () => {
    const result = validateScenarioManifest({ ...validScenario(), version: "abc" });
    expect(result.valid).toBe(false);
  });

  test("rejects invalid status", () => {
    const result = validateScenarioManifest({ ...validScenario(), status: "broken" });
    expect(result.valid).toBe(false);
  });

  test("rejects extra properties", () => {
    const result = validateScenarioManifest({ ...validScenario(), extraField: "nope" });
    expect(result.valid).toBe(false);
  });
});
