# Contributing to WikiRecall

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

1. **Prerequisites:** [Bun](https://bun.sh/) v1.1+ and Git.
2. **Clone and install:**
   ```bash
   git clone https://github.com/aviraldua93/wiki-recall.git
   cd wiki-recall
   bun install
   ```
3. **Run tests:** `bun test`
4. **Type-check:** `bun run lint`

## Branch Naming

Use descriptive kebab-case branches prefixed by type:

- `feat/add-init-command`
- `fix/fts5-slug-indexing`
- `docs/update-contributing`

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add wikirecall init command
fix: prevent command injection in handoff sync
docs: add CONTRIBUTING.md
test: add entity CRUD search integration tests
```

## Pull Request Process

1. Fork the repo and create a feature branch from `main`.
2. Make your changes with tests for any new behavior.
3. Run `bun test` and `bun run lint` — both must pass.
4. Open a PR against `main` with a clear description of what and why.
5. One approval is required before merging.

## Code Style

- TypeScript strict mode — no `any` unless absolutely necessary.
- Use explicit types on exported function signatures.
- Keep files focused — one module, one responsibility.
- Comment only when the *why* isn't obvious from the code.

## Testing

- Unit tests live in `tests/unit/` and mirror the `src/` structure.
- End-to-end tests live in `tests/e2e/`.
- Use `bun:test` (describe/test/expect) — no external test runners.
- Every bug fix should include a regression test.

## Project Structure

```
src/
  cli/          — Commander.js CLI entry point
  knowledge/    — Karpathy-style knowledge entities + FTS5 search
  scenario/     — Scenario CRUD, lifecycle, templates
  skills/       — Skill loading, validation, promotion
  sync/         — Git push/pull and GitHub PR handoffs
  providers/    — AI provider integrations
schemas/        — JSON Schema definitions
skills/         — Built-in skill Markdown files
tests/          — Unit and e2e tests
```

## Reporting Issues

- Use GitHub Issues for bugs and feature requests.
- Include reproduction steps, expected vs actual behavior, and your environment (OS, Bun version).

## Technical Guidance

For repo-specific conventions, architecture decisions, LLM integration patterns, and file formats, see [AGENTS.md](AGENTS.md).

## LLM Integration Pattern

All LLM usage goes through the shared client in `engine/llm_client.py`.
Never call OpenAI or subprocess directly — use `LLMClient` instead.

```python
from engine.llm_client import LLMClient

client = LLMClient()
if client.available:
    verified = client.verify(candidates, "decisions")
    summary = client.summarize(long_text, max_words=50)
    label = client.classify(text, categories=["bug", "feature", "chore"])
else:
    # fallback: regex-only path, reduced quality
    verified = candidates
```

**Backend priority:** The client tries backends in order:

1. `OPENAI_API_KEY` environment variable → OpenAI API
2. `copilot` CLI on PATH → Copilot subprocess
3. Neither → graceful fallback (no LLM, script-only)

Use `BATCH_SIZE` (default 20) to stay under token limits when sending
multiple items in a single LLM call.

### Adding LLM to a New Feature

1. Import the shared client: `from engine.llm_client import LLMClient`
2. Guard every LLM call with `client.available` so the feature still works
   without an LLM backend.
3. Use the existing methods — `verify(`, `summarize(`, `classify(` — before
   adding new ones.
4. Keep fallback behavior simple: return inputs unchanged or use regex.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
