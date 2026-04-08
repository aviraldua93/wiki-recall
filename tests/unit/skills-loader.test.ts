/**
 * Unit tests for src/skills/loader.ts — skill loading
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { loadSkill, loadAllSkills, loadBuiltinSkill } from "../../src/skills/loader.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

function writeSkill(dir: string, name: string, frontmatter: Record<string, unknown>, content: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, "skill.md");
  writeFileSync(file, matter.stringify(content, frontmatter), "utf8");
}

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadSkill
// ---------------------------------------------------------------------------

describe("loadSkill", () => {
  test("loads a valid skill", () => {
    writeSkill(testDir, "test-skill", {
      name: "test-skill",
      description: "A test skill",
      version: "1.0.0",
      source: "root",
    }, "# Test Skill\n\n## When to Use\n\nUse this for testing.");

    const skill = loadSkill(join(testDir, "test-skill"));

    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill");
    expect(skill.version).toBe("1.0.0");
    expect(skill.source).toBe("root");
    expect(skill.content).toContain("When to Use");
  });

  test("throws if skill.md does not exist", () => {
    mkdirSync(join(testDir, "empty-skill"), { recursive: true });
    expect(() => loadSkill(join(testDir, "empty-skill"))).toThrow("not found");
  });

  test("throws if frontmatter is missing required fields", () => {
    const skillDir = join(testDir, "bad-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "skill.md"), "---\nname: bad\n---\n# Bad", "utf8");

    expect(() => loadSkill(skillDir)).toThrow("missing required fields");
  });
});

// ---------------------------------------------------------------------------
// loadAllSkills
// ---------------------------------------------------------------------------

describe("loadAllSkills", () => {
  test("loads all valid skills from a directory", () => {
    writeSkill(testDir, "skill-a", {
      name: "skill-a", description: "Skill A", version: "1.0.0", source: "root",
    }, "Content A");

    writeSkill(testDir, "skill-b", {
      name: "skill-b", description: "Skill B", version: "1.0.0", source: "team",
    }, "Content B");

    const skills = loadAllSkills(testDir);
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name).sort()).toEqual(["skill-a", "skill-b"]);
  });

  test("returns empty array for nonexistent directory", () => {
    const skills = loadAllSkills(join(testDir, "nonexistent"));
    expect(skills).toEqual([]);
  });

  test("skips directories without skill.md", () => {
    writeSkill(testDir, "valid-skill", {
      name: "valid-skill", description: "Valid", version: "1.0.0", source: "root",
    }, "Content");

    mkdirSync(join(testDir, "no-skill-file"), { recursive: true });

    const skills = loadAllSkills(testDir);
    expect(skills).toHaveLength(1);
  });

  test("skips invalid skills during bulk loading", () => {
    writeSkill(testDir, "valid-skill", {
      name: "valid-skill", description: "Valid", version: "1.0.0", source: "root",
    }, "Content");

    // Write an invalid skill (missing required frontmatter)
    const badDir = join(testDir, "bad-skill");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "skill.md"), "---\nname: bad\n---\n# Bad", "utf8");

    const skills = loadAllSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid-skill");
  });
});

// ---------------------------------------------------------------------------
// loadBuiltinSkill
// ---------------------------------------------------------------------------

describe("loadBuiltinSkill", () => {
  test("loads a built-in skill by name", () => {
    writeSkill(testDir, "code-review", {
      name: "code-review", description: "Code review", version: "1.0.0", source: "root",
    }, "Review content");

    const skill = loadBuiltinSkill("code-review", testDir);
    expect(skill.name).toBe("code-review");
  });

  test("throws if built-in skill does not exist", () => {
    expect(() => loadBuiltinSkill("nonexistent", testDir)).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// Integration: load real built-in skills
// ---------------------------------------------------------------------------

describe("load real built-in skills", () => {
  const builtinDir = join(process.cwd(), "skills");

  test("loads all 7 built-in skills", () => {
    const skills = loadAllSkills(builtinDir);
    expect(skills).toHaveLength(7);

    const names = skills.map(s => s.name).sort();
    expect(names).toEqual([
      "ci-monitor",
      "code-review",
      "multi-agent",
      "paper-curation",
      "pr-management",
      "research-loop",
      "session-management",
    ]);
  });

  test("all built-in skills have source: root", () => {
    const skills = loadAllSkills(builtinDir);
    for (const skill of skills) {
      expect(skill.source).toBe("root");
    }
  });

  test("all built-in skills have non-empty content", () => {
    const skills = loadAllSkills(builtinDir);
    for (const skill of skills) {
      expect(skill.content.length).toBeGreaterThan(100);
    }
  });
});
