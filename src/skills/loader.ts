/**
 * Skills Loader — loads skill Markdown files from the skills directory.
 *
 * Skills are Markdown files with YAML frontmatter stored in
 * skills/<skill-name>/skill.md. The loader reads, parses, and returns
 * structured skill data.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import { getConfig } from "../config.js";
import type { Scenario, Skill, SkillSource } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadedSkill {
  /** Skill identifier (directory name). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Semantic version. */
  version: string;
  /** Origin layer. */
  source: SkillSource;
  /** Raw Markdown content (body without frontmatter). */
  content: string;
  /** Full path to the skill file. */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Source directory resolution
// ---------------------------------------------------------------------------

/** Built-in skills ship with the package in the project root skills/ dir. */
function builtinSkillsDir(): string {
  return resolve(join(__dirname, "..", "..", "skills"));
}

/** Team skills live in DEVCONTEXT_HOME/skills/team/. */
function teamSkillsDir(): string {
  return join(getConfig().home, "skills", "team");
}

/** Personal skills live in DEVCONTEXT_HOME/skills/personal/. */
function personalSkillsDir(): string {
  return join(getConfig().home, "skills", "personal");
}

/**
 * Return the base directory for a given skill source layer.
 */
function dirForSource(source: SkillSource): string {
  switch (source) {
    case "root":
      return builtinSkillsDir();
    case "team":
      return teamSkillsDir();
    case "personal":
      return personalSkillsDir();
  }
}

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Load a single skill from a directory.
 * Expects a skill.md file in the given directory.
 */
export function loadSkillFromDir(skillDir: string): LoadedSkill {
  const skillFile = join(skillDir, "skill.md");

  if (!existsSync(skillFile)) {
    throw new Error(`Skill file not found: ${skillFile}`);
  }

  const raw = readFileSync(skillFile, "utf8");
  const parsed = matter(raw);

  const { name, description, version, source } = parsed.data;

  if (!name || !description || !version || !source) {
    throw new Error(
      `Invalid skill frontmatter in ${skillFile}: missing required fields (name, description, version, source)`
    );
  }

  return {
    name,
    description,
    version,
    source,
    content: parsed.content.trim(),
    filePath: skillFile,
  };
}

/**
 * Load a single skill from a directory (alias for loadSkillFromDir).
 * @deprecated Use loadSkill(name, source) or loadSkillFromDir(dir) instead.
 */
export function loadSkill(nameOrDir: string, source?: SkillSource): LoadedSkill {
  if (source) {
    // Called as loadSkill(name, source) — resolve to directory
    const baseDir = dirForSource(source);
    const skillDir = join(baseDir, nameOrDir);
    if (!existsSync(skillDir)) {
      throw new Error(`Skill '${nameOrDir}' not found in ${source} skills (${baseDir})`);
    }
    return loadSkillFromDir(skillDir);
  }
  // Called as loadSkill(dir) — backwards compatibility
  return loadSkillFromDir(nameOrDir);
}

/**
 * Load all skills from a root skills directory.
 * Each subdirectory should contain a skill.md file.
 */
export function loadAllSkills(rootDir: string): LoadedSkill[] {
  if (!existsSync(rootDir)) return [];

  const entries = readdirSync(rootDir);
  const skills: LoadedSkill[] = [];

  for (const entry of entries) {
    const entryPath = join(rootDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const skillFile = join(entryPath, "skill.md");
    if (!existsSync(skillFile)) continue;

    try {
      skills.push(loadSkillFromDir(entryPath));
    } catch {
      // Skip invalid skills during bulk loading
    }
  }

  return skills;
}

/**
 * Load a skill by name from the built-in skills directory.
 */
export function loadBuiltinSkill(name: string, builtinDir: string): LoadedSkill {
  const skillDir = join(builtinDir, name);
  if (!existsSync(skillDir)) {
    throw new Error(`Built-in skill '${name}' not found in ${builtinDir}`);
  }
  return loadSkillFromDir(skillDir);
}

// ---------------------------------------------------------------------------
// Scenario-level loading
// ---------------------------------------------------------------------------

/**
 * Search order for resolving a skill reference: the requested source first,
 * then fall back through the promotion chain (personal → team → root).
 */
const SOURCE_SEARCH_ORDER: Record<SkillSource, SkillSource[]> = {
  root: ["root"],
  team: ["team", "root"],
  personal: ["personal", "team", "root"],
};

/**
 * Resolve a single Skill reference to a LoadedSkill.
 * Searches the source's directory first, then falls back through the
 * promotion chain so that promoted skills are still discoverable.
 */
function resolveSkillRef(ref: Skill): LoadedSkill | undefined {
  const searchOrder = SOURCE_SEARCH_ORDER[ref.source] ?? [ref.source];

  for (const src of searchOrder) {
    const baseDir = dirForSource(src);
    const skillDir = join(baseDir, ref.name);
    if (existsSync(join(skillDir, "skill.md"))) {
      try {
        return loadSkillFromDir(skillDir);
      } catch {
        // Invalid file — try next source
      }
    }
  }

  return undefined;
}

/**
 * Load all skills referenced in a scenario manifest.
 *
 * Returns an array of LoadedSkill objects for every skill ref in the
 * scenario. Skills that cannot be resolved are silently skipped (the
 * caller can compare counts to detect missing skills).
 */
export function loadSkillsForScenario(scenario: Scenario): LoadedSkill[] {
  if (!scenario.skills || scenario.skills.length === 0) return [];

  const loaded: LoadedSkill[] = [];

  for (const ref of scenario.skills) {
    const skill = resolveSkillRef(ref);
    if (skill) {
      loaded.push(skill);
    }
  }

  return loaded;
}
