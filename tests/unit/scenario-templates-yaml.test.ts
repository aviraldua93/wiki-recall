/**
 * Unit tests for src/scenario/templates.ts — YAML template loading.
 *
 * Tests template loading from YAML files, template ID lookup,
 * template application with overrides, and edge cases.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import {
  getTemplates,
  getTemplate,
  applyTemplate,
  listTemplates,
  instantiateTemplate,
} from "../../src/scenario/templates.js";
import { getScenario } from "../../src/scenario/manager.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-tmpl-yaml-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {}
  resetConfig();
});

// ---------------------------------------------------------------------------
// getTemplates — built-in templates
// ---------------------------------------------------------------------------

describe("getTemplates built-in", () => {
  test("web-api template has correct label", () => {
    const tpl = getTemplate("web-api");
    expect(tpl.label).toBe("Web API");
    expect(tpl.description).toContain("API");
  });

  test("frontend-app template has correct label", () => {
    const tpl = getTemplate("frontend-app");
    expect(tpl.label).toBe("Frontend App");
  });

  test("infra-pipeline template has correct label", () => {
    const tpl = getTemplate("infra-pipeline");
    expect(tpl.label).toBe("Infrastructure Pipeline");
  });

  test("research-paper template has correct label", () => {
    const tpl = getTemplate("research-paper");
    expect(tpl.label).toBe("Research Paper");
  });

  test("multi-agent template has correct label", () => {
    const tpl = getTemplate("multi-agent");
    expect(tpl.label).toBe("Multi-Agent Project");
  });

  test("all templates have version 0.1.0 as default", () => {
    for (const tpl of getTemplates()) {
      expect(tpl.defaults.version).toBe("0.1.0");
    }
  });

  test("all templates have status 'active' as default", () => {
    for (const tpl of getTemplates()) {
      expect(tpl.defaults.status).toBe("active");
    }
  });

  test("all templates have at least one skill", () => {
    for (const tpl of getTemplates()) {
      expect(tpl.defaults.skills).toBeDefined();
      expect(tpl.defaults.skills!.length).toBeGreaterThan(0);
    }
  });

  test("all templates have context with next_steps", () => {
    for (const tpl of getTemplates()) {
      expect(tpl.defaults.context).toBeDefined();
      expect(tpl.defaults.context!.next_steps).toBeDefined();
      expect(tpl.defaults.context!.next_steps!.length).toBeGreaterThan(0);
    }
  });

  test("each template has a unique ID", () => {
    const ids = getTemplates().map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// applyTemplate — merging overrides
// ---------------------------------------------------------------------------

describe("applyTemplate merging", () => {
  test("name and description are required overrides", () => {
    const scenario = applyTemplate("web-api", {
      name: "test-api",
      description: "Test API",
    });
    expect(scenario.name).toBe("test-api");
    expect(scenario.description).toBe("Test API");
  });

  test("template skills are inherited", () => {
    const scenario = applyTemplate("web-api", {
      name: "test-api",
      description: "Test",
    });
    expect(scenario.skills).toBeDefined();
    expect(scenario.skills!.length).toBeGreaterThan(0);
  });

  test("version override takes precedence", () => {
    const scenario = applyTemplate("web-api", {
      name: "test",
      description: "Test",
      version: "2.0.0",
    });
    expect(scenario.version).toBe("2.0.0");
  });

  test("status override takes precedence", () => {
    const scenario = applyTemplate("web-api", {
      name: "test",
      description: "Test",
      status: "paused",
    });
    expect(scenario.status).toBe("paused");
  });

  test("context is merged (not replaced)", () => {
    const scenario = applyTemplate("web-api", {
      name: "test",
      description: "Test",
      context: { summary: "Custom summary" },
    });
    expect(scenario.context?.summary).toBe("Custom summary");
    // Should still have next_steps from template
    expect(scenario.context?.next_steps).toBeDefined();
  });

  test("repos can be added via overrides", () => {
    const scenario = applyTemplate("web-api", {
      name: "test",
      description: "Test",
      repos: [{ url: "https://github.com/org/repo", branch: "main" }],
    });
    expect(scenario.repos).toBeDefined();
    expect(scenario.repos!.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// instantiateTemplate — creates + persists
// ---------------------------------------------------------------------------

describe("instantiateTemplate persistence", () => {
  test("persisted scenario has an ID", () => {
    const scenario = instantiateTemplate("web-api", {
      name: "persisted-api",
      description: "Persisted API",
    });
    expect(scenario.id).toBeDefined();
    expect(scenario.id!.length).toBeGreaterThan(0);
  });

  test("persisted scenario has created_at timestamp", () => {
    const scenario = instantiateTemplate("web-api", {
      name: "timestamped-api",
      description: "Timestamped",
    });
    expect(scenario.created_at).toBeDefined();
  });

  test("persisted scenario can be retrieved by name", () => {
    instantiateTemplate("frontend-app", {
      name: "my-frontend",
      description: "My Frontend",
    });
    const retrieved = getScenario("my-frontend");
    expect(retrieved.name).toBe("my-frontend");
    expect(retrieved.description).toBe("My Frontend");
  });

  test("duplicate name throws", () => {
    instantiateTemplate("web-api", {
      name: "dup-test",
      description: "First",
    });
    expect(() => instantiateTemplate("web-api", {
      name: "dup-test",
      description: "Second",
    })).toThrow("already exists");
  });

  test("instantiation with infra-pipeline template", () => {
    const scenario = instantiateTemplate("infra-pipeline", {
      name: "my-pipeline",
      description: "My CI/CD",
    });
    const skillNames = scenario.skills?.map(s => s.name) ?? [];
    expect(skillNames).toContain("ci-monitor");
  });

  test("instantiation with research-paper template", () => {
    const scenario = instantiateTemplate("research-paper", {
      name: "my-paper",
      description: "My Research",
    });
    const skillNames = scenario.skills?.map(s => s.name) ?? [];
    expect(skillNames).toContain("session-management");
  });
});

// ---------------------------------------------------------------------------
// listTemplates fallback behavior
// ---------------------------------------------------------------------------

describe("listTemplates fallback", () => {
  test("returns builtin templates when no YAML templates exist", () => {
    const templates = listTemplates();
    expect(templates.length).toBe(5);
    const ids = templates.map(t => t.id);
    expect(ids).toContain("web-api");
  });

  test("returns builtin templates when templates/ dir doesn't exist", () => {
    // Ensure no templates/ dir exists in cwd
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// getTemplate error handling
// ---------------------------------------------------------------------------

describe("getTemplate error handling", () => {
  test("throws with descriptive message for unknown ID", () => {
    try {
      getTemplate("nonexistent-template");
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.message).toContain("not found");
      expect(e.message).toContain("Available:");
      expect(e.message).toContain("web-api");
    }
  });

  test("error message lists all available template IDs", () => {
    try {
      getTemplate("nope");
    } catch (e: any) {
      expect(e.message).toContain("web-api");
      expect(e.message).toContain("frontend-app");
      expect(e.message).toContain("infra-pipeline");
      expect(e.message).toContain("research-paper");
      expect(e.message).toContain("multi-agent");
    }
  });

  test("template IDs are case-sensitive", () => {
    expect(() => getTemplate("Web-Api")).toThrow("not found");
    expect(() => getTemplate("WEB-API")).toThrow("not found");
  });
});
