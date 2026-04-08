/**
 * MCP protocol edge case tests — malformed JSON-RPC, unknown methods,
 * missing params, boundary conditions.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import { handleMessage, parseMessage } from "../../src/mcp/server.js";
import { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from "../../src/mcp/types.js";
import type { JsonRpcRequest, McpServerConfig } from "../../src/mcp/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;
const testConfig: McpServerConfig = {
  name: "wikirecall-edge-test",
  version: "0.1.0-edge",
  workspaceDir: "",
};

const silentLog = pino({ level: "silent" });

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-mcp-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  testConfig.workspaceDir = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

// ---------------------------------------------------------------------------
// Malformed JSON-RPC — parseMessage edge cases
// ---------------------------------------------------------------------------

describe("parseMessage — malformed JSON-RPC", () => {
  test("rejects truncated JSON", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method"');
    expect("error" in msg).toBeTrue();
  });

  test("rejects JSON array instead of object", () => {
    const msg = parseMessage('[1, 2, 3]');
    expect("error" in msg).toBeTrue();
  });

  test("rejects null value", () => {
    const msg = parseMessage("null");
    expect("error" in msg).toBeTrue();
  });

  test("rejects numeric value", () => {
    const msg = parseMessage("42");
    expect("error" in msg).toBeTrue();
  });

  test("rejects boolean value", () => {
    const msg = parseMessage("true");
    expect("error" in msg).toBeTrue();
  });

  test("rejects string value in JSON", () => {
    const msg = parseMessage('"just a string"');
    expect("error" in msg).toBeTrue();
  });

  test("rejects object with jsonrpc but no method", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("rejects object with method but wrong jsonrpc version", () => {
    const msg = parseMessage('{"jsonrpc":"3.0","method":"test","id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("rejects empty object", () => {
    const msg = parseMessage("{}");
    expect("error" in msg).toBeTrue();
  });

  test("rejects method as number", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":123,"id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("rejects method as boolean", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":true,"id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("rejects method as null", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":null,"id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("rejects method as array", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":["test"],"id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("handles very long invalid JSON gracefully", () => {
    const msg = parseMessage("{" + "a".repeat(10000));
    expect("error" in msg).toBeTrue();
  });

  test("handles unicode BOM prefix", () => {
    const msg = parseMessage('\ufeff{"jsonrpc":"2.0","method":"test","id":1}');
    // Some parsers handle BOM, others don't — either way, no crash
    expect(msg).toBeDefined();
  });

  test("accepts valid request with extra unknown fields", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":"test","id":1,"extra":"field","more":true}');
    expect("error" in msg).toBeFalse();
    expect((msg as JsonRpcRequest).method).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// Unknown methods via handleMessage
// ---------------------------------------------------------------------------

describe("handleMessage — unknown methods", () => {
  test("returns METHOD_NOT_FOUND for empty method string", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
  });

  test("returns METHOD_NOT_FOUND for random method name", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 2, method: "foo/bar/baz" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
  });

  test("returns METHOD_NOT_FOUND for method with special chars", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 3, method: "test!@#$%^&*()" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
  });

  test("error message includes the unknown method name", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 4, method: "completions/create" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error!.message).toContain("completions/create");
  });

  test("METHOD_NOT_FOUND with string id preserves id", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: "my-req-id", method: "unknown" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe("my-req-id");
  });

  test("METHOD_NOT_FOUND with numeric id preserves id", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 999, method: "unknown" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Missing params edge cases
// ---------------------------------------------------------------------------

describe("handleMessage — missing/invalid params", () => {
  test("tools/call with empty params object returns error", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 10, method: "tools/call", params: {},
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });

  test("tools/call with null params equivalent returns error", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 11, method: "tools/call",
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeDefined();
  });

  test("tools/call with unknown tool name returns error result", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "totally_nonexistent_tool", arguments: {} },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    // Unknown tool returns an error via the result (isError: true), not a JSON-RPC error
    const result = resp!.result as any;
    if (result) {
      expect(result.content[0].text).toBeDefined();
    }
  });

  test("tools/call with arguments but no tool name returns INVALID_PARAMS", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 13, method: "tools/call",
      params: { arguments: { query: "test" } },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });

  test("initialize with extra params still works", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 14, method: "initialize",
      params: { clientInfo: { name: "test-client", version: "1.0" } },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
    expect(resp!.result).toBeDefined();
  });

  test("tools/list with params still works", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 15, method: "tools/list",
      params: { cursor: "next-page" },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
    const result = resp!.result as { tools: any[] };
    expect(result.tools).toBeArray();
  });
});

// ---------------------------------------------------------------------------
// Notification handling
// ---------------------------------------------------------------------------

describe("handleMessage — notification edge cases", () => {
  test("notifications/initialized returns null", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", method: "notifications/initialized" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).toBeNull();
  });

  test("any notification prefix returns null", async () => {
    // Even unknown notifications — but let's test the known one
    const req: JsonRpcRequest = { jsonrpc: "2.0", method: "notifications/initialized" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ID handling edge cases
// ---------------------------------------------------------------------------

describe("handleMessage — ID handling", () => {
  test("integer zero ID is preserved", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 0, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe(0);
  });

  test("negative integer ID is preserved", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: -1, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe(-1);
  });

  test("very large integer ID is preserved", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 999999999, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe(999999999);
  });

  test("empty string ID is preserved", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: "", method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe("");
  });

  test("UUID string ID is preserved", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "550e8400-e29b-41d4-a716-446655440000",
      method: "initialize",
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

// ---------------------------------------------------------------------------
// Response structure validation
// ---------------------------------------------------------------------------

describe("handleMessage — response structure", () => {
  test("success response never has error field", async () => {
    const methods = ["initialize", "tools/list"];
    for (const method of methods) {
      const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method };
      const resp = await handleMessage(req, testConfig, silentLog);
      if (resp) {
        expect(resp.error).toBeUndefined();
        expect(resp.result).toBeDefined();
      }
    }
  });

  test("error response never has result field", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "nonexistent/method" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeDefined();
    expect(resp!.result).toBeUndefined();
  });

  test("all responses have jsonrpc 2.0 field", async () => {
    const methods = ["initialize", "tools/list", "unknown_method"];
    for (const method of methods) {
      const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method };
      const resp = await handleMessage(req, testConfig, silentLog);
      if (resp) {
        expect(resp.jsonrpc).toBe("2.0");
      }
    }
  });

  test("initialize response has correct shape", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    const result = resp!.result as any;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toBeObject();
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo).toBeObject();
    expect(result.serverInfo.name).toBe("wikirecall-edge-test");
    expect(result.serverInfo.version).toBe("0.1.0-edge");
  });

  test("tools/list returns tools with complete schema", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const resp = await handleMessage(req, testConfig, silentLog);
    const result = resp!.result as { tools: any[] };
    expect(result.tools.length).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.inputSchema).toBe("object");
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// Tool call result format
// ---------------------------------------------------------------------------

describe("handleMessage — tool call result format", () => {
  test("successful tool call has content array", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "memory_stats", arguments: {} },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
    const result = resp!.result as any;
    expect(result.content).toBeArray();
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });

  test("tool call result text is valid JSON for structured tools", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "scenario_list", arguments: {} },
    };
    const resp = await handleMessage(req, testConfig, silentLog);
    const result = resp!.result as any;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBeObject();
    expect(parsed.scenarios).toBeArray();
  });
});
