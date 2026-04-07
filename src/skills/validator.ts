/**
 * Skills Validator — validates skill Markdown files for correctness.
 *
 * Checks that skills have valid frontmatter, required sections, and
 * conform to the expected format.
 */

import type { SkillSource } from "../types.js";
import type { LoadedSkill } from "./loader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

const VALID_SOURCES: SkillSource[] = ["root", "team", "personal"];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Validate a loaded skill for correctness.
 */
export function validateSkill(skill: LoadedSkill): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate name
  if (!skill.name) {
    errors.push("Skill name is required");
  } else if (!NAME_PATTERN.test(skill.name)) {
    errors.push(`Skill name '${skill.name}' must be kebab-case (lowercase alphanumeric with hyphens)`);
  }

  // Validate description
  if (!skill.description) {
    errors.push("Skill description is required");
  } else if (skill.description.length > 500) {
    errors.push("Skill description must be 500 characters or less");
  }

  // Validate version
  if (!skill.version) {
    errors.push("Skill version is required");
  } else if (!VERSION_PATTERN.test(skill.version)) {
    errors.push(`Skill version '${skill.version}' must be semantic (e.g., '1.0.0')`);
  }

  // Validate source
  if (!skill.source) {
    errors.push("Skill source is required");
  } else if (!VALID_SOURCES.includes(skill.source)) {
    errors.push(`Skill source '${skill.source}' must be one of: ${VALID_SOURCES.join(", ")}`);
  }

  // Validate content exists
  if (!skill.content || skill.content.trim().length === 0) {
    errors.push("Skill must have non-empty content");
  }

  // Check for required sections
  if (skill.content) {
    const content = skill.content;
    if (!content.includes("## When to Use") && !content.includes("## when to use")) {
      warnings.push("Skill is missing a '## When to Use' section");
    }
    if (!content.includes("## How to Execute") && !content.includes("## how to execute")) {
      warnings.push("Skill is missing a '## How to Execute' section");
    }
    if (!content.includes("## Expected Outputs") && !content.includes("## expected outputs")) {
      warnings.push("Skill is missing an '## Expected Outputs' section");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate multiple skills and return results for each.
 */
export function validateAllSkills(skills: LoadedSkill[]): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();
  for (const skill of skills) {
    results.set(skill.name, validateSkill(skill));
  }
  return results;
}
