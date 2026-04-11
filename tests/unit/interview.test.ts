/**
 * Unit tests for the interview mode setup.
 *
 * Validates:
 *  - interview-protocol.md structure, steps, and content safety
 *  - setup.ps1 flag handling
 *  - No PII or corporate references in any interview-related file
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..", "..");
const PROTOCOL_PATH = join(ROOT, "scripts", "interview-protocol.md");
const SETUP_PATH = join(ROOT, "scripts", "setup.ps1");
const README_PATH = join(ROOT, "README.md");

// ---------------------------------------------------------------------------
// Load file content once
// ---------------------------------------------------------------------------

let protocol = "";
let setup = "";
let readme = "";

beforeAll(() => {
  protocol = readFileSync(PROTOCOL_PATH, "utf-8");
  setup = readFileSync(SETUP_PATH, "utf-8");
  readme = readFileSync(README_PATH, "utf-8");
});

// ---------------------------------------------------------------------------
// Existence checks
// ---------------------------------------------------------------------------

describe("interview file existence", () => {
  test("interview-protocol.md exists", () => {
    expect(existsSync(PROTOCOL_PATH)).toBe(true);
  });

  test("setup.ps1 exists", () => {
    expect(existsSync(SETUP_PATH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Protocol structure — all 9 steps
// ---------------------------------------------------------------------------

describe("interview protocol steps", () => {
  const expectedSteps = [
    "Step 1",
    "Step 2",
    "Step 3",
    "Step 4",
    "Step 5",
    "Step 6",
    "Step 7",
    "Step 8",
    "Step 9",
  ];

  for (const step of expectedSteps) {
    test(`protocol contains ${step}`, () => {
      expect(protocol).toContain(step);
    });
  }

  test("protocol has exactly 9 step headings", () => {
    const stepHeadings = protocol.match(/^## Step \d+/gm) || [];
    expect(stepHeadings.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Protocol step content checks
// ---------------------------------------------------------------------------

describe("interview protocol step content", () => {
  test("Step 1 references session mining", () => {
    expect(protocol).toContain("session-store.db");
    expect(protocol).toContain("indexer.py");
  });

  test("Step 2 covers identity", () => {
    expect(protocol).toContain("name");
    expect(protocol).toContain("GitHub");
  });

  test("Step 3 covers domains", () => {
    expect(protocol).toContain("domains/");
    expect(protocol).toContain("cluster");
  });

  test("Step 4 covers people", () => {
    expect(protocol).toContain("people");
    expect(protocol).toContain("mentions");
  });

  test("Step 5 covers writing style", () => {
    expect(protocol).toContain("persona.md");
    expect(protocol).toContain("voice");
  });

  test("Step 6 covers decisions", () => {
    expect(protocol).toContain("decisions.md");
    expect(protocol).toContain("decided");
  });

  test("Step 7 covers pending actions", () => {
    expect(protocol).toContain("actions.md");
    expect(protocol).toContain("pending");
  });

  test("Step 8 covers brain.md generation", () => {
    expect(protocol).toContain("brain.md");
    expect(protocol).toContain("550 tokens");
  });

  test("Step 9 covers verification", () => {
    expect(protocol).toContain("lint");
    expect(protocol).toContain("ready");
  });
});

// ---------------------------------------------------------------------------
// Protocol references correct file paths
// ---------------------------------------------------------------------------

describe("interview protocol file path references", () => {
  test("references brain.md", () => {
    expect(protocol).toContain("brain.md");
  });

  test("references domains/ directory", () => {
    expect(protocol).toContain("domains/");
  });

  test("references decisions.md", () => {
    expect(protocol).toContain("decisions.md");
  });

  test("references actions.md", () => {
    expect(protocol).toContain("actions.md");
  });

  test("references persona.md", () => {
    expect(protocol).toContain("persona.md");
  });

  test("references wiki/people/", () => {
    expect(protocol).toContain("wiki/people/");
  });

  test("references domains/comms.md", () => {
    expect(protocol).toContain("domains/comms.md");
  });

  test("references ~/.grain/ base path", () => {
    expect(protocol).toContain("~/.grain/");
  });

  test("references indexer.py for session mining", () => {
    expect(protocol).toContain("indexer.py");
  });

  test("references session-store.db", () => {
    expect(protocol).toContain("session-store.db");
  });
});

// ---------------------------------------------------------------------------
// Protocol guidelines
// ---------------------------------------------------------------------------

describe("interview protocol guidelines", () => {
  test("has Guidelines section", () => {
    expect(protocol).toContain("## Guidelines");
  });

  test("mentions asking one question at a time", () => {
    expect(protocol.toLowerCase()).toContain("one question at a time");
  });

  test("mentions showing data first", () => {
    expect(protocol.toLowerCase()).toContain("show data first");
  });

  test("mentions skip/later handling", () => {
    expect(protocol.toLowerCase()).toContain("skip");
  });

  test("mentions 15-30 minute target", () => {
    expect(protocol).toContain("15-30 minutes");
  });

  test("mentions conversational tone", () => {
    expect(protocol.toLowerCase()).toContain("conversational");
  });

  test("ends with brain ready message", () => {
    expect(protocol).toContain("Your brain is ready");
  });
});

// ---------------------------------------------------------------------------
// PII / corporate content checks — ZERO tolerance
// ---------------------------------------------------------------------------

describe("interview protocol has no PII or corporate content", () => {
  const forbiddenStrings = [
    "microsoft",
    "Microsoft",
    "MICROSOFT",
    "msft",
    "MSFT",
    "@microsoft.com",
    "azure devops",
    "Azure DevOps",
    "visualstudio.com",
    "dev.azure.com",
    "corp.microsoft",
    "redmond",
    "Redmond",
    "aviraldua",
    "aviral",
  ];

  for (const forbidden of forbiddenStrings) {
    test(`protocol does not contain "${forbidden}"`, () => {
      expect(protocol).not.toContain(forbidden);
    });
  }

  test("protocol has no email addresses", () => {
    const emailRegex = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/g;
    const matches = protocol.match(emailRegex);
    expect(matches).toBeNull();
  });

  test("protocol has no internal URLs", () => {
    const internalUrlRegex =
      /https?:\/\/[a-zA-Z0-9.-]*\.(visualstudio\.com|azure\.com\/[a-zA-Z0-9_-]+\/_)/g;
    const matches = protocol.match(internalUrlRegex);
    expect(matches).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setup.ps1 flag handling
// ---------------------------------------------------------------------------

describe("setup.ps1 flag support", () => {
  test("setup.ps1 declares Interview parameter", () => {
    expect(setup).toContain("[switch]$Interview");
  });

  test("setup.ps1 declares Quick parameter", () => {
    expect(setup).toContain("[switch]$Quick");
  });

  test("setup.ps1 has param block", () => {
    expect(setup).toContain("param(");
  });

  test("setup.ps1 handles mode selection when no flags passed", () => {
    expect(setup).toContain("-not $Interview -and -not $Quick");
  });

  test("setup.ps1 interview mode copies interview-protocol.md", () => {
    expect(setup).toContain("interview-protocol.md");
  });

  test("setup.ps1 interview mode prints copilot launch command", () => {
    expect(setup).toContain("copilot");
    expect(setup).toContain("interview-protocol.md");
  });

  test("setup.ps1 interview mode creates ~/.grain/ directories", () => {
    expect(setup).toContain("wiki");
    expect(setup).toContain("domains");
    expect(setup).toContain("reference");
  });

  test("setup.ps1 still contains quick setup form questions", () => {
    expect(setup).toContain("Read-Host");
    expect(setup).toContain("Your name");
  });
});

// ---------------------------------------------------------------------------
// setup.ps1 PII checks
// ---------------------------------------------------------------------------

describe("setup.ps1 has no PII or corporate content", () => {
  const forbiddenStrings = [
    "@microsoft.com",
    "visualstudio.com",
    "dev.azure.com",
    "corp.microsoft",
  ];

  for (const forbidden of forbiddenStrings) {
    test(`setup.ps1 does not contain "${forbidden}"`, () => {
      expect(setup).not.toContain(forbidden);
    });
  }
});

// ---------------------------------------------------------------------------
// README integration
// ---------------------------------------------------------------------------

describe("README documents interview mode", () => {
  test("README mentions Quick Setup", () => {
    expect(readme.toLowerCase()).toContain("quick setup");
  });

  test("README mentions Deep Interview", () => {
    expect(readme.toLowerCase()).toContain("deep interview");
  });

  test("README mentions -Interview flag", () => {
    expect(readme).toContain("-Interview");
  });

  test("README mentions -Quick flag", () => {
    expect(readme).toContain("-Quick");
  });

  test("README describes session mining in interview", () => {
    expect(readme.toLowerCase()).toMatch(/mine|session|interview/);
  });
});

// ---------------------------------------------------------------------------
// Protocol does not reference internal/corporate content
// ---------------------------------------------------------------------------

describe("protocol is platform-agnostic", () => {
  test("protocol does not reference Windows-specific paths with backslashes", () => {
    // Should use ~/  not C:\Users\
    expect(protocol).not.toContain("C:\\Users");
  });

  test("protocol uses generic ~/.grain/ paths", () => {
    const grainRefs = protocol.match(/~\/\.grain\//g) || [];
    expect(grainRefs.length).toBeGreaterThan(5);
  });

  test("protocol does not reference any specific company tools", () => {
    const corporateTools = ["Teams", "Outlook", "SharePoint", "OneDrive"];
    for (const tool of corporateTools) {
      expect(protocol).not.toContain(tool);
    }
  });

  test("protocol uses generic examples for people names", () => {
    // The example names (Sarah, Jake) should be generic, not real people
    // Just verify no surnames are attached that could be PII
    expect(protocol).not.toMatch(/Sarah [A-Z][a-z]+/);
    expect(protocol).not.toMatch(/Jake [A-Z][a-z]+/);
  });
});
