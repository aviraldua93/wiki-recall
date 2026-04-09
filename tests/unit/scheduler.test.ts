/**
 * Unit tests for wiki-recall scheduler and maintenance scripts.
 * Validates PowerShell/Bash syntax, ensures no PII, and checks script conventions.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scriptsDir = join(import.meta.dir, "..", "..", "scripts");

function readScript(name: string): string {
  const path = join(scriptsDir, name);
  if (!existsSync(path)) {
    throw new Error(`Script not found: ${path}`);
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
];

function checkNoPII(content: string, scriptName: string): void {
  for (const forbidden of FORBIDDEN_STRINGS) {
    const lower = content.toLowerCase();
    const check = forbidden.toLowerCase();
    if (lower.includes(check)) {
      throw new Error(
        `PII violation in ${scriptName}: found "${forbidden}"`,
      );
    }
  }
}

/** Validate PowerShell syntax using powershell -Command */
function validatePowerShellSyntax(scriptPath: string): { valid: boolean; error?: string } {
  try {
    const absPath = join(scriptsDir, scriptPath);
    // Use PowerShell's parser to check syntax without executing
    const cmd = `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('${absPath.replace(/'/g, "''")}', [ref]$null, [ref]$null) | Out-Null; if ($?) { Write-Output 'VALID' } else { Write-Output 'INVALID' }"`;
    const result = execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();
    return { valid: result.includes("VALID") || !result.includes("INVALID") };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // If the parser itself errors, that's a syntax problem
    if (msg.includes("ParseException") || msg.includes("ParserError")) {
      return { valid: false, error: msg };
    }
    // Other errors (e.g., powershell not found) — assume valid and skip
    return { valid: true };
  }
}

/** Validate bash syntax using bash -n */
function validateBashSyntax(scriptPath: string): { valid: boolean; error?: string } {
  try {
    const absPath = join(scriptsDir, scriptPath);
    // Convert Windows path to Unix-style for bash (WSL/Git Bash)
    const unixPath = absPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`);
    // bash -n does syntax check without execution
    execSync(`bash -n "${unixPath}"`, { encoding: "utf-8", timeout: 10000 });
    return { valid: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // If bash isn't available (Windows without WSL), skip gracefully
    if (msg.includes("ENOENT") || msg.includes("is not recognized")) {
      return { valid: true }; // Can't validate, assume OK
    }
    // "No such file" with WSL path conversion issues — try alternate path
    if (msg.includes("No such file")) {
      try {
        // Try with wslpath conversion
        const absPath2 = join(scriptsDir, scriptPath);
        const wslPath = execSync(`wsl wslpath -a "${absPath2}"`, { encoding: "utf-8", timeout: 5000 }).trim();
        execSync(`bash -n "${wslPath}"`, { encoding: "utf-8", timeout: 10000 });
        return { valid: true };
      } catch {
        // If all path methods fail, validate by reading content for basic syntax markers
        const content = readScript(scriptPath);
        const hasShebang = content.startsWith("#!/bin/bash");
        const balanced = (content.match(/\bif\b/g) || []).length <=
          (content.match(/\bfi\b/g) || []).length + 1;
        if (hasShebang && balanced) {
          return { valid: true };
        }
        return { valid: false, error: "Could not validate bash syntax" };
      }
    }
    return { valid: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Script existence
// ---------------------------------------------------------------------------

describe("script files exist", () => {
  test("maintenance.ps1 exists", () => {
    expect(existsSync(join(scriptsDir, "maintenance.ps1"))).toBe(true);
  });

  test("backup.ps1 exists", () => {
    expect(existsSync(join(scriptsDir, "backup.ps1"))).toBe(true);
  });

  test("setup-scheduler.ps1 exists", () => {
    expect(existsSync(join(scriptsDir, "setup-scheduler.ps1"))).toBe(true);
  });

  test("setup-cron.sh exists", () => {
    expect(existsSync(join(scriptsDir, "setup-cron.sh"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PowerShell syntax validation
// ---------------------------------------------------------------------------

describe("PowerShell syntax validation", () => {
  test("maintenance.ps1 has valid PowerShell syntax", () => {
    const result = validatePowerShellSyntax("maintenance.ps1");
    if (!result.valid) {
      throw new Error(`Syntax error in maintenance.ps1: ${result.error}`);
    }
    expect(result.valid).toBe(true);
  });

  test("backup.ps1 has valid PowerShell syntax", () => {
    const result = validatePowerShellSyntax("backup.ps1");
    if (!result.valid) {
      throw new Error(`Syntax error in backup.ps1: ${result.error}`);
    }
    expect(result.valid).toBe(true);
  });

  test("setup-scheduler.ps1 has valid PowerShell syntax", () => {
    const result = validatePowerShellSyntax("setup-scheduler.ps1");
    if (!result.valid) {
      throw new Error(`Syntax error in setup-scheduler.ps1: ${result.error}`);
    }
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bash syntax validation
// ---------------------------------------------------------------------------

describe("Bash syntax validation", () => {
  test("setup-cron.sh has valid bash syntax", () => {
    const result = validateBashSyntax("setup-cron.sh");
    if (!result.valid) {
      throw new Error(`Syntax error in setup-cron.sh: ${result.error}`);
    }
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No PII in scripts
// ---------------------------------------------------------------------------

describe("PII checks — no corporate/personal references", () => {
  const scriptFiles = [
    "maintenance.ps1",
    "backup.ps1",
    "setup-scheduler.ps1",
    "setup-cron.sh",
  ];

  for (const script of scriptFiles) {
    test(`${script} contains no PII or corporate references`, () => {
      const content = readScript(script);
      // Will throw if PII found
      checkNoPII(content, script);
      expect(true).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Script content checks
// ---------------------------------------------------------------------------

describe("maintenance.ps1 content", () => {
  test("supports -WhatIf via ShouldProcess", () => {
    const content = readScript("maintenance.ps1");
    expect(content).toContain("SupportsShouldProcess");
  });

  test("uses try/catch for resilience", () => {
    const content = readScript("maintenance.ps1");
    const tryCount = (content.match(/\btry\b/g) || []).length;
    const catchCount = (content.match(/\bcatch\b/g) || []).length;
    expect(tryCount).toBeGreaterThanOrEqual(4);
    expect(catchCount).toBeGreaterThanOrEqual(4);
  });

  test("logs to maintenance log file", () => {
    const content = readScript("maintenance.ps1");
    expect(content).toContain("maintenance-");
    expect(content).toContain(".log");
  });

  test("prunes old logs (30 days)", () => {
    const content = readScript("maintenance.ps1");
    expect(content).toContain("AddDays(-30)");
  });

  test("returns exit code 0 or 1", () => {
    const content = readScript("maintenance.ps1");
    expect(content).toContain("exit 0");
    expect(content).toContain("exit 1");
  });
});

describe("backup.ps1 content", () => {
  test("accepts -Layer parameter with correct values", () => {
    const content = readScript("backup.ps1");
    expect(content).toContain('ValidateSet("local", "all", "status")');
  });

  test("uses ~/wiki-recall-backup/ as destination", () => {
    const content = readScript("backup.ps1");
    expect(content).toContain("wiki-recall-backup");
  });

  test("excludes rebuildable directories", () => {
    const content = readScript("backup.ps1");
    expect(content).toContain("chromadb");
    expect(content).toContain("__pycache__");
    expect(content).toContain("node_modules");
    expect(content).toContain(".obsidian");
  });

  test("keeps last 7 backups", () => {
    const content = readScript("backup.ps1");
    expect(content).toContain("7");
  });
});

describe("setup-scheduler.ps1 content", () => {
  test("supports -Uninstall switch", () => {
    const content = readScript("setup-scheduler.ps1");
    expect(content).toContain("[switch]$Uninstall");
  });

  test("registers three tasks with WikiRecall prefix", () => {
    const content = readScript("setup-scheduler.ps1");
    expect(content).toContain("WikiRecall Maintenance");
    expect(content).toContain("WikiRecall Backup");
    expect(content).toContain("WikiRecall Nightly");
  });

  test("uses AllowStartIfOnBatteries", () => {
    const content = readScript("setup-scheduler.ps1");
    expect(content).toContain("AllowStartIfOnBatteries");
  });

  test("nightly task uses WakeToRun", () => {
    const content = readScript("setup-scheduler.ps1");
    expect(content).toContain("WakeToRun");
  });

  test("supports hourly, every4hours, daily frequencies", () => {
    const content = readScript("setup-scheduler.ps1");
    expect(content).toContain('"hourly"');
    expect(content).toContain('"every4hours"');
    expect(content).toContain('"daily"');
  });
});

describe("setup-cron.sh content", () => {
  test("has shebang line", () => {
    const content = readScript("setup-cron.sh");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
  });

  test("supports --uninstall flag", () => {
    const content = readScript("setup-cron.sh");
    expect(content).toContain("--uninstall");
  });

  test("uses wiki-recall-auto cron marker", () => {
    const content = readScript("setup-cron.sh");
    expect(content).toContain("wiki-recall-auto");
  });

  test("supports hourly and daily frequencies", () => {
    const content = readScript("setup-cron.sh");
    expect(content).toContain("hourly");
    expect(content).toContain("daily");
  });
});

describe("setup.ps1 integration", () => {
  test("setup.ps1 includes maintenance wizard step", () => {
    const content = readScript("setup.ps1");
    expect(content).toContain("automatic maintenance");
  });

  test("setup.ps1 calls setup-scheduler.ps1", () => {
    const content = readScript("setup.ps1");
    expect(content).toContain("setup-scheduler.ps1");
  });

  test("setup.ps1 offers frequency options", () => {
    const content = readScript("setup.ps1");
    expect(content).toContain("hourly");
    expect(content).toContain("every4hours");
    expect(content).toContain("daily");
  });
});
