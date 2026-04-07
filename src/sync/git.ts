/**
 * Git Sync — push/pull scenarios to/from GitHub repositories.
 *
 * Shells out to the `git` CLI with GITHUB_TOKEN authentication.
 * All operations are async and include error handling for common
 * failure modes (auth, network, merge conflicts).
 *
 * Auth tokens are passed transiently via `-c http.extraheader`
 * and are never persisted to .git/config.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { gitAuthArgs, redactToken } from "./auth.js";

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

// ---------------------------------------------------------------------------
// Shell execution — uses execFile (no shell) to prevent command injection
// ---------------------------------------------------------------------------

function execGit(args: string[], cwd?: string): Promise<GitResult> {
  const config = getConfig();
  return new Promise((resolve) => {
    const options: { cwd?: string; env: NodeJS.ProcessEnv } = {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    };
    if (cwd) options.cwd = cwd;

    execFile("git", args, options, (error, stdout, stderr) => {
      const token = config.githubToken;
      if (error) {
        logger.debug({ args: args[0], error: redactToken(error.message, token) }, "git command failed");
        resolve({
          ok: false,
          stdout: redactToken(stdout?.toString() ?? "", token),
          stderr: redactToken(stderr?.toString() ?? error.message, token),
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
 * Auth tokens are passed transiently — never stored in .git/config.
 */
export async function pushScenario(
  scenarioName: string,
  repoUrl: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const syncDir = scenarioSyncDir(scenarioName);
  const authArgs = gitAuthArgs(config.githubToken);
  ensureDir(syncDir);

  // Initialize git if needed — remote URL is plain (no embedded token)
  if (!existsSync(join(syncDir, ".git"))) {
    const initResult = await execGit(["init", "-b", branch], syncDir);
    if (!initResult.ok) {
      return { ok: false, stdout: "", stderr: classifyGitError(initResult.stderr) };
    }
    await execGit(["remote", "add", "origin", repoUrl], syncDir);
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

  // Auth passed transiently via -c flag — not persisted
  const pushResult = await execGit(
    [...authArgs, "push", "-u", "origin", branch, "--force-with-lease"],
    syncDir
  );
  if (!pushResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(pushResult.stderr) };
  }

  logger.info({ scenarioName, repoUrl, branch }, "scenario pushed");
  return pushResult;
}

/**
 * Pull a scenario from a remote git repository into the sync directory.
 * Auth tokens are passed transiently — never stored in .git/config.
 */
export async function pullScenario(
  scenarioName: string,
  repoUrl: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const syncDir = scenarioSyncDir(scenarioName);
  const authArgs = gitAuthArgs(config.githubToken);

  // If directory doesn't exist, clone instead
  if (!existsSync(join(syncDir, ".git"))) {
    return cloneScenarioRepo(repoUrl, syncDir, branch);
  }

  // Ensure remote URL is plain (no embedded token)
  await execGit(["remote", "set-url", "origin", repoUrl], syncDir);

  // Auth passed transiently via -c flag
  const pullResult = await execGit(
    [...authArgs, "pull", "origin", branch, "--rebase"],
    syncDir
  );
  if (!pullResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(pullResult.stderr) };
  }

  logger.info({ scenarioName, repoUrl, branch }, "scenario pulled");
  return pullResult;
}

/**
 * Clone a repository into a target directory.
 * Auth tokens are passed transiently — never stored in .git/config.
 */
export async function cloneScenarioRepo(
  repoUrl: string,
  targetDir: string,
  branch = "main"
): Promise<GitResult> {
  const config = getConfig();
  const authArgs = gitAuthArgs(config.githubToken);

  if (existsSync(targetDir) && existsSync(join(targetDir, ".git"))) {
    return { ok: true, stdout: "Already cloned", stderr: "" };
  }

  ensureDir(targetDir);

  // Auth passed transiently via -c flag — not stored in cloned .git/config
  const cloneResult = await execGit([
    ...authArgs,
    "clone",
    "--branch", branch,
    "--single-branch",
    repoUrl,
    targetDir,
  ]);

  if (!cloneResult.ok) {
    return { ok: false, stdout: "", stderr: classifyGitError(cloneResult.stderr) };
  }

  logger.info({ repoUrl, targetDir, branch }, "repository cloned");
  return cloneResult;
}
