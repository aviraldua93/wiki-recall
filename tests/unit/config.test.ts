/**
 * Unit tests for src/config.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getConfig, resetConfig } from "../../src/config.js";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  test("returns default values when env vars are not set", () => {
    delete process.env.WIKIRECALL_HOME;
    delete process.env.WIKIRECALL_LOG_LEVEL;
    delete process.env.GITHUB_TOKEN;

    const config = getConfig();
    expect(config.home).toContain(".wikirecall");
    expect(config.logLevel).toBe("info");
    expect(config.githubToken).toBeUndefined();
  });

  test("reads WIKIRECALL_HOME from env", () => {
    process.env.WIKIRECALL_HOME = "/tmp/test-wikirecall";
    const config = getConfig();
    expect(config.home).toBe("/tmp/test-wikirecall");
  });

  test("reads WIKIRECALL_LOG_LEVEL from env", () => {
    process.env.WIKIRECALL_LOG_LEVEL = "debug";
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
  });

  test("reads GITHUB_TOKEN from env", () => {
    process.env.GITHUB_TOKEN = "ghp_test_token_123";
    const config = getConfig();
    expect(config.githubToken).toBe("ghp_test_token_123");
  });

  test("caches config after first call", () => {
    process.env.WIKIRECALL_LOG_LEVEL = "debug";
    const config1 = getConfig();

    process.env.WIKIRECALL_LOG_LEVEL = "error";
    const config2 = getConfig();

    // Should still be "debug" because config was cached
    expect(config2.logLevel).toBe("debug");
    expect(config1).toBe(config2); // Same reference
  });

  test("resetConfig clears the cache", () => {
    process.env.WIKIRECALL_LOG_LEVEL = "debug";
    getConfig();

    resetConfig();

    process.env.WIKIRECALL_LOG_LEVEL = "error";
    const config = getConfig();
    expect(config.logLevel).toBe("error");
  });
});
