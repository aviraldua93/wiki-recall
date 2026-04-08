/**
 * Rename verification tests — ensure the wiki-recall branding is consistent
 * across CLI program name, config env vars, and package metadata.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfig, getConfig } from "../../src/config.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfig();
});

// ---------------------------------------------------------------------------
// Package.json metadata
// ---------------------------------------------------------------------------

describe("rename — package.json", () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8")
  );

  test('package name is "wiki-recall"', () => {
    expect(pkg.name).toBe("wiki-recall");
  });

  test("bin entry is wiki-recall", () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["wiki-recall"]).toBeDefined();
  });

  test("bin entry points to src/cli/index.ts", () => {
    expect(pkg.bin["wiki-recall"]).toBe("src/cli/index.ts");
  });

  test("repository URL contains wiki-recall", () => {
    expect(pkg.repository.url).toContain("wiki-recall");
  });

  test("homepage URL contains wiki-recall", () => {
    expect(pkg.homepage).toContain("wiki-recall");
  });

  test("keywords include wiki-recall", () => {
    expect(pkg.keywords).toContain("wiki-recall");
  });

  test("MCP server command uses src/cli/index.ts", () => {
    expect(pkg.mcp).toBeDefined();
    expect(pkg.mcp.server.args).toContain("src/cli/index.ts");
  });

  test("MCP server transport is stdio", () => {
    expect(pkg.mcp.server.transport).toBe("stdio");
  });
});

// ---------------------------------------------------------------------------
// CLI program name
// ---------------------------------------------------------------------------

describe("rename — CLI program", () => {
  test('program name is "wiki-recall"', async () => {
    const { program } = await import("../../src/cli/index.js");
    expect(program.name()).toBe("wiki-recall");
  });

  test("program version matches package.json", async () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    );
    const { program } = await import("../../src/cli/index.js");
    expect(program.version()).toBe(pkg.version);
  });

  test("program has a description", async () => {
    const { program } = await import("../../src/cli/index.js");
    expect(program.description()).toBeString();
    expect(program.description().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Config env vars use WIKIRECALL_ prefix
// ---------------------------------------------------------------------------

describe("rename — config env vars", () => {
  test("WIKIRECALL_HOME sets home directory", () => {
    resetConfig();
    process.env.WIKIRECALL_HOME = "/custom/path";
    const config = getConfig();
    expect(config.home).toBe("/custom/path");
  });

  test("default home contains .wikirecall", () => {
    resetConfig();
    delete process.env.WIKIRECALL_HOME;
    const config = getConfig();
    expect(config.home).toContain(".wikirecall");
  });

  test("WIKIRECALL_LOG_LEVEL sets log level", () => {
    resetConfig();
    process.env.WIKIRECALL_LOG_LEVEL = "debug";
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
  });

  test("default log level is info", () => {
    resetConfig();
    delete process.env.WIKIRECALL_LOG_LEVEL;
    const config = getConfig();
    expect(config.logLevel).toBe("info");
  });

  test("GITHUB_TOKEN is read from env", () => {
    resetConfig();
    process.env.GITHUB_TOKEN = "ghp_test123";
    const config = getConfig();
    expect(config.githubToken).toBe("ghp_test123");
  });

  test("GITHUB_TOKEN is undefined when not set", () => {
    resetConfig();
    delete process.env.GITHUB_TOKEN;
    const config = getConfig();
    expect(config.githubToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Config interface
// ---------------------------------------------------------------------------

describe("rename — config interface", () => {
  test("WikiRecallConfig has home field", () => {
    resetConfig();
    const config = getConfig();
    expect("home" in config).toBeTrue();
  });

  test("WikiRecallConfig has logLevel field", () => {
    resetConfig();
    const config = getConfig();
    expect("logLevel" in config).toBeTrue();
  });

  test("WikiRecallConfig has githubToken field", () => {
    resetConfig();
    const config = getConfig();
    expect("githubToken" in config).toBeTrue();
  });

  test("resetConfig clears cached config", () => {
    process.env.WIKIRECALL_LOG_LEVEL = "trace";
    resetConfig();
    const config1 = getConfig();
    expect(config1.logLevel).toBe("trace");

    process.env.WIKIRECALL_LOG_LEVEL = "warn";
    resetConfig();
    const config2 = getConfig();
    expect(config2.logLevel).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// Source files consistency
// ---------------------------------------------------------------------------

describe("rename — source file references", () => {
  test("config.ts uses WIKIRECALL_HOME env var name", () => {
    const configSrc = readFileSync(
      join(process.cwd(), "src", "config.ts"),
      "utf8"
    );
    expect(configSrc).toContain("WIKIRECALL_HOME");
  });

  test("config.ts uses WIKIRECALL_LOG_LEVEL env var name", () => {
    const configSrc = readFileSync(
      join(process.cwd(), "src", "config.ts"),
      "utf8"
    );
    expect(configSrc).toContain("WIKIRECALL_LOG_LEVEL");
  });

  test("config.ts default home directory contains .wikirecall", () => {
    const configSrc = readFileSync(
      join(process.cwd(), "src", "config.ts"),
      "utf8"
    );
    expect(configSrc).toContain(".wikirecall");
  });
});
