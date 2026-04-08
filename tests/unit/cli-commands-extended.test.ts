/**
 * Extended CLI command tests — covers commands not tested in cli-commands.test.ts:
 * papers, visualize, memory, mcp, benchmark
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-cli-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

async function getProgram() {
  const { program } = await import("../../src/cli/index.js");
  return program;
}

// ---------------------------------------------------------------------------
// papers command structure
// ---------------------------------------------------------------------------

describe("CLI papers command structure", () => {
  test("papers subcommand exists", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    expect(commandNames).toContain("papers");
  });

  test("papers has search subcommand", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    expect(papersCmd).toBeDefined();
    const subNames = papersCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("search");
  });

  test("papers has curate subcommand", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const subNames = papersCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("curate");
  });

  test("papers has ingest subcommand", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const subNames = papersCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("ingest");
  });

  test("papers search has --limit option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const searchCmd = papersCmd!.commands.find((c: any) => c.name() === "search");
    expect(searchCmd).toBeDefined();
    const optionNames = searchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--limit");
  });

  test("papers search has --source option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const searchCmd = papersCmd!.commands.find((c: any) => c.name() === "search");
    const optionNames = searchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--source");
  });

  test("papers search has required query argument", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const searchCmd = papersCmd!.commands.find((c: any) => c.name() === "search");
    expect(searchCmd!.registeredArguments.length).toBeGreaterThanOrEqual(1);
  });

  test("papers curate has --topics option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const curateCmd = papersCmd!.commands.find((c: any) => c.name() === "curate");
    expect(curateCmd).toBeDefined();
    const optionNames = curateCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--topics");
  });

  test("papers curate has --keywords option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const curateCmd = papersCmd!.commands.find((c: any) => c.name() === "curate");
    const optionNames = curateCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--keywords");
  });

  test("papers curate has --max-papers option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const curateCmd = papersCmd!.commands.find((c: any) => c.name() === "curate");
    const optionNames = curateCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--max-papers");
  });

  test("papers curate has --source option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const curateCmd = papersCmd!.commands.find((c: any) => c.name() === "curate");
    const optionNames = curateCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--source");
  });

  test("papers curate has --min-score option", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const curateCmd = papersCmd!.commands.find((c: any) => c.name() === "curate");
    const optionNames = curateCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--min-score");
  });

  test("papers ingest has required paper-id argument", async () => {
    const program = await getProgram();
    const papersCmd = program.commands.find((c: any) => c.name() === "papers");
    const ingestCmd = papersCmd!.commands.find((c: any) => c.name() === "ingest");
    expect(ingestCmd).toBeDefined();
    expect(ingestCmd!.registeredArguments.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// visualize command structure
// ---------------------------------------------------------------------------

describe("CLI visualize command structure", () => {
  test("visualize command exists", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    expect(commandNames).toContain("visualize");
  });

  test("visualize has --type option", async () => {
    const program = await getProgram();
    const vizCmd = program.commands.find((c: any) => c.name() === "visualize");
    expect(vizCmd).toBeDefined();
    const optionNames = vizCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--type");
  });

  test("visualize has --output option", async () => {
    const program = await getProgram();
    const vizCmd = program.commands.find((c: any) => c.name() === "visualize");
    const optionNames = vizCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--output");
  });

  test("visualize has --title option", async () => {
    const program = await getProgram();
    const vizCmd = program.commands.find((c: any) => c.name() === "visualize");
    const optionNames = vizCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--title");
  });

  test("visualize has --open option", async () => {
    const program = await getProgram();
    const vizCmd = program.commands.find((c: any) => c.name() === "visualize");
    const optionNames = vizCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--open");
  });
});

// ---------------------------------------------------------------------------
// memory command structure
// ---------------------------------------------------------------------------

describe("CLI memory command structure", () => {
  test("memory subcommand exists", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    expect(commandNames).toContain("memory");
  });

  test("memory has query subcommand", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    expect(memCmd).toBeDefined();
    const subNames = memCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("query");
  });

  test("memory has index subcommand", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const subNames = memCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("index");
  });

  test("memory has stats subcommand", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const subNames = memCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("stats");
  });

  test("memory has identity subcommand", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const subNames = memCmd!.commands.map((c: any) => c.name());
    expect(subNames).toContain("identity");
  });

  test("memory query has required query argument", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const queryCmd = memCmd!.commands.find((c: any) => c.name() === "query");
    expect(queryCmd).toBeDefined();
    expect(queryCmd!.registeredArguments.length).toBeGreaterThanOrEqual(1);
  });

  test("memory query has --layers option", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const queryCmd = memCmd!.commands.find((c: any) => c.name() === "query");
    const optionNames = queryCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--layers");
  });

  test("memory query has --max-tokens option", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const queryCmd = memCmd!.commands.find((c: any) => c.name() === "query");
    const optionNames = queryCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--max-tokens");
  });

  test("memory query has --domain option", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const queryCmd = memCmd!.commands.find((c: any) => c.name() === "query");
    const optionNames = queryCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--domain");
  });

  test("memory identity has --init option", async () => {
    const program = await getProgram();
    const memCmd = program.commands.find((c: any) => c.name() === "memory");
    const identityCmd = memCmd!.commands.find((c: any) => c.name() === "identity");
    expect(identityCmd).toBeDefined();
    const optionNames = identityCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--init");
  });
});

// ---------------------------------------------------------------------------
// mcp command structure
// ---------------------------------------------------------------------------

describe("CLI mcp command structure", () => {
  test("mcp command exists", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    expect(commandNames).toContain("mcp");
  });

  test("mcp has --list-tools option", async () => {
    const program = await getProgram();
    const mcpCmd = program.commands.find((c: any) => c.name() === "mcp");
    expect(mcpCmd).toBeDefined();
    const optionNames = mcpCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--list-tools");
  });
});

// ---------------------------------------------------------------------------
// benchmark command structure
// ---------------------------------------------------------------------------

describe("CLI benchmark command structure", () => {
  test("benchmark command exists", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    expect(commandNames).toContain("benchmark");
  });

  test("benchmark has --suite option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    expect(benchCmd).toBeDefined();
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--suite");
  });

  test("benchmark has --report option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--report");
  });

  test("benchmark has --entities option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--entities");
  });

  test("benchmark has --sessions option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--sessions");
  });

  test("benchmark has --queries option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--queries");
  });

  test("benchmark has --seed option", async () => {
    const program = await getProgram();
    const benchCmd = program.commands.find((c: any) => c.name() === "benchmark");
    const optionNames = benchCmd!.options.map((o: any) => o.long);
    expect(optionNames).toContain("--seed");
  });
});

// ---------------------------------------------------------------------------
// Full command list completeness
// ---------------------------------------------------------------------------

describe("CLI complete command list", () => {
  test("program has all 14 top-level commands", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    const expected = [
      "init", "create", "recall", "save", "list",
      "handoff", "teardown", "push", "pull",
      "knowledge", "papers", "visualize", "mcp",
      "memory", "benchmark",
    ];
    for (const name of expected) {
      expect(commandNames).toContain(name);
    }
  });

  test("no duplicate command names", async () => {
    const program = await getProgram();
    const commandNames = program.commands.map((c: any) => c.name());
    const unique = new Set(commandNames);
    expect(unique.size).toBe(commandNames.length);
  });
});
