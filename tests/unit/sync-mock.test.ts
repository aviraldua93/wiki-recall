/**
 * Unit tests for src/sync/mock.ts — mock git provider
 */

import { describe, test, expect } from "bun:test";
import { createMockGitProvider } from "../../src/sync/mock.js";

// ---------------------------------------------------------------------------
// createMockGitProvider
// ---------------------------------------------------------------------------

describe("createMockGitProvider", () => {
  test("returns a provider with empty calls", () => {
    const provider = createMockGitProvider();
    expect(provider.calls).toEqual([]);
  });

  test("pushScenario records the call and returns success", async () => {
    const provider = createMockGitProvider();
    const result = await provider.pushScenario("my-scenario", "https://github.com/org/repo");
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("pushScenario");
    expect(provider.calls[0].args).toEqual(["my-scenario", "https://github.com/org/repo", "main"]);
  });

  test("pullScenario records the call and returns success", async () => {
    const provider = createMockGitProvider();
    const result = await provider.pullScenario("my-scenario", "https://github.com/org/repo", "develop");
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("pullScenario");
    expect(provider.calls[0].args).toEqual(["my-scenario", "https://github.com/org/repo", "develop"]);
  });

  test("cloneScenarioRepo records the call and returns success", async () => {
    const provider = createMockGitProvider();
    const result = await provider.cloneScenarioRepo("https://github.com/org/repo", "/tmp/clone");
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("cloneScenarioRepo");
  });

  test("run records the call", async () => {
    const provider = createMockGitProvider();
    const result = await provider.run(["status"], "/tmp/repo");
    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("run");
  });

  test("shouldFail makes all operations fail", async () => {
    const provider = createMockGitProvider({ shouldFail: true, failMessage: "simulated error" });
    const result = await provider.pushScenario("s", "u");
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("simulated error");
  });

  test("methodResults allows per-method overrides", async () => {
    const provider = createMockGitProvider({
      methodResults: {
        pushScenario: { ok: false, stdout: "", stderr: "push denied" },
        pullScenario: { ok: true, stdout: "pulled", stderr: "" },
      },
    });

    const pushResult = await provider.pushScenario("s", "u");
    expect(pushResult.ok).toBe(false);
    expect(pushResult.stderr).toBe("push denied");

    const pullResult = await provider.pullScenario("s", "u");
    expect(pullResult.ok).toBe(true);
    expect(pullResult.stdout).toBe("pulled");
  });

  test("reset clears call history", async () => {
    const provider = createMockGitProvider();
    await provider.pushScenario("s", "u");
    await provider.pullScenario("s", "u");
    expect(provider.calls).toHaveLength(2);
    provider.reset();
    expect(provider.calls).toHaveLength(0);
  });

  test("respects delay option", async () => {
    const provider = createMockGitProvider({ delay: 50 });
    const start = Date.now();
    await provider.pushScenario("s", "u");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  test("records timestamps", async () => {
    const provider = createMockGitProvider();
    const before = Date.now();
    await provider.pushScenario("s", "u");
    const after = Date.now();
    expect(provider.calls[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(provider.calls[0].timestamp).toBeLessThanOrEqual(after);
  });
});
