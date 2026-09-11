export interface MCPServer {
  id: string;
  name: string;
  protocol: 'stdio' | 'http' | 'websocket';
  endpoint?: string;
  capabilities: string[];
  status: 'online' | 'offline' | 'initializing';
  healthScore: number;
  tools: MCPTool[];
  permissions: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
}

export interface MCPClient {
  connect(serverId: string): Promise<boolean>;
  disconnect(serverId: string): Promise<void>;
  callTool(serverId: string, toolName: string, args: any): Promise<any>;
  listTools(serverId: string): Promise<MCPTool[]>;
  healthCheck(serverId: string): Promise<{ status: 'online' | 'offline'; latencyMs: number }>;
}

export class MCPManager {
  private servers = new Map<string, MCPServer>();
  private clients: MCPClient[] = [];

  registerServer(server: MCPServer) {
    this.servers.set(server.id, server);
    console.log(`[MCP] Registered server: ${server.name} (${server.id})`);
  }

  discoverServers() {
    return Array.from(this.servers.values());
  }

  getServer(id: string): MCPServer | undefined {
    return this.servers.get(id);
  }

  registerClient(client: MCPClient) {
    this.clients.push(client);
  }

  async discoverCapabilities() {
    const results: { serverId: string; capabilities: string[] }[] = [];
    for (const server of this.servers.values()) {
      if (server.status === 'online') {
        results.push({ serverId: server.id, capabilities: server.capabilities });
      }
    }
    return results;
  }

  getServerByCapability(capabilityName: string) {
    return Array.from(this.servers.values()).find((s) =>
      s.capabilities.includes(capabilityName)
    );
  }

  updateStatus(id: string, status: MCPServer['status']) {
    const server = this.servers.get(id);
    if (server) {
      server.status = status;
    }
  }
}

export const mcpManager = new MCPManager();
