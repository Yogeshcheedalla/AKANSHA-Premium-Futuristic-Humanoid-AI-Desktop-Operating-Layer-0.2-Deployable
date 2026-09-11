import { agentManager, type AgentTask } from './AgentManager';
import { eventBus } from '../events/EventBus';

export interface AgentDescriptor {
  agentId: string;
  name: string;
  role: string;
  capabilities: string[];
  permissions: string[];
  status: 'idle' | 'busy' | 'paused' | 'terminated';
  heartbeat?: number;
  currentTask?: string;
  resourceUsage?: { cpu: number; memory: number };
  successRate: number;
}

export interface ResourceBudget {
  cpu: number;
  ram: number;
  gpu: number;
  network: number;
  parallelism: number;
  timeMs: number;
  tokenBudget: number;
  retryBudget: number;
}

const DEFAULT_BUDGET: ResourceBudget = {
  cpu: 4,
  ram: 8,
  gpu: 1,
  network: 100,
  parallelism: 4,
  timeMs: 5 * 60 * 1000,
  tokenBudget: 200_000,
  retryBudget: 3,
};

/**
 * Agent Supervisor — full lifecycle control over execution specialists.
 * Sits under the Master Orchestrator. Enforces resource budgets.
 */
export class AgentSupervisor {
  private agents = new Map<string, AgentDescriptor>();
  private budget: ResourceBudget = { ...DEFAULT_BUDGET };
  private retries = new Map<string, number>();

  registerAgent(descriptor: AgentDescriptor) {
    this.agents.set(descriptor.agentId, descriptor);
    agentManager.registerAgent(descriptor.agentId);
  }

  getAgent(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId);
  }

  getAgents(): AgentDescriptor[] {
    return Array.from(this.agents.values());
  }

  setBudget(budget: Partial<ResourceBudget>) {
    this.budget = { ...this.budget, ...budget };
  }

  getBudget(): ResourceBudget {
    return { ...this.budget };
  }

  canDispatch(): { allowed: boolean; reason?: string } {
    const running = agentManager.getRunningTasks().length;
    if (running >= this.budget.parallelism) {
      return { allowed: false, reason: `Parallelism limit reached (${this.budget.parallelism})` };
    }
    return { allowed: true };
  }

  async dispatch(agentId: string, goal: string, tools: string[], permissions: string[]): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const check = this.canDispatch();
    if (!check.allowed) {
      eventBus.emit('agent.failed', 'AgentSupervisor', { agentId, goal, reason: check.reason });
      return null;
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await agentManager.dispatchTask({
      id: taskId,
      agentId,
      goal,
      permissions,
      tools,
    });

    agent.status = 'busy';
    agent.currentTask = taskId;
    agent.heartbeat = Date.now();

    eventBus.emit('agent.started', 'AgentSupervisor', { agentId, taskId, goal });
    return taskId;
  }

  async start(agentId: string, goal: string, tools: string[] = [], permissions: string[] = []): Promise<string | null> {
    return this.dispatch(agentId, goal, tools, permissions);
  }

  pause(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = 'paused';
  }

  resume(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent && agent.currentTask) agent.status = 'busy';
  }

  cancel(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.currentTask) agentManager.cancelTask(agent.currentTask);
    agent.status = 'idle';
    agent.currentTask = undefined;
  }

  terminate(agentId: string) {
    this.cancel(agentId);
    const agent = this.agents.get(agentId);
    if (agent) agent.status = 'terminated';
  }

  retry(agentId: string): { allowed: boolean; reason?: string } {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.currentTask) return { allowed: false, reason: 'No active task to retry' };

    const count = this.retries.get(agent.currentTask) || 0;
    if (count >= this.budget.retryBudget) {
      return { allowed: false, reason: `Retry budget exhausted (${this.budget.retryBudget})` };
    }
    this.retries.set(agent.currentTask, count + 1);
    eventBus.emit('retry.started', 'AgentSupervisor', { agentId, taskId: agent.currentTask, attempt: count + 1 });
    return { allowed: true };
  }

  complete(agentId: string, result?: any) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.currentTask) agentManager.completeTask(agent.currentTask, result);
    agent.status = 'idle';
    agent.currentTask = undefined;
    eventBus.emit('agent.completed', 'AgentSupervisor', { agentId, result });
  }

  fail(agentId: string, error: string) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.currentTask) agentManager.failTask(agent.currentTask, error);
    agent.status = 'idle';
    agent.currentTask = undefined;
    eventBus.emit('agent.failed', 'AgentSupervisor', { agentId, error });
  }

  heartbeat(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) agent.heartbeat = Date.now();
  }

  /**
   * Checkpoint = snapshot of active agents/tasks for recovery.
   */
  checkpoint(): Record<string, any> {
    return {
      timestamp: Date.now(),
      agents: Array.from(this.agents.values()).map((a) => ({
        agentId: a.agentId,
        status: a.status,
        currentTask: a.currentTask,
      })),
      tasks: agentManager.getRunningTasks().map((t) => ({ id: t.id, agentId: t.agentId, goal: t.goal })),
    };
  }

  restore(checkpoint: Record<string, any>) {
    if (!checkpoint?.agents) return;
    for (const a of checkpoint.agents) {
      const agent = this.agents.get(a.agentId);
      if (agent) {
        agent.status = a.status;
        agent.currentTask = a.currentTask;
      }
    }
  }
}

export const agentSupervisor = new AgentSupervisor();
