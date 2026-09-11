export interface AgentTask {
  id: string;
  agentId: string;
  goal: string;
  status: 'QUEUED' | 'PLANNING' | 'RUNNING' | 'WAITING' | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  permissions: string[];
  tools: string[];
  progress: number; // 0-100
  logs: string[];
  result?: any;
  startedAt: number;
  finishedAt?: number;
}

export class AgentManager {
  private tasks = new Map<string, AgentTask>();
  private activeAgentIds = new Set<string>();

  registerAgent(agentId: string) {
    this.activeAgentIds.add(agentId);
  }

  async dispatchTask(task: Omit<AgentTask, 'status' | 'progress' | 'logs' | 'startedAt'>): Promise<string> {
    const fullTask: AgentTask = {
      ...task,
      status: 'QUEUED',
      progress: 0,
      logs: [`Task queued at ${new Date().toISOString()}`],
      startedAt: Date.now(),
    };
    this.tasks.set(task.id, fullTask);
    console.log(`[AGENT MANAGER] Task ${task.id} queued for agent ${task.agentId}`);
    return task.id;
  }

  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  getRunningTasks() {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'RUNNING' || t.status === 'PLANNING' || t.status === 'VERIFYING' || t.status === 'WAITING'
    );
  }

  cancelTask(id: string) {
    const task = this.tasks.get(id);
    if (task && (task.status === 'QUEUED' || task.status === 'RUNNING' || task.status === 'PLANNING')) {
      task.status = 'CANCELLED';
      task.logs.push(`Task cancelled at ${new Date().toISOString()}`);
    }
  }

  updateProgress(id: string, progress: number, log?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.progress = Math.min(100, Math.max(0, progress));
      if (log) task.logs.push(log);
    }
  }

  completeTask(id: string, result?: any) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'COMPLETED';
      task.result = result;
      task.finishedAt = Date.now();
      task.progress = 100;
      task.logs.push('Task completed successfully');
      console.log(`[AGENT MANAGER] Task ${id} completed`);
    }
  }

  failTask(id: string, error: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'FAILED';
      task.logs.push(`Task failed: ${error}`);
      console.error(`[AGENT MANAGER] Task ${id} failed: ${error}`);
    }
  }
}

export const agentManager = new AgentManager();
