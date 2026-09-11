import { eventBus } from '../events/EventBus';

export interface ResourceBudget {
  cpu: number;          // cores
  ram: number;          // GB
  vram: number;         // GB
  networkMbps: number;
  maxConcurrentAgents: number;
  maxConcurrentModels: number;
  tokenBudget: number;
  retryBudget: number;
  timeBudgetMs: number;
}

export interface ResourceUsage {
  agents: number;
  modelsInUse: number;
  tokensUsed: number;
  retries: number;
  elapsedMs: number;
}

const TIERS: Record<string, Partial<ResourceBudget>> = {
  tier0: { maxConcurrentAgents: 0, maxConcurrentModels: 0, tokenBudget: 0, retryBudget: 0, timeBudgetMs: 2_000 },
  tier1: { maxConcurrentAgents: 0, maxConcurrentModels: 1, tokenBudget: 2_000, retryBudget: 1, timeBudgetMs: 20_000 },
  tier2: { maxConcurrentAgents: 0, maxConcurrentModels: 1, tokenBudget: 8_000, retryBudget: 2, timeBudgetMs: 60_000 },
  tier3: { maxConcurrentAgents: 2, maxConcurrentModels: 2, tokenBudget: 40_000, retryBudget: 3, timeBudgetMs: 5 * 60_000 },
  tier4: { maxConcurrentAgents: 6, maxConcurrentModels: 3, tokenBudget: 200_000, retryBudget: 4, timeBudgetMs: 30 * 60_000 },
};

/**
 * Resource Governor — prevents launching 20 agents for a trivial request.
 * Tier 0 = deterministic, no model. Tier 1 = fast chat. Tier 2 = reasoning.
 * Tier 3 = single-agent mission. Tier 4 = parallel multi-agent mission.
 */
export class ResourceGovernor {
  private budgets = new Map<string, ResourceBudget>();
  private usage = new Map<string, ResourceUsage>();
  private startedAt = new Map<string, number>();
  private tokensSpent = new Map<string, number>();

  /** Assign the minimum sufficient budget for the request tier. */
  budgetFor(tier: keyof typeof TIERS | string, overrides: Partial<ResourceBudget> = {}): ResourceBudget {
    const base: ResourceBudget = {
      cpu: 4,
      ram: 8,
      vram: 4,
      networkMbps: 100,
      maxConcurrentAgents: 1,
      maxConcurrentModels: 1,
      tokenBudget: 10_000,
      retryBudget: 2,
      timeBudgetMs: 120_000,
      ...TIERS[tier],
      ...overrides,
    };
    return base;
  }

  begin(requestId: string, budget: ResourceBudget) {
    this.budgets.set(requestId, budget);
    this.usage.set(requestId, {
      agents: 0,
      modelsInUse: 0,
      tokensUsed: 0,
      retries: 0,
      elapsedMs: 0,
    });
    this.startedAt.set(requestId, Date.now());
  }

  canSpawnAgent(requestId: string): { allowed: boolean; reason?: string } {
    const b = this.budgets.get(requestId);
    const u = this.usage.get(requestId);
    if (!b || !u) return { allowed: false, reason: 'no budget allocated' };
    if (u.agents >= b.maxConcurrentAgents) {
      eventBus.emit('resource.throttled', 'ResourceGovernor', { requestId, kind: 'agent', limit: b.maxConcurrentAgents });
      return { allowed: false, reason: `agent concurrency limit (${b.maxConcurrentAgents})` };
    }
    if (this.elapsed(requestId) > b.timeBudgetMs) {
      return { allowed: false, reason: 'time budget exhausted' };
    }
    return { allowed: true };
  }

  acquireAgent(requestId: string) {
    const u = this.usage.get(requestId);
    if (u) u.agents += 1;
  }

  releaseAgent(requestId: string) {
    const u = this.usage.get(requestId);
    if (u && u.agents > 0) u.agents -= 1;
  }

  canCallModel(requestId: string): { allowed: boolean; reason?: string } {
    const b = this.budgets.get(requestId);
    const u = this.usage.get(requestId);
    if (!b || !u) return { allowed: false, reason: 'no budget allocated' };
    if (u.tokensUsed >= b.tokenBudget) {
      eventBus.emit('resource.throttled', 'ResourceGovernor', { requestId, kind: 'token', limit: b.tokenBudget });
      return { allowed: false, reason: `token budget exhausted (${b.tokenBudget})` };
    }
    if (u.modelsInUse >= b.maxConcurrentModels) {
      return { allowed: false, reason: `model concurrency limit (${b.maxConcurrentModels})` };
    }
    return { allowed: true };
  }

  acquireModel(requestId: string) {
    const u = this.usage.get(requestId);
    if (u) u.modelsInUse += 1;
  }

  releaseModel(requestId: string) {
    const u = this.usage.get(requestId);
    if (u && u.modelsInUse > 0) u.modelsInUse -= 1;
  }

  recordTokens(requestId: string, tokens: number) {
    const u = this.usage.get(requestId);
    const spent = (this.tokensSpent.get(requestId) || 0) + tokens;
    this.tokensSpent.set(requestId, spent);
    if (u) u.tokensUsed = spent;
  }

  canRetry(requestId: string): { allowed: boolean; reason?: string } {
    const b = this.budgets.get(requestId);
    const u = this.usage.get(requestId);
    if (!b || !u) return { allowed: false, reason: 'no budget allocated' };
    if (u.retries >= b.retryBudget) {
      return { allowed: false, reason: `retry budget exhausted (${b.retryBudget})` };
    }
    u.retries += 1;
    return { allowed: true };
  }

  private elapsed(requestId: string): number {
    const start = this.startedAt.get(requestId);
    return start ? Date.now() - start : 0;
  }

  usageFor(requestId: string): ResourceUsage & { budget: ResourceBudget; elapsedMs: number } {
    const b = this.budgets.get(requestId);
    const u = this.usage.get(requestId);
    return {
      agents: u?.agents ?? 0,
      modelsInUse: u?.modelsInUse ?? 0,
      tokensUsed: u?.tokensUsed ?? 0,
      retries: u?.retries ?? 0,
      elapsedMs: this.elapsed(requestId),
      budget: b ?? this.budgetFor('tier2'),
    };
  }

  finish(requestId: string) {
    this.budgets.delete(requestId);
    this.usage.delete(requestId);
    this.startedAt.delete(requestId);
    this.tokensSpent.delete(requestId);
  }
}

export const resourceGovernor = new ResourceGovernor();
