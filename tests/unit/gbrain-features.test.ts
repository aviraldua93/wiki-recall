/**
 * Unit tests for GBrain depth upgrade — Priority 1 features.
 *
 * Validates:
 *  1.1 Compiled Truth + Timeline page format across all templates
 *  1.2 RESOLVER.md filing decision tree
 *  1.3 [No data yet] enrichment prompts in all templates
 *  1.4 Source attribution discipline in AGENTS.md and interview-protocol.md
 *  PII safety — no corporate/internal references
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..", "..");
const TEMPLATES = join(ROOT, "templates");
const AGENTS_PATH = join(ROOT, "AGENTS.md");
const PROTOCOL_PATH = join(ROOT, "protocols", "interview-protocol.md");

const templateFiles = {
  brain: join(TEMPLATES, "brain.md"),
  actions: join(TEMPLATES, "actions.md"),
  decisions: join(TEMPLATES, "decisions.md"),
  domain: join(TEMPLATES, "domain-template.md"),
  project: join(TEMPLATES, "project-template.md"),
  people: join(TEMPLATES, "people-template.md"),
  resolver: join(TEMPLATES, "RESOLVER.md"),
  copilot: join(TEMPLATES, "copilot-instructions.md"),
  persona: join(TEMPLATES, "persona.md"),
  wikiIndex: join(TEMPLATES, "wiki-index.md"),
};

// ---------------------------------------------------------------------------
// Load all content once
// ---------------------------------------------------------------------------

const content: Record<string, string> = {};

beforeAll(() => {
  for (const [key, path] of Object.entries(templateFiles)) {
    if (existsSync(path)) {
      content[key] = readFileSync(path, "utf-8");
    }
  }
  if (existsSync(AGENTS_PATH)) {
    content.agents = readFileSync(AGENTS_PATH, "utf-8");
  }
  if (existsSync(PROTOCOL_PATH)) {
    content.protocol = readFileSync(PROTOCOL_PATH, "utf-8");
  }
});

// ---------------------------------------------------------------------------
// PII / corporate reference forbidden strings
// ---------------------------------------------------------------------------

const FORBIDDEN_STRINGS = [
  "microsoft",
  "msft",
  "azure devops",
  "sharepoint",
  "eng.ms",
  "aka.ms",
  "corp.microsoft",
  "@microsoft.com",
  "internal-tool",
  "oneclient",
  "1es",
];

function assertNoPII(text: string, fileName: string) {
  const lower = text.toLowerCase();
  // Strip the "no internal/corporate references" policy section from AGENTS.md
  // since it legitimately names things to avoid (e.g., "SharePoint", "eng.ms")
  const cleaned = lower.replace(
    /## important: no internal\/corporate references[\s\S]*?use only generic, public github references\./,
    ""
  );
  for (const s of FORBIDDEN_STRINGS) {
    expect(cleaned).not.toContain(s);
  }
}

// ===========================================================================
// 1.2 RESOLVER.md — Filing Decision Tree
// ===========================================================================

describe("1.2 RESOLVER.md — filing decision tree", () => {
  test("RESOLVER.md exists", () => {
    expect(existsSync(templateFiles.resolver)).toBe(true);
  });

  test("has all 8 filing rules", () => {
    const r = content.resolver;
    expect(r).toContain("PERSON");
    expect(r).toContain("PROJECT");
    expect(r).toContain("BUG/FIX/WORKAROUND");
    expect(r).toContain("TECH CONCEPT");
    expect(r).toContain("DECISION");
    expect(r).toContain("COMMITMENT");
    expect(r).toContain("VISION/STRATEGY");
    expect(r).toContain("harvest-suggestions.md");
  });

  test("filing rule 1 routes PERSON to wiki/people/", () => {
    expect(content.resolver).toContain("wiki/people/");
  });

  test("filing rule 2 routes PROJECT to wiki/projects/", () => {
    expect(content.resolver).toContain("wiki/projects/");
  });

  test("filing rule 3 routes BUG to wiki/patterns/", () => {
    expect(content.resolver).toContain("wiki/patterns/");
  });

  test("filing rule 4 routes CONCEPT to wiki/concepts/", () => {
    expect(content.resolver).toContain("wiki/concepts/");
  });

  test("filing rule 5 routes DECISION to decisions.md", () => {
    expect(content.resolver).toContain("decisions.md");
  });

  test("filing rule 6 routes COMMITMENT to actions.md", () => {
    expect(content.resolver).toContain("actions.md");
  });

  test("describes page format (compiled truth + timeline)", () => {
    expect(content.resolver).toContain("Compiled Truth");
    expect(content.resolver).toContain("Timeline");
  });

  test("includes source attribution types", () => {
    expect(content.resolver).toContain("observed");
    expect(content.resolver).toContain("self-stated");
    expect(content.resolver).toContain("inferred");
  });

  test("no PII in RESOLVER.md", () => {
    assertNoPII(content.resolver, "RESOLVER.md");
  });
});

// ===========================================================================
// 1.1 Compiled Truth + Timeline — project-template.md
// ===========================================================================

describe("1.1 project-template.md — compiled truth + timeline", () => {
  test("project-template.md exists", () => {
    expect(existsSync(templateFiles.project)).toBe(true);
  });

  test("has YAML frontmatter with type: project", () => {
    expect(content.project).toContain("type: project");
  });

  test("has Compiled Truth section", () => {
    expect(content.project).toContain("## Compiled Truth");
  });

  test("has Architecture section", () => {
    expect(content.project).toContain("## Architecture");
  });

  test("has Decisions section", () => {
    expect(content.project).toContain("## Decisions");
  });

  test("has Timeline section with append-only note", () => {
    expect(content.project).toContain("## Timeline (append-only, never delete)");
  });

  test("timeline has date + session attribution format", () => {
    expect(content.project).toContain("[YYYY-MM-DD]");
    expect(content.project).toContain("session:");
  });

  test("has tier field in frontmatter", () => {
    expect(content.project).toContain("tier:");
  });

  test("no PII in project-template.md", () => {
    assertNoPII(content.project, "project-template.md");
  });
});

// ===========================================================================
// 1.1 Compiled Truth + Timeline — people-template.md
// ===========================================================================

describe("1.1 people-template.md — compiled truth + working relationship + timeline", () => {
  test("people-template.md exists", () => {
    expect(existsSync(templateFiles.people)).toBe(true);
  });

  test("has YAML frontmatter with type: person", () => {
    expect(content.people).toContain("type: person");
  });

  test("has Compiled Truth section", () => {
    expect(content.people).toContain("## Compiled Truth");
  });

  test("has Working Relationship section", () => {
    expect(content.people).toContain("## Working Relationship");
  });

  test("Working Relationship has Reports to field", () => {
    expect(content.people).toContain("Reports to:");
  });

  test("Working Relationship has Collaborates on field", () => {
    expect(content.people).toContain("Collaborates on:");
  });

  test("Working Relationship has Communication field", () => {
    expect(content.people).toContain("Communication:");
  });

  test("Working Relationship has Review pattern field", () => {
    expect(content.people).toContain("Review pattern:");
  });

  test("has Timeline section with append-only note", () => {
    expect(content.people).toContain("## Timeline (append-only, never delete)");
  });

  test("has tier field in frontmatter", () => {
    expect(content.people).toContain("tier:");
  });

  test("no PII in people-template.md", () => {
    assertNoPII(content.people, "people-template.md");
  });
});

// ===========================================================================
// 1.1 Compiled Truth + Timeline — brain.md
// ===========================================================================

describe("1.1 brain.md — compiled truth + timeline in L1", () => {
  test("brain.md has Compiled Truth section", () => {
    expect(content.brain).toContain("### Compiled Truth");
  });

  test("brain.md has Timeline section with append-only note", () => {
    expect(content.brain).toContain("### Timeline (append-only, never delete)");
  });

  test("brain.md timeline has date + session format", () => {
    expect(content.brain).toContain("[YYYY-MM-DD]");
    expect(content.brain).toContain("session:");
  });
});

// ===========================================================================
// 1.1 Compiled Truth + Timeline — domain-template.md
// ===========================================================================

describe("1.1 domain-template.md — compiled truth + timeline", () => {
  test("domain-template.md has Compiled Truth section", () => {
    expect(content.domain).toContain("## Compiled Truth");
  });

  test("domain-template.md has Timeline section", () => {
    expect(content.domain).toContain("## Timeline (append-only, never delete)");
  });

  test("domain-template.md has YAML frontmatter with type: domain", () => {
    expect(content.domain).toContain("type: domain");
  });
});

// ===========================================================================
// 1.3 [No data yet] enrichment prompts
// ===========================================================================

describe("1.3 [No data yet] enrichment prompts", () => {
  test("brain.md uses [No data yet]", () => {
    expect(content.brain).toContain("[No data yet");
  });

  test("actions.md has structured format", () => {
    expect(content.actions).toContain("## Pending");
    expect(content.actions).toContain("## Waiting On");
    expect(content.actions).toContain("## Done");
  });

  test("decisions.md uses [No data yet]", () => {
    expect(content.decisions).toContain("[No data yet]");
  });

  test("domain-template.md uses [No data yet]", () => {
    expect(content.domain).toContain("[No data yet]");
  });

  test("project-template.md uses [No data yet]", () => {
    expect(content.project).toContain("[No data yet]");
  });

  test("people-template.md uses [No data yet]", () => {
    expect(content.people).toContain("[No data yet]");
  });

  test("persona.md uses [No data yet]", () => {
    expect(content.persona).toContain("[No data yet]");
  });

  test("wiki-index.md uses [No data yet]", () => {
    expect(content.wikiIndex).toContain("[No data yet]");
  });

  test("copilot-instructions.md references RESOLVER.md", () => {
    expect(content.copilot).toContain("RESOLVER.md");
  });
});

// ===========================================================================
// 1.4 Source Attribution Discipline
// ===========================================================================

describe("1.4 source attribution in AGENTS.md", () => {
  test("AGENTS.md has Source Attribution section", () => {
    expect(content.agents).toContain("## Source Attribution");
  });

  test("AGENTS.md mentions observed source type", () => {
    expect(content.agents).toContain("observed");
  });

  test("AGENTS.md mentions self-stated source type", () => {
    expect(content.agents).toContain("self-stated");
  });

  test("AGENTS.md mentions inferred source type", () => {
    expect(content.agents).toContain("inferred");
  });

  test("AGENTS.md mentions confidence levels", () => {
    expect(content.agents).toContain("high|medium|low");
  });

  test("AGENTS.md mentions compiled truth + timeline format", () => {
    expect(content.agents).toContain("Compiled Truth");
    expect(content.agents).toContain("Timeline");
  });
});

describe("1.4 source attribution in interview-protocol.md", () => {
  test("interview-protocol.md mentions compiled truth + timeline", () => {
    expect(content.protocol).toContain("compiled truth");
  });

  test("interview-protocol.md references people-template.md", () => {
    expect(content.protocol).toContain("people-template.md");
  });

  test("interview-protocol.md references project-template.md", () => {
    expect(content.protocol).toContain("project-template.md");
  });

  test("interview-protocol.md mentions source attribution", () => {
    expect(content.protocol).toContain("source attribution");
  });

  test("interview-protocol.md references RESOLVER.md", () => {
    expect(content.protocol).toContain("RESOLVER.md");
  });
});

// ===========================================================================
// PII scan across ALL new/modified files
// ===========================================================================

describe("PII safety — no corporate references in any file", () => {
  const filesToCheck = [
    "brain", "actions", "decisions", "domain", "project",
    "people", "resolver", "copilot", "persona", "wikiIndex",
    "agents", "protocol",
  ];

  for (const key of filesToCheck) {
    test(`no PII in ${key}`, () => {
      if (content[key]) {
        assertNoPII(content[key], key);
      }
    });
  }
});
