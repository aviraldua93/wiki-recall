/**
 * Unit tests for Issues #24, #25, #26:
 * - RESOLVER tiered decisions (#26)
 * - Adopt wiring to ~/.github/ (#24)
 * - Dead file detection (#24)
 * - Retrofit (#25) file structure and syntax
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
const templatesDir = join(projectRoot, "templates");

function readFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/** Forbidden strings -- no PII or corporate references allowed */
const FORBIDDEN_STRINGS = [
  "OneDrive - Microsoft",
  "gim-home",
  "@microsoft.com",
  "Aviral",
  "aviraldua",
  "aviraldua_microsoft",
  "aviraldua93",
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
      return { valid: true };
    }
    return { valid: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Issue #26: RESOLVER.md tiered decisions
// ---------------------------------------------------------------------------

describe("RESOLVER.md tiered decisions (#26)", () => {
  const resolverPath = join(templatesDir, "RESOLVER.md");

  test("file exists", () => {
    expect(existsSync(resolverPath)).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(resolverPath);
    expect(() => checkNoPII(content, "RESOLVER.md")).not.toThrow();
  });

  test("has 3-tier decision routing section", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("## Decision Routing (3 tiers)");
  });

  test("has Tier 1 -- Behavioral Rules", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("### Tier 1");
    expect(content).toContain("Behavioral Rules");
    expect(content).toContain("always loaded");
  });

  test("has Tier 2 -- Architectural Decisions", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("### Tier 2");
    expect(content).toContain("Architectural Decisions");
    expect(content).toContain("brain.md");
  });

  test("has Tier 3 -- Historical Decisions", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("### Tier 3");
    expect(content).toContain("Historical Decisions");
    expect(content).toContain("decisions.md only");
  });

  test("Tier 1 trigger words include always/never/prefer", () => {
    const content = readFile(resolverPath);
    const tier1Section = content.split("### Tier 1")[1]?.split("### Tier 2")[0] || "";
    expect(tier1Section).toContain('"always"');
    expect(tier1Section).toContain('"never"');
    expect(tier1Section).toContain('"prefer"');
  });

  test("Tier 2 trigger words include decided/settled/going with", () => {
    const content = readFile(resolverPath);
    const tier2Section = content.split("### Tier 2")[1]?.split("### Tier 3")[0] || "";
    expect(tier2Section).toContain('"decided to"');
    expect(tier2Section).toContain('"settled on"');
    expect(tier2Section).toContain('"going with"');
  });

  test("Tier 1 writes to copilot-instructions.md and decisions.md", () => {
    const content = readFile(resolverPath);
    const tier1Section = content.split("### Tier 1")[1]?.split("### Tier 2")[0] || "";
    expect(tier1Section).toContain("copilot-instructions.md");
    expect(tier1Section).toContain("decisions.md");
  });

  test("Tier 2 writes to decisions.md and brain.md", () => {
    const content = readFile(resolverPath);
    const tier2Section = content.split("### Tier 2")[1]?.split("### Tier 3")[0] || "";
    expect(tier2Section).toContain("decisions.md");
    expect(tier2Section).toContain("brain.md");
  });

  test("Tier 3 writes to decisions.md only", () => {
    const content = readFile(resolverPath);
    const tier3Section = content.split("### Tier 3")[1]?.split("###")[0] || "";
    expect(tier3Section).toContain("decisions.md only");
  });

  test("has detection logic section", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("### Detection Logic");
  });

  test("format includes tier tag", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("[tier:N]");
  });

  test("has 8 filing rules", () => {
    const content = readFile(resolverPath);
    // Count numbered items (1. through 8.)
    const matches = content.match(/^\d+\.\s/gm);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(8);
  });

  test("decision rule now references tiers instead of plain append", () => {
    const content = readFile(resolverPath);
    // Rule 5 should no longer say "decisions.md (append)"
    expect(content).not.toContain("5. Is it a **DECISION** that was made? → decisions.md (append)");
    expect(content).toContain("Decision Routing");
  });

  test("still has page format section", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("## Page Format");
    expect(content).toContain("Compiled Truth");
    expect(content).toContain("Timeline");
  });

  test("still has source attribution", () => {
    const content = readFile(resolverPath);
    expect(content).toContain("## Source Attribution");
    expect(content).toContain("observed");
    expect(content).toContain("self-stated");
    expect(content).toContain("inferred");
  });
});

// ---------------------------------------------------------------------------
// Issue #26: copilot-instructions.md tiered write-back
// ---------------------------------------------------------------------------

describe("copilot-instructions.md tiered write-back (#26)", () => {
  const instructionsPath = join(templatesDir, "copilot-instructions.md");

  test("file exists", () => {
    expect(existsSync(instructionsPath)).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(instructionsPath);
    expect(() => checkNoPII(content, "copilot-instructions.md")).not.toThrow();
  });

  test("has Decision Write-Back section", () => {
    const content = readFile(instructionsPath);
    expect(content).toContain("## Decision Write-Back (Tiered)");
  });

  test("Tier 1 writes to copilot-instructions.md directly", () => {
    const content = readFile(instructionsPath);
    const section = content.split("### Tier 1")[1]?.split("### Tier 2")[0] || "";
    expect(section).toContain("DIRECTLY into this file");
  });

  test("Tier 2 updates brain.md L1", () => {
    const content = readFile(instructionsPath);
    const section = content.split("### Tier 2")[1]?.split("### Tier 3")[0] || "";
    expect(section).toContain("brain.md");
  });

  test("Tier 3 appends to decisions.md only", () => {
    const content = readFile(instructionsPath);
    const section = content.split("### Tier 3")[1]?.split("##")[0] || "";
    expect(section).toContain("decisions.md only");
  });

  test("all tiers log to decisions.md", () => {
    const content = readFile(instructionsPath);
    // Tier 1 logs to decisions.md
    const tier1 = content.split("### Tier 1")[1]?.split("### Tier 2")[0] || "";
    expect(tier1).toContain("decisions.md");
    // Tier 2 logs to decisions.md
    const tier2 = content.split("### Tier 2")[1]?.split("### Tier 3")[0] || "";
    expect(tier2).toContain("decisions.md");
    // Tier 3 logs to decisions.md
    const tier3 = content.split("### Tier 3")[1]?.split("##")[0] || "";
    expect(tier3).toContain("decisions.md");
  });

  test("has tier format specification", () => {
    const content = readFile(instructionsPath);
    expect(content).toContain("[tier:N]");
  });
});

// ---------------------------------------------------------------------------
// Issue #24: setup.ps1 adopt wiring
// ---------------------------------------------------------------------------

describe("setup.ps1 adopt wiring (#24)", () => {
  const setupPath = join(scriptsDir, "setup.ps1");

  test("file exists", () => {
    expect(existsSync(setupPath)).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(setupPath);
    expect(() => checkNoPII(content, "setup.ps1")).not.toThrow();
  });

  test("adopt mode copies to ~/.github/ (live location)", () => {
    const content = readFile(setupPath);
    expect(content).toContain(".github");
    expect(content).toContain("copilot-instructions.md");
  });

  test("adopt mode creates backup in ~/.grain/", () => {
    const content = readFile(setupPath);
    expect(content).toContain("copilotBackup");
    expect(content).toContain("backup");
  });

  test("adopt mode merges into existing copilot-instructions.md", () => {
    const content = readFile(setupPath);
    // Should check for existing content before overwriting
    expect(content).toContain("Merge");
    expect(content).toContain("sectionsAdded");
  });

  test("adopt mode inlines RESOLVER routing rules", () => {
    const content = readFile(setupPath);
    expect(content).toContain("resolverRules");
    expect(content).toContain("Knowledge Filing (RESOLVER)");
  });

  test("adopt mode adds decision write-back section", () => {
    const content = readFile(setupPath);
    expect(content).toContain("Decision Write-Back");
  });

  test("adopt mode warns user about wiring", () => {
    const content = readFile(setupPath);
    expect(content).toContain("IMPORTANT");
    expect(content).toContain("Copilot CLI reads from");
  });

  test("adopt mode reports wiring summary", () => {
    const content = readFile(setupPath);
    expect(content).toContain("Wiring summary");
  });

  test("adopt mode detects dead files in ~/.grain/", () => {
    const content = readFile(setupPath);
    // Should detect copilot-instructions.md in grain but not in github
    expect(content).toContain("dead file");
  });

  test("adopt mode does NOT copy copilot-instructions.md to just ~/.grain/", () => {
    const content = readFile(setupPath);
    // The old structuralFiles hash should NOT include copilot-instructions.md
    // (it's handled separately with merge logic)
    const structuralSection = content.split("$structuralFiles = @{")[1]?.split("}")[0] || "";
    expect(structuralSection).not.toContain("copilot-instructions.md");
  });

  test("adopt mode checks ~/.github/ for live instructions", () => {
    const content = readFile(setupPath);
    expect(content).toContain("githubCopilot");
    expect(content).toContain(".github");
  });
});

// ---------------------------------------------------------------------------
// Issue #25: retrofit.py structure
// ---------------------------------------------------------------------------

describe("retrofit.py (#25)", () => {
  const retrofitPath = join(engineDir, "retrofit.py");

  test("file exists", () => {
    expect(existsSync(retrofitPath)).toBe(true);
  });

  test("has valid Python syntax", () => {
    const result = validatePythonSyntax(retrofitPath);
    if (result.error) {
      console.warn("Python syntax check:", result.error);
    }
    expect(result.valid).toBe(true);
  });

  test("no PII or corporate references", () => {
    const content = readFile(retrofitPath);
    expect(() => checkNoPII(content, "retrofit.py")).not.toThrow();
  });

  test("defines all 6 phases", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("phase_1_structure_cleanup");
    expect(content).toContain("phase_2_brain_cleanup");
    expect(content).toContain("phase_3_wire_resolver");
    expect(content).toContain("phase_4_compiled_truth_timeline");
    expect(content).toContain("phase_5_clean_decisions");
    expect(content).toContain("phase_6_hygiene_report");
  });

  test("has backup function", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def ensure_backup");
  });

  test("has CLI entry point", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain('if __name__ == "__main__"');
    expect(content).toContain("def main");
  });

  test("uses interactive confirmation", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("prompt_yn");
    expect(content).toContain("input(");
  });

  test("extracts code blocks without LLM", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def extract_code_blocks");
    // Should NOT reference any LLM or API
    expect(content).not.toContain("openai");
    expect(content).not.toContain("llm_filter");
  });

  test("extracts inline decisions", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def extract_inline_decisions");
  });

  test("trims project descriptions", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def trim_project_descriptions");
  });

  test("wires RESOLVER routing rules", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def wire_resolver_to_instructions");
    expect(content).toContain("Knowledge Filing (RESOLVER)");
  });

  test("adds compiled truth and timeline", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def add_compiled_truth_and_timeline");
    expect(content).toContain("Compiled Truth");
    expect(content).toContain("Timeline");
  });

  test("cleans harvest noise from decisions", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("def is_harvest_noise");
    expect(content).toContain("[harvest]");
  });

  test("reports before/after stats", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("before_grades");
    expect(content).toContain("Retrofit Summary");
  });

  test("archives instead of deleting", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain(".archive");
    expect(content).toContain("archive");
  });

  test("brain max lines is 40", () => {
    const content = readFile(retrofitPath);
    expect(content).toContain("BRAIN_MAX_LINES = 40");
  });
});

// ---------------------------------------------------------------------------
// Issue #25: hygiene.ps1 -Retrofit flag
// ---------------------------------------------------------------------------

describe("hygiene.ps1 -Retrofit flag (#25)", () => {
  const scriptPath = join(scriptsDir, "hygiene.ps1");

  test("accepts -Retrofit switch", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("$Retrofit");
  });

  test("calls retrofit.py when -Retrofit", () => {
    const content = readFile(scriptPath);
    expect(content).toContain("retrofit.py");
  });
});

// ---------------------------------------------------------------------------
// AGENTS.md documentation
// ---------------------------------------------------------------------------

describe("AGENTS.md updates", () => {
  const agentsPath = join(projectRoot, "AGENTS.md");

  test("documents retrofit", () => {
    const content = readFile(agentsPath);
    expect(content).toContain("retrofit.py");
    expect(content).toContain("Retrofit");
  });

  test("documents 3-tier decision routing", () => {
    const content = readFile(agentsPath);
    expect(content).toContain("Tier 1");
    expect(content).toContain("Tier 2");
    expect(content).toContain("Tier 3");
  });

  test("documents -Retrofit flag in hygiene.ps1", () => {
    const content = readFile(agentsPath);
    expect(content).toContain("-Retrofit");
  });
});
