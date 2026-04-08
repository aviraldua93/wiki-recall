/**
 * MCP Server — stdio-based JSON-RPC 2.0 server for the Model Context Protocol.
 *
 * Reads newline-delimited JSON-RPC messages from stdin, dispatches them,
 * and writes responses to stdout. All diagnostic logging goes to stderr
 * via pino so stdout remains clean for protocol traffic.
 *
 * Supported methods:
 *  - initialize       → returns server capabilities
 *  - notifications/initialized → client ack (no response)
 *  - tools/list       → returns the tool catalog
 *  - tools/call       → executes a tool and returns the result
 */

import pino from "pino";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpServerConfig,
  McpToolResult,
} from "./types.js";
import { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from "./types.js";
import { ALL_TOOLS } from "./tools.js";
import { dispatchToolCall } from "./handlers.js";

// ---------------------------------------------------------------------------
// Logger — must write to stderr (stdout is for MCP protocol)
// ---------------------------------------------------------------------------

function createMcpLogger(level = "info"): pino.Logger {
  return pino(
    {
      name: "wikirecall-mcp",
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label: string) => ({ level: label }) },
    },
    pino.destination({ dest: 2, sync: true }), // fd 2 = stderr
  );
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function makeResponse(id: string | number | undefined | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function makeError(
  id: string | number | undefined | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

export async function handleMessage(
  msg: JsonRpcRequest,
  config: McpServerConfig,
  log: pino.Logger,
): Promise<JsonRpcResponse | null> {
  log.debug({ method: msg.method, id: msg.id }, "Received message");

  switch (msg.method) {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------
    case "initialize":
      return makeResponse(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: config.name,
          version: config.version,
        },
      });

    // -----------------------------------------------------------------------
    // notifications/initialized — client acknowledgment, no response needed
    // -----------------------------------------------------------------------
    case "notifications/initialized":
      log.info("Client initialized");
      return null;

    // -----------------------------------------------------------------------
    // tools/list
    // -----------------------------------------------------------------------
    case "tools/list":
      return makeResponse(msg.id, { tools: ALL_TOOLS });

    // -----------------------------------------------------------------------
    // tools/call
    // -----------------------------------------------------------------------
    case "tools/call": {
      const params = msg.params ?? {};
      const toolName = params.name as string | undefined;
      const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

      if (!toolName) {
        return makeError(msg.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Missing tool name");
      }

      log.info({ tool: toolName }, "Calling tool");

      const result: McpToolResult = await dispatchToolCall({
        name: toolName,
        arguments: toolArgs,
      });

      return makeResponse(msg.id, result);
    }

    // -----------------------------------------------------------------------
    // Unknown method
    // -----------------------------------------------------------------------
    default:
      return makeError(
        msg.id,
        JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        `Unknown method: ${msg.method}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Message parser
// ---------------------------------------------------------------------------

export function parseMessage(line: string): JsonRpcRequest | { error: string } {
  try {
    const msg = JSON.parse(line);
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return { error: "Invalid JSON-RPC 2.0 message" };
    }
    return msg as JsonRpcRequest;
  } catch {
    return { error: "Failed to parse JSON" };
  }
}

// ---------------------------------------------------------------------------
// stdio server loop
// ---------------------------------------------------------------------------

export async function startServer(config: McpServerConfig): Promise<void> {
  const log = createMcpLogger(process.env.WIKIRECALL_LOG_LEVEL ?? "info");
  log.info({ name: config.name, version: config.version }, "MCP server starting");

  const decoder = new TextDecoder();
  let buffer = "";

  // Read from stdin in a loop
  const reader = Bun.stdin.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        log.info("stdin closed, shutting down");
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        const parsed = parseMessage(line);

        if ("error" in parsed) {
          const errResp = makeError(null, JSON_RPC_ERRORS.PARSE_ERROR, parsed.error);
          process.stdout.write(JSON.stringify(errResp) + "\n");
          continue;
        }

        const response = await handleMessage(parsed, config, log);

        // Notifications don't get responses
        if (response !== null) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      }
    }
  } catch (err) {
    log.error({ err }, "Server error");
  } finally {
    reader.releaseLock();
    log.info("MCP server stopped");
  }
}
