/**
 * Unit tests for src/skills/promotion.ts — skill promotion pipeline
 */

import { describe, test, expect } from "bun:test";
import {
  isValidPromotion,
  getNextPromotionTarget,
  getPromotionLevel,
  promoteSkill,
  checkPromotionRequirements,
} from "../../src/skills/promotion.js";
import type { LoadedSkill } from "../../src/skills/loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: "test-skill",
    description: "A promotable test skill",
    version: "1.0.0",
    source: "personal",
    content: `# Test Skill

## When to Use

Use this skill for testing purposes when you need to validate promotion logic.

## How to Execute

Follow these comprehensive steps to execute the skill properly and thoroughly.

## Expected Outputs

The skill produces validated test results confirming promotion requirements.`,
    filePath: "/path/to/skill.md",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isValidPromotion
// ---------------------------------------------------------------------------

describe("isValidPromotion", () => {
  test("personal → team is valid", () => {
    expect(isValidPromotion("personal", "team")).toBe(true);
  });

  test("team → root is valid", () => {
    expect(isValidPromotion("team", "root")).toBe(true);
  });

  test("personal → root is invalid (skip level)", () => {
    expect(isValidPromotion("personal", "root")).toBe(false);
  });

  test("root → team is invalid (demotion)", () => {
    expect(isValidPromotion("root", "team")).toBe(false);
  });

  test("root → personal is invalid (demotion)", () => {
    expect(isValidPromotion("root", "personal")).toBe(false);
  });

  test("same level is invalid", () => {
    expect(isValidPromotion("personal", "personal")).toBe(false);
    expect(isValidPromotion("team", "team")).toBe(false);
    expect(isValidPromotion("root", "root")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getNextPromotionTarget
// ---------------------------------------------------------------------------

describe("getNextPromotionTarget", () => {
  test("personal promotes to team", () => {
    expect(getNextPromotionTarget("personal")).toBe("team");
  });

  test("team promotes to root", () => {
    expect(getNextPromotionTarget("team")).toBe("root");
  });

  test("root has no promotion target", () => {
    expect(getNextPromotionTarget("root")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPromotionLevel
// ---------------------------------------------------------------------------

describe("getPromotionLevel", () => {
  test("personal is level 0", () => {
    expect(getPromotionLevel("personal")).toBe(0);
  });

  test("team is level 1", () => {
    expect(getPromotionLevel("team")).toBe(1);
  });

  test("root is level 2", () => {
    expect(getPromotionLevel("root")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// promoteSkill
// ---------------------------------------------------------------------------

describe("promoteSkill", () => {
  test("promotes personal skill to team", () => {
    const promoted = promoteSkill(validSkill({ source: "personal" }));
    expect(promoted.source).toBe("team");
  });

  test("promotes team skill to root", () => {
    const promoted = promoteSkill(validSkill({ source: "team" }));
    expect(promoted.source).toBe("root");
  });

  test("throws when promoting root skill", () => {
    expect(() => promoteSkill(validSkill({ source: "root" }))).toThrow("already at highest level");
  });

  test("throws when skill validation fails", () => {
    expect(() => promoteSkill(validSkill({ name: "", source: "personal" }))).toThrow("validation failed");
  });

  test("preserves other skill properties after promotion", () => {
    const original = validSkill({ source: "personal", description: "My Skill" });
    const promoted = promoteSkill(original);

    expect(promoted.name).toBe(original.name);
    expect(promoted.description).toBe(original.description);
    expect(promoted.version).toBe(original.version);
    expect(promoted.content).toBe(original.content);
  });
});

// ---------------------------------------------------------------------------
// checkPromotionRequirements
// ---------------------------------------------------------------------------

describe("checkPromotionRequirements", () => {
  test("returns no issues for a valid skill", () => {
    const issues = checkPromotionRequirements(validSkill({ source: "personal" }));
    expect(issues).toEqual([]);
  });

  test("reports already at highest level", () => {
    const issues = checkPromotionRequirements(validSkill({ source: "root" }));
    expect(issues.some(i => i.includes("highest level"))).toBe(true);
  });

  test("reports validation errors", () => {
    const issues = checkPromotionRequirements(validSkill({ name: "", source: "personal" }));
    expect(issues.some(i => i.includes("Validation"))).toBe(true);
  });

  test("reports short content for team/root promotion", () => {
    const issues = checkPromotionRequirements(validSkill({
      source: "personal",
      content: "Short",
    }));
    expect(issues.some(i => i.includes("too short"))).toBe(true);
  });
});
