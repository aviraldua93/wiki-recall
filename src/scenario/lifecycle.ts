/**
 * Scenario Lifecycle — state transition management for DevContext scenarios.
 *
 * Enforces valid state transitions between active, paused, handed-off, and archived.
 * Provides save/recall for capturing and restoring scenario context.
 */

import type { ScenarioStatus, ScenarioContext, Scenario } from "../types.js";
import { getScenario, updateScenario, validateScenarioManifest } from "./manager.js";

// ---------------------------------------------------------------------------
// Valid state transition map
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ScenarioStatus, ScenarioStatus[]> = {
  active: ["paused", "handed-off", "archived"],
  paused: ["active", "archived"],
  "handed-off": ["active", "archived"],
  archived: [], // terminal state — no transitions out
};

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: ScenarioStatus, to: ScenarioStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the list of valid target states for a given status.
 */
export function getValidTransitions(status: ScenarioStatus): ScenarioStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

/**
 * Transition a scenario to a new lifecycle state.
 * Throws if the transition is not valid.
 */
export function transitionScenario(name: string, newStatus: ScenarioStatus): Scenario {
  const scenario = getScenario(name);
  const currentStatus = scenario.status;

  if (!isValidTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid transition: cannot move from '${currentStatus}' to '${newStatus}'. ` +
      `Valid transitions from '${currentStatus}': ${getValidTransitions(currentStatus).join(", ") || "none"}`
    );
  }

  return updateScenario(name, { status: newStatus });
}

/**
 * Activate a paused or handed-off scenario (transition to active).
 */
export function activateScenario(name: string): Scenario {
  return transitionScenario(name, "active");
}

/**
 * Pause an active scenario.
 */
export function pauseScenario(name: string): Scenario {
  return transitionScenario(name, "paused");
}

/**
 * Resume a paused or handed-off scenario (alias for activateScenario).
 */
export function resumeScenario(name: string): Scenario {
  return activateScenario(name);
}

/**
 * Hand off a scenario to another engineer.
 */
export function handoffScenario(name: string): Scenario {
  return transitionScenario(name, "handed-off");
}

/**
 * Archive a scenario (terminal state).
 */
export function archiveScenario(name: string): Scenario {
  return transitionScenario(name, "archived");
}

/**
 * Save a scenario's current context.
 *
 * Captures context (summary, open_prs, next_steps, blockers, notes) and
 * updates the manifest with a new updated_at timestamp.
 */
export function saveScenario(
  name: string,
  context: ScenarioContext,
): Scenario {
  return updateScenario(name, { context });
}

/**
 * Recall a scenario — reads the manifest, validates it, and returns
 * the full scenario state ready for CLI consumption.
 *
 * Throws if the scenario does not exist or fails schema validation.
 */
export function recallScenario(name: string): Scenario {
  const scenario = getScenario(name);

  const validation = validateScenarioManifest(scenario);
  if (!validation.valid) {
    throw new Error(
      `Scenario '${name}' failed validation on recall: ${validation.errors?.join("; ")}`
    );
  }

  return scenario;
}
