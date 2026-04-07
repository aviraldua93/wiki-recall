/**
 * Shared authentication and validation utilities for git sync operations.
 *
 * Provides transient auth (never persisted to .git/config) and input
 * sanitization for branch names and other user-provided values.
 */

// ---------------------------------------------------------------------------
// Transient git authentication
// ---------------------------------------------------------------------------

/**
 * Build git CLI arguments that inject auth headers transiently.
 * Uses `-c http.extraheader` so the token is never written to .git/config.
 */
export function gitAuthArgs(token: string | undefined): string[] {
  if (!token) return [];
  const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=Authorization: Basic ${encoded}`];
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate a git branch name to prevent injection attacks.
 * Allows: alphanumeric, hyphens, underscores, dots, and forward slashes.
 * Rejects: shell metacharacters, directory traversal (`..`), leading dashes.
 */
export function validateBranchName(name: string): string {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(name)) {
    throw new Error(
      `Invalid branch name: "${name}". Must start with alphanumeric and contain only alphanumeric, hyphens, underscores, dots, or slashes.`
    );
  }
  if (name.includes("..")) {
    throw new Error(`Invalid branch name: "${name}". Double dots are not allowed.`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Output sanitization
// ---------------------------------------------------------------------------

/**
 * Redact a token from error output to prevent leaking secrets in logs.
 */
export function redactToken(output: string, token: string | undefined): string {
  if (!token || !output) return output;
  return output.replaceAll(token, "[REDACTED]");
}
