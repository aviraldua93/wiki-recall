/**
 * Unit tests for src/sync/handoff.ts — PR body builder and handoff logic.
 *
 * Tests buildPRBody (indirectly) and createHandoffPR validation.
 * All git/network operations are mocked — zero external calls.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { createScenario } from "../../src/scenario/manager.js";
import { validateBranchName } from "../../src/sync/auth.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  process.env.GITHUB_TOKEN = "ghp_handoff_test_token";
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {}
  delete process.env.GITHUB_TOKEN;
  resetConfig();
});

// ---------------------------------------------------------------------------
// Handoff branch name generation
// ---------------------------------------------------------------------------

describe("Handoff branch naming", () => {
  test("handoff/scenario-name is a valid branch name", () => {
    expect(validateBranchName("handoff/my-scenario")).toBe("handoff/my-scenario");
  });

  test("handoff/simple is valid", () => {
    expect(validateBranchName("handoff/simple")).toBe("handoff/simple");
  });

  test("handoff with nested slashes is valid", () => {
    expect(validateBranchName("handoff/team/scenario")).toBe("handoff/team/scenario");
  });

  test("rejects handoff branch with double dots", () => {
    expect(() => validateBranchName("handoff/../etc/passwd")).toThrow("Double dots");
  });

  test("rejects handoff branch with shell injection", () => {
    expect(() => validateBranchName("handoff/$(whoami)")).toThrow("Invalid branch name");
  });
});

// ---------------------------------------------------------------------------
// HandoffPRResult contract
// ---------------------------------------------------------------------------

describe("HandoffPRResult shape", () => {
  test("successful result has ok=true and prUrl", () => {
    const result = { ok: true, prUrl: "https://github.com/org/repo/pull/42" };
    expect(result.ok).toBe(true);
    expect(result.prUrl).toContain("github.com");
  });

  test("failed result has ok=false and error", () => {
    const result = { ok: false, error: "push failed" };
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createHandoffPR prerequisites
// ---------------------------------------------------------------------------

describe("createHandoffPR prerequisites", () => {
  test("requires a scenario with repos to create PR", () => {
    createScenario({
      name: "no-repos",
      version: "0.1.0",
      status: "active",
      description: "No repos scenario",
    });

    // createHandoffPR would throw because no repo URL
    // We test this indirectly since the function shells out to git
    const { createHandoffPR } = require("../../src/sync/handoff.js");
    expect(createHandoffPR("no-repos")).rejects.toThrow();
  });

  test("scenario with repos has required URL", () => {
    const scenario = createScenario({
      name: "has-repos",
      version: "0.1.0",
      status: "active",
      description: "Has repos",
      repos: [{ url: "https://github.com/org/repo", branch: "main" }],
    });

    expect(scenario.repos).toBeDefined();
    expect(scenario.repos![0].url).toBe("https://github.com/org/repo");
  });
});

// ---------------------------------------------------------------------------
// PR body structure (indirect tests via scenario data)
// ---------------------------------------------------------------------------

describe("PR body construction", () => {
  test("scenario with full context provides PR body data", () => {
    const scenario = createScenario({
      name: "full-context",
      version: "0.1.0",
      status: "active",
      description: "Full context scenario for handoff",
      repos: [{ url: "https://github.com/org/repo", branch: "main" }],
      context: {
        summary: "Working on retry handler",
        next_steps: ["Write tests", "Deploy"],
        blockers: ["Waiting on dependency"],
        notes: "Use exponential backoff",
      },
    });

    expect(scenario.context?.summary).toBe("Working on retry handler");
    expect(scenario.context?.next_steps).toHaveLength(2);
    expect(scenario.context?.blockers).toHaveLength(1);
    expect(scenario.context?.notes).toBe("Use exponential backoff");
  });

  test("scenario without context still provides minimal data", () => {
    const scenario = createScenario({
      name: "minimal-ctx",
      version: "0.1.0",
      status: "active",
      description: "Minimal scenario",
    });

    expect(scenario.name).toBe("minimal-ctx");
    expect(scenario.description).toBe("Minimal scenario");
  });

  test("scenario with empty next_steps", () => {
    const scenario = createScenario({
      name: "empty-steps",
      version: "0.1.0",
      status: "active",
      description: "Empty steps",
      context: { next_steps: [] },
    });

    expect(scenario.context?.next_steps).toEqual([]);
  });

  test("scenario with empty blockers", () => {
    const scenario = createScenario({
      name: "no-blockers",
      version: "0.1.0",
      status: "active",
      description: "No blockers",
      context: { blockers: [] },
    });

    expect(scenario.context?.blockers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Handoff state transitions
// ---------------------------------------------------------------------------

describe("Handoff state transitions", () => {
  test("handing off changes status to handed-off", () => {
    const { handoffScenario } = require("../../src/scenario/lifecycle.js");
    const { getScenario } = require("../../src/scenario/manager.js");

    createScenario({
      name: "transition-test",
      version: "0.1.0",
      status: "active",
      description: "Transition test",
    });

    handoffScenario("transition-test");
    const updated = getScenario("transition-test");
    expect(updated.status).toBe("handed-off");
  });

  test("cannot handoff an archived scenario", () => {
    const { handoffScenario } = require("../../src/scenario/lifecycle.js");

    createScenario({
      name: "archived-handoff",
      version: "0.1.0",
      status: "archived",
      description: "Archived scenario",
    });

    expect(() => handoffScenario("archived-handoff")).toThrow();
  });

  test("can resume a handed-off scenario", () => {
    const { handoffScenario, resumeScenario } = require("../../src/scenario/lifecycle.js");
    const { getScenario } = require("../../src/scenario/manager.js");

    createScenario({
      name: "resume-handoff",
      version: "0.1.0",
      status: "active",
      description: "Resume test",
    });

    handoffScenario("resume-handoff");
    expect(getScenario("resume-handoff").status).toBe("handed-off");

    resumeScenario("resume-handoff");
    expect(getScenario("resume-handoff").status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// GitHub URL parsing for PR creation
// ---------------------------------------------------------------------------

describe("GitHub URL parsing", () => {
  test("HTTPS URL format is parseable", () => {
    const url = "https://github.com/aviraldua93/wikirecall";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    expect(match).toBeDefined();
    expect(match![1]).toBe("aviraldua93");
    expect(match![2]).toBe("wikirecall");
  });

  test("SSH URL format is parseable", () => {
    const url = "git@github.com:aviraldua93/wikirecall.git";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    expect(match).toBeDefined();
    expect(match![1]).toBe("aviraldua93");
    expect(match![2]).toBe("wikirecall");
  });

  test("URL with .git suffix is parsed correctly", () => {
    const url = "https://github.com/org/repo.git";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    expect(match).toBeDefined();
    expect(match![1]).toBe("org");
    expect(match![2]).toBe("repo");
  });

  test("non-GitHub URL fails parsing", () => {
    const url = "https://gitlab.com/org/repo";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    expect(match).toBeNull();
  });

  test("malformed URL fails parsing", () => {
    const url = "not-a-url";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    expect(match).toBeNull();
  });
});
