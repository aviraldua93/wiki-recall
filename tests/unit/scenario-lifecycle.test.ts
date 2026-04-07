/**
 * Unit tests for src/scenario/lifecycle.ts — state transitions
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { createScenario } from "../../src/scenario/manager.js";
import {
  isValidTransition,
  getValidTransitions,
  transitionScenario,
  activateScenario,
  pauseScenario,
  resumeScenario,
  handoffScenario,
  archiveScenario,
  saveScenario,
  recallScenario,
} from "../../src/scenario/lifecycle.js";
import type { Scenario, ScenarioStatus } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function validScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "lifecycle-test",
    version: "0.1.0",
    status: "active",
    description: "Lifecycle test scenario",
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// isValidTransition
// ---------------------------------------------------------------------------

describe("isValidTransition", () => {
  test("active → paused is valid", () => {
    expect(isValidTransition("active", "paused")).toBe(true);
  });

  test("active → handed-off is valid", () => {
    expect(isValidTransition("active", "handed-off")).toBe(true);
  });

  test("active → archived is valid", () => {
    expect(isValidTransition("active", "archived")).toBe(true);
  });

  test("paused → active is valid", () => {
    expect(isValidTransition("paused", "active")).toBe(true);
  });

  test("paused → archived is valid", () => {
    expect(isValidTransition("paused", "archived")).toBe(true);
  });

  test("handed-off → active is valid", () => {
    expect(isValidTransition("handed-off", "active")).toBe(true);
  });

  test("handed-off → archived is valid", () => {
    expect(isValidTransition("handed-off", "archived")).toBe(true);
  });

  // Invalid transitions
  test("archived → active is invalid", () => {
    expect(isValidTransition("archived", "active")).toBe(false);
  });

  test("archived → paused is invalid", () => {
    expect(isValidTransition("archived", "paused")).toBe(false);
  });

  test("paused → handed-off is invalid", () => {
    expect(isValidTransition("paused", "handed-off")).toBe(false);
  });

  test("same state transition is invalid", () => {
    expect(isValidTransition("active", "active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getValidTransitions
// ---------------------------------------------------------------------------

describe("getValidTransitions", () => {
  test("active has 3 valid transitions", () => {
    const transitions = getValidTransitions("active");
    expect(transitions).toEqual(["paused", "handed-off", "archived"]);
  });

  test("paused has 2 valid transitions", () => {
    const transitions = getValidTransitions("paused");
    expect(transitions).toEqual(["active", "archived"]);
  });

  test("handed-off has 2 valid transitions", () => {
    const transitions = getValidTransitions("handed-off");
    expect(transitions).toEqual(["active", "archived"]);
  });

  test("archived has no valid transitions", () => {
    const transitions = getValidTransitions("archived");
    expect(transitions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// transitionScenario
// ---------------------------------------------------------------------------

describe("transitionScenario", () => {
  test("transitions active scenario to paused", () => {
    createScenario(validScenario());
    const result = transitionScenario("lifecycle-test", "paused");
    expect(result.status).toBe("paused");
  });

  test("throws on invalid transition (archived → active)", () => {
    createScenario(validScenario({ status: "archived" }));
    expect(() => transitionScenario("lifecycle-test", "active")).toThrow("Invalid transition");
  });

  test("throws if scenario does not exist", () => {
    expect(() => transitionScenario("nonexistent", "paused")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

describe("convenience lifecycle functions", () => {
  test("pauseScenario transitions to paused", () => {
    createScenario(validScenario());
    const result = pauseScenario("lifecycle-test");
    expect(result.status).toBe("paused");
  });

  test("resumeScenario transitions paused to active", () => {
    createScenario(validScenario({ status: "paused" }));
    const result = resumeScenario("lifecycle-test");
    expect(result.status).toBe("active");
  });

  test("resumeScenario transitions handed-off to active", () => {
    createScenario(validScenario({ status: "handed-off" }));
    const result = resumeScenario("lifecycle-test");
    expect(result.status).toBe("active");
  });

  test("handoffScenario transitions to handed-off", () => {
    createScenario(validScenario());
    const result = handoffScenario("lifecycle-test");
    expect(result.status).toBe("handed-off");
  });

  test("archiveScenario transitions active to archived", () => {
    createScenario(validScenario());
    const result = archiveScenario("lifecycle-test");
    expect(result.status).toBe("archived");
  });

  test("archiveScenario transitions paused to archived", () => {
    createScenario(validScenario({ status: "paused" }));
    const result = archiveScenario("lifecycle-test");
    expect(result.status).toBe("archived");
  });

  test("activateScenario transitions paused to active", () => {
    createScenario(validScenario({ status: "paused" }));
    const result = activateScenario("lifecycle-test");
    expect(result.status).toBe("active");
  });

  test("activateScenario transitions handed-off to active", () => {
    createScenario(validScenario({ status: "handed-off" }));
    const result = activateScenario("lifecycle-test");
    expect(result.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// saveScenario / recallScenario
// ---------------------------------------------------------------------------

describe("saveScenario", () => {
  test("saves context and updates timestamp", () => {
    createScenario(validScenario());
    const result = saveScenario("lifecycle-test", {
      summary: "Implemented retry logic",
      open_prs: ["repo#42"],
      next_steps: ["Write tests"],
      blockers: [],
      notes: "Using exponential backoff",
    });

    expect(result.context?.summary).toBe("Implemented retry logic");
    expect(result.context?.open_prs).toEqual(["repo#42"]);
    expect(result.context?.next_steps).toEqual(["Write tests"]);
    expect(result.updated_at).toBeDefined();
  });

  test("throws if scenario does not exist", () => {
    expect(() => saveScenario("nonexistent", { summary: "test" })).toThrow("not found");
  });
});

describe("recallScenario", () => {
  test("reads and validates a scenario", () => {
    createScenario(validScenario({
      context: { summary: "Working on feature X" },
    }));
    const result = recallScenario("lifecycle-test");

    expect(result.name).toBe("lifecycle-test");
    expect(result.status).toBe("active");
    expect(result.context?.summary).toBe("Working on feature X");
  });

  test("throws if scenario does not exist", () => {
    expect(() => recallScenario("nonexistent")).toThrow("not found");
  });
});
