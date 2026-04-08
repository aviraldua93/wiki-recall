/**
 * MCP Module — barrel export for the WikiRecall MCP server.
 *
 * Re-exports types, tools, handlers, and server for clean imports.
 */

// Types
export type {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpServerConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from "./types.js";

export { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from "./types.js";

// Tool definitions
export { ALL_TOOLS, getToolByName } from "./tools.js";

// Handlers
export { dispatchToolCall, getRegisteredHandlers } from "./handlers.js";

// Server
export { startServer, handleMessage, parseMessage } from "./server.js";
