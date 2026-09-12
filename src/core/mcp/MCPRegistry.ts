import { eventBus } from '../events/EventBus';

/**
 * MCP Registry + security gate.
 *
 * Discovery ≠ installation. A server starts DISCOVERED and can only reach
 * CONNECTED after passing trust evaluation + a security/permission scan +
 * explicit approval. Unknown or over-privileged servers are BLOCKED. This is a
 * capability boundary: MCP servers are treated as potentially privileged
 * software and are never given blanket filesystem/shell/credential access.
 */

export type MCPState =
  | 'DISCOVERED'
  | 'SCANNING'
  | 'APPROVED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'BLOCKED'
  | 'REVOKED';

export type MCPTransport = 'stdio' | 'streamable-http';

export type MCPPermission =
  | 'READ' | 'WRITE' | 'DELETE' | 'NETWORK' | 'FILESYSTEM'
  | 'ACCOUNT' | 'MESSAGE' | 'FINANCIAL' | 'SENSITIVE_DATA' | 'EXECUTION';

export interface MCPServerDef {
  serverId: string;
  name: string;
  description?: string;
  transport: MCPTransport;
  // stdio: command + args; streamable-http: url
  command?: string;
  args?: string[];
  url?: string;
  version?: string;
  source?: string; // publisher / repository
  trustLevel: 'official' | 'trusted' | 'community' | 'unknown';
  declaredPermissions: MCPPermission[];
  sandboxed: boolean;
}

export interface MCPRegistryEntry extends MCPServerDef {
  state: MCPState;
  tools: string[];
  resources: string[];
  prompts: string[];
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  approvalReason?: string;
}

// Permissions that require explicit human approval regardless of trust level.
const PRIVILEGED: MCPPermission[] = ['EXECUTION', 'FILESYSTEM', 'FINANCIAL', 'SENSITIVE_DATA', 'ACCOUNT', 'DELETE', 'MESSAGE'];

export class MCPRegistry {
  private entries = new Map<string, MCPRegistryEntry>();

  discover(def: MCPServerDef): MCPRegistryEntry {
    const now = Date.now();
    const entry: MCPRegistryEntry = {
      ...def,
      state: 'DISCOVERED',
      tools: [],
      resources: [],
      prompts: [],
      installedAt: now,
      updatedAt: now,
    };
    this.entries.set(def.serverId, entry);
    eventBus.emit('mcp.discovered', 'MCPRegistry', { serverId: def.serverId, trustLevel: def.trustLevel });
    return entry;
  }

  /**
   * Security gate: evaluate whether a discovered server may be approved.
   * Unknown-source servers and over-privileged non-sandboxed servers are BLOCKED.
   */
  evaluate(serverId: string): { approved: boolean; reason: string; state: MCPState } {
    const e = this.entries.get(serverId);
    if (!e) return { approved: false, reason: 'unknown server', state: 'BLOCKED' };
    e.state = 'SCANNING';
    e.updatedAt = Date.now();

    if (e.trustLevel === 'unknown') {
      e.state = 'BLOCKED';
      e.approvalReason = 'untrusted source — manual approval required';
      eventBus.emit('mcp.failed', 'MCPRegistry', { serverId, reason: 'blocked unknown source' });
      return { approved: false, reason: e.approvalReason, state: 'BLOCKED' };
    }
    const privileged = e.declaredPermissions.filter((p) => PRIVILEGED.includes(p));
    if (privileged.length && !e.sandboxed) {
      e.state = 'BLOCKED';
      e.approvalReason = `requests privileged permissions (${privileged.join(', ')}) without sandbox`;
      eventBus.emit('mcp.failed', 'MCPRegistry', { serverId, reason: e.approvalReason });
      return { approved: false, reason: e.approvalReason, state: 'BLOCKED' };
    }
    e.state = 'APPROVED';
    e.approvalReason = 'passed trust + permission review';
    eventBus.emit('mcp.connected', 'MCPRegistry', { serverId, state: 'APPROVED' });
    return { approved: true, reason: e.approvalReason, state: 'APPROVED' };
  }

  get(serverId: string): MCPRegistryEntry | undefined {
    return this.entries.get(serverId);
  }
  all(): MCPRegistryEntry[] {
    return Array.from(this.entries.values());
  }
  setState(serverId: string, state: MCPState, extra: Partial<MCPRegistryEntry> = {}) {
    const e = this.entries.get(serverId);
    if (!e) return;
    Object.assign(e, extra, { state, updatedAt: Date.now() });
  }
  revoke(serverId: string) {
    this.setState(serverId, 'REVOKED');
    eventBus.emit('mcp.failed', 'MCPRegistry', { serverId, reason: 'revoked' });
  }
}

export const mcpRegistry = new MCPRegistry();
