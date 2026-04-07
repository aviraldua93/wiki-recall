/**
 * Environment-based configuration for DevContext.
 *
 * Reads from environment variables with sensible defaults. No external
 * config files — keep it simple and twelve-factor friendly.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config interface
// ---------------------------------------------------------------------------

export interface DevContextConfig {
  /** Root directory for DevContext data (scenarios, knowledge, skills). */
  home: string;
  /** Pino log level. */
  logLevel: string;
  /** GitHub personal access token for sync operations (optional). */
  githubToken: string | undefined;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HOME = join(homedir(), ".devcontext");
const DEFAULT_LOG_LEVEL = "info";

// ---------------------------------------------------------------------------
// getConfig — singleton accessor
// ---------------------------------------------------------------------------

let _config: DevContextConfig | undefined;

/**
 * Returns the resolved DevContext configuration.
 *
 * Reads the following environment variables:
 *  - `DEVCONTEXT_HOME`      — Root data directory (default: ~/.devcontext)
 *  - `DEVCONTEXT_LOG_LEVEL` — Log level (default: "info")
 *  - `GITHUB_TOKEN`         — GitHub PAT for sync (optional)
 *
 * The result is cached after the first call.
 */
export function getConfig(): DevContextConfig {
  if (_config) return _config;

  _config = {
    home: process.env.DEVCONTEXT_HOME ?? DEFAULT_HOME,
    logLevel: process.env.DEVCONTEXT_LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    githubToken: process.env.GITHUB_TOKEN,
  };

  return _config;
}

/**
 * Reset the cached config — useful for tests that manipulate env vars.
 */
export function resetConfig(): void {
  _config = undefined;
}
