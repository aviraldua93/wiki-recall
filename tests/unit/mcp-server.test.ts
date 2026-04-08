/**
 * Unit tests for src/mcp/server.ts — JSON-RPC message parsing and protocol compliance
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import { handleMessage, parseMessage } from "../../src/mcp/server.js";
import { ALL_TOOLS } from "../../src/mcp/tools.js";
import { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from "../../src/mcp/types.js";
import type { JsonRpcRequest, JsonRpcResponse, McpServerConfig } from "../../src/mcp/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;
const testConfig: McpServerConfig = {
  name: "wikirecall-test",
  version: "0.1.0-test",
  workspaceDir: "",
};

const silentLog = pino({ level: "silent" });

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-mcp-server-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  testConfig.workspaceDir = testDir;
  resetConfig();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup on Windows
  }
  resetConfig();
});

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe("parseMessage", () => {
  test("parses valid JSON-RPC request", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":"initialize","id":1}');
    expect("error" in msg).toBeFalse();
    expect((msg as JsonRpcRequest).method).toBe("initialize");
    expect((msg as JsonRpcRequest).id).toBe(1);
  });

  test("parses request with params", () => {
    const msg = parseMessage(
      '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"knowledge_search","arguments":{"query":"test"}}}',
    );
    expect("error" in msg).toBeFalse();
    const req = msg as JsonRpcRequest;
    expect(req.method).toBe("tools/call");
    expect(req.params?.name).toBe("knowledge_search");
  });

  test("parses request with string id", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":"test","id":"abc-123"}');
    expect("error" in msg).toBeFalse();
    expect((msg as JsonRpcRequest).id).toBe("abc-123");
  });

  test("parses notification (no id)", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect("error" in msg).toBeFalse();
    expect((msg as JsonRpcRequest).id).toBeUndefined();
  });

  test("returns error for invalid JSON", () => {
    const msg = parseMessage("not json at all");
    expect("error" in msg).toBeTrue();
    expect((msg as { error: string }).error).toContain("parse");
  });

  test("returns error for empty string", () => {
    const msg = parseMessage("");
    expect("error" in msg).toBeTrue();
  });

  test("returns error for missing jsonrpc field", () => {
    const msg = parseMessage('{"method":"test","id":1}');
    expect("error" in msg).toBeTrue();
    expect((msg as { error: string }).error).toContain("Invalid");
  });

  test("returns error for wrong jsonrpc version", () => {
    const msg = parseMessage('{"jsonrpc":"1.0","method":"test","id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("returns error for missing method field", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","id":1}');
    expect("error" in msg).toBeTrue();
  });

  test("returns error for non-string method", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","method":42,"id":1}');
    expect("error" in msg).toBeTrue();
  });
});

// ---------------------------------------------------------------------------
// handleMessage — initialize
// ---------------------------------------------------------------------------

describe("handleMessage — initialize", () => {
  test("returns server info and capabilities", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.jsonrpc).toBe("2.0");
    expect(resp!.id).toBe(1);

    const result = resp!.result as {
      protocolVersion: string;
      capabilities: { tools: Record<string, unknown> };
      serverInfo: { name: string; version: string };
    };

    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("wikirecall-test");
    expect(result.serverInfo.version).toBe("0.1.0-test");
  });

  test("preserves request id in response", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: "init-42", method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe("init-42");
  });

  test("response has no error field", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleMessage — notifications/initialized
// ---------------------------------------------------------------------------

describe("handleMessage — notifications/initialized", () => {
  test("returns null (no response for notifications)", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", method: "notifications/initialized" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleMessage — tools/list
// ---------------------------------------------------------------------------

describe("handleMessage — tools/list", () => {
  test("returns all tools", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const resp = await handleMessage(req, testConfig, silentLog);

    expect(resp).not.toBeNull();
    expect(resp!.id).toBe(2);

    const result = resp!.result as { tools: Array<{ name: string }> };
    expect(result.tools).toBeArray();
    expect(result.tools.length).toBe(ALL_TOOLS.length);
  });

  test("each tool has name, description, inputSchema", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 3, method: "tools/list" };
    const resp = await handleMessage(req, testConfig, silentLog);

    const result = resp!.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    for (const tool of result.tools) {
      expect(tool.name).toBeString();
      expect(tool.description).toBeString();
      expect(tool.inputSchema).toBeObject();
    }
  });

  test("tool names match ALL_TOOLS", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 4, method: "tools/list" };
    const resp = await handleMessage(req, testConfig, silentLog);

    const result = resp!.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    for (const tool of ALL_TOOLS) {
      expect(names).toContain(tool.name);
    }
  });
});

// ---------------------------------------------------------------------------
// handleMessage — tools/call
// ---------------------------------------------------------------------------

describe("handleMessage — tools/call", () => {
  test("calls knowledge_search tool", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "knowledge_search",
        arguments: { query: "test" },
      },
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.id).toBe(10);

    const result = resp!.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeArray();
    expect(result.content[0].type).toBe("text");
  });

  test("returns error for missing tool name", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { arguments: {} },
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });

  test("handles tool call without arguments", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "memory_identity" },
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.error).toBeUndefined();
  });

  test("handles tool call without params", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });

  test("calls scenario_list tool", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "scenario_list", arguments: {} },
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
    const result = resp!.result as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.scenarios).toBeArray();
  });

  test("calls memory_stats tool", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "memory_stats", arguments: {} },
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error).toBeUndefined();
    const result = resp!.result as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.layers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleMessage — unknown method
// ---------------------------------------------------------------------------

describe("handleMessage — unknown method", () => {
  test("returns METHOD_NOT_FOUND error", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 20,
      method: "some/unknown/method",
    };

    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
    expect(resp!.error!.message).toContain("some/unknown/method");
  });

  test("preserves id in error response", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 99, method: "nope" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.id).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Protocol compliance
// ---------------------------------------------------------------------------

describe("protocol compliance", () => {
  test("all responses have jsonrpc 2.0", async () => {
    const methods = ["initialize", "tools/list", "unknown"];
    for (const method of methods) {
      const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method };
      const resp = await handleMessage(req, testConfig, silentLog);
      if (resp) {
        expect(resp.jsonrpc).toBe("2.0");
      }
    }
  });

  test("responses have either result or error, not both", async () => {
    // Success case
    const successReq: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
    const successResp = await handleMessage(successReq, testConfig, silentLog);
    expect(successResp!.result).toBeDefined();
    expect(successResp!.error).toBeUndefined();

    // Error case
    const errorReq: JsonRpcRequest = { jsonrpc: "2.0", id: 2, method: "unknown" };
    const errorResp = await handleMessage(errorReq, testConfig, silentLog);
    expect(errorResp!.error).toBeDefined();
    expect(errorResp!.result).toBeUndefined();
  });

  test("error objects have code and message fields", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "unknown" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp!.error!.code).toBeNumber();
    expect(resp!.error!.message).toBeString();
  });

  test("null id is handled in responses", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", method: "unknown" };
    const resp = await handleMessage(req, testConfig, silentLog);
    expect(resp).not.toBeNull();
    expect(resp!.id).toBeNull();
  });

  test("initialize returns protocolVersion", async () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
    const resp = await handleMessage(req, testConfig, silentLog);
    const result = resp!.result as { protocolVersion: string };
    expect(result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC error codes
// ---------------------------------------------------------------------------

describe("JSON-RPC error codes", () => {
  test("PARSE_ERROR is -32700", () => {
    expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
  });

  test("INVALID_REQUEST is -32600", () => {
    expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
  });

  test("METHOD_NOT_FOUND is -32601", () => {
    expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
  });

  test("INVALID_PARAMS is -32602", () => {
    expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
  });

  test("INTERNAL_ERROR is -32603", () => {
    expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
  });
});

// ---------------------------------------------------------------------------
// MCP protocol version
// ---------------------------------------------------------------------------

describe("MCP protocol version", () => {
  test("MCP_PROTOCOL_VERSION is a date string", () => {
    expect(MCP_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("MCP_PROTOCOL_VERSION is 2024-11-05", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
  });
});
