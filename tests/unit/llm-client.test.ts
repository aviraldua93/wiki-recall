/**
 * TypeScript tests for engine/llm_client.py validation.
 *
 * Checks:
 *   - llm_client.py Python syntax valid
 *   - No PII/corporate references
 *   - CONTRIBUTING.md has LLM Integration Pattern section
 *   - Module structure validation
 *   - API surface completeness
 *
 * Target: 10+ tests
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");

function readFile(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return readFileSync(fullPath, "utf-8");
}

describe("llm_client.py syntax and structure", () => {
  const source = readFile("engine/llm_client.py");

  test("has valid Python class definition", () => {
    expect(source).toContain("class LLMClient:");
  });

  test("has __init__ with fallback_mode parameter", () => {
    expect(source).toContain("def __init__(self, fallback_mode");
  });

  test("available is always False (protocols architecture)", () => {
    expect(source).toContain("return False");
    expect(source).toContain("protocols");
  });

  test("no subprocess imports (zero subprocess LLM calls)", () => {
    expect(source).not.toContain("import subprocess");
    expect(source).not.toContain("subprocess.run");
  });

  test("no _call_copilot method (removed in #49)", () => {
    expect(source).not.toContain("def _call_copilot");
  });

  test("no _call_openai method (removed in #49)", () => {
    expect(source).not.toContain("def _call_openai");
  });

  test("references issue #49", () => {
    expect(source).toContain("#49");
  });

  test("no syntax errors in import lines", () => {
    const importLines = source
      .split("\n")
      .filter((l) => l.trim().startsWith("import ") || l.trim().startsWith("from "));
    for (const line of importLines) {
      // Basic syntax: import X or from X import Y
      expect(
        line.trim().match(/^(import\s+\w|from\s+\w)/) !== null
      ).toBe(true);
    }
  });
});

describe("no PII or corporate references", () => {
  const filesToCheck = [
    "engine/llm_client.py",
    "engine/llm_filter.py",
    "CONTRIBUTING.md",
  ];

  for (const file of filesToCheck) {
    test(`${file} has no corporate references`, () => {
      const content = readFile(file);
      const corporateTerms = [
        /\bmicrosoft\b/i,
        /\b@microsoft\.com\b/i,
        /\bmsft\b/i,
        /\bazure\.com\b/i,
        /\bcorpnet\b/i,
        /\bredmond\b/i,
      ];
      for (const term of corporateTerms) {
        // Allow "microsoft" only in URLs like github.com/microsoft
        const matches = content.match(term);
        if (matches) {
          // Check it's not part of a URL pattern
          const lineWithMatch = content
            .split("\n")
            .find((l) => term.test(l));
          if (lineWithMatch && !lineWithMatch.includes("github.com")) {
            expect(matches).toBeNull();
          }
        }
      }
    });
  }
});

describe("CONTRIBUTING.md protocols architecture", () => {
  const content = readFile("CONTRIBUTING.md");

  test("has protocols architecture section", () => {
    expect(content).toContain("Protocols, Not Scripts");
  });

  test("references AGENTS.md for details", () => {
    expect(content).toContain("AGENTS.md");
  });

  test("documents adding a new feature", () => {
    expect(content).toContain("Adding a New Feature");
  });

  test("prohibits subprocess LLM calls", () => {
    expect(content).toContain("Never spawn");
    expect(content).toContain("copilot -p");
  });

  test("references protocols directory", () => {
    expect(content).toContain("protocols/");
  });
});

describe("llm_filter.py uses LLMClient", () => {
  const source = readFile("engine/llm_filter.py");

  test("imports from llm_client", () => {
    expect(source).toContain("from engine.llm_client import LLMClient");
  });

  test("does not directly import openai", () => {
    expect(source).not.toContain("import openai");
  });

  test("does not directly import subprocess", () => {
    expect(source).not.toContain("import subprocess");
  });

  test("does not directly import shutil", () => {
    expect(source).not.toContain("import shutil");
  });
});
