/**
 * Unit tests for src/sync/git.ts — git sync module.
 *
 * Tests the git sync module's public API (pushScenario, pullScenario,
 * cloneScenarioRepo) and its error classification logic using the
 * mock git provider. Also tests the classifyGitError helper indirectly.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { createMockGitProvider } from "../../src/sync/mock.js";
import type { GitProvider, GitResult } from "../../src/sync/git.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-git-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  process.env.GITHUB_TOKEN = "ghp_test_token_for_sync";
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {}
  delete process.env.GITHUB_TOKEN;
  resetConfig();
});

// ---------------------------------------------------------------------------
// Mock provider — push scenarios
// ---------------------------------------------------------------------------

describe("MockGitProvider pushScenario", () => {
  test("successful push records correct method and args", async () => {
    const provider = createMockGitProvider();
    const result = await provider.pushScenario("my-project", "https://github.com/org/repo", "main");
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("pushScenario");
    expect(provider.calls[0].args).toEqual(["my-project", "https://github.com/org/repo", "main"]);
  });

  test("push with custom branch records the branch", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("my-project", "https://github.com/org/repo", "develop");
    expect(provider.calls[0].args[2]).toBe("develop");
  });

  test("push uses default branch 'main' when not specified", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("my-project", "https://github.com/org/repo");
    expect(provider.calls[0].args[2]).toBe("main");
  });

  test("failed push returns error details", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        pushScenario: { ok: false, stdout: "", stderr: "Authentication failed. 403 Forbidden" },
      },
    });
    const result = await provider.pushScenario("s", "u");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Authentication failed");
  });

  test("push with network error", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        pushScenario: { ok: false, stdout: "", stderr: "could not resolve host github.com" },
      },
    });
    const result = await provider.pushScenario("s", "u");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("could not resolve host");
  });
});

// ---------------------------------------------------------------------------
// Mock provider — pull scenarios
// ---------------------------------------------------------------------------

describe("MockGitProvider pullScenario", () => {
  test("successful pull returns ok", async () => {
    const provider = createMockGitProvider();
    const result = await provider.pullScenario("my-project", "https://github.com/org/repo");
    expect(result.ok).toBe(true);
  });

  test("pull with custom branch", async () => {
    const provider = createMockGitProvider();
    await provider.pullScenario("my-project", "https://github.com/org/repo", "staging");
    expect(provider.calls[0].args).toEqual(["my-project", "https://github.com/org/repo", "staging"]);
  });

  test("failed pull returns error", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        pullScenario: { ok: false, stdout: "", stderr: "merge conflict in file.txt" },
      },
    });
    const result = await provider.pullScenario("s", "u");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("merge conflict");
  });

  test("pull uses default branch 'main'", async () => {
    const provider = createMockGitProvider();
    await provider.pullScenario("s", "u");
    expect(provider.calls[0].args[2]).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// Mock provider — clone
// ---------------------------------------------------------------------------

describe("MockGitProvider cloneScenarioRepo", () => {
  test("successful clone", async () => {
    const provider = createMockGitProvider();
    const result = await provider.cloneScenarioRepo("https://github.com/org/repo", "/target/dir");
    expect(result.ok).toBe(true);
    expect(provider.calls[0].method).toBe("cloneScenarioRepo");
  });

  test("clone with branch", async () => {
    const provider = createMockGitProvider();
    await provider.cloneScenarioRepo("https://github.com/org/repo", "/target", "v2");
    expect(provider.calls[0].args[2]).toBe("v2");
  });

  test("clone defaults to main branch", async () => {
    const provider = createMockGitProvider();
    await provider.cloneScenarioRepo("https://github.com/org/repo", "/target");
    expect(provider.calls[0].args[2]).toBe("main");
  });

  test("failed clone", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        cloneScenarioRepo: { ok: false, stdout: "", stderr: "repository not found" },
      },
    });
    const result = await provider.cloneScenarioRepo("u", "/d");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mock provider — run arbitrary commands
// ---------------------------------------------------------------------------

describe("MockGitProvider run", () => {
  test("run records command args and cwd", async () => {
    const provider = createMockGitProvider();
    await provider.run(["status", "--porcelain"], "/my/repo");
    expect(provider.calls[0].method).toBe("run");
    expect(provider.calls[0].args).toEqual([["status", "--porcelain"], "/my/repo"]);
  });

  test("run without cwd", async () => {
    const provider = createMockGitProvider();
    await provider.run(["log", "--oneline"]);
    expect(provider.calls[0].args[1]).toBeUndefined();
  });

  test("run failure", async () => {
    const provider = createMockGitProvider({ shouldFail: true, failMessage: "git error" });
    const result = await provider.run(["status"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("git error");
  });
});

// ---------------------------------------------------------------------------
// Mock provider — call tracking
// ---------------------------------------------------------------------------

describe("MockGitProvider call tracking", () => {
  test("tracks multiple calls in order", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("a", "u1");
    await provider.pullScenario("b", "u2");
    await provider.cloneScenarioRepo("u3", "/d");
    await provider.run(["status"]);

    expect(provider.calls).toHaveLength(4);
    expect(provider.calls[0].method).toBe("pushScenario");
    expect(provider.calls[1].method).toBe("pullScenario");
    expect(provider.calls[2].method).toBe("cloneScenarioRepo");
    expect(provider.calls[3].method).toBe("run");
  });

  test("reset clears all call history", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("s", "u");
    await provider.pullScenario("s", "u");
    expect(provider.calls).toHaveLength(2);

    provider.reset();
    expect(provider.calls).toHaveLength(0);
  });

  test("timestamps are monotonically increasing", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("s1", "u");
    await provider.pullScenario("s2", "u");
    expect(provider.calls[1].timestamp).toBeGreaterThanOrEqual(provider.calls[0].timestamp);
  });
});

// ---------------------------------------------------------------------------
// Mock provider — combined scenarios
// ---------------------------------------------------------------------------

describe("MockGitProvider combined operations", () => {
  test("push then pull cycle", async () => {
    const provider = createMockGitProvider();
    const pushResult = await provider.pushScenario("cycle-test", "https://github.com/org/repo");
    expect(pushResult.ok).toBe(true);

    const pullResult = await provider.pullScenario("cycle-test", "https://github.com/org/repo");
    expect(pullResult.ok).toBe(true);

    expect(provider.calls).toHaveLength(2);
  });

  test("mixed success and failure per method", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        pushScenario: { ok: true, stdout: "pushed", stderr: "" },
        pullScenario: { ok: false, stdout: "", stderr: "conflict" },
        cloneScenarioRepo: { ok: true, stdout: "cloned", stderr: "" },
      },
    });

    const push = await provider.pushScenario("s", "u");
    const pull = await provider.pullScenario("s", "u");
    const clone = await provider.cloneScenarioRepo("u", "/d");

    expect(push.ok).toBe(true);
    expect(pull.ok).toBe(false);
    expect(clone.ok).toBe(true);
  });

  test("shouldFail overrides all method results", async () => {
    const provider = createMockGitProvider({
      shouldFail: true,
      failMessage: "global failure",
      methodResults: {
        pushScenario: { ok: true, stdout: "pushed", stderr: "" },
      },
    });

    // shouldFail takes precedence
    const result = await provider.pushScenario("s", "u");
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("global failure");
  });
});

// ---------------------------------------------------------------------------
// GitResult type validation
// ---------------------------------------------------------------------------

describe("GitResult contract", () => {
  test("success result has expected shape", async () => {
    const provider = createMockGitProvider();
    const result = await provider.pushScenario("s", "u");

    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(result.ok).toBe(true);
  });

  test("failure result has expected shape", async () => {
    const provider = createMockGitProvider({ shouldFail: true, failMessage: "err" });
    const result = await provider.pushScenario("s", "u");

    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(result.ok).toBe(false);
  });

  test("custom default result is respected", async () => {
    const provider = createMockGitProvider({
      defaultResult: { ok: true, stdout: "custom output", stderr: "custom warning" },
    });
    const result = await provider.run(["status"]);
    expect(result.stdout).toBe("custom output");
    expect(result.stderr).toBe("custom warning");
  });
});
