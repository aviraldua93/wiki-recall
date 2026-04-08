/**
 * Unit tests for src/memory/layers/l0-identity.ts — L0 Identity layer
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { resetConfig } from "../../src/config.js";
import {
  loadIdentity,
  generateIdentityPrompt,
  createDefaultIdentity,
  saveIdentity,
} from "../../src/memory/layers/l0-identity.js";
import type { L0Identity } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `devcontext-l0-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.DEVCONTEXT_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup errors */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function writeIdentityYaml(dir: string, data: Record<string, unknown>): string {
  const filePath = join(dir, "identity.yaml");
  writeFileSync(filePath, yaml.dump(data), "utf8");
  return filePath;
}

function fullIdentity(): L0Identity {
  return {
    name: "Alice",
    roles: ["Software Engineer", "Open Source Contributor"],
    accounts: [
      { platform: "github", username: "alice-dev" },
      { platform: "gitlab", username: "alice" },
    ],
    coreContext: "Full-stack developer focused on distributed systems.",
  };
}

// ---------------------------------------------------------------------------
// loadIdentity
// ---------------------------------------------------------------------------

describe("loadIdentity", () => {
  test("loads a valid identity YAML file", () => {
    const path = writeIdentityYaml(testDir, {
      name: "Alice",
      roles: ["SWE"],
      accounts: [{ platform: "github", username: "alice" }],
      coreContext: "Backend developer.",
    });

    const identity = loadIdentity(path);
    expect(identity.name).toBe("Alice");
    expect(identity.roles).toEqual(["SWE"]);
    expect(identity.accounts).toEqual([{ platform: "github", username: "alice" }]);
    expect(identity.coreContext).toBe("Backend developer.");
  });

  test("throws when file does not exist", () => {
    expect(() => loadIdentity(join(testDir, "nonexistent.yaml"))).toThrow("Identity file not found");
  });

  test("handles missing optional fields with defaults", () => {
    const path = writeIdentityYaml(testDir, { name: "Bob" });
    const identity = loadIdentity(path);
    expect(identity.name).toBe("Bob");
    expect(identity.roles).toEqual([]);
    expect(identity.accounts).toEqual([]);
    expect(identity.coreContext).toBe("");
  });

  test("handles empty YAML object", () => {
    const path = writeIdentityYaml(testDir, {});
    const identity = loadIdentity(path);
    expect(identity.name).toBe("");
    expect(identity.roles).toEqual([]);
    expect(identity.accounts).toEqual([]);
    expect(identity.coreContext).toBe("");
  });

  test("throws on non-object YAML", () => {
    const filePath = join(testDir, "bad.yaml");
    writeFileSync(filePath, "just a string", "utf8");
    expect(() => loadIdentity(filePath)).toThrow("Invalid identity file");
  });

  test("handles multiple accounts", () => {
    const path = writeIdentityYaml(testDir, {
      name: "Carol",
      accounts: [
        { platform: "github", username: "carol" },
        { platform: "gitlab", username: "carol-gl" },
        { platform: "npm", username: "carol-npm" },
      ],
    });
    const identity = loadIdentity(path);
    expect(identity.accounts).toHaveLength(3);
    expect(identity.accounts[2].platform).toBe("npm");
  });

  test("coerces non-string fields to strings", () => {
    const path = writeIdentityYaml(testDir, {
      name: 42,
      roles: [1, 2],
      accounts: [{ platform: 99, username: true }],
    });
    const identity = loadIdentity(path);
    expect(identity.name).toBe("");
    expect(identity.roles).toEqual(["1", "2"]);
    expect(identity.accounts[0].platform).toBe("99");
  });

  test("handles roles as empty array", () => {
    const path = writeIdentityYaml(testDir, { name: "Dave", roles: [] });
    const identity = loadIdentity(path);
    expect(identity.roles).toEqual([]);
  });

  test("handles accounts as empty array", () => {
    const path = writeIdentityYaml(testDir, { name: "Eve", accounts: [] });
    const identity = loadIdentity(path);
    expect(identity.accounts).toEqual([]);
  });

  test("ignores extra YAML fields", () => {
    const path = writeIdentityYaml(testDir, {
      name: "Frank",
      extra: "ignored",
      nested: { deep: true },
    });
    const identity = loadIdentity(path);
    expect(identity.name).toBe("Frank");
    expect((identity as Record<string, unknown>).extra).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateIdentityPrompt
// ---------------------------------------------------------------------------

describe("generateIdentityPrompt", () => {
  test("generates a compact prompt with all fields", () => {
    const prompt = generateIdentityPrompt(fullIdentity());
    expect(prompt).toContain("User: Alice");
    expect(prompt).toContain("Roles: Software Engineer, Open Source Contributor");
    expect(prompt).toContain("Accounts: github:alice-dev, gitlab:alice");
    expect(prompt).toContain("Full-stack developer");
    expect(prompt.endsWith(".")).toBe(true);
  });

  test("handles identity with name only", () => {
    const prompt = generateIdentityPrompt({
      name: "Bob",
      roles: [],
      accounts: [],
      coreContext: "",
    });
    expect(prompt).toBe("User: Bob.");
  });

  test("handles completely empty identity", () => {
    const prompt = generateIdentityPrompt({
      name: "",
      roles: [],
      accounts: [],
      coreContext: "",
    });
    expect(prompt).toBe("");
  });

  test("generates prompt under ~50 tokens for typical identity", () => {
    const prompt = generateIdentityPrompt(fullIdentity());
    // Approximate token count: chars / 4
    const tokenEstimate = Math.ceil(prompt.length / 4);
    expect(tokenEstimate).toBeLessThan(100);
  });

  test("handles single role", () => {
    const prompt = generateIdentityPrompt({
      name: "Carol",
      roles: ["DevOps"],
      accounts: [],
      coreContext: "",
    });
    expect(prompt).toContain("Roles: DevOps");
  });

  test("handles core context without name", () => {
    const prompt = generateIdentityPrompt({
      name: "",
      roles: [],
      accounts: [],
      coreContext: "Builds things",
    });
    expect(prompt).toBe("Builds things.");
  });

  test("handles single account", () => {
    const prompt = generateIdentityPrompt({
      name: "",
      roles: [],
      accounts: [{ platform: "github", username: "test" }],
      coreContext: "",
    });
    expect(prompt).toContain("Accounts: github:test");
  });
});

// ---------------------------------------------------------------------------
// createDefaultIdentity
// ---------------------------------------------------------------------------

describe("createDefaultIdentity", () => {
  test("creates identity with given name", () => {
    const identity = createDefaultIdentity("TestUser");
    expect(identity.name).toBe("TestUser");
  });

  test("includes Software Engineer as default role", () => {
    const identity = createDefaultIdentity("TestUser");
    expect(identity.roles).toContain("Software Engineer");
  });

  test("has empty accounts", () => {
    const identity = createDefaultIdentity("TestUser");
    expect(identity.accounts).toEqual([]);
  });

  test("has empty coreContext", () => {
    const identity = createDefaultIdentity("TestUser");
    expect(identity.coreContext).toBe("");
  });

  test("handles empty name", () => {
    const identity = createDefaultIdentity("");
    expect(identity.name).toBe("");
  });

  test("handles name with special characters", () => {
    const identity = createDefaultIdentity("O'Brien-Smith");
    expect(identity.name).toBe("O'Brien-Smith");
  });
});

// ---------------------------------------------------------------------------
// saveIdentity
// ---------------------------------------------------------------------------

describe("saveIdentity", () => {
  test("saves identity to YAML file", () => {
    const path = join(testDir, "saved-identity.yaml");
    saveIdentity(fullIdentity(), path);

    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    const loaded = yaml.load(raw) as Record<string, unknown>;
    expect(loaded.name).toBe("Alice");
  });

  test("creates parent directories if needed", () => {
    const path = join(testDir, "deep", "nested", "identity.yaml");
    saveIdentity(fullIdentity(), path);
    expect(existsSync(path)).toBe(true);
  });

  test("overwrites existing file", () => {
    const path = join(testDir, "identity.yaml");
    saveIdentity(createDefaultIdentity("First"), path);
    saveIdentity(createDefaultIdentity("Second"), path);

    const raw = readFileSync(path, "utf8");
    const loaded = yaml.load(raw) as Record<string, unknown>;
    expect(loaded.name).toBe("Second");
  });

  test("round-trips through load", () => {
    const original = fullIdentity();
    const path = join(testDir, "roundtrip.yaml");
    saveIdentity(original, path);
    const loaded = loadIdentity(path);

    expect(loaded.name).toBe(original.name);
    expect(loaded.roles).toEqual(original.roles);
    expect(loaded.accounts).toEqual(original.accounts);
    expect(loaded.coreContext).toBe(original.coreContext);
  });

  test("saves identity with empty fields", () => {
    const path = join(testDir, "empty.yaml");
    saveIdentity({ name: "", roles: [], accounts: [], coreContext: "" }, path);
    expect(existsSync(path)).toBe(true);
  });

  test("saves and loads identity with unicode characters", () => {
    const path = join(testDir, "unicode.yaml");
    const identity: L0Identity = {
      name: "名前",
      roles: ["エンジニア"],
      accounts: [],
      coreContext: "开发者",
    };
    saveIdentity(identity, path);
    const loaded = loadIdentity(path);
    expect(loaded.name).toBe("名前");
    expect(loaded.coreContext).toBe("开发者");
  });
});
