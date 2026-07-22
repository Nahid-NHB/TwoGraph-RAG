import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from './tools/index.js';
import { registerEditTools } from './tools/edits.js';

/** Builds the `@twograph/mcp` server: read tools (issue #63) + editing tools (issue #65). */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'twograph', version: '0.0.0' });
  registerReadTools(server);
  registerEditTools(server);
  return server;
}
