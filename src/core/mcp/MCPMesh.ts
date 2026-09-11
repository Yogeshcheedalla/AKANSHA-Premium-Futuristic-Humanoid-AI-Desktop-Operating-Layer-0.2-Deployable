import { mcpManager, type MCPServer, type MCPTool } from './MCPManager';
import { eventBus } from '../events/EventBus';

export type MCPHealthState =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'STARTING'
  | 'STOPPED'
  | 'AUTH_REQUIRED'
  | 'INCOMPATIBLE';

export interface MCPMeshNode {
  serverId: string;
  name: string;
  category: 'windows' | 'browser' | 'page-agent' | 'device' | 'files' | 'github' | 'communication' | 'calendar' | 'research' | 'coding' | 'orca' | 'custom';
  health: MCPHealthState;
  latencyMs: number;
  version?: string;
  permissions: string[];
  sandboxed: boolean;
  lastFailure?: string;
  successRate: number;
}

export interface MCPGenerationRequest {
  capabilityName: string;
  description: string;
  requiredPermissions: string[];
  schema: string;
}

/**
 * Central MCP Mesh Manager.
 * Manages the lifecycle, health, discovery, routing, and (gated) synthesis
 * of MCP servers. It sits UNDER the Master Orchestrator.
 */
export class MCPMesh {
  private nodes = new Map<string, MCPMeshNode>();

  registerNode(node: MCPMeshNode) {
    this.nodes.set(node.serverId, node);
    mcpManager.registerServer({
      id: node.serverId,
      name: node.name,
      protocol: 'http',
      capabilities: [],
      status: node.health === 'AVAILABLE' ? 'online' : 'offline',
      healthScore: node.successRate * 100,
      tools: [],
      permissions: node.permissions,
    });
    eventBus.emit('mcp.connected', 'MCPMesh', { serverId: node.serverId, category: node.category });
  }

  updateHealth(serverId: string, health: MCPHealthState, latencyMs?: number, failureReason?: string) {
    const node = this.nodes.get(serverId);
    if (!node) return;
    const prev = node.health;
    node.health = health;
    if (latencyMs !== undefined) node.latencyMs = latencyMs;
    if (failureReason) node.lastFailure = failureReason;
    if (prev !== health) {
      eventBus.emit('integration.health_changed', 'MCPMesh', { serverId, from: prev, to: health });
    }
  }

  getNode(serverId: string): MCPMeshNode | undefined {
    return this.nodes.get(serverId);
  }

  getAvailableNodes(category?: MCPMeshNode['category']): MCPMeshNode[] {
    return Array.from(this.nodes.values()).filter(
      (n) => n.health === 'AVAILABLE' && (!category || n.category === category)
    );
  }

  getNodesByCategory(category: MCPMeshNode['category']): MCPMeshNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.category === category);
  }

  /**
   * Route a capability need to the best available MCP node.
   */
  routeCapability(need: string): MCPMeshNode | undefined {
    const available = this.getAvailableNodes();
    const scored = available
      .map((node) => ({
        node,
        score: node.successRate * 100 + (node.latencyMs < 200 ? 10 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0]?.node;
  }

  /**
   * Gated MCP synthesis. This does NOT grant permissions automatically —
   * it produces a candidate that must pass security review before use.
   */
  proposeSynthesis(request: MCPGenerationRequest): { approved: boolean; reason: string } {
    // Security gate: never auto-grant unrestricted access
    const restricted = request.requiredPermissions.some((p) =>
      ['EXECUTE_COMMANDS', 'PURCHASE_ACTION', 'SYSTEM_CONFIGURATION', 'NETWORK_ACCESS'].includes(p)
    );
    if (restricted) {
      return {
        approved: false,
        reason: `Synthesis blocked: capability "${request.capabilityName}" requests privileged permissions (${request.requiredPermissions.join(', ')}). Manual authorization required.`,
      };
    }
    return {
      approved: true,
      reason: `MCP synthesis candidate created for "${request.capabilityName}". Pending sandbox test and security review before registration.`,
    };
  }

  getSummary() {
    const nodes = Array.from(this.nodes.values());
    return {
      total: nodes.length,
      available: nodes.filter((n) => n.health === 'AVAILABLE').length,
      degraded: nodes.filter((n) => n.health === 'DEGRADED').length,
      unavailable: nodes.filter((n) => n.health === 'UNAVAILABLE').length,
      byCategory: nodes.reduce<Record<string, number>>((acc, n) => {
        acc[n.category] = (acc[n.category] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

export const mcpMesh = new MCPMesh();
