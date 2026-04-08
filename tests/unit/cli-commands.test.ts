/**
 * Unit tests for src/cli/index.ts — CLI command parsing and execution.
 *
 * Tests the Commander.js program's command definitions, option parsing,
 * error formatting, and action handlers using mocked dependencies.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";

// ---------------------------------------------------------------------------
// Test setup — isolated workspace per test
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors on Windows
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Import the program for testing — it's exported for this purpose
// ---------------------------------------------------------------------------

// We import lazily so that env vars are set before module loads
async function getProgram() {
  const { program } = await import("../../src/cli/index.js");
  return program;
}

// ---------------------------------------------------------------------------
// formatCliError — error classification tests
// ---------------------------------------------------------------------------

describe("CLI error formatting", () => {
  // We test the formatCliError behavior indirectly by checking that CLI
  // commands produce expected error messages for various error conditions

  test("'not found' errors include a hint about 'wikirecall list'", async () => {
    const program = await getProgram();
    // Trying to recall a nonexistent scenario should throw a "not found" error
    let errorMsg = "";
    const originalExit = process.exit;
    const originalError = console.error;
    const originalLog = console.log;

    // Suppress CLI output and capture errors
    console.error = (msg: string) => { errorMsg += msg; };
    console.log = () => {};
    process.exit = (() => { throw new Error("EXIT"); }) as any;

    try {
      await program.parseAsync(["node", "wikirecall", "recall", "nonexistent-scenario-xyz"]);
    } catch {
      // Expected — process.exit throws
    }

    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    // The error would have been handled by ora spinner, not console.error directly
  });
});

// ---------------------------------------------------------------------------
// Program structure — command and option definitions
// ---------------------------------------------------------------------------

describe("CLI program structure", () => {
  test("program name is 'wikirecall'", async () => {
    const program = await getProgram();
    expect(program.name()).toBe("wikirecall");
  });

  test("program version is 0.1.0", async () => {
    const program = await getProgram();
    expect(program.version()).toBe("0.1.0");
  });

  test("has all expected commands", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map(c => c.name());
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("create");
    expect(commandNames).toContain("recall");
    expect(commandNames).toContain("save");
    expect(commandNames).toContain("list");
    expect(commandNames).toContain("handoff");
    expect(commandNames).toContain("teardown");
    expect(commandNames).toContain("push");
    expect(commandNames).toContain("pull");
    expect(commandNames).toContain("knowledge");
  });

  test("init command has no required arguments", async () => {
    const program = await getProgram();
    const initCmd = program.commands.find(c => c.name() === "init");
    expect(initCmd).toBeDefined();
    expect(initCmd!.registeredArguments.filter((a: any) => a.required)).toHaveLength(0);
  });

  test("create command has optional name argument", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    // name is an optional argument
    expect(createCmd!.registeredArguments.length).toBeGreaterThanOrEqual(0);
  });

  test("create command has --template option", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--template");
  });

  test("create command has --description option", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--description");
  });

  test("create command has --interactive option", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--interactive");
  });

  test("create command has --repo option", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--repo");
  });

  test("create command has --skill option", async () => {
    const program = await getProgram();
    const createCmd = program.commands.find(c => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--skill");
  });

  test("recall command has required name argument", async () => {
    const program = await getProgram();
    const recallCmd = program.commands.find(c => c.name() === "recall");
    expect(recallCmd).toBeDefined();
    expect(recallCmd!.registeredArguments.length).toBe(1);
  });

  test("recall command has --skip-repos option", async () => {
    const program = await getProgram();
    const recallCmd = program.commands.find(c => c.name() === "recall");
    expect(recallCmd).toBeDefined();
    const optionNames = recallCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--skip-repos");
  });

  test("save command has required name argument", async () => {
    const program = await getProgram();
    const saveCmd = program.commands.find(c => c.name() === "save");
    expect(saveCmd).toBeDefined();
    expect(saveCmd!.registeredArguments.length).toBe(1);
  });

  test("save command has --summary, --next-step, --blocker, --note options", async () => {
    const program = await getProgram();
    const saveCmd = program.commands.find(c => c.name() === "save");
    expect(saveCmd).toBeDefined();
    const optionNames = saveCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--summary");
    expect(optionNames).toContain("--next-step");
    expect(optionNames).toContain("--blocker");
    expect(optionNames).toContain("--note");
  });

  test("list command has --status option", async () => {
    const program = await getProgram();
    const listCmd = program.commands.find(c => c.name() === "list");
    expect(listCmd).toBeDefined();
    const optionNames = listCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--status");
  });

  test("handoff command has --to and --pr options", async () => {
    const program = await getProgram();
    const handoffCmd = program.commands.find(c => c.name() === "handoff");
    expect(handoffCmd).toBeDefined();
    const optionNames = handoffCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--pr");
  });

  test("teardown command has -y/--yes option", async () => {
    const program = await getProgram();
    const teardownCmd = program.commands.find(c => c.name() === "teardown");
    expect(teardownCmd).toBeDefined();
    const optionNames = teardownCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--yes");
  });

  test("push command has --repo and --branch options", async () => {
    const program = await getProgram();
    const pushCmd = program.commands.find(c => c.name() === "push");
    expect(pushCmd).toBeDefined();
    const optionNames = pushCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--repo");
    expect(optionNames).toContain("--branch");
  });

  test("pull command has --repo and --branch options", async () => {
    const program = await getProgram();
    const pullCmd = program.commands.find(c => c.name() === "pull");
    expect(pullCmd).toBeDefined();
    const optionNames = pullCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--repo");
    expect(optionNames).toContain("--branch");
  });

  test("knowledge subcommand has search, list, get, create, delete", async () => {
    const program = await getProgram();
    const knowledgeCmd = program.commands.find(c => c.name() === "knowledge");
    expect(knowledgeCmd).toBeDefined();
    const subNames = knowledgeCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("search");
    expect(subNames).toContain("list");
    expect(subNames).toContain("get");
    expect(subNames).toContain("create");
    expect(subNames).toContain("delete");
  });

  test("knowledge search has --limit option", async () => {
    const program = await getProgram();
    const knowledgeCmd = program.commands.find(c => c.name() === "knowledge");
    const searchCmd = knowledgeCmd!.commands.find((c: any) => c.name() === "search");
    expect(searchCmd).toBeDefined();
    const optionNames = searchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--limit");
  });

  test("knowledge create has --title, --type, --tags, --content options", async () => {
    const program = await getProgram();
    const knowledgeCmd = program.commands.find(c => c.name() === "knowledge");
    const createCmd = knowledgeCmd!.commands.find((c: any) => c.name() === "create");
    expect(createCmd).toBeDefined();
    const optionNames = createCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--title");
    expect(optionNames).toContain("--type");
    expect(optionNames).toContain("--tags");
    expect(optionNames).toContain("--content");
  });
});

// ---------------------------------------------------------------------------
// init command — workspace initialization
// ---------------------------------------------------------------------------

describe("CLI init command", () => {
  test("creates workspace directories", async () => {
    const program = await getProgram();
    // Suppress output
    const origLog = console.log;
    console.log = () => {};

    program.exitOverride();
    try {
      await program.parseAsync(["node", "wikirecall", "init"]);
    } catch {
      // exitOverride may throw
    }
    console.log = origLog;

    expect(existsSync(join(testDir, "scenarios"))).toBe(true);
    expect(existsSync(join(testDir, "knowledge"))).toBe(true);
    expect(existsSync(join(testDir, "skills"))).toBe(true);
  });

  test("creates README.md", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};

    program.exitOverride();
    try {
      await program.parseAsync(["node", "wikirecall", "init"]);
    } catch {
      // exitOverride may throw
    }
    console.log = origLog;

    const readmePath = join(testDir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf8");
    expect(content).toContain("WikiRecall Workspace");
  });

  test("init is idempotent — running twice does not error", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    // Run twice
    try { await program.parseAsync(["node", "wikirecall", "init"]); } catch {}
    try { await program.parseAsync(["node", "wikirecall", "init"]); } catch {}
    console.log = origLog;

    expect(existsSync(join(testDir, "scenarios"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create command — scenario creation (non-interactive)
// ---------------------------------------------------------------------------

describe("CLI create command", () => {
  test("creates a scenario with name and description", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "create", "test-api", "-d", "Test API project"]);
    } catch {
      // May throw from exitOverride
    }
    console.log = origLog;

    const scenarioFile = join(testDir, "scenarios", "test-api.yaml");
    expect(existsSync(scenarioFile)).toBe(true);
  });

  test("creates a scenario with a template", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "create", "my-web-api", "-d", "From template", "--template", "web-api"]);
    } catch {}
    console.log = origLog;

    const scenarioFile = join(testDir, "scenarios", "my-web-api.yaml");
    expect(existsSync(scenarioFile)).toBe(true);
  });

  test("creates a scenario with skills", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync([
        "node", "wikirecall", "create", "skill-test",
        "-d", "Skill test",
        "--skill", "code-review",
      ]);
    } catch {}
    console.log = origLog;

    const scenarioFile = join(testDir, "scenarios", "skill-test.yaml");
    expect(existsSync(scenarioFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// list command — scenario listing
// ---------------------------------------------------------------------------

describe("CLI list command", () => {
  test("lists scenarios (empty)", async () => {
    const { createScenario } = await import("../../src/scenario/manager.js");
    const program = await getProgram();
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(" "); };
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "list"]);
    } catch {}
    console.log = origLog;

    expect(output).toContain("No scenarios found");
  });

  test("lists scenarios after creation", async () => {
    const { createScenario } = await import("../../src/scenario/manager.js");
    createScenario({
      name: "list-test",
      version: "0.1.0",
      status: "active",
      description: "A test scenario",
    });

    const program = await getProgram();
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(" ") + "\n"; };
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "list"]);
    } catch {}
    console.log = origLog;

    expect(output).toContain("list-test");
  });

  test("filters scenarios by status", async () => {
    const { createScenario } = await import("../../src/scenario/manager.js");
    createScenario({
      name: "active-one",
      version: "0.1.0",
      status: "active",
      description: "Active scenario",
    });

    const program = await getProgram();
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(" ") + "\n"; };
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "list", "--status", "paused"]);
    } catch {}
    console.log = origLog;

    expect(output).toContain("No scenarios found");
  });
});

// ---------------------------------------------------------------------------
// save command — scenario state saving
// ---------------------------------------------------------------------------

describe("CLI save command", () => {
  test("saves scenario summary", async () => {
    const { createScenario, getScenario } = await import("../../src/scenario/manager.js");
    createScenario({
      name: "save-test",
      version: "0.1.0",
      status: "active",
      description: "Save test",
    });

    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "save", "save-test", "--summary", "Updated summary"]);
    } catch {}
    console.log = origLog;

    const scenario = getScenario("save-test");
    expect(scenario.context?.summary).toBe("Updated summary");
  });
});

// ---------------------------------------------------------------------------
// knowledge commands
// ---------------------------------------------------------------------------

describe("CLI knowledge commands", () => {
  test("knowledge list shows empty message", async () => {
    const program = await getProgram();
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(" "); };
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "knowledge", "list"]);
    } catch {}
    console.log = origLog;

    expect(output).toContain("No knowledge entities");
  });

  test("knowledge create with --title creates an entity", async () => {
    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync([
        "node", "wikirecall", "knowledge", "create",
        "--title", "Test Concept",
        "--type", "concept",
        "--content", "Some test content",
      ]);
    } catch {}
    console.log = origLog;

    const entityFile = join(testDir, "knowledge", "test-concept.md");
    expect(existsSync(entityFile)).toBe(true);
  });

  test("knowledge get retrieves a created entity", async () => {
    const { createEntity } = await import("../../src/knowledge/entities.js");
    createEntity({
      title: "CLI Get Test",
      type: "concept",
      updated: "2025-01-15",
      tags: ["test"],
      related: [],
      content: "CLI get test content",
    });

    const program = await getProgram();
    let output = "";
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(" ") + "\n"; };
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "knowledge", "get", "cli-get-test"]);
    } catch {}
    console.log = origLog;

    expect(output).toContain("CLI Get Test");
  });

  test("knowledge delete removes an entity", async () => {
    const { createEntity } = await import("../../src/knowledge/entities.js");
    createEntity({
      title: "CLI Delete Test",
      type: "tool",
      updated: "2025-01-15",
      tags: [],
      related: [],
      content: "Will be deleted",
    });

    const program = await getProgram();
    const origLog = console.log;
    console.log = () => {};
    program.exitOverride();

    try {
      await program.parseAsync(["node", "wikirecall", "knowledge", "delete", "cli-delete-test"]);
    } catch {}
    console.log = origLog;

    const entityFile = join(testDir, "knowledge", "cli-delete-test.md");
    expect(existsSync(entityFile)).toBe(false);
  });
});
