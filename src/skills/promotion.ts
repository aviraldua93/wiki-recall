/**
 * Skills Promotion — pipeline for promoting skills between layers.
 *
 * Skills flow through: personal → team → root
 * Each promotion requires validation at the target level.
 */

import type { SkillSource } from "../types.js";
import type { LoadedSkill } from "./loader.js";
import { validateSkill } from "./validator.js";

// ---------------------------------------------------------------------------
// Promotion pipeline
// ---------------------------------------------------------------------------

const PROMOTION_ORDER: SkillSource[] = ["personal", "team", "root"];

/**
 * Check if a promotion from one source to another is valid.
 * Promotions must follow: personal → team → root
 */
export function isValidPromotion(from: SkillSource, to: SkillSource): boolean {
  const fromIndex = PROMOTION_ORDER.indexOf(from);
  const toIndex = PROMOTION_ORDER.indexOf(to);
  // Can only promote one level at a time, moving up
  return fromIndex >= 0 && toIndex >= 0 && toIndex === fromIndex + 1;
}

/**
 * Get the next promotion target for a skill source.
 * Returns undefined if the skill is already at root level.
 */
export function getNextPromotionTarget(source: SkillSource): SkillSource | undefined {
  const index = PROMOTION_ORDER.indexOf(source);
  if (index < 0 || index >= PROMOTION_ORDER.length - 1) return undefined;
  return PROMOTION_ORDER[index + 1];
}

/**
 * Get the promotion level (0 = personal, 1 = team, 2 = root).
 */
export function getPromotionLevel(source: SkillSource): number {
  return PROMOTION_ORDER.indexOf(source);
}

/**
 * Attempt to promote a skill to the next level.
 * Returns the promoted skill data or throws if promotion is invalid.
 */
export function promoteSkill(skill: LoadedSkill): LoadedSkill {
  const validation = validateSkill(skill);
  if (!validation.valid) {
    throw new Error(
      `Cannot promote skill '${skill.name}': validation failed — ${validation.errors.join("; ")}`
    );
  }

  const nextSource = getNextPromotionTarget(skill.source);
  if (!nextSource) {
    throw new Error(
      `Cannot promote skill '${skill.name}': already at highest level (${skill.source})`
    );
  }

  return {
    ...skill,
    source: nextSource,
  };
}

/**
 * Check if a skill meets the requirements for promotion.
 * Returns a list of requirements that are not met.
 */
export function checkPromotionRequirements(skill: LoadedSkill): string[] {
  const issues: string[] = [];

  // Must pass validation
  const validation = validateSkill(skill);
  if (!validation.valid) {
    issues.push(...validation.errors.map(e => `Validation: ${e}`));
  }

  // Must have a promotion target
  const nextSource = getNextPromotionTarget(skill.source);
  if (!nextSource) {
    issues.push(`Already at highest level (${skill.source})`);
  }

  // Content quality checks for team and root promotion
  if (nextSource === "team" || nextSource === "root") {
    if (skill.content.length < 200) {
      issues.push("Content is too short for promotion (minimum 200 characters)");
    }
    if (validation.warnings.length > 0) {
      issues.push(...validation.warnings.map(w => `Warning: ${w}`));
    }
  }

  return issues;
}
