/**
 * Unit tests for src/skills/validator.ts — skill validation
 */

import { describe, test, expect } from "bun:test";
import { validateSkill, validateAllSkills } from "../../src/skills/validator.js";
import type { LoadedSkill } from "../../src/skills/loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: "test-skill",
    description: "A valid test skill",
    version: "1.0.0",
    source: "root",
    content: `# Test Skill

## When to Use

Use this skill for testing.

## How to Execute

Follow these steps.

## Expected Outputs

Produces test results.`,
    filePath: "/path/to/skill.md",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateSkill
// ---------------------------------------------------------------------------

describe("validateSkill", () => {
  test("validates a correct skill", () => {
    const result = validateSkill(validSkill());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects missing name", () => {
    const result = validateSkill(validSkill({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("name"))).toBe(true);
  });

  test("rejects non-kebab-case name", () => {
    const result = validateSkill(validSkill({ name: "BadName" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("kebab-case"))).toBe(true);
  });

  test("rejects missing description", () => {
    const result = validateSkill(validSkill({ description: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("description"))).toBe(true);
  });

  test("rejects too-long description", () => {
    const result = validateSkill(validSkill({ description: "x".repeat(501) }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("500"))).toBe(true);
  });

  test("rejects missing version", () => {
    const result = validateSkill(validSkill({ version: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("version"))).toBe(true);
  });

  test("rejects invalid version format", () => {
    const result = validateSkill(validSkill({ version: "abc" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("semantic"))).toBe(true);
  });

  test("rejects invalid source", () => {
    const result = validateSkill(validSkill({ source: "invalid" as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("source"))).toBe(true);
  });

  test("rejects empty content", () => {
    const result = validateSkill(validSkill({ content: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("content"))).toBe(true);
  });

  test("warns about missing 'When to Use' section", () => {
    const result = validateSkill(validSkill({
      content: "# Skill\n\n## How to Execute\n\nSteps.\n\n## Expected Outputs\n\nResults.",
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("When to Use"))).toBe(true);
  });

  test("warns about missing 'How to Execute' section", () => {
    const result = validateSkill(validSkill({
      content: "# Skill\n\n## When to Use\n\nUse this.\n\n## Expected Outputs\n\nResults.",
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("How to Execute"))).toBe(true);
  });

  test("warns about missing 'Expected Outputs' section", () => {
    const result = validateSkill(validSkill({
      content: "# Skill\n\n## When to Use\n\nUse this.\n\n## How to Execute\n\nSteps.",
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("Expected Outputs"))).toBe(true);
  });

  test("accepts all valid source types", () => {
    for (const source of ["root", "team", "personal"] as const) {
      const result = validateSkill(validSkill({ source }));
      expect(result.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAllSkills
// ---------------------------------------------------------------------------

describe("validateAllSkills", () => {
  test("validates multiple skills", () => {
    const skills = [
      validSkill({ name: "skill-a" }),
      validSkill({ name: "skill-b" }),
    ];

    const results = validateAllSkills(skills);
    expect(results.size).toBe(2);
    expect(results.get("skill-a")?.valid).toBe(true);
    expect(results.get("skill-b")?.valid).toBe(true);
  });

  test("reports individual skill failures", () => {
    const skills = [
      validSkill({ name: "good-skill" }),
      validSkill({ name: "", description: "" }),
    ];

    const results = validateAllSkills(skills);
    expect(results.get("good-skill")?.valid).toBe(true);
    expect(results.get("")?.valid).toBe(false);
  });
});
