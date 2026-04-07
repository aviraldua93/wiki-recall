---
title: "Bun JavaScript Runtime"
type: tool
updated: "2025-06-15"
tags:
  - javascript
  - typescript
  - runtime
  - bundler
  - package-manager
related:
  - a2a-protocol
---

## What It Is

Bun is an all-in-one JavaScript/TypeScript runtime, bundler, test runner, and package manager built from scratch in Zig with JavaScriptCore (Safari's engine) instead of V8. It aims to be a drop-in replacement for Node.js with dramatically faster startup, native TypeScript execution (no transpilation step), and built-in tooling that eliminates the need for separate tools like webpack, jest, and npm.

## Key Concepts

- **Native TypeScript**: Bun executes `.ts` and `.tsx` files directly — no `tsc` compilation step, no `ts-node`, no `tsx` wrapper. Type annotations are stripped at parse time with near-zero overhead.
- **JavaScriptCore engine**: Uses WebKit's JS engine instead of V8. Faster startup time and lower memory usage for short-lived scripts and CLI tools. Slightly different JIT optimization profile than V8 for long-running servers.
- **Built-in package manager**: `bun install` reads `package.json` and `node_modules` — fully compatible with npm registries. Uses a global module cache and hardlinks, making installs 10-30x faster than npm.
- **Built-in test runner**: `bun test` provides Jest-compatible syntax (`describe`, `it`, `expect`) with no configuration. Runs tests in Bun's runtime for fast execution.
- **Built-in bundler**: `bun build` bundles TypeScript/JavaScript for production with tree-shaking, minification, and source maps. No webpack or esbuild configuration needed.
- **Node.js compatibility**: Implements most of the Node.js API surface (`fs`, `path`, `http`, `crypto`, `child_process`, etc.). Most npm packages work without modification.
- **Bun.serve()**: Built-in HTTP server with performance optimized at the runtime level. Handles static files, WebSockets, and TLS natively.
- **bun.lock**: Bun's lockfile format (binary by default, text with `--save-text-lockfile`). Ensures deterministic installs across machines.

## Common Patterns

### Running TypeScript Directly

```bash
# No tsconfig needed for simple scripts
bun run src/index.ts

# Run with watch mode for development
bun --watch run src/server.ts
```

### Testing

```typescript
import { describe, it, expect } from "bun:test";

describe("parser", () => {
  it("handles empty input", () => {
    expect(parse("")).toEqual({ tokens: [] });
  });
});
```

```bash
# Run all tests
bun test

# Run specific test file with coverage
bun test --coverage src/parser.test.ts
```

### Package Management

```bash
# Install dependencies (reads package.json)
bun install

# Add a dependency
bun add zod

# Add a dev dependency
bun add -d @types/node
```

### HTTP Server

```typescript
Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    return new Response("Not Found", { status: 404 });
  },
});
```

## When to Use Bun

- **CLI tools and scripts** — fast startup time (5-10x faster than Node.js) makes CLI tools feel instant.
- **TypeScript-first projects** — no build step configuration. Write TypeScript, run TypeScript.
- **Test-heavy projects** — built-in test runner eliminates Jest/Vitest configuration. Tests run faster due to native execution.
- **Monorepo workspaces** — `bun install` with workspaces is significantly faster than npm/yarn for large monorepos.

## Limitations

- **Not 100% Node.js compatible** — some Node.js APIs have partial implementations or subtle behavioral differences. Always test against your specific dependencies.
- **Smaller ecosystem of native APIs** — Bun-specific APIs (`Bun.serve`, `Bun.file`, `Bun.write`) are powerful but not portable to Node.js.
- **Younger runtime** — less battle-tested in production than Node.js. Fewer debugging tools, profilers, and APM integrations.
- **Windows support** — available but less mature than Linux/macOS. Some features may have platform-specific limitations.

## Related Work

- Node.js — the established JavaScript runtime that Bun aims to replace for many use cases
- Deno — another modern JS/TS runtime with a security-first approach and URL-based module imports
- esbuild — fast JavaScript bundler written in Go; Bun's bundler serves a similar role but is integrated into the runtime
- Vitest — modern test runner for Vite projects; Bun's test runner is a built-in alternative
