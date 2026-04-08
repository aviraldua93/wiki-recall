/**
 * Scenario Manager — CRUD operations for WikiRecall scenarios.
 *
 * Handles creation, reading, updating, deletion, and listing of scenario
 * manifests stored as YAML files on disk.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import yaml from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "../config.js";
import type { Scenario } from "../types.js";
import scenarioSchema from "../../schemas/scenario.schema.json";

// ---------------------------------------------------------------------------
// Schema validator (singleton)
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateScenario = ajv.compile(scenarioSchema);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scenariosDir(): string {
  return join(getConfig().home, "scenarios");
}

function scenarioPath(name: string): string {
  const dir = resolve(scenariosDir());
  const resolved = resolve(join(dir, `${name}.yaml`));
  // Path traversal protection: use relative() to detect escape from scenarios directory
  const rel = relative(dir, resolved);
  if (rel.startsWith("..") || resolve(dir, rel) !== resolved) {
    throw new Error(`Invalid scenario name: path traversal detected`);
  }
  return resolved;
}

function ensureScenariosDir(): void {
  const dir = scenariosDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new scenario manifest on disk.
 *
 * Generates a UUID, sets status to 'active', and timestamps created_at/updated_at.
 * Throws if a scenario with the same name already exists or if the
 * manifest fails schema validation.
 */
export function createScenario(scenario: Scenario): Scenario {
  const now = new Date().toISOString();
  const enriched: Scenario = {
    ...scenario,
    id: scenario.id ?? uuidv4(),
    status: scenario.status ?? "active",
    created_at: scenario.created_at ?? now,
    updated_at: scenario.updated_at ?? now,
  };

  const valid = validateScenario(enriched);
  if (!valid) {
    const errors = validateScenario.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Invalid scenario: ${errors}`);
  }

  ensureScenariosDir();
  const filePath = scenarioPath(enriched.name);

  if (existsSync(filePath)) {
    throw new Error(`Scenario '${enriched.name}' already exists`);
  }

  const content = yaml.dump(enriched, { lineWidth: -1 });
  writeFileSync(filePath, content, "utf8");
  return enriched;
}

/**
 * Read a scenario manifest from disk by name.
 * Validates against the JSON Schema on read.
 * Throws if the scenario does not exist or fails validation.
 */
export function getScenario(name: string): Scenario {
  const filePath = scenarioPath(name);
  if (!existsSync(filePath)) {
    throw new Error(`Scenario '${name}' not found`);
  }

  const content = readFileSync(filePath, "utf8");
  const scenario = yaml.load(content) as Scenario;

  const valid = validateScenario(scenario);
  if (!valid) {
    const errors = validateScenario.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Scenario '${name}' failed validation on read: ${errors}`);
  }

  return scenario;
}

/**
 * Update an existing scenario manifest.
 * Updates the updated_at timestamp automatically.
 * Throws if the scenario does not exist or if the update fails validation.
 */
export function updateScenario(name: string, updates: Partial<Scenario>): Scenario {
  const existing = getScenario(name);
  const updated: Scenario = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  // If name changed, we need to handle the rename
  if (updates.name && updates.name !== name) {
    throw new Error("Cannot rename a scenario — create a new one instead");
  }

  const valid = validateScenario(updated);
  if (!valid) {
    const errors = validateScenario.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Invalid scenario update: ${errors}`);
  }

  const content = yaml.dump(updated, { lineWidth: -1 });
  writeFileSync(scenarioPath(name), content, "utf8");
  return updated;
}

/**
 * Delete a scenario manifest from disk.
 * Throws if the scenario does not exist.
 */
export function deleteScenario(name: string): void {
  const filePath = scenarioPath(name);
  if (!existsSync(filePath)) {
    throw new Error(`Scenario '${name}' not found`);
  }
  rmSync(filePath);
}

/**
 * List all scenario manifests in the scenarios directory.
 * Returns an empty array if the directory does not exist.
 * Skips files that fail schema validation to handle corrupt/incompatible files gracefully.
 */
export function listScenarios(): Scenario[] {
  const dir = scenariosDir();
  if (!existsSync(dir)) return [];

  const scenarios: Scenario[] = [];

  for (const f of readdirSync(dir).filter(f => f.endsWith(".yaml"))) {
    try {
      const content = readFileSync(join(dir, f), "utf8");
      const raw = yaml.load(content);
      if (validateScenario(raw)) {
        scenarios.push(raw as unknown as Scenario);
      }
    } catch {
      // Skip corrupt or unreadable scenario files
    }
  }

  return scenarios;
}

/**
 * Validate a scenario object against the JSON Schema.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateScenarioManifest(scenario: unknown): { valid: boolean; errors?: string[] } {
  const valid = validateScenario(scenario);
  if (valid) return { valid: true };

  const errors = validateScenario.errors?.map(e => `${e.instancePath || "/"} ${e.message}`) ?? [];
  return { valid: false, errors };
}
