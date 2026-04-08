# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in WikiRecall, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email **aviraldua93@gmail.com** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive an acknowledgement within **48 hours**.
4. A fix will be prioritized and released as a patch version.

## Security Considerations

WikiRecall handles sensitive data including:

- **GitHub tokens** — Used transiently via `-c http.extraheader` for git operations. Tokens are never persisted to disk or logged.
- **Git operations** — All commands use `execFile` (not `exec`) to prevent shell injection. Branch names are validated against metacharacters.
- **File paths** — Scenario and entity names are validated to prevent path traversal attacks.
- **Error output** — Tokens are redacted from all error messages and logs.

## Best Practices

- Never commit `.env` files or tokens to your WikiRecall workspace.
- Use fine-grained GitHub Personal Access Tokens with minimal scopes.
- Keep WikiRecall updated to the latest version.
