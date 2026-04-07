/**
 * Handoff — create GitHub PRs for scenario handoffs.
 *
 * Uses git push to a feature branch and the `gh` CLI (or GITHUB_TOKEN
 * + GitHub REST API) to create a pull request containing the scenario
 * manifest and context for the recipient.
 */

import { exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { getConfig } from "../config.js";
import { getScenario } from "../scenario/manager.js";
import { createLogger } from "../logger.js";

const logger = createLogger("handoff");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoffPRResult {
  /** Whether the PR was created successfully. */
  ok: boolean;
  /** URL of the created PR (if successful). */
  prUrl?: string;
  /** Error message (if failed). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handoffDir(scenarioName: string): string {
  return join(getConfig().home, "sync", scenarioName);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function execCmd(cmd: string, cwd?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const options: { cwd?: string; env: NodeJS.ProcessEnv } = {
      env: { ...process.env },
    };
    if (cwd) options.cwd = cwd;
    options.env.GIT_TERMINAL_PROMPT = "0";

    exec(cmd, options, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? error.message,
        });
      } else {
        resolve({
          ok: true,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
        });
      }
    });
  });
}

/**
 * Inject GITHUB_TOKEN into a git remote URL for HTTPS auth.
 */
function injectToken(url: string, token: string): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      parsed.username = token;
      return parsed.toString();
    }
  } catch {
    // Not a valid URL
  }
  return url;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a GitHub PR for handing off a scenario.
 *
 * Steps:
 * 1. Write the scenario manifest and a handoff summary to the sync dir.
 * 2. Create a feature branch named `handoff/<scenario>`.
 * 3. Commit and push the branch.
 * 4. Create a PR via the GitHub API (or gh CLI).
 *
 * Returns the PR URL on success.
 */
export async function createHandoffPR(
  scenarioName: string,
  recipientUsername?: string
): Promise<string> {
  const config = getConfig();
  const scenario = getScenario(scenarioName);
  const dir = handoffDir(scenarioName);
  ensureDir(dir);

  const branchName = `handoff/${scenarioName}`;
  const title = `[DevContext] Handoff: ${scenarioName}`;
  const body = buildPRBody(scenario, recipientUsername);

  // Write scenario manifest into the sync directory
  const manifestPath = join(dir, "scenario.yaml");
  writeFileSync(manifestPath, yaml.dump(scenario, { lineWidth: -1 }), "utf8");

  // Write handoff summary
  const summaryPath = join(dir, "HANDOFF.md");
  writeFileSync(summaryPath, body, "utf8");

  // Initialize git repo if needed
  if (!existsSync(join(dir, ".git"))) {
    await execCmd("git init -b main", dir);
  }

  // Determine the remote URL from scenario repos (first repo, or a default)
  const repoUrl = scenario.repos?.[0]?.url;
  if (!repoUrl) {
    throw new Error("No repository URL in scenario — cannot create handoff PR");
  }

  const authedUrl = config.githubToken ? injectToken(repoUrl, config.githubToken) : repoUrl;

  // Set up remote
  const remoteCheck = await execCmd("git remote get-url origin", dir);
  if (!remoteCheck.ok) {
    await execCmd(`git remote add origin ${authedUrl}`, dir);
  } else {
    await execCmd(`git remote set-url origin ${authedUrl}`, dir);
  }

  // Create and switch to handoff branch
  await execCmd(`git checkout -B ${branchName}`, dir);

  // Stage and commit
  await execCmd("git add -A", dir);
  await execCmd(
    `git commit -m "devcontext: handoff scenario '${scenarioName}'" --allow-empty`,
    dir
  );

  // Push the branch
  const pushResult = await execCmd(`git push -u origin ${branchName} --force`, dir);
  if (!pushResult.ok) {
    throw new Error(`Failed to push handoff branch: ${pushResult.stderr}`);
  }

  // Try to create PR using GitHub API via curl
  const prUrl = await createPRViaAPI(repoUrl, branchName, title, body, config.githubToken);

  logger.info({ scenarioName, branchName, prUrl }, "handoff PR created");
  return prUrl;
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

function buildPRBody(scenario: { name: string; description: string; context?: { summary?: string; next_steps?: string[]; blockers?: string[]; notes?: string } }, recipient?: string): string {
  const lines: string[] = [
    `# 🔄 DevContext Handoff: ${scenario.name}`,
    "",
    `> ${scenario.description}`,
    "",
  ];

  if (recipient) {
    lines.push(`**Assigned to:** @${recipient}`, "");
  }

  if (scenario.context?.summary) {
    lines.push("## Summary", "", scenario.context.summary, "");
  }

  if (scenario.context?.next_steps?.length) {
    lines.push("## Next Steps", "");
    scenario.context.next_steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  if (scenario.context?.blockers?.length) {
    lines.push("## ⚠️ Blockers", "");
    scenario.context.blockers.forEach(b => lines.push(`- ${b}`));
    lines.push("");
  }

  if (scenario.context?.notes) {
    lines.push("## Notes", "", scenario.context.notes, "");
  }

  lines.push(
    "---",
    "*Created by [DevContext](https://github.com/aviraldua93/devcontext) — portable AI-driven working scenarios.*",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub API PR creation
// ---------------------------------------------------------------------------

async function createPRViaAPI(
  repoUrl: string,
  branch: string,
  title: string,
  body: string,
  token?: string
): Promise<string> {
  if (!token) {
    throw new Error("GITHUB_TOKEN required to create a pull request");
  }

  // Parse owner/repo from URL
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse owner/repo from URL: ${repoUrl}`);
  }
  const [, owner, repo] = match;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      head: branch,
      base: "main",
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errBody}`);
  }

  const data = (await response.json()) as { html_url: string };
  return data.html_url;
}
