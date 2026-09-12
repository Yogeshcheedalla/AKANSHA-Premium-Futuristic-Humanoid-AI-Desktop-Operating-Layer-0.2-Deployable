// Minimal, harmless local MCP server used to VERIFY the MCP client round-trip
// (connect -> discover -> call -> result). Exposes two non-destructive tools.
// Run via stdio transport by the MCPClientManager in the integration test.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'akansha-test-mcp', version: '1.0.0' });

server.registerTool(
  'echo',
  { description: 'Return the given message back.', inputSchema: { message: z.string() } },
  async ({ message }) => ({ content: [{ type: 'text', text: `echo:${message}` }] })
);

server.registerTool(
  'add',
  { description: 'Add two numbers.', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
);

const transport = new StdioServerTransport();
await server.connect(transport);
// Keep the process alive on stdio; the client drives the lifecycle.
