/**
 * Tests for the protocols architecture (#49).
 *
 * Validates:
 *  - All 4 protocol files exist with proper structure
 *  - Zero subprocess LLM calls in Python codebase
 *  - Protocol format consistency (steps, guidelines)
 *  - No copilot -p subprocess calls anywhere
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = join(import.meta.dir, "..", "..");
const PROTOCOLS_DIR = join(ROOT, "protocols");

function readProtocol(name: string): string {
  return readFileSync(join(PROTOCOLS_DIR, name), "utf-8");
}

// ---------------------------------------------------------------------------
// Protocol file existence
// ---------------------------------------------------------------------------

describe("protocol files exist", () => {
  const expectedProtocols = [
    "heal-protocol.md",
    "interview-protocol.md",
    "retrofit-protocol.md",
    "dream-protocol.md",
  ];

  test("protocols/ directory exists", () => {
    expect(existsSync(PROTOCOLS_DIR)).toBe(true);
  });

  for (const proto of expectedProtocols) {
    test(`${proto} exists`, () => {
      expect(existsSync(join(PROTOCOLS_DIR, proto))).toBe(true);
    });
  }

  test("protocols/ contains exactly 4 protocol files", () => {
    const files = readdirSync(PROTOCOLS_DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Protocol structure (each protocol has steps + guidelines)
// ---------------------------------------------------------------------------

describe("heal-protocol.md structure", () => {
  const content = readProtocol("heal-protocol.md");

  test("has step headings", () => {
    const steps = content.match(/^## Step \d+/gm) || [];
    expect(steps.length).toBeGreaterThanOrEqual(8);
  });

  test("starts with backup step", () => {
    expect(content).toContain("## Step 1: Backup");
  });

  test("has diagnose step with hygiene.py", () => {
    expect(content).toContain("hygiene.py");
    expect(content).toContain("--json");
  });

  test("has verify step at the end", () => {
    expect(content).toContain("Verify");
    expect(content).toContain("before/after");
  });

  test("has guidelines section", () => {
    expect(content).toContain("## Guidelines");
  });

  test("mentions ASCII-only encoding", () => {
    expect(content).toContain("ASCII only");
  });

  test("mentions source attribution", () => {
    expect(content).toContain("source attribution");
  });

  test("does not reference copilot -p subprocess", () => {
    expect(content).not.toContain('copilot -p');
  });
});

describe("retrofit-protocol.md structure", () => {
  const content = readProtocol("retrofit-protocol.md");

  test("has step headings", () => {
    const steps = content.match(/^## Step \d+/gm) || [];
    expect(steps.length).toBeGreaterThanOrEqual(7);
  });

  test("starts with backup step", () => {
    expect(content).toContain("## Step 1: Backup");
  });

  test("references RESOLVER.md", () => {
    expect(content).toContain("RESOLVER");
  });

  test("has guidelines section", () => {
    expect(content).toContain("## Guidelines");
  });
});

describe("dream-protocol.md structure", () => {
  const content = readProtocol("dream-protocol.md");

  test("has step headings", () => {
    const steps = content.match(/^## Step \d+/gm) || [];
    expect(steps.length).toBeGreaterThanOrEqual(6);
  });

  test("mentions nightly/unattended", () => {
    expect(content.toLowerCase()).toContain("nightly");
  });

  test("has entity sweep step", () => {
    expect(content).toContain("Entity Sweep");
  });

  test("has consolidation step", () => {
    expect(content).toContain("Consolidation");
  });

  test("mentions idempotent", () => {
    expect(content).toContain("Idempotent");
  });

  test("has guidelines section", () => {
    expect(content).toContain("## Guidelines");
  });
});

// ---------------------------------------------------------------------------
// Zero subprocess LLM calls (#49 acceptance criteria)
// ---------------------------------------------------------------------------

describe("zero subprocess LLM calls in Python", () => {
  test("llm_client.py has no subprocess import", () => {
    const source = readFileSync(join(ROOT, "engine", "llm_client.py"), "utf-8");
    expect(source).not.toContain("import subprocess");
    expect(source).not.toContain("subprocess.run");
  });

  test("llm_client.py has no _call_copilot method", () => {
    const source = readFileSync(join(ROOT, "engine", "llm_client.py"), "utf-8");
    expect(source).not.toContain("def _call_copilot");
  });

  test("llm_client.py has no _call_openai method", () => {
    const source = readFileSync(join(ROOT, "engine", "llm_client.py"), "utf-8");
    expect(source).not.toContain("def _call_openai");
  });

  test("llm_client.py available property always returns False", () => {
    const source = readFileSync(join(ROOT, "engine", "llm_client.py"), "utf-8");
    // The available property should return False
    expect(source).toContain("return False");
  });

  test("no Python file spawns copilot subprocess", () => {
    // Check that no .py file calls subprocess.run with "copilot" as the command
    const engineDir = join(ROOT, "engine");
    const pyFiles = readdirSync(engineDir).filter((f) => f.endsWith(".py"));
    for (const pyFile of pyFiles) {
      const content = readFileSync(join(engineDir, pyFile), "utf-8");
      // Match the actual pattern: subprocess.run(["copilot", ...])
      const hasCopilotSubprocess =
        /subprocess\.run\(\s*\[.*["']copilot["']/.test(content);
      expect(hasCopilotSubprocess).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AGENTS.md documents protocols architecture
// ---------------------------------------------------------------------------

describe("AGENTS.md protocols documentation", () => {
  const content = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");

  test("has protocols architecture section", () => {
    expect(content).toContain("Protocols, Not Scripts");
  });

  test("references issue #49", () => {
    expect(content).toContain("#49");
  });

  test("shows the DIAGNOSIS / JUDGMENT / PLUMBING split", () => {
    expect(content).toContain("DIAGNOSIS");
    expect(content).toContain("JUDGMENT");
    expect(content).toContain("PLUMBING");
  });

  test("prohibits subprocess LLM calls", () => {
    expect(content).toContain("copilot -p");
    expect(content).toContain("Never spawn");
  });

  test("references protocols directory", () => {
    expect(content).toContain("protocols/");
    expect(content).toContain("heal-protocol.md");
  });
});
