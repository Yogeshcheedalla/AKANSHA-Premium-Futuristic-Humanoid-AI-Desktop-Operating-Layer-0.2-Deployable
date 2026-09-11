import {
  repositoryRegistry,
  type RepositoryEntry,
  type RepositoryLayer,
} from '../../core/repositories/RepositoryRegistry';
import { capabilityGraph } from '../../core/capabilities/CapabilityRegistry';
import { skillRegistry } from '../../core/skills/SkillRegistry';
import { mcpMesh } from '../../core/mcp/MCPMesh';
import { eventBus } from '../../core/events/EventBus';

export interface PipelineStage {
  id: string;
  label: string;
  description: string;
  repositories: RepositoryEntry[];
  capabilities: string[];
}

export interface EscalationRung {
  level: number;
  label: string;
  repository?: RepositoryEntry;
  reason: string;
}

export interface SecurityGate {
  repository: RepositoryEntry;
  sandboxRequired: boolean;
  highPrivilege: boolean;
  permissions: string[];
}

const STAGE_ORDER: Array<{
  id: string;
  label: string;
  description: string;
  layers: RepositoryLayer[];
}> = [
  { id: 'input', label: 'Input & Understanding', description: 'Voice, text, vision and intent normalisation', layers: ['avatar'] },
  { id: 'memory', label: 'Memory', description: 'Context retrieval and scoring before storage', layers: ['memory'] },
  { id: 'orchestration', label: 'Master Orchestrator', description: 'Single authority: goal, plan, authorisation', layers: ['orchestration'] },
  { id: 'model', label: 'Model Router', description: 'Minimum sufficient intelligence per tier', layers: ['model'] },
  { id: 'execution', label: 'Execution Fabric', description: 'Browser, computer-use and coding providers', layers: ['browser', 'computer-use', 'coding'] },
  { id: 'fabric', label: 'MCP & Connectors', description: 'Governed integration fabric', layers: ['mcp', 'workspace'] },
  { id: 'presentation', label: 'Avatar & Voice Out', description: 'One speech stream, one avatar state', layers: ['desktop'] },
  { id: 'evaluation', label: 'Evaluation', description: 'Offline benchmarking of agent capability', layers: ['evaluation'] },
];

/**
 * Integration Matrix — derives the live pipeline from the repository registry
 * and registers approved capabilities into the running CapabilityGraph and
 * SkillRegistry so routing is genuinely experience-driven.
 */
export class IntegrationMatrix {
  private synced = false;

  pipeline(): PipelineStage[] {
    const repos = repositoryRegistry.all();
    return STAGE_ORDER.map((stage) => {
      const stageRepos = repos.filter((r) => stage.layers.includes(r.layer) && r.status !== 'REJECTED');
      return {
        id: stage.id,
        label: stage.label,
        description: stage.description,
        repositories: stageRepos,
        capabilities: Array.from(new Set(stageRepos.flatMap((r) => r.capabilitiesProvided))),
      };
    }).filter((s) => s.repositories.length > 0);
  }

  /** Browser + computer-use escalation ladder derived from the registry. */
  escalationLadder(): EscalationRung[] {
    const find = (id: string) => repositoryRegistry.get(id);
    return [
      { level: 1, label: 'DOM / Page Agent', repository: find('page-agent'), reason: 'Forms, buttons, text fields, accessible page flows' },
      { level: 2, label: 'Accessibility Tree', reason: 'Shadow DOM, ARIA structures, cross-frame content' },
      { level: 3, label: 'Browser Automation', repository: find('browser-use'), reason: 'Multi-page flows, extension-only surfaces' },
      { level: 4, label: 'Playwright / Puppeteer', reason: 'Full automation engine when DOM is unavailable' },
      { level: 5, label: 'Vision / Screenshot', repository: find('ui-tars'), reason: 'Canvas, visual-only controls, custom rendered UI' },
      { level: 6, label: 'Computer Use', repository: find('ui-tars-desktop'), reason: 'OS dialogs, browser permission prompts, native apps' },
      { level: 7, label: 'Windows UI Automation', reason: 'Native Win32 / UIA element control' },
      { level: 8, label: 'User Confirmation', reason: 'CAPTCHA, authentication challenges, irreversible actions' },
    ];
  }

  /** Repos requiring sandbox or holding high privilege. */
  securityGates(): SecurityGate[] {
    return repositoryRegistry.securitySensitive().map((repo) => ({
      repository: repo,
      sandboxRequired: repo.sandboxRequired,
      highPrivilege: repo.permissions.includes('EXECUTE_COMMANDS') || repo.permissions.includes('INPUT_CONTROL'),
      permissions: repo.permissions,
    }));
  }

  /** Rejected repos with their auditable rationale. */
  rejections(): RepositoryEntry[] {
    return repositoryRegistry.byStatus('REJECTED');
  }

  /**
   * Register approved repository capabilities into the LIVE capability graph
   * and skill registry. Only INTEGRATED / ADAPTER_READY repos participate.
   */
  syncCapabilities(): { capabilities: number; skills: number; mcpNodes: number } {
    if (this.synced) {
      return {
        capabilities: capabilityGraph.getAll().length,
        skills: skillRegistry.getAll().length,
        mcpNodes: mcpMesh.getSummary().total,
      };
    }
    this.synced = true;

    let capabilities = 0;
    let skills = 0;

    for (const { repo, capability } of repositoryRegistry.actionableCapabilities()) {
      const id = `cap-${repo.id}-${capability.replace(/[^a-z0-9]+/g, '-')}`;

      if (!capabilityGraph.get(id)) {
        capabilityGraph.register({
          id,
          name: capability,
          description: `${repo.name} — ${repo.roleInAkansha}`,
          category: this.categoryFor(repo),
          permissions: repo.permissions,
          requiredCapabilities: [capability],
          latencyEstimateMs: repo.status === 'INTEGRATED' ? 400 : 1500,
          reliabilityScore: repo.status === 'INTEGRATED' ? 0.88 : 0.6,
          costEstimate: repo.sandboxRequired ? 'high' : 'medium',
          available: repo.status === 'INTEGRATED',
          mcpServerId: repo.integrationMode === 'mcp' ? `mcp-${repo.id}` : undefined,
          toolName: capability,
        });
        capabilities += 1;
      }

      const skillId = `skill-${repo.id}-${capability.replace(/[^a-z0-9]+/g, '-')}`;
      if (!skillRegistry.get(skillId)) {
        skillRegistry.register({
          id: skillId,
          name: capability,
          description: repo.roleInAkansha,
          version: '1.0.0',
          provider: repo.id,
          providers: [repo.id, ...(repo.fallbackFor || [])],
          inputs: ['task_context'],
          outputs: [capability],
          tools: [capability],
          mcpServers: repo.integrationMode === 'mcp' ? [`mcp-${repo.id}`] : [],
          agents: [repo.id],
          requiredPermissions: repo.permissions,
          riskLevel: repo.permissions.includes('EXECUTE_COMMANDS') || repo.permissions.includes('INPUT_CONTROL')
            ? 'high'
            : repo.sandboxRequired
              ? 'medium'
              : 'low',
          dependencies: [],
          preconditions: repo.status === 'INTEGRATED' ? [] : [`${repo.name} runtime available`],
          successCriteria: ['observed state matches expected state'],
          failureModes: [
            {
              mode: 'provider-unavailable',
              cause: `${repo.name} is not running`,
              recovery: 'escalate to fallback capability',
              alternativeCapability: repo.fallbackFor?.[0],
            },
          ],
          verification: 'observe result and compare against expected state',
          latencyProfile: {
            min: 50,
            max: repo.sandboxRequired ? 60000 : 8000,
            typical: repo.status === 'INTEGRATED' ? 400 : 2000,
          },
          reliabilityProfile: repo.status === 'INTEGRATED' ? 0.88 : 0.6,
          learningHistory: [],
          availability: repo.status === 'INTEGRATED' ? 'available' : 'degraded',
        });
        skills += 1;
      }
    }

    eventBus.emit('skill.registered', 'IntegrationMatrix', {
      capabilities,
      skills,
      repositories: repositoryRegistry.stats().total,
    });

    return { capabilities, skills, mcpNodes: mcpMesh.getSummary().total };
  }

  private categoryFor(repo: RepositoryEntry) {
    switch (repo.layer) {
      case 'browser': return 'agent' as const;
      case 'computer-use': return 'vision' as const;
      case 'coding': return 'agent' as const;
      case 'memory': return 'memory' as const;
      case 'mcp': return 'mcp' as const;
      default: return 'api' as const;
    }
  }
}

export const integrationMatrix = new IntegrationMatrix();
