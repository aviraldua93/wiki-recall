/**
 * Unit tests for loadSkillsForScenario in src/skills/loader.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { loadSkillsForScenario } from "../../src/skills/loader.js";
import { resetConfig } from "../../src/config.js";
import type { Scenario } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Setup — use a temp DEVCONTEXT_HOME so loadSkillsForScenario can resolve
// personal/team skills, while built-in skills come from the real skills/ dir.
// ---------------------------------------------------------------------------

let testHome: string;
let origHome: string | undefined;

function writeSkill(dir: string, name: string, frontmatter: Record<string, unknown>, content: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, "skill.md");
  writeFileSync(file, matter.stringify(content, frontmatter), "utf8");
}

beforeEach(() => {
  testHome = join(tmpdir(), `devcontext-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  origHome = process.env.DEVCONTEXT_HOME;
  process.env.DEVCONTEXT_HOME = testHome;
  resetConfig();
});

afterEach(() => {
  if (origHome !== undefined) {
    process.env.DEVCONTEXT_HOME = origHome;
  } else {
    delete process.env.DEVCONTEXT_HOME;
  }
  resetConfig();
  if (existsSync(testHome)) {
    rmSync(testHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadSkillsForScenario
// ---------------------------------------------------------------------------

describe("loadSkillsForScenario", () => {
  test("returns empty array for scenario with no skills", () => {
    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
    };
    expect(loadSkillsForScenario(scenario)).toEqual([]);
  });

  test("returns empty array for scenario with empty skills list", () => {
    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [],
    };
    expect(loadSkillsForScenario(scenario)).toEqual([]);
  });

  test("loads built-in (root) skills from the real skills directory", () => {
    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "code-review", source: "root" },
        { name: "ci-monitor", source: "root" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(2);
    expect(loaded.map(s => s.name).sort()).toEqual(["ci-monitor", "code-review"]);
    expect(loaded[0].source).toBe("root");
  });

  test("loads personal skills from DEVCONTEXT_HOME", () => {
    const personalDir = join(testHome, "skills", "personal");
    writeSkill(personalDir, "my-custom", {
      name: "my-custom",
      description: "Custom personal skill",
      version: "1.0.0",
      source: "personal",
    }, "# Custom\n\n## When to Use\n\nAlways.");

    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "my-custom", source: "personal" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("my-custom");
    expect(loaded[0].source).toBe("personal");
  });

  test("loads team skills from DEVCONTEXT_HOME", () => {
    const teamDir = join(testHome, "skills", "team");
    writeSkill(teamDir, "team-skill", {
      name: "team-skill",
      description: "Team skill",
      version: "1.0.0",
      source: "team",
    }, "# Team\n\n## When to Use\n\nDuring sprints.");

    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "team-skill", source: "team" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("team-skill");
  });

  test("skips skills that cannot be resolved", () => {
    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "code-review", source: "root" },
        { name: "nonexistent-skill", source: "personal" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("code-review");
  });

  test("falls back through promotion chain for team source", () => {
    // A skill referenced as team source but only exists as root should still load
    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "code-review", source: "team" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("code-review");
  });

  test("loads a mix of root and personal skills", () => {
    const personalDir = join(testHome, "skills", "personal");
    writeSkill(personalDir, "my-helper", {
      name: "my-helper",
      description: "A helper",
      version: "1.0.0",
      source: "personal",
    }, "# Helper content");

    const scenario: Scenario = {
      name: "test",
      version: "0.1.0",
      status: "active",
      description: "test scenario",
      skills: [
        { name: "code-review", source: "root" },
        { name: "my-helper", source: "personal" },
      ],
    };

    const loaded = loadSkillsForScenario(scenario);
    expect(loaded).toHaveLength(2);
    const names = loaded.map(s => s.name).sort();
    expect(names).toEqual(["code-review", "my-helper"]);
  });
});
