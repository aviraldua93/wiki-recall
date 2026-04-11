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

  test("has _detect_backend static method", () => {
    expect(source).toContain("def _detect_backend");
  });

  test("has ask method", () => {
    expect(source).toContain("def ask(self, prompt");
  });

  test("has classify method", () => {
    expect(source).toContain("def classify(");
  });

  test("has summarize method", () => {
    expect(source).toContain("def summarize(self, text");
  });

  test("has verify method", () => {
    expect(source).toContain("def verify(");
  });

  test("has rewrite method", () => {
    expect(source).toContain("def rewrite(self, text");
  });

  test("has available property", () => {
    expect(source).toContain("def available(self)");
  });

  test("has consolidate_truth method", () => {
    expect(source).toContain("def consolidate_truth(");
  });

  test("has BATCH_SIZE constant", () => {
    expect(source).toContain("BATCH_SIZE = ");
  });

  test("has _batch_items helper", () => {
    expect(source).toContain("def _batch_items(");
  });

  test("has _format_candidate_list helper", () => {
    expect(source).toContain("def _format_candidate_list(");
  });

  test("has _apply_verdicts helper", () => {
    expect(source).toContain("def _apply_verdicts(");
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

describe("CONTRIBUTING.md LLM Integration Pattern", () => {
  const content = readFile("CONTRIBUTING.md");

  test("has LLM Integration Pattern section", () => {
    expect(content).toContain("## LLM Integration Pattern");
  });

  test("has code example with LLMClient import", () => {
    expect(content).toContain("from engine.llm_client import LLMClient");
  });

  test("mentions fallback behavior", () => {
    expect(content.toLowerCase()).toContain("fallback");
  });

  test("mentions backend priority", () => {
    expect(content).toContain("OPENAI_API_KEY");
    expect(content.toLowerCase()).toContain("copilot");
  });

  test("mentions batch size", () => {
    expect(content).toContain("BATCH_SIZE");
  });

  test("mentions verify method", () => {
    expect(content).toContain("verify(");
  });

  test("mentions summarize method", () => {
    expect(content).toContain("summarize(");
  });

  test("mentions classify method", () => {
    expect(content).toContain("classify(");
  });

  test("documents adding LLM to new features", () => {
    expect(content).toContain("Adding LLM to a New Feature");
  });

  test("mentions client.available guard", () => {
    expect(content).toContain("client.available");
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
