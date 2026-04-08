/**
 * Unit tests for src/scenario/templates.ts — scenario templates
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { getTemplates, getTemplate, applyTemplate, listTemplates, instantiateTemplate } from "../../src/scenario/templates.js";
import { validateScenarioManifest, getScenario } from "../../src/scenario/manager.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// getTemplates
// ---------------------------------------------------------------------------

describe("getTemplates", () => {
  test("returns all 5 templates", () => {
    const templates = getTemplates();
    expect(templates).toHaveLength(5);
  });

  test("returns templates with correct IDs", () => {
    const ids = getTemplates().map(t => t.id);
    expect(ids).toContain("web-api");
    expect(ids).toContain("frontend-app");
    expect(ids).toContain("infra-pipeline");
    expect(ids).toContain("research-paper");
    expect(ids).toContain("multi-agent");
  });

  test("each template has required fields", () => {
    for (const template of getTemplates()) {
      expect(template.id).toBeTruthy();
      expect(template.label).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.defaults).toBeDefined();
    }
  });

  test("returns a copy (not mutable reference)", () => {
    const templates1 = getTemplates();
    const templates2 = getTemplates();
    expect(templates1).not.toBe(templates2);
  });
});

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

describe("getTemplate", () => {
  test("returns a specific template by ID", () => {
    const template = getTemplate("web-api");
    expect(template.id).toBe("web-api");
    expect(template.label).toBe("Web API");
  });

  test("throws for unknown template ID", () => {
    expect(() => getTemplate("nonexistent")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------

describe("applyTemplate", () => {
  test("creates a scenario from template", () => {
    const scenario = applyTemplate("web-api", {
      name: "my-api",
      description: "My API project",
    });

    expect(scenario.name).toBe("my-api");
    expect(scenario.description).toBe("My API project");
    expect(scenario.version).toBe("0.1.0");
    expect(scenario.status).toBe("active");
  });

  test("includes template skills", () => {
    const scenario = applyTemplate("web-api", {
      name: "my-api",
      description: "My API project",
    });

    expect(scenario.skills).toBeDefined();
    expect(scenario.skills!.length).toBeGreaterThan(0);
  });

  test("includes template context with next_steps", () => {
    const scenario = applyTemplate("web-api", {
      name: "my-api",
      description: "My API project",
    });

    expect(scenario.context).toBeDefined();
    expect(scenario.context!.next_steps).toBeDefined();
    expect(scenario.context!.next_steps!.length).toBeGreaterThan(0);
  });

  test("overrides take precedence over template defaults", () => {
    const scenario = applyTemplate("web-api", {
      name: "my-api",
      description: "Custom desc",
      version: "1.0.0",
      status: "paused",
    });

    expect(scenario.version).toBe("1.0.0");
    expect(scenario.status).toBe("paused");
  });

  test("throws for unknown template", () => {
    expect(() => applyTemplate("nonexistent", { name: "test", description: "test" })).toThrow("not found");
  });

  test("multi-agent template includes multi-agent skill", () => {
    const scenario = applyTemplate("multi-agent", {
      name: "my-agents",
      description: "Agent project",
    });

    const skillNames = scenario.skills?.map(s => s.name) ?? [];
    expect(skillNames).toContain("multi-agent");
  });
});

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

describe("listTemplates", () => {
  test("returns 5 templates", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(5);
  });

  test("returns templates with correct IDs", () => {
    const ids = listTemplates().map(t => t.id);
    expect(ids).toContain("web-api");
    expect(ids).toContain("frontend-app");
    expect(ids).toContain("infra-pipeline");
    expect(ids).toContain("research-paper");
    expect(ids).toContain("multi-agent");
  });

  test("each listed template has description", () => {
    for (const template of listTemplates()) {
      expect(template.description).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// instantiateTemplate
// ---------------------------------------------------------------------------

describe("instantiateTemplate", () => {
  test("creates and persists a scenario from template", () => {
    const scenario = instantiateTemplate("web-api", {
      name: "my-api",
      description: "My API from template",
    });

    expect(scenario.name).toBe("my-api");
    expect(scenario.status).toBe("active");
    expect(scenario.id).toBeDefined();
    expect(scenario.created_at).toBeDefined();

    // Verify persisted
    const recalled = getScenario("my-api");
    expect(recalled.name).toBe("my-api");
  });

  test("overrides take precedence in instantiation", () => {
    const scenario = instantiateTemplate("frontend-app", {
      name: "custom-frontend",
      description: "Custom frontend",
      version: "2.0.0",
    });

    expect(scenario.version).toBe("2.0.0");
  });

  test("throws for unknown template", () => {
    expect(() =>
      instantiateTemplate("nonexistent", { name: "test", description: "test" })
    ).toThrow("not found");
  });

  test("instantiated scenario includes template skills", () => {
    const scenario = instantiateTemplate("multi-agent", {
      name: "my-agents",
      description: "Agent project",
    });

    const skillNames = scenario.skills?.map(s => s.name) ?? [];
    expect(skillNames).toContain("multi-agent");
  });
});

// ---------------------------------------------------------------------------
// YAML template validation
// ---------------------------------------------------------------------------

describe("YAML template validation", () => {
  test("all 5 YAML templates validate against scenario.schema.json", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(5);

    for (const template of templates) {
      const scenario = {
        name: template.id,
        ...template.defaults,
        description: template.defaults.description ?? template.description,
      };
      const result = validateScenarioManifest(scenario);
      expect(result.valid).toBe(true);
    }
  });
});
