/**
 * DevContext CLI — entry point for the command-line interface.
 *
 * Uses Commander.js to define commands for scenario and knowledge management.
 * Enhanced with chalk (coloured output), ora (spinners), and inquirer (prompts).
 */

import { Command } from "commander";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { createScenario, getScenario, listScenarios, updateScenario } from "../scenario/manager.js";
import { resumeScenario, handoffScenario, archiveScenario } from "../scenario/lifecycle.js";
import { getTemplates, applyTemplate } from "../scenario/templates.js";
import { loadSkillsForScenario } from "../skills/loader.js";
import { searchEntities } from "../knowledge/search.js";
import { createEntity, getEntity, listEntities, deleteEntity } from "../knowledge/entities.js";
import { pushScenario, pullScenario, cloneScenarioRepo } from "../sync/git.js";
import { createHandoffPR } from "../sync/handoff.js";
import { getConfig } from "../config.js";
import { generateVisualization } from "../knowledge/visualize/generator.js";
import type { VisualizationType, VisualizationConfig } from "../knowledge/visualize/types.js";
import type { Scenario, ScenarioStatus, KnowledgeEntityType } from "../types.js";

// ---------------------------------------------------------------------------
// Error classification — map common errors to actionable suggestions
// ---------------------------------------------------------------------------

function formatCliError(err: unknown): string {
  const msg = (err as Error).message ?? String(err);

  if (msg.includes("not found")) {
    return `${msg}\n  ${chalk.dim("Hint: Run")} ${chalk.cyan("devcontext list")} ${chalk.dim("to see available scenarios.")}`;
  }
  if (msg.includes("already exists")) {
    return `${msg}\n  ${chalk.dim("Hint: Choose a different name, or delete the existing one first.")}`;
  }
  if (msg.includes("Invalid scenario")) {
    return `${msg}\n  ${chalk.dim("Hint: Check that the name is kebab-case and all required fields are provided.")}`;
  }
  if (msg.includes("GITHUB_TOKEN")) {
    return `${msg}\n  ${chalk.dim("Hint: Set the GITHUB_TOKEN environment variable with a personal access token.")}`;
  }
  if (msg.includes("Invalid entity")) {
    return `${msg}\n  ${chalk.dim("Hint: Ensure title, type (platform|system|repo|tool|concept|person|team), and updated date (YYYY-MM-DD) are valid.")}`;
  }
  if (msg.includes("Authentication failed")) {
    return `${msg}\n  ${chalk.dim("Hint: Verify your GITHUB_TOKEN has the 'repo' scope.")}`;
  }
  if (msg.includes("Network error")) {
    return `${msg}\n  ${chalk.dim("Hint: Check your internet connection and verify the repository URL.")}`;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("devcontext")
  .description("Portable AI-driven working scenarios — Docker for your engineering brain")
  .version("0.1.0")
  .addHelpText("after", `
Examples:
  $ devcontext init                            Initialize workspace
  $ devcontext create my-api --template web-api  Create from template
  $ devcontext recall my-api                   Resume a scenario
  $ devcontext list --status active            List active scenarios
  $ devcontext knowledge search "retry"        Search knowledge wiki
  $ devcontext push my-api                     Push scenario to GitHub
  $ devcontext pull my-api                     Pull scenario from GitHub
`);

// ---------------------------------------------------------------------------
// init — initialize workspace structure
// ---------------------------------------------------------------------------

program
  .command("init")
  .description("Initialize the DevContext workspace directory structure")
  .addHelpText("after", `
Example:
  $ devcontext init
`)
  .action(async () => {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const home = getConfig().home;
    const dirs = ["scenarios", "knowledge", "skills"];
    const created: string[] = [];

    for (const dir of dirs) {
      const fullPath = join(home, dir);
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
        created.push(dir);
      }
    }

    const readmePath = join(home, "README.md");
    if (!existsSync(readmePath)) {
      writeFileSync(readmePath, [
        "# DevContext Workspace",
        "",
        "This directory contains your DevContext data.",
        "",
        "## Structure",
        "",
        "- `scenarios/` — Working scenario manifests (YAML)",
        "- `knowledge/` — Knowledge entities (Markdown + YAML frontmatter)",
        "- `skills/`    — Custom skill definitions (Markdown)",
        "",
        "Learn more: https://github.com/aviraldua93/devcontext",
        "",
      ].join("\n"), "utf8");
      created.push("README.md");
    }

    if (created.length > 0) {
      console.log(chalk.green(`✔ Initialized workspace at ${chalk.bold(home)}`));
      console.log(chalk.dim(`  Created: ${created.join(", ")}`));
    } else {
      console.log(chalk.dim(`Workspace already initialized at ${home}`));
    }
  });

// ---------------------------------------------------------------------------
// create — interactive scenario creation
// ---------------------------------------------------------------------------

program
  .command("create")
  .description("Create a new working scenario (interactive with --interactive)")
  .argument("[name]", "Scenario name (kebab-case)")
  .option("-d, --description <desc>", "Scenario description")
  .option("-t, --template <id>", "Use a scenario template")
  .option("--repo <repos...>", "Add repositories (format: url:branch)")
  .option("--skill <skills...>", "Add skills")
  .option("-i, --interactive", "Use interactive prompts")
  .addHelpText("after", `
Examples:
  $ devcontext create my-api -d "REST API project"
  $ devcontext create my-api --template web-api
  $ devcontext create my-api --repo https://github.com/org/repo:main --skill code-review
  $ devcontext create -i                         # interactive mode
`)
  .action(async (name: string | undefined, opts: {
    description?: string;
    template?: string;
    repo?: string[];
    skill?: string[];
    interactive?: boolean;
  }) => {
    const spinner = ora();
    try {
      let scenarioName = name;
      let description = opts.description ?? "New working scenario";
      let templateId = opts.template;

      // Interactive mode — use inquirer prompts
      if (opts.interactive || !scenarioName) {
        const { default: inquirer } = await import("inquirer");
        const answers = await inquirer.prompt([
          ...(!scenarioName ? [{
            type: "input" as const,
            name: "name",
            message: "Scenario name (kebab-case):",
            validate: (v: string) => /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(v) || "Must be kebab-case",
          }] : []),
          ...(!opts.description ? [{
            type: "input" as const,
            name: "description",
            message: "Description:",
            default: "New working scenario",
          }] : []),
          ...(!templateId ? [{
            type: "list" as const,
            name: "template",
            message: "Use a template?",
            choices: [
              { name: "None", value: "" },
              ...getTemplates().map(t => ({ name: `${t.label} — ${t.description}`, value: t.id })),
            ],
          }] : []),
        ]);

        scenarioName = scenarioName ?? answers.name;
        description = opts.description ?? answers.description ?? description;
        templateId = templateId ?? (answers.template || undefined);
      }

      if (!scenarioName) {
        console.error(chalk.red("Error: scenario name is required"));
        process.exit(1);
      }

      spinner.start(chalk.cyan(`Creating scenario ${chalk.bold(scenarioName)}…`));

      let scenario: Scenario;

      if (templateId) {
        scenario = applyTemplate(templateId, { name: scenarioName, description });
      } else {
        scenario = {
          name: scenarioName,
          version: "0.1.0",
          status: "active",
          description,
          repos: (opts.repo ?? []).map(r => {
            const [url, branch] = r.split(":");
            return { url, branch: branch ?? "main" };
          }),
          skills: (opts.skill ?? []).map(s => ({ name: s, source: "root" as const })),
          context: { summary: "", open_prs: [], next_steps: [], blockers: [], notes: "" },
        };
      }

      createScenario(scenario);
      spinner.succeed(chalk.green(`Created scenario: ${chalk.bold(scenarioName)}`));

      if (scenario.skills?.length) {
        console.log(chalk.dim(`  Skills: ${scenario.skills.map(s => s.name).join(", ")}`));
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// recall — resume a scenario
// ---------------------------------------------------------------------------

program
  .command("recall")
  .description("Recall and resume a working scenario — clones/pulls repos, loads skills, restores context")
  .argument("<name>", "Scenario name")
  .option("--skip-repos", "Skip cloning/pulling repositories")
  .addHelpText("after", `
Examples:
  $ devcontext recall my-api              # full recall with repo clone/pull
  $ devcontext recall my-api --skip-repos # recall without touching repos
`)
  .action(async (name: string, opts: { skipRepos?: boolean }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Recalling scenario ${chalk.bold(name)}…`));
      const scenario = getScenario(name);

      // If paused or handed-off, resume to active
      if (scenario.status === "paused" || scenario.status === "handed-off") {
        resumeScenario(name);
        scenario.status = "active";
      }

      spinner.succeed(chalk.green(`Recalled scenario: ${chalk.bold(scenario.name)}`));

      const statusColor = scenario.status === "active" ? chalk.green : chalk.yellow;
      console.log(`  ${chalk.dim("Status:")} ${statusColor(scenario.status)}`);
      if (scenario.context?.summary) {
        console.log(`  ${chalk.dim("Summary:")} ${scenario.context.summary}`);
      }
      if (scenario.context?.next_steps?.length) {
        console.log(chalk.dim("  Next steps:"));
        scenario.context.next_steps.forEach((s, i) =>
          console.log(`    ${chalk.cyan(`${i + 1}.`)} ${s}`)
        );
      }
      if (scenario.context?.blockers?.length) {
        console.log(chalk.dim("  Blockers:"));
        scenario.context.blockers.forEach(b =>
          console.log(`    ${chalk.red("\u26A0")} ${b}`)
        );
      }

      // Clone/pull repositories listed in the scenario
      if (!opts.skipRepos && scenario.repos?.length) {
        console.log(chalk.dim(`  Syncing ${scenario.repos.length} repo(s)…`));
        const { join } = await import("node:path");
        const { existsSync } = await import("node:fs");
        const syncBase = join(getConfig().home, "repos", scenario.name);

        for (const repo of scenario.repos) {
          const repoName = repo.url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
          const targetDir = join(syncBase, repoName);

          if (existsSync(join(targetDir, ".git"))) {
            const result = await pullScenario(scenario.name, repo.url, repo.branch);
            if (result.ok) {
              console.log(`    ${chalk.green("\u2714")} ${chalk.dim("Pulled")} ${repoName} ${chalk.dim(`(${repo.branch})`)}`);
            } else {
              console.log(`    ${chalk.yellow("\u26A0")} ${chalk.dim("Pull failed for")} ${repoName}: ${chalk.dim(result.stderr)}`);
            }
          } else {
            const result = await cloneScenarioRepo(repo.url, targetDir, repo.branch);
            if (result.ok) {
              console.log(`    ${chalk.green("\u2714")} ${chalk.dim("Cloned")} ${repoName} ${chalk.dim(`(${repo.branch})`)}`);
            } else {
              console.log(`    ${chalk.yellow("\u26A0")} ${chalk.dim("Clone failed for")} ${repoName}: ${chalk.dim(result.stderr)}`);
            }
          }
        }
      }

      // Load skills
      const skills = loadSkillsForScenario(scenario);
      if (skills.length) {
        console.log(chalk.dim(`  Skills loaded: ${skills.map(s => s.name).join(", ")}`));
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// save — save scenario state
// ---------------------------------------------------------------------------

program
  .command("save")
  .description("Save current scenario state")
  .argument("<name>", "Scenario name")
  .option("-s, --summary <text>", "Update summary")
  .option("--next-step <steps...>", "Set next steps")
  .option("--blocker <blockers...>", "Set blockers")
  .option("--note <text>", "Add notes")
  .addHelpText("after", `
Examples:
  $ devcontext save my-api --summary "Retry handler done"
  $ devcontext save my-api --next-step "Write tests" --next-step "Update docs"
  $ devcontext save my-api --blocker "Waiting on dependency release"
`)
  .action(async (name: string, opts: { summary?: string; nextStep?: string[]; blocker?: string[]; note?: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Saving scenario ${chalk.bold(name)}…`));

      const updates: Partial<Scenario> = {};
      const context: Scenario["context"] = {};

      if (opts.summary) context.summary = opts.summary;
      if (opts.nextStep) context.next_steps = opts.nextStep;
      if (opts.blocker) context.blockers = opts.blocker;
      if (opts.note) context.notes = opts.note;

      if (Object.keys(context).length > 0) {
        const existing = getScenario(name);
        updates.context = { ...existing.context, ...context };
      }

      updateScenario(name, updates);
      spinner.succeed(chalk.green(`Saved scenario: ${chalk.bold(name)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// list — table output
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<ScenarioStatus, (s: string) => string> = {
  active: chalk.green,
  paused: chalk.yellow,
  "handed-off": chalk.blue,
  archived: chalk.dim,
};

program
  .command("list")
  .description("List all scenarios")
  .option("--status <status>", "Filter by status")
  .addHelpText("after", `
Examples:
  $ devcontext list
  $ devcontext list --status active
  $ devcontext list --status paused
`)
  .action(async (opts: { status?: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan("Loading scenarios…"));
      let scenarios = listScenarios();
      if (opts.status) {
        scenarios = scenarios.filter(s => s.status === opts.status);
      }
      spinner.stop();

      if (scenarios.length === 0) {
        console.log(chalk.dim("No scenarios found."));
        return;
      }

      // Table header
      const nameWidth = Math.max(20, ...scenarios.map(s => s.name.length + 2));
      const statusWidth = 14;
      console.log(
        chalk.bold(
          "NAME".padEnd(nameWidth) +
          "STATUS".padEnd(statusWidth) +
          "DESCRIPTION"
        )
      );
      console.log(chalk.dim("─".repeat(nameWidth + statusWidth + 30)));

      for (const s of scenarios) {
        const colorFn = STATUS_COLORS[s.status] ?? chalk.white;
        console.log(
          chalk.bold(s.name.padEnd(nameWidth)) +
          colorFn(s.status.padEnd(statusWidth)) +
          s.description
        );
      }

      console.log(chalk.dim(`\n${scenarios.length} scenario(s)`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// handoff — hand off with optional PR creation
// ---------------------------------------------------------------------------

program
  .command("handoff")
  .description("Hand off a scenario to another engineer")
  .argument("<name>", "Scenario name")
  .option("--to <engineer>", "Target engineer GitHub username")
  .option("--pr", "Create a GitHub PR for the handoff")
  .addHelpText("after", `
Examples:
  $ devcontext handoff my-api --to teammate
  $ devcontext handoff my-api --to teammate --pr
`)
  .action(async (name: string, opts: { to?: string; pr?: boolean }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Handing off scenario ${chalk.bold(name)}…`));
      handoffScenario(name);

      if (opts.pr) {
        spinner.text = chalk.cyan("Creating handoff PR…");
        try {
          const prUrl = await createHandoffPR(name, opts.to);
          spinner.succeed(
            chalk.green(`Handed off scenario: ${chalk.bold(name)}`) +
            (opts.to ? chalk.dim(` → ${opts.to}`) : "") +
            chalk.dim(` PR: ${prUrl}`)
          );
        } catch {
          spinner.warn(
            chalk.yellow(`Scenario handed off but PR creation failed. Push manually.`)
          );
        }
      } else {
        spinner.succeed(
          chalk.green(`Handed off scenario: ${chalk.bold(name)}`) +
          (opts.to ? chalk.dim(` → ${opts.to}`) : "")
        );
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// teardown — archive with confirmation
// ---------------------------------------------------------------------------

program
  .command("teardown")
  .description("Archive and clean up a scenario")
  .argument("<name>", "Scenario name")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `
Examples:
  $ devcontext teardown my-api
  $ devcontext teardown my-api -y     # skip confirmation
`)
  .action(async (name: string, opts: { yes?: boolean }) => {
    const spinner = ora();
    try {
      // Confirm unless --yes
      if (!opts.yes) {
        const { default: inquirer } = await import("inquirer");
        const { confirm } = await inquirer.prompt([{
          type: "confirm",
          name: "confirm",
          message: chalk.yellow(`Archive and tear down scenario "${name}"? This cannot be undone.`),
          default: false,
        }]);
        if (!confirm) {
          console.log(chalk.dim("Cancelled."));
          return;
        }
      }

      spinner.start(chalk.cyan(`Tearing down scenario ${chalk.bold(name)}…`));
      archiveScenario(name);
      spinner.succeed(chalk.green(`Archived scenario: ${chalk.bold(name)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// push — push scenario to GitHub
// ---------------------------------------------------------------------------

program
  .command("push")
  .description("Push a scenario to a remote GitHub repository")
  .argument("<name>", "Scenario name")
  .option("--repo <url>", "Repository URL (overrides scenario manifest)")
  .option("-b, --branch <branch>", "Branch name", "main")
  .addHelpText("after", `
Examples:
  $ devcontext push my-api
  $ devcontext push my-api --repo https://github.com/org/repo --branch dev
`)
  .action(async (name: string, opts: { repo?: string; branch: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Pushing scenario ${chalk.bold(name)}…`));
      const scenario = getScenario(name);

      const repoUrl = opts.repo ?? scenario.repos?.[0]?.url;
      if (!repoUrl) {
        throw new Error("No repository URL — provide --repo or add a repo to the scenario manifest.");
      }

      const result = await pushScenario(name, repoUrl, opts.branch);
      if (!result.ok) {
        throw new Error(result.stderr);
      }

      spinner.succeed(chalk.green(`Pushed scenario: ${chalk.bold(name)} → ${chalk.dim(repoUrl)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// pull — pull scenario from GitHub
// ---------------------------------------------------------------------------

program
  .command("pull")
  .description("Pull a scenario from a remote GitHub repository")
  .argument("<name>", "Scenario name")
  .option("--repo <url>", "Repository URL (overrides scenario manifest)")
  .option("-b, --branch <branch>", "Branch name", "main")
  .addHelpText("after", `
Examples:
  $ devcontext pull my-api
  $ devcontext pull my-api --repo https://github.com/org/repo --branch dev
`)
  .action(async (name: string, opts: { repo?: string; branch: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Pulling scenario ${chalk.bold(name)}…`));
      const scenario = getScenario(name);

      const repoUrl = opts.repo ?? scenario.repos?.[0]?.url;
      if (!repoUrl) {
        throw new Error("No repository URL — provide --repo or add a repo to the scenario manifest.");
      }

      const result = await pullScenario(name, repoUrl, opts.branch);
      if (!result.ok) {
        throw new Error(result.stderr);
      }

      spinner.succeed(chalk.green(`Pulled scenario: ${chalk.bold(name)} ← ${chalk.dim(repoUrl)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// knowledge — search subcommand
// ---------------------------------------------------------------------------

const knowledgeCmd = new Command("knowledge")
  .description("Manage and search knowledge entities")
  .addHelpText("after", `
Examples:
  $ devcontext knowledge search "retry patterns"
  $ devcontext knowledge list
  $ devcontext knowledge get retry-patterns
  $ devcontext knowledge create --title "Retry Patterns" --type concept
  $ devcontext knowledge delete retry-patterns
`);

knowledgeCmd
  .command("search")
  .description("Search knowledge entities using full-text search")
  .argument("<query>", "Search query")
  .option("-l, --limit <n>", "Maximum results", "20")
  .action(async (query: string, opts: { limit: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Searching for "${query}"…`));
      const limit = parseInt(opts.limit, 10) || 20;
      const results = searchEntities(query, limit);
      spinner.stop();

      if (results.length === 0) {
        console.log(chalk.dim("No results found."));
        return;
      }

      console.log(chalk.bold(`Found ${results.length} result(s):\n`));
      for (const r of results) {
        console.log(`  ${chalk.bold(chalk.cyan(r.title))} ${chalk.dim(`[${r.type}]`)}`);
        if (r.snippet) {
          console.log(`  ${chalk.dim(r.snippet)}`);
        }
        console.log();
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("list")
  .description("List all knowledge entities")
  .action(async () => {
    try {
      const entities = listEntities();
      if (entities.length === 0) {
        console.log(chalk.dim("No knowledge entities found."));
        return;
      }

      const nameWidth = Math.max(20, ...entities.map(e => e.title.length + 2));
      const typeWidth = 12;
      console.log(
        chalk.bold(
          "TITLE".padEnd(nameWidth) +
          "TYPE".padEnd(typeWidth) +
          "TAGS"
        )
      );
      console.log(chalk.dim("\u2500".repeat(nameWidth + typeWidth + 30)));

      for (const e of entities) {
        console.log(
          chalk.bold(e.title.padEnd(nameWidth)) +
          chalk.cyan(e.type.padEnd(typeWidth)) +
          chalk.dim((e.tags ?? []).join(", "))
        );
      }

      console.log(chalk.dim(`\n${entities.length} entity(s)`));
    } catch (err: unknown) {
      console.error(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("get")
  .description("Get a knowledge entity by slug")
  .argument("<slug>", "Entity slug (e.g. retry-patterns)")
  .action(async (slug: string) => {
    try {
      const entity = getEntity(slug);
      console.log(chalk.bold(chalk.cyan(entity.title)) + chalk.dim(` [${entity.type}]`));
      console.log(chalk.dim(`Updated: ${entity.updated}`));
      if (entity.tags?.length) {
        console.log(chalk.dim(`Tags: ${entity.tags.join(", ")}`));
      }
      if (entity.related?.length) {
        console.log(chalk.dim(`Related: ${entity.related.join(", ")}`));
      }
      console.log();
      console.log(entity.content ?? "");
    } catch (err: unknown) {
      console.error(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("create")
  .description("Create a new knowledge entity")
  .option("--title <title>", "Entity title (required)")
  .option("--type <type>", "Entity type: platform, system, repo, tool, concept, person, team", "concept")
  .option("--tags <tags...>", "Tags for categorization")
  .option("--content <text>", "Markdown content body")
  .action(async (opts: { title?: string; type?: string; tags?: string[]; content?: string }) => {
    const spinner = ora();
    try {
      if (!opts.title) {
        throw new Error("--title is required. Example: devcontext knowledge create --title \"Retry Patterns\" --type concept");
      }

      spinner.start(chalk.cyan(`Creating entity "${opts.title}"…`));
      const result = createEntity({
        title: opts.title,
        type: (opts.type ?? "concept") as KnowledgeEntityType,
        updated: new Date().toISOString().slice(0, 10),
        tags: opts.tags ?? [],
        related: [],
        content: opts.content ?? "",
      });
      spinner.succeed(chalk.green(`Created entity: ${chalk.bold(result.slug)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("delete")
  .description("Delete a knowledge entity by slug")
  .argument("<slug>", "Entity slug")
  .action(async (slug: string) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Deleting entity "${slug}"…`));
      deleteEntity(slug);
      spinner.succeed(chalk.green(`Deleted entity: ${chalk.bold(slug)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

program.addCommand(knowledgeCmd);

// ---------------------------------------------------------------------------
// papers — research paper curation and ingestion
// ---------------------------------------------------------------------------

const papersCmd = new Command("papers")
  .description("Research paper discovery, curation, and knowledge ingestion")
  .addHelpText("after", `
Examples:
  $ devcontext papers search "transformer attention"
  $ devcontext papers curate --topics "LLM,RAG"
  $ devcontext papers ingest arxiv-2301-07041
`);

papersCmd
  .command("search")
  .description("Search arXiv and Semantic Scholar for papers")
  .argument("<query>", "Search query")
  .option("-l, --limit <n>", "Maximum results per source", "10")
  .option("--source <source>", "Source to search: arxiv, semantic-scholar, or all", "all")
  .action(async (query: string, opts: { limit: string; source: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Searching for papers: "${query}"…`));
      const limit = parseInt(opts.limit, 10) || 10;

      const { createArxivClient, createSemanticScholarClient } = await import("../knowledge/papers/index.js");
      const searchQuery = { query, maxResults: limit };
      const allPapers: Array<{ title: string; authors: string[]; source: string; url: string; citations?: number }> = [];

      if (opts.source === "all" || opts.source === "arxiv") {
        try {
          const arxiv = createArxivClient();
          const result = await arxiv.searchPapers(searchQuery);
          allPapers.push(...result.papers.map(p => ({
            title: p.title, authors: p.authors, source: "arXiv", url: p.url, citations: p.citations,
          })));
        } catch (err) {
          spinner.warn(chalk.yellow(`arXiv search failed: ${(err as Error).message}`));
          spinner.start(chalk.cyan("Continuing with other sources…"));
        }
      }

      if (opts.source === "all" || opts.source === "semantic-scholar") {
        try {
          const s2 = createSemanticScholarClient();
          const result = await s2.searchPapers(searchQuery);
          allPapers.push(...result.papers.map(p => ({
            title: p.title, authors: p.authors, source: "S2", url: p.url, citations: p.citations,
          })));
        } catch (err) {
          spinner.warn(chalk.yellow(`Semantic Scholar search failed: ${(err as Error).message}`));
          spinner.start(chalk.cyan("Continuing…"));
        }
      }

      spinner.stop();

      if (allPapers.length === 0) {
        console.log(chalk.dim("No papers found."));
        return;
      }

      console.log(chalk.bold(`Found ${allPapers.length} paper(s):\n`));
      for (const p of allPapers) {
        console.log(`  ${chalk.bold(chalk.cyan(p.title))} ${chalk.dim(`[${p.source}]`)}`);
        console.log(`  ${chalk.dim(p.authors.slice(0, 3).join(", "))}${p.authors.length > 3 ? chalk.dim(` +${p.authors.length - 3}`) : ""}`);
        if (p.citations !== undefined) {
          console.log(`  ${chalk.dim(`Citations: ${p.citations}`)}`);
        }
        console.log(`  ${chalk.dim(p.url)}`);
        console.log();
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

papersCmd
  .command("curate")
  .description("Run automated paper curation based on topics and keywords")
  .option("--topics <topics>", "Comma-separated topics", "")
  .option("--keywords <keywords>", "Comma-separated keywords", "")
  .option("--min-score <score>", "Minimum relevance score (0-1)", "0.2")
  .option("--max-papers <n>", "Maximum papers to return", "10")
  .option("--source <source>", "Sources: arxiv, semantic-scholar, or all", "all")
  .action(async (opts: { topics: string; keywords: string; minScore: string; maxPapers: string; source: string }) => {
    const spinner = ora();
    try {
      const topics = opts.topics ? opts.topics.split(",").map(s => s.trim()).filter(Boolean) : [];
      const keywords = opts.keywords ? opts.keywords.split(",").map(s => s.trim()).filter(Boolean) : [];

      if (topics.length === 0 && keywords.length === 0) {
        console.error(chalk.red("Error: provide --topics or --keywords for curation."));
        console.log(chalk.dim('  Example: devcontext papers curate --topics "LLM,RAG" --keywords "transformer,attention"'));
        process.exit(1);
      }

      // Use keywords as search terms; if only topics provided, search by topics
      const searchKeywords = keywords.length > 0 ? keywords : topics;

      spinner.start(chalk.cyan("Curating papers…"));

      const { curatePapers, createMockArxivClient, createMockSemanticScholarClient } = await import("../knowledge/papers/index.js");
      const { createArxivClient, createSemanticScholarClient } = await import("../knowledge/papers/index.js");

      const sources: Array<"arxiv" | "semantic-scholar"> = [];
      if (opts.source === "all" || opts.source === "arxiv") sources.push("arxiv");
      if (opts.source === "all" || opts.source === "semantic-scholar") sources.push("semantic-scholar");

      const config = {
        topics,
        keywords: searchKeywords,
        minRelevanceScore: parseFloat(opts.minScore) || 0.2,
        maxPapersPerDay: parseInt(opts.maxPapers, 10) || 10,
        sources,
      };

      const deps: Record<string, unknown> = {};
      if (sources.includes("arxiv")) {
        try { deps.arxiv = createArxivClient(); } catch { /* skip */ }
      }
      if (sources.includes("semantic-scholar")) {
        try { deps.semanticScholar = createSemanticScholarClient(); } catch { /* skip */ }
      }

      const papers = await curatePapers(config, deps as Parameters<typeof curatePapers>[1]);
      spinner.stop();

      if (papers.length === 0) {
        console.log(chalk.dim("No papers matched your curation criteria."));
        return;
      }

      console.log(chalk.bold(`Curated ${papers.length} paper(s):\n`));
      for (const p of papers) {
        console.log(`  ${chalk.bold(chalk.cyan(p.title))}`);
        console.log(`  ${chalk.dim(p.authors.slice(0, 3).join(", "))}`);
        console.log(`  ${chalk.dim(`ID: ${p.id}`)} ${chalk.dim(`| ${p.url}`)}`);
        console.log();
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

papersCmd
  .command("ingest")
  .description("Ingest a paper into the knowledge wiki by ID")
  .argument("<paper-id>", "Paper ID (e.g. arxiv-2301-07041)")
  .action(async (paperId: string) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan(`Ingesting paper ${chalk.bold(paperId)}…`));

      // For now, papers must have been found via search/curate first.
      // This command creates a stub entity from the paper ID.
      const { join } = await import("node:path");
      const knowledgeDir = join(getConfig().home, "knowledge");
      const { ingestPaper } = await import("../knowledge/papers/index.js");

      // Try to fetch from Semantic Scholar by ID
      const { getPaper } = await import("../knowledge/papers/semantic-scholar.js");
      let paper;
      try {
        paper = await getPaper(paperId);
      } catch {
        // Fall back to a minimal manual paper entry
        paper = {
          id: paperId,
          title: paperId.replace(/-/g, " "),
          authors: [],
          abstract: "",
          url: "",
          publishedDate: new Date().toISOString().split("T")[0],
          topics: [],
          source: "manual" as const,
        };
      }

      await ingestPaper(paper, knowledgeDir);
      spinner.succeed(chalk.green(`Ingested paper: ${chalk.bold(paper.title)}`));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

program.addCommand(papersCmd);

// ---------------------------------------------------------------------------
// visualize — generate interactive knowledge graph HTML
// ---------------------------------------------------------------------------

program
  .command("visualize")
  .description("Generate interactive HTML visualizations of your knowledge graph")
  .option("--type <type>", "Visualization type: knowledge-graph, topic-clusters, timeline, research-landscape, entity-connections", "knowledge-graph")
  .option("--output <path>", "Output file path", "knowledge-graph.html")
  .option("--title <title>", "Visualization title")
  .option("--open", "Open in browser after generation")
  .addHelpText("after", `
Examples:
  $ devcontext visualize                                    Interactive knowledge graph
  $ devcontext visualize --type topic-clusters              Cluster view
  $ devcontext visualize --type timeline                    Timeline view
  $ devcontext visualize --type research-landscape          Full dashboard
  $ devcontext visualize --output ./my-graph.html           Custom output path
  $ devcontext visualize --open                             Open in browser after generation
`)
  .action(async (opts: { type: string; output: string; title?: string; open?: boolean }) => {
    const spinner = ora();
    try {
      const vizType = opts.type as VisualizationType;
      const validTypes = ["knowledge-graph", "topic-clusters", "timeline", "research-landscape", "entity-connections"];
      if (!validTypes.includes(vizType)) {
        throw new Error(`Invalid type "${opts.type}". Valid: ${validTypes.join(", ")}`);
      }

      const config: VisualizationConfig = {
        type: vizType,
        title: opts.title ?? `DevContext — ${vizType}`,
        outputPath: opts.output,
        interactive: true,
      };

      const knowledgeDir = join(getConfig().home, "knowledge");
      spinner.start(chalk.cyan(`Generating ${chalk.bold(vizType)} visualization…`));

      await generateVisualization(config, knowledgeDir);
      spinner.succeed(
        chalk.green(`Generated: ${chalk.bold(opts.output)}`) +
        chalk.dim(` (${vizType})`)
      );

      if (opts.open) {
        const { exec } = await import("node:child_process");
        const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
        exec(`${cmd} "${opts.output}"`);
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// mcp — start MCP server on stdio (for IDE integration)
// ---------------------------------------------------------------------------

program
  .command("mcp")
  .description("Start MCP (Model Context Protocol) server on stdio for IDE integration")
  .option("--list-tools", "List available MCP tools and exit")
  .addHelpText("after", `
Examples:
  $ devcontext mcp                  # Start MCP server on stdio
  $ devcontext mcp --list-tools     # List available tools
`)
  .action(async (opts: { listTools?: boolean }) => {
    if (opts.listTools) {
      const { ALL_TOOLS } = await import("../mcp/tools.js");
      console.log(chalk.bold(`\nDevContext MCP Tools (${ALL_TOOLS.length}):\n`));
      for (const tool of ALL_TOOLS) {
        console.log(`  ${chalk.cyan(tool.name)}`);
        console.log(`    ${chalk.dim(tool.description)}`);
      }
      console.log();
      return;
    }

    const { startServer } = await import("../mcp/server.js");
    await startServer({
      name: "devcontext",
      version: "0.1.0",
      workspaceDir: getConfig().home,
    });
  });

// ---------------------------------------------------------------------------
// memory — 5-layer memory architecture
// ---------------------------------------------------------------------------

const memoryCmd = new Command("memory")
  .description("5-layer memory system — identity, story, wiki, semantic search, sessions")
  .addHelpText("after", `
Examples:
  $ devcontext memory query "what did we discuss about retry logic?"
  $ devcontext memory index
  $ devcontext memory stats
  $ devcontext memory identity
`);

memoryCmd
  .command("query")
  .description("Route a query through all memory layers")
  .argument("<query>", "Query to search across memory layers")
  .option("--layers <layers>", "Comma-separated layers to include (L0,L1,L2,L3,L4)")
  .option("--max-tokens <n>", "Maximum token budget", "4000")
  .option("--domain <domain>", "Domain routing hint for L2 wiki")
  .action(async (query: string, opts: { layers?: string; maxTokens: string; domain?: string }) => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan("Querying memory layers…"));

      const { createDefaultMemorySystem } = await import("../memory/index.js");
      const system = createDefaultMemorySystem();

      const maxLayers = opts.layers
        ? (opts.layers.split(",").map(l => l.trim()) as import("../memory/types.js").MemoryLayer[])
        : undefined;

      const result = await system.query({
        query,
        maxLayers,
        maxTokens: parseInt(opts.maxTokens, 10) || 4000,
        domain: opts.domain,
      });

      spinner.stop();

      // Display results by layer
      if (result.layers.L0) {
        console.log(chalk.bold("\n🧠 L0 — Identity"));
        console.log(`  ${chalk.cyan(result.layers.L0.name)} (${result.layers.L0.roles.join(", ")})`);
      }

      if (result.layers.L1) {
        console.log(chalk.bold("\n📖 L1 — Essential Story"));
        const { storyToPrompt } = await import("../memory/layers/l1-story.js");
        const prompt = storyToPrompt(result.layers.L1);
        for (const line of prompt.split("\n").slice(0, 10)) {
          console.log(`  ${chalk.dim(line)}`);
        }
      }

      if (result.layers.L2) {
        console.log(chalk.bold(`\n📚 L2 — Wiki (${result.layers.L2.entities.length} entities)`));
        for (const e of result.layers.L2.entities.slice(0, 5)) {
          console.log(`  ${chalk.cyan(e.title)} ${chalk.dim(`[${e.type}]`)}`);
          if (e.excerpt) console.log(`    ${chalk.dim(e.excerpt.slice(0, 100))}`);
        }
      }

      if (result.layers.L3) {
        console.log(chalk.bold(`\n🔍 L3 — Semantic Search (${result.layers.L3.matches.length} matches)`));
        for (const m of result.layers.L3.matches.slice(0, 5)) {
          console.log(`  ${chalk.dim(`[${m.source}]`)} ${m.content.slice(0, 120)}`);
        }
      }

      if (result.layers.L4) {
        console.log(chalk.bold(`\n💬 L4 — Session (${result.layers.L4.turns.length} turns)`));
        for (const t of result.layers.L4.turns.slice(0, 4)) {
          console.log(`  ${chalk.cyan(t.role)}: ${t.content.slice(0, 100)}`);
        }
      }

      console.log(chalk.dim(`\nTotal tokens: ${result.totalTokens}`));
      console.log(chalk.dim(`Routing: ${result.routingDecision}`));

    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

memoryCmd
  .command("index")
  .description("Rebuild L3 session search index")
  .action(async () => {
    const spinner = ora();
    try {
      spinner.start(chalk.cyan("Rebuilding L3 session index…"));

      const { join } = await import("node:path");
      const { rebuildIndex, getIndexStats } = await import("../memory/layers/l3-semantic.js");
      const home = getConfig().home;
      const sessionStorePath = join(home, "session_store.db");
      const indexDbPath = join(home, "memory", "session-index.db");

      rebuildIndex(sessionStorePath, indexDbPath);
      const stats = getIndexStats(indexDbPath);

      spinner.succeed(chalk.green(
        `Index rebuilt: ${chalk.bold(String(stats.sessionCount))} sessions, ` +
        `${chalk.bold(String(stats.turnCount))} turns indexed`
      ));
    } catch (err: unknown) {
      spinner.fail(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

memoryCmd
  .command("stats")
  .description("Show memory layer statistics")
  .action(async () => {
    try {
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");
      const { listEntities } = await import("../knowledge/entities.js");
      const { getIndexStats } = await import("../memory/layers/l3-semantic.js");
      const { listRecentSessions } = await import("../memory/layers/l4-sessions.js");
      const home = getConfig().home;

      console.log(chalk.bold("\n📊 Memory Layer Stats\n"));

      // L0
      const identityPath = join(home, "identity.yaml");
      console.log(`  ${chalk.cyan("L0 Identity")}: ${existsSync(identityPath) ? chalk.green("configured") : chalk.yellow("not configured")}`);

      // L1 + L2
      let entityCount = 0;
      try { entityCount = listEntities().length; } catch { /* empty */ }
      console.log(`  ${chalk.cyan("L1 Story / L2 Wiki")}: ${chalk.bold(String(entityCount))} knowledge entities`);

      // L3
      const indexPath = join(home, "memory", "session-index.db");
      if (existsSync(indexPath)) {
        const stats = getIndexStats(indexPath);
        console.log(`  ${chalk.cyan("L3 Session Index")}: ${chalk.bold(String(stats.sessionCount))} sessions, ${chalk.bold(String(stats.turnCount))} turns`);
        if (stats.lastIndexed) {
          console.log(`    ${chalk.dim(`Last indexed: ${stats.lastIndexed}`)}`);
        }
      } else {
        console.log(`  ${chalk.cyan("L3 Session Index")}: ${chalk.yellow("not built")} ${chalk.dim("(run: devcontext memory index)")}`);
      }

      // L4
      const sessionStorePath = join(home, "session_store.db");
      if (existsSync(sessionStorePath)) {
        const recent = listRecentSessions(sessionStorePath, 3);
        console.log(`  ${chalk.cyan("L4 Session Store")}: ${chalk.green("available")}`);
        if (recent.length > 0) {
          console.log(`    ${chalk.dim("Recent sessions:")}`);
          for (const s of recent) {
            console.log(`      ${chalk.dim(s.date)} ${s.summary || s.id}`);
          }
        }
      } else {
        console.log(`  ${chalk.cyan("L4 Session Store")}: ${chalk.yellow("not found")}`);
      }

      console.log();
    } catch (err: unknown) {
      console.error(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

memoryCmd
  .command("identity")
  .description("Show or initialize L0 identity")
  .option("--init <name>", "Initialize a new identity with the given name")
  .action(async (opts: { init?: string }) => {
    try {
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");
      const { loadIdentity, createDefaultIdentity, saveIdentity, generateIdentityPrompt } = await import("../memory/layers/l0-identity.js");
      const home = getConfig().home;
      const identityPath = join(home, "identity.yaml");

      if (opts.init) {
        const identity = createDefaultIdentity(opts.init);
        saveIdentity(identity, identityPath);
        console.log(chalk.green(`\nIdentity initialized for ${chalk.bold(opts.init)}`));
        console.log(chalk.dim(`  Saved to: ${identityPath}`));
        console.log(chalk.dim(`  Edit the file to customize your identity.\n`));
        return;
      }

      if (!existsSync(identityPath)) {
        console.log(chalk.yellow("\nNo identity configured."));
        console.log(chalk.dim(`  Run: devcontext memory identity --init "Your Name"\n`));
        return;
      }

      const identity = loadIdentity(identityPath);
      console.log(chalk.bold("\n🧠 L0 Identity\n"));
      console.log(`  ${chalk.cyan("Name")}: ${identity.name}`);
      console.log(`  ${chalk.cyan("Roles")}: ${identity.roles.join(", ") || chalk.dim("none")}`);
      if (identity.accounts.length > 0) {
        console.log(`  ${chalk.cyan("Accounts")}:`);
        for (const a of identity.accounts) {
          console.log(`    ${a.platform}: ${a.username}`);
        }
      }
      if (identity.coreContext) {
        console.log(`  ${chalk.cyan("Context")}: ${identity.coreContext}`);
      }
      console.log(chalk.dim(`\n  Prompt (~tokens): "${generateIdentityPrompt(identity)}"\n`));
    } catch (err: unknown) {
      console.error(chalk.red(formatCliError(err)));
      process.exit(1);
    }
  });

program.addCommand(memoryCmd);

// ---------------------------------------------------------------------------
// Export for testing
// ---------------------------------------------------------------------------

export { program };

// ---------------------------------------------------------------------------
// Run CLI when executed directly
// ---------------------------------------------------------------------------

// Run CLI when this file is the entry point.
// Bun sets import.meta.main = true when the file is directly executed.
const isMain =
  (import.meta as { main?: boolean }).main ||
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli/index.ts") ||
  process.argv[1]?.endsWith("cli\\index.ts");

if (isMain) {
  program.parse();
}
