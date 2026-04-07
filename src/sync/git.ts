/**
 * Git Sync — push/pull scenarios to/from GitHub repositories.
 *
 * Shells out to the `git` CLI with GITHUB_TOKEN authentication.
 * All operations are async and include error handling for common
 * failure modes (auth, network, merge conflicts).
 */

import { exec } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("sync");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitResult {
  /** Whether the operation succeeded. */
  ok: boolean;
  /** stdout output from git. */
  stdout: string;
  /** stderr output from git. */
  stderr: string;
}

export interface GitProvider {
  /** Run a git command and return the result. */
  run(args: string[], cwd?: string): Promise<GitResult>;
  /** Push a scenario to a remote repository. */
  pushScenario(scenarioName: string, repoUrl: string, branch?: string): Promise<GitResult>;
  /** Pull a scenario from a remote repository. */
  pullScenario(scenarioName: string, repoUrl: string, branch?: string): Promise<GitResult>;
  /** Clone a repository for a scenario. */
  cloneScenarioRepo(repoUrl: string, targetDir: string, branch?: string): Promise<GitResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scenarioSyncDir(scenarioName: string): string {
  return join(getConfig().home, "sync", scenarioName);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Inject GITHUB_TOKEN into a git remote URL for HTTPS auth.
 * Converts https://github.com/org/repo → https://<token>@github.com/org/repo
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
    // Not a valid URL — return as-is
  }
  return url;
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

function execGit(args: string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const cmd = `git ${args.join(" ")}`;
    const options: { cwd?: string; env: NodeJS.ProcessEnv } = {
      env: { ...process.env },
    };
    if (cwd) options.cwd = cwd;

    // Set GIT_TERMINAL_PROMPT=0 to avoid interactive auth prompts
    options.env.GIT_TERMINAL_PROMPT = "0";

    exec(cmd, options, (error, stdout, stderr) => {
      if (error) {
        logger.debug({ cmd, error: error.message, stderr }, "git command failed");
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

// ---------------------------------------------------------------------------
// Classify errors
// ---------------------------------------------------------------------------

function classifyGitError(stderr: string): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("authentication") || lower.includes("403") || lower.includes("401") || lower.includes("could not read username")) {
    return "Authentication failed. Ensure GITHUB_TOKEN is set and has repository access.";
  }
  if (lower.includes("could not resolve host") || lower.includes("network") || lower.includes("unable to access")) {
    return "Network error. Check your internet connection and the repository URL.";
  }
  if (lower.includes("merge conflict") || lower.includes("conflict")) {
    return "Merge conflict detected. Resolve conflicts manually and try again.";
  }
  if (lower.includes("not a git repository")) {
    return "Not a git repository. Initialize with 'git init' first.";
  }
  if (lower.includes("remote already exists")) {
    return "Remote 'origin' already exists. Remove it or use a different name.";
  }
  return stderr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push a scenario's sync directory to a remote git repository.
 * Initializes the repo if needed, commits changes, and pushes.
 */
export async function pushScenario(
  scenarioName: string,
  repoUrl: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const syncDir = scenarioSyncDir(scenarioName);
  ensureDir(syncDir);

  const authedUrl = config.githubToken ? injectToken(repoUrl, config.githubToken) : repoUrl;

  // Initialize git if needed
  if (!existsSync(join(syncDir, ".git"))) {
    const initResult = await execGit(["init", "-b", branch], syncDir);
    if (!initResult.ok) {
      return { ok: false, stdout: "", stderr: classifyGitError(initResult.stderr) };
    }
    await execGit(["remote", "add", "origin", authedUrl], syncDir);
  }

  // Stage, commit, push
  await execGit(["add", "-A"], syncDir);

  const commitResult = await execGit(
    ["commit", "-m", `devcontext: sync scenario '${scenarioName}'`, "--allow-empty"],
    syncDir
  );
  if (!commitResult.ok && !commitResult.stderr.includes("nothing to commit")) {
    return { ok: false, stdout: "", stderr: classifyGitError(commitResult.stderr) };
  }

  const pushResult = await execGit(["push", "-u", "origin", branch, "--force-with-lease"], syncDir);
  if (!pushResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(pushResult.stderr) };
  }

  logger.info({ scenarioName, repoUrl, branch }, "scenario pushed");
  return pushResult;
}

/**
 * Pull a scenario from a remote git repository into the sync directory.
 */
export async function pullScenario(
  scenarioName: string,
  repoUrl: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const syncDir = scenarioSyncDir(scenarioName);
  const authedUrl = config.githubToken ? injectToken(repoUrl, config.githubToken) : repoUrl;

  // If directory doesn't exist, clone instead
  if (!existsSync(join(syncDir, ".git"))) {
    return cloneScenarioRepo(authedUrl, syncDir, branch);
  }

  // Update remote URL in case token changed
  await execGit(["remote", "set-url", "origin", authedUrl], syncDir);

  const pullResult = await execGit(["pull", "origin", branch, "--rebase"], syncDir);
  if (!pullResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(pullResult.stderr) };
  }

  logger.info({ scenarioName, repoUrl, branch }, "scenario pulled");
  return pullResult;
}

/**
 * Clone a repository into a target directory.
 */
export async function cloneScenarioRepo(
  repoUrl: string,
  targetDir: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const authedUrl = config.githubToken ? injectToken(repoUrl, config.githubToken) : repoUrl;

  if (existsSync(targetDir) && existsSync(join(targetDir, ".git"))) {
    return { ok: true, stdout: "Already cloned", stderr: "" };
  }

  ensureDir(targetDir);

  const cloneResult = await execGit([
    "clone",
    "--branch", branch,
    "--single-branch",
    authedUrl,
    targetDir,
  ]);

  if (!cloneResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(cloneResult.stderr) };
  }

  logger.info({ repoUrl, targetDir, branch }, "repository cloned");
  return cloneResult;
}
