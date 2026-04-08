/**
 * L0 Identity — always-loaded identity layer (~50 tokens).
 *
 * Reads/writes identity from a YAML file. The identity is the cheapest
 * layer and is always included in every memory response.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import yaml from "js-yaml";
import { createLogger } from "../../logger.js";
import type { L0Identity } from "../types.js";

const logger = createLogger("memory:l0");

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load identity from a YAML file.
 * Throws if the file does not exist or is malformed.
 */
export function loadIdentity(configPath: string): L0Identity {
  if (!existsSync(configPath)) {
    throw new Error(`Identity file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf8");
  const data = yaml.load(raw) as Record<string, unknown>;

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid identity file: expected YAML object`);
  }

  const identity: L0Identity = {
    name: typeof data.name === "string" ? data.name : "",
    roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
    accounts: Array.isArray(data.accounts)
      ? data.accounts.map((a: Record<string, unknown>) => ({
          platform: String(a.platform ?? ""),
          username: String(a.username ?? ""),
        }))
      : [],
    coreContext: typeof data.coreContext === "string" ? data.coreContext : "",
  };

  logger.debug({ path: configPath }, "Loaded identity");
  return identity;
}

// ---------------------------------------------------------------------------
// Generate prompt
// ---------------------------------------------------------------------------

/**
 * Generate a compact system prompt from the identity (~50 tokens).
 */
export function generateIdentityPrompt(identity: L0Identity): string {
  const parts: string[] = [];

  if (identity.name) {
    parts.push(`User: ${identity.name}`);
  }

  if (identity.roles.length > 0) {
    parts.push(`Roles: ${identity.roles.join(", ")}`);
  }

  if (identity.accounts.length > 0) {
    const accts = identity.accounts
      .map(a => `${a.platform}:${a.username}`)
      .join(", ");
    parts.push(`Accounts: ${accts}`);
  }

  if (identity.coreContext) {
    parts.push(identity.coreContext);
  }

  return parts.join(". ") + (parts.length > 0 ? "." : "");
}

// ---------------------------------------------------------------------------
// Create default
// ---------------------------------------------------------------------------

/**
 * Scaffold a blank identity with the given name.
 */
export function createDefaultIdentity(name: string): L0Identity {
  return {
    name,
    roles: ["Software Engineer"],
    accounts: [],
    coreContext: "",
  };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save an identity to a YAML file.
 */
export function saveIdentity(identity: L0Identity, path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = yaml.dump(identity, { lineWidth: 120, noRefs: true });
  writeFileSync(path, content, "utf8");
  logger.debug({ path }, "Saved identity");
}
