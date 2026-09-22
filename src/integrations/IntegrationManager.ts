import { openLLMVTuber } from './open-llm-vtuber/OpenLLMVTuberAdapter';
import { pageAgent } from './page-agent/PageAgentAdapter';
import { orca } from './orca/OrcaAdapter';
import { mcpMesh } from '../core/mcp/MCPMesh';
import { agentSupervisor } from '../core/agents/AgentSupervisor';
import { eventBus } from '../core/events/EventBus';
import { skillRegistry } from '../core/skills/SkillRegistry';
import { modelRouter } from '../core/models/ModelRouter';
import { providerManager } from '../core/providers/ProviderManager';
import { credentialVault } from '../core/security/CredentialVault';

export interface SystemStatus {
  integrations: {
    openLLMVTuber: { state: string; capabilities: Record<string, boolean> };
    pageAgent: { state: string; capabilities: string[] };
    orca: { state: string; worktrees: number; agents: number };
  };
  mcpMesh: ReturnType<typeof mcpMesh.getSummary>;
  skills: number;
  agents: { total: number; busy: number };
  modelProvider: { available: boolean; provider: string; discoveredModels: number };
  events: number;
}

/**
 * Integration Manager — wires the three external repositories (Open-LLM-VTuber,
 * Page Agent, Orca) UNDER the Akansha Master Orchestrator as specialized
 * capability providers. It is NOT a second orchestrator.
 */
export class IntegrationManager {
  private initialized = false;

  async initialize(): Promise<SystemStatus> {
    if (this.initialized) return this.getStatus();
    this.initialized = true;

    // 0. Hydrate persisted credentials so provider health checks can use them.
    await credentialVault.hydrate();

    // 1. Discover every configured AI provider (Ollama/OpenAI/Gemini/custom).
    await modelRouter.initialize();

    // 2. Initialize integrations (each is a capability provider, not a brain)
    await openLLMVTuber.initialize();
    await pageAgent.initialize();
    await orca.initialize();

    // 3. Register the MCP mesh nodes for the standard capability categories
    this.registerStandardMCPNodes();

    // 4. Register core skills
    this.registerCoreSkills();

    // 4b. Register the vendored agent-skills methodology corpus (TDD, debugging,
    //     planning, security-hardening, …) into the SAME SkillRegistry as guidance
    //     skills. Best-effort — never crash startup.
    try {
      const { registerAgentSkills } = await import('../core/skills/agentSkills');
      registerAgentSkills();
    } catch { /* guidance corpus is optional */ }

    // 5. Sync repository-derived capabilities into the LIVE graph so routing
    //    is actually informed by the registry (not merely displayable).
    try {
      const { integrationMatrix } = await import('./registry/IntegrationMatrix');
      integrationMatrix.syncCapabilities();
    } catch {
      /* capability sync is best-effort — degrade, do not crash startup */
    }

    eventBus.emit('mission.completed', 'IntegrationManager', { note: 'System initialized' });
    return this.getStatus();
  }

  private registerStandardMCPNodes() {
    const standardNodes = [
      { serverId: 'mcp-windows', name: 'Windows MCP', category: 'windows' as const, permissions: ['WINDOWS_CONTROL', 'EXECUTE_COMMANDS'] },
      { serverId: 'mcp-browser', name: 'Browser MCP', category: 'browser' as const, permissions: ['BROWSER_ACCESS', 'NETWORK_ACCESS'] },
      { serverId: 'mcp-files', name: 'Files MCP', category: 'files' as const, permissions: ['READ_FILES', 'WRITE_FILES'] },
      { serverId: 'mcp-github', name: 'GitHub MCP', category: 'github' as const, permissions: ['NETWORK_ACCESS'] },
      { serverId: 'mcp-research', name: 'Research MCP', category: 'research' as const, permissions: ['NETWORK_ACCESS', 'READ_EXTERNAL_DATA'] },
      { serverId: 'mcp-orca', name: 'Orca MCP Adapter', category: 'orca' as const, permissions: ['READ_FILES', 'WRITE_FILES', 'EXECUTE_COMMANDS'] },
      { serverId: 'mcp-device', name: 'Device MCP', category: 'device' as const, permissions: ['DEVICE_CONTROL'] },
    ];

    for (const node of standardNodes) {
      if (!mcpMesh.getNode(node.serverId)) {
        mcpMesh.registerNode({
          ...node,
          health: 'AVAILABLE',
          latencyMs: 50,
          version: '1.0.0',
          sandboxed: false,
          successRate: 0.9,
        });
      }
    }
  }

  private registerCoreSkills() {
    const existing = skillRegistry.getAll();
    if (existing.length > 0) return;

    skillRegistry.register({
      id: 'skill-windows-control',
      name: 'Windows Control',
      description: 'Launch applications, manage windows, control desktop UI',
      version: '1.0.0',
      provider: 'native',
      providers: ['windows-agent', 'computer-use'],
      inputs: ['app_name', 'action'],
      outputs: ['window_state'],
      tools: ['app.open', 'app.close', 'app.focus', 'window.manage'],
      mcpServers: ['mcp-windows'],
      agents: ['windows-agent'],
      requiredPermissions: ['WINDOWS_CONTROL', 'EXECUTE_COMMANDS'],
      riskLevel: 'medium',
      dependencies: [],
      preconditions: [],
      successCriteria: ['window/process detected'],
      failureModes: [{ mode: 'not-found', cause: 'app not installed', recovery: 'report to user', alternativeCapability: 'manual' }],
      verification: 'observe process/window state',
      latencyProfile: { min: 100, max: 3000, typical: 500 },
      reliabilityProfile: 0.92,
      learningHistory: [],
      availability: 'available',
    });
  }

  getStatus(): SystemStatus {
    const vtuberHealth = openLLMVTuber.getHealth();
    const providers = providerManager.getAll();
    const registry = modelRouter.getRegistry();
    return {
      integrations: {
        openLLMVTuber: {
          state: vtuberHealth.state,
          capabilities: vtuberHealth.capabilities as unknown as Record<string, boolean>,
        },
        pageAgent: { state: pageAgent.getHealth(), capabilities: pageAgent.getCapabilities() },
        orca: { state: orca.getHealth(), worktrees: orca.getWorktrees().length, agents: agentSupervisor.getAgents().filter((a) => a.agentId.startsWith('orca')).length },
      },
      mcpMesh: mcpMesh.getSummary(),
      skills: skillRegistry.getAll().length,
      agents: {
        total: agentSupervisor.getAgents().length,
        busy: agentSupervisor.getAgents().filter((a) => a.status === 'busy').length,
      },
      modelProvider: {
        available: providers.length > 0 && registry.listAll().length > 0,
        provider: providers.map((p) => p.id).join(', ') || 'none',
        discoveredModels: registry.listAll().length,
      },
      events: eventBus.getHistory().length,
    };
  }
}

export const integrationManager = new IntegrationManager();
