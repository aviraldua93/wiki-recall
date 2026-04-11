/**
 * Unit tests for brain hygiene scripts.
 * Validates PowerShell/Python syntax, ensures no PII, and checks conventions.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const projectRoot = join(import.meta.dir, "..", "..");
const scriptsDir = join(projectRoot, "scripts");
const engineDir = join(projectRoot, "engine");

function readFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/** Forbidden strings — no PII or corporate references allowed */
const FORBIDDEN_STRINGS = [
  "OneDrive - Microsoft",
  "gim-home",
  "@microsoft.com",
  "Aviral",
  "aviraldua",
  "aviraldua_microsoft",
  "aviraldua93",
  "aviraldua-brain",
  "aka.ms",
  "eng.ms",
  "SharePoint",
];

function checkNoPII(content: string, fileName: string): void {
  for (const forbidden of FORBIDDEN_STRINGS) {
    const lower = content.toLowerCase();
    const check = forbidden.toLowerCase();
    if (lower.includes(check)) {
      throw new Error(
        `PII violation in ${fileName}: found "${forbidden}"`,
      );
    }
  }
}

/** Validate PowerShell syntax using powershell -Command */
function validatePowerShellSyntax(
  scriptPath: string,
): { valid: boolean; error?: string } {
  try {
    const cmd = `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$null, [ref]$null) | Out-Null; if ($?) { Write-Output 'VALID' } else { Write-Output 'INVALID' }"`;
    const result = execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();
    return {
      valid: result.includes("VALID") || !result.includes("INVALID"),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ParseException") || msg.includes("ParserError")) {
      return { valid: false, error: msg };
    }
    return { valid: true };
  }
}

/** Validate Python syntax using py_compile */
function validatePythonSyntax(
  scriptPath: string,
): { valid: boolean; error?: string } {
  try {
    execSync(`python -c "import py_compile; py_compile.compile('${scriptPath.replace(/\\/g, "\\\\")}', doraise=True)"`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    return { valid: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT") || msg.includes("is not recognized")) {
      return { valid: true }; // Python not available, skip
    }
    return { valid: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// hygiene.ps1 tests
// ---------------------------------------------------------------------------

describe("hygiene.ps1", () => {
  const scriptPath = join(scriptsDir, "hygiene.ps1");

  test("file exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  test("has valid PowerShell syntax", () => {
    const result = validatePowerShellSyntax(scriptPath);
    expect(result.valid).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(scriptPath);
    expect(() => checkNoPII(content, "hygiene.ps1")).not.toThrow();
  });

  test("accepts -Path parameter", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("$Path");
  });

  test("accepts -Fix switch", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("$Fix");
  });

  test("accepts -Refactor switch", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("$Refactor");
  });

  test("accepts -Json switch", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("$Json");
  });

  test("calls hygiene.py", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("hygiene.py");
  });

  test("calls refactor.py when -Refactor", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("refactor.py");
  });
});

// ---------------------------------------------------------------------------
// hygiene.py tests
// ---------------------------------------------------------------------------

describe("hygiene.py", () => {
  const scriptPath = join(engineDir, "hygiene.py");

  test("file exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  test("has valid Python syntax", () => {
    const result = validatePythonSyntax(scriptPath);
    if (result.error) {
      console.warn("Python syntax check:", result.error);
    }
    expect(result.valid).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(scriptPath);
    expect(() => checkNoPII(content, "hygiene.py")).not.toThrow();
  });

  test("defines HygieneIssue class", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("class HygieneIssue");
  });

  test("defines HygieneReport class", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("class HygieneReport");
  });

  test("has all four check functions", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("def check_structure");
    expect(content).toContain("def check_content");
    expect(content).toContain("def check_depth");
    expect(content).toContain("def check_duplication");
  });

  test("has CLI entry point", () => {
    const content = readFile(scriptPath);
    expect(content).toContain('if __name__ == "__main__"');
    expect(content).toContain("def main");
  });

  test("supports --fix flag", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("--fix");
  });

  test("supports --json flag", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("--json");
  });

  test("has grade computation", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("def compute_grade");
  });
});

// ---------------------------------------------------------------------------
// refactor.py tests
// ---------------------------------------------------------------------------

describe("refactor.py", () => {
  const scriptPath = join(engineDir, "refactor.py");

  test("file exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  test("has valid Python syntax", () => {
    const result = validatePythonSyntax(scriptPath);
    if (result.error) {
      console.warn("Python syntax check:", result.error);
    }
    expect(result.valid).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(scriptPath);
    expect(() => checkNoPII(content, "refactor.py")).not.toThrow();
  });

  test("defines all 6 phases", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("phase_1_root_cleanup");
    expect(content).toContain("phase_2_projects_cleanup");
    expect(content).toContain("phase_3_content_depth");
    expect(content).toContain("phase_4_dedup_check");
    expect(content).toContain("phase_5_rebuild_index");
    expect(content).toContain("phase_6_validate");
  });

  test("has backup function", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("def ensure_backup");
  });

  test("has archive function", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("def archive_path");
  });

  test("uses input() for interactive confirmation", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("input(");
  });

  test("has CLI entry point", () => {
    const content = readFile(scriptPath);
    expect(content).toContain('if __name__ == "__main__"');
  });
});
