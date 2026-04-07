/**
 * Mock Git Provider — simulates git operations for testing.
 *
 * Returns configurable, deterministic results without touching the
 * file system or network. Zero external dependencies.
 */

import type { GitResult, GitProvider } from "./git.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockGitCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

export interface MockGitProviderOptions {
  /** Default result for all operations (default: success). */
  defaultResult?: GitResult;
  /** Per-method overrides. Key is the method name. */
  methodResults?: Record<string, GitResult>;
  /** If true, all operations will fail. */
  shouldFail?: boolean;
  /** Error message when shouldFail is true. */
  failMessage?: string;
  /** Artificial delay in milliseconds. */
  delay?: number;
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

/**
 * Create a mock git provider for testing.
 *
 * Tracks all calls in a `calls` array for assertions and returns
 * configurable results.
 */
export function createMockGitProvider(options: MockGitProviderOptions = {}): GitProvider & { calls: MockGitCall[]; reset(): void } {
  const {
    defaultResult = { ok: true, stdout: "mock: ok", stderr: "" },
    methodResults = {},
    shouldFail = false,
    failMessage = "Mock git failure",
    delay = 0,
  } = options;

  const calls: MockGitCall[] = [];

  function record(method: string, args: unknown[]): void {
    calls.push({ method, args, timestamp: Date.now() });
  }

  async function getResult(method: string): Promise<GitResult> {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (shouldFail) {
      return { ok: false, stdout: "", stderr: failMessage };
    }

    return methodResults[method] ?? defaultResult;
  }

  return {
    calls,

    reset(): void {
      calls.length = 0;
    },

    async run(args: string[], cwd?: string): Promise<GitResult> {
      record("run", [args, cwd]);
      return getResult("run");
    },

    async pushScenario(scenarioName: string, repoUrl: string, branch = "main"): Promise<GitResult> {
      record("pushScenario", [scenarioName, repoUrl, branch]);
      return getResult("pushScenario");
    },

    async pullScenario(scenarioName: string, repoUrl: string, branch = "main"): Promise<GitResult> {
      record("pullScenario", [scenarioName, repoUrl, branch]);
      return getResult("pullScenario");
    },

    async cloneScenarioRepo(repoUrl: string, targetDir: string, branch = "main"): Promise<GitResult> {
      record("cloneScenarioRepo", [repoUrl, targetDir, branch]);
      return getResult("cloneScenarioRepo");
    },
  };
}
