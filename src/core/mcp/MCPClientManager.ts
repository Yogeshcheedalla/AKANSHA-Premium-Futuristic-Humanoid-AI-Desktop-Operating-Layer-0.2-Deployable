import { mcpRegistry, type MCPRegistryEntry } from './MCPRegistry';
import { eventBus } from '../events/EventBus';

/**
 * MCPClientManager — a real MCP client using the official SDK
 * (@modelcontextprotocol/sdk). It connects to APPROVED servers over stdio or
 * Streamable HTTP, discovers tools/resources/prompts, caches the catalog, calls
 * tools, and manages connection lifecycle (pooling, timeouts, disconnect).
 *
 * It only connects to servers the MCPRegistry has APPROVED (security-gated).
 * A tool call is NOT success: the caller verifies the result.
 */
export interface ToolResult {
  ok: boolean;
  content: unknown;
  isError: boolean;
  latencyMs: number;
  error?: string;
}

type ClientLike = {
  connect(t: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>;
  listResources?(): Promise<{ resources: { uri: string; name?: string }[] }>;
  listPrompts?(): Promise<{ prompts: { name: string }[] }>;
  callTool(a: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: unknown; isError?: boolean }>;
};

export class MCPClientManager {
  private clients = new Map<string, ClientLike>();

  private async loadSdk() {
    const [{ Client }, stdio, http] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]);
    return { Client, StdioClientTransport: (stdio as any).StdioClientTransport, StreamableHTTPClientTransport: (http as any).StreamableHTTPClientTransport };
  }

  async connect(serverId: string): Promise<{ ok: boolean; tools: string[]; error?: string }> {
    const entry = mcpRegistry.get(serverId);
    if (!entry) return { ok: false, tools: [], error: 'not registered' };
    if (entry.state !== 'APPROVED' && entry.state !== 'CONNECTED' && entry.state !== 'DEGRADED') {
      return { ok: false, tools: [], error: `refusing to connect: state=${entry.state} (must be APPROVED)` };
    }
    mcpRegistry.setState(serverId, 'CONNECTING');
    try {
      const { Client, StdioClientTransport, StreamableHTTPClientTransport } = await this.loadSdk();
      const transport =
        entry.transport === 'stdio'
          ? new StdioClientTransport({ command: entry.command, args: entry.args || [], cwd: process.cwd(), stderr: 'pipe' })
          : new StreamableHTTPClientTransport(new URL(entry.url as string));

      const client = new Client({ name: 'akansha-mcp-client', version: '1.0.0' }) as unknown as ClientLike;
      await client.connect(transport);
      const { tools } = await client.listTools();
      let resources: string[] = [];
      let prompts: string[] = [];
      try { resources = (await client.listResources?.())?.resources.map((r) => r.uri) || []; } catch { /* optional */ }
      try { prompts = (await client.listPrompts?.())?.prompts.map((p) => p.name) || []; } catch { /* optional */ }

      this.clients.set(serverId, client);
      mcpRegistry.setState(serverId, 'CONNECTED', { tools: tools.map((t) => t.name), resources, prompts });
      eventBus.emit('mcp.connected', 'MCPClientManager', { serverId, tools: tools.length });
      return { ok: true, tools: tools.map((t) => t.name) };
    } catch (e: any) {
      mcpRegistry.setState(serverId, 'DISCONNECTED', { lastError: e?.message });
      eventBus.emit('mcp.failed', 'MCPClientManager', { serverId, error: e?.message });
      return { ok: false, tools: [], error: e?.message || 'connect failed' };
    }
  }

  async callTool(serverId: string, tool: string, args: Record<string, unknown>, timeoutMs = 20000): Promise<ToolResult> {
    const started = Date.now();
    const client = this.clients.get(serverId);
    if (!client) return { ok: false, content: null, isError: true, latencyMs: 0, error: `not connected: ${serverId}` };
    const entry = mcpRegistry.get(serverId);
    if (entry && !entry.tools.includes(tool)) {
      return { ok: false, content: null, isError: true, latencyMs: 0, error: `tool not found: ${tool}` };
    }
    try {
      const res = await Promise.race([
        client.callTool({ name: tool, arguments: args }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tool timeout')), timeoutMs)),
      ]);
      const isError = !!res.isError;
      return { ok: !isError, content: res.content, isError, latencyMs: Date.now() - started };
    } catch (e: any) {
      return { ok: false, content: null, isError: true, latencyMs: Date.now() - started, error: e?.message };
    }
  }

  async disconnect(serverId: string) {
    const client = this.clients.get(serverId);
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
      this.clients.delete(serverId);
    }
    mcpRegistry.setState(serverId, 'DISCONNECTED');
  }

  isConnected(serverId: string): boolean {
    return this.clients.has(serverId);
  }
}

export const mcpClientManager = new MCPClientManager();
