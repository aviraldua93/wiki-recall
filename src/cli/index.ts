/**
 * DevContext CLI — entry point for the command-line interface.
 *
 * Uses Commander.js to define commands for scenario and knowledge management.
 * Enhanced with chalk (coloured output), ora (spinners), and inquirer (prompts).
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createScenario, getScenario, listScenarios, deleteScenario, updateScenario } from "../scenario/manager.js";
import { transitionScenario, pauseScenario, resumeScenario, handoffScenario, archiveScenario } from "../scenario/lifecycle.js";
import { getTemplates, applyTemplate } from "../scenario/templates.js";
import { loadSkillsForScenario } from "../skills/loader.js";
import { searchEntities } from "../knowledge/search.js";
import { pushScenario, pullScenario, cloneScenarioRepo } from "../sync/git.js";
import { createHandoffPR } from "../sync/handoff.js";
import type { Scenario, ScenarioStatus } from "../types.js";

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("devcontext")
  .description("Portable AI-driven working scenarios — Docker for your engineering brain")
  .version("0.1.0");

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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// recall — resume a scenario
// ---------------------------------------------------------------------------

program
  .command("recall")
  .description("Recall and resume a working scenario")
  .argument("<name>", "Scenario name")
  .action(async (name: string) => {
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
          console.log(`    ${chalk.red("⚠")} ${b}`)
        );
      }

      // Load skills
      const skills = loadSkillsForScenario(scenario);
      if (skills.length) {
        console.log(chalk.dim(`  Skills loaded: ${skills.map(s => s.name).join(", ")}`));
      }
    } catch (err: unknown) {
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// knowledge — search subcommand
// ---------------------------------------------------------------------------

const knowledgeCmd = new Command("knowledge")
  .description("Manage and search knowledge entities");

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
      spinner.fail(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.addCommand(knowledgeCmd);

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
