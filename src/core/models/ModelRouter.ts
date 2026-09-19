import { providerManager } from '../providers/ProviderManager';
import { classifyTaskRequirement } from '../../integrations/models/CapabilityInference';
import type {
  ModelProvider,
  ModelInfo,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  HealthStatus,
} from './ModelProvider';
import { eventBus } from '../events/EventBus';
import { freeFirstCompare, allRoutesPaid } from '../routing/costPolicy';

export interface RoutingCandidate {
  providerId: string;
  modelId: string;
  score: number;
  reasons: string[];
  latencyEstimateMs: number;
}

export interface RoutingDecision {
  provider: string;
  modelId: string;
  reason: string;
  capabilitiesMatched: string[];
  estimatedLatencyMs: number;
  candidates: RoutingCandidate[];
  requiresPaidConsent: boolean;
}

export type RoutingPolicy = 'LOCAL_ONLY' | 'CLOUD_ONLY' | 'PREFERRED_LOCAL' | 'PREFERRED_CLOUD' | 'BALANCED' | 'MANUAL';

export interface FallbackAttempt {
  providerId: string;
  modelId: string;
  outcome: 'success' | 'failure';
  error?: string;
}

export { ModelRegistry } from './ModelRegistry';
import { modelRegistry } from './ModelRegistry';

const LOCAL_TYPES = new Set(['ollama', 'local']);

/**
 * Model Router — the ONLY way Akansha reaches model intelligence.
 *
 * Routes on task type, capability need, latency, privacy/policy preference,
 * availability and health, then falls back through configured providers.
 * Every decision produces an auditable trace.
 */
export class ModelRouter {
  private policy: RoutingPolicy = 'BALANCED';
  private providerSuccess = new Map<string, { success: number; total: number }>();

  setPolicy(policy: RoutingPolicy) {
    this.policy = policy;
  }

  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  async initialize() {
    await providerManager.load();

    // Discover models from every configured provider (non-fatal on failure).
    for (const provider of providerManager.getAll()) {
      try {
        const models = await provider.listModels();
        for (const model of models) {
          modelRegistry.register(model);
        }
        if (models.length > 0) {
          eventBus.emit('mcp.connected', 'ModelRouter', { providerId: provider.id, models: models.length });
        }
      } catch {
        /* provider unavailable — degrade, do not crash */
      }
    }
    const known = modelRegistry.listAll();
    eventBus.emit('model.selected', 'ModelRouter', {
      note: 'discovery complete',
      providers: providerManager.getAll().length,
      models: known.length,
    });
    return { providers: providerManager.getAll().length, models: known.length };
  }

  /** Small quality nudge so a working modern model is preferred over a legacy one. */
  private modelQuality(id: string): { delta: number; reason?: string } {
    const m = id.toLowerCase();
    if (/gpt-3\.5|gpt-4-0(314|513)|text-davinci|-instruct\b|-00[13]\b|\bada\b|gpt-4-32k/.test(m)) {
      return { delta: -25, reason: 'legacy-model' };
    }
    if (/gpt-4o|gpt-4\.1|\bo1\b|\bo3\b|\bo4\b|claude|gemini-(?:1\.5|2|pro|flash)|llama-?(?:3\.1|3\.2|3\.3|4)|mistral|qwen[23]|deepseek/.test(m)) {
      return { delta: 15, reason: 'modern-capable' };
    }
    return { delta: 0 };
  }

  private scoreProvider(
    provider: ModelProvider,
    need: { reasoning: boolean; vision: boolean; coding: boolean; fast: boolean },
    models: ModelInfo[],
    contextSize?: number
  ): RoutingCandidate[] {
    const out: RoutingCandidate[] = [];
    if (models.length === 0) return out;

    const isLocal = LOCAL_TYPES.has(provider.type);
    const d = provider.descriptor();

    // Policy filters
    if (this.policy === 'LOCAL_ONLY' && !isLocal) return out;
    if (this.policy === 'CLOUD_ONLY' && isLocal) return out;

    for (const model of models) {
      // Never route chat/generation to a non-conversational model
      // (embeddings, whisper, tts, moderation, image, etc.).
      if (!model.capabilities.chat) continue;

      const reasons: string[] = [];
      let score = 50;

      // Capability fit
      if (need.reasoning && model.capabilities.reasoning) {
        score += 20;
        reasons.push('reasoning-capable');
      }
      if (need.vision) {
        if (model.capabilities.vision) {
          score += 25;
          reasons.push('vision-capable');
        } else {
          score -= 60;
          reasons.push('no-vision');
        }
      }
      if (need.coding && model.capabilities.tools) {
        score += 10;
        reasons.push('tool-capable');
      }
      if (need.fast) {
        score += 10;
        reasons.push('fast-path');
      }

      // Model quality nudge (prefer working modern models over legacy ones).
      const quality = this.modelQuality(model.id);
      score += quality.delta;
      if (quality.reason) reasons.push(quality.reason);

      // Context window
      if (contextSize && model.contextWindow && contextSize > model.contextWindow) {
        score -= 40;
        reasons.push('context-too-small');
      }

      // Policy preference
      if (this.policy === 'PREFERRED_LOCAL') score += isLocal ? 20 : 0;
      if (this.policy === 'PREFERRED_CLOUD') score += isLocal ? 0 : 20;

      // Explicit fallback priority (lower = preferred)
      score += Math.max(0, 25 - d.fallbackPriority / 4);

      // Default model bonus
      if (d.defaultModel && d.defaultModel === model.id) {
        score += 10;
        reasons.push('user-default');
      }

      // Historical success rate
      const hist = this.providerSuccess.get(provider.id);
      if (hist && hist.total > 0) {
        const rate = hist.success / hist.total;
        score += (rate - 0.5) * 30;
        if (rate > 0.8) reasons.push('high-success-rate');
        if (rate < 0.5) reasons.push('recent-failures');
      }

      // Health score
      score *= model.healthScore ?? 1;

      out.push({
        providerId: provider.id,
        modelId: model.id,
        score: Math.max(0, Math.round(score)),
        reasons,
        latencyEstimateMs: model.latencyMs ?? (isLocal ? 400 : 900),
      });
    }

    // Best-first within this provider.
    return out.sort((a, b) => b.score - a.score);
  }

  /**
   * Produce an ordered list of routing candidates with reasons.
   */
  async rank(
    taskType: string,
    requiredCapabilities: string[] = [],
    contextSize?: number,
    privacySensitive = false
  ): Promise<RoutingCandidate[]> {
    await providerManager.load();
    const need = classifyTaskRequirement(taskType);
    if (requiredCapabilities.includes('vision')) need.vision = true;
    if (requiredCapabilities.includes('reasoning')) need.reasoning = true;
    if (requiredCapabilities.includes('coding')) need.coding = true;
    if (privacySensitive) {
      // Prefer local for private data
      need.fast = false;
    }

    const candidates: RoutingCandidate[] = [];
    for (const provider of providerManager.getAll()) {
      const models = modelRegistry.listByProvider(provider.id);
      candidates.push(...this.scoreProvider(provider, need, models, contextSize));
    }

    if (privacySensitive) {
      candidates.sort((a, b) => b.score - a.score || freeFirstCompare(a, b));
    } else {
      candidates.sort((a, b) => b.score - a.score || freeFirstCompare(a, b));
    }
    return candidates;
  }

  /**
   * Route a task to the best provider/model.
   */
  async routeTask(
    taskType: string,
    requiredCapabilities: string[] = [],
    contextSize?: number,
    privacySensitive = false
  ): Promise<RoutingDecision | null> {
    const candidates = await this.rank(taskType, requiredCapabilities, contextSize, privacySensitive);
    if (candidates.length === 0) {
      eventBus.emit('integration.health_changed', 'ModelRouter', { state: 'UNAVAILABLE', detail: 'no provider has models' });
      return null;
    }

    const top = candidates[0];
    const decision: RoutingDecision = {
      provider: top.providerId,
      modelId: top.modelId,
      reason: top.reasons.length ? top.reasons.join(', ') : 'best available score',
      capabilitiesMatched: requiredCapabilities,
      estimatedLatencyMs: top.latencyEstimateMs,
      candidates,
      requiresPaidConsent: allRoutesPaid(candidates),
    };

    eventBus.emit('model.selected', 'ModelRouter', {
      providerId: decision.provider,
      modelId: decision.modelId,
      taskType,
      score: top.score,
      reasons: top.reasons,
      candidateCount: candidates.length,
    });

    return decision;
  }

  /** Ordered fallback chain across all viable providers. */
  async fallbackChain(taskType: string, requiredCapabilities: string[] = []): Promise<RoutingCandidate[]> {
    return this.rank(taskType, requiredCapabilities);
  }

  private record(providerId: string, success: boolean) {
    const h = this.providerSuccess.get(providerId) || { success: 0, total: 0 };
    h.total += 1;
    if (success) h.success += 1;
    this.providerSuccess.set(providerId, h);
  }

  /**
   * Generate with automatic, bounded fallback across providers.
   * Never fabricates a response — throws honestly if every provider fails.
   */
  async generateWithFallback(
    request: ModelRequest,
    taskType = 'reasoning',
    requiredCapabilities: string[] = []
  ): Promise<{ response: ModelResponse; attempts: FallbackAttempt[]; decision: RoutingDecision | null }> {
    const chain = await this.fallbackChain(taskType, requiredCapabilities);
    const attempts: FallbackAttempt[] = [];

    if (chain.length === 0) {
      throw new Error('No AI provider is configured with an available model.');
    }

    const decision: RoutingDecision = {
      provider: chain[0].providerId,
      modelId: chain[0].modelId,
      reason: chain[0].reasons.join(', '),
      capabilitiesMatched: requiredCapabilities,
      estimatedLatencyMs: chain[0].latencyEstimateMs,
      candidates: chain,
      requiresPaidConsent: allRoutesPaid(chain),
    };

    // Provider-diverse ordering: try the best model of EACH provider before
    // exhausting extra models on one provider. A quota-limited or flaky
    // provider can no longer crowd out a healthy one.
    const seenProviders = new Set<string>();
    const firstPass: RoutingCandidate[] = [];
    const rest: RoutingCandidate[] = [];
    for (const c of chain) {
      if (!seenProviders.has(c.providerId)) {
        seenProviders.add(c.providerId);
        firstPass.push(c);
      } else {
        rest.push(c);
      }
    }
    const ordered = [...firstPass, ...rest];

    for (const candidate of ordered.slice(0, 8)) {
      const provider = providerManager.get(candidate.providerId);
      if (!provider) continue;
      try {
        const response = await provider.generate({ ...request, model: candidate.modelId });
        this.record(candidate.providerId, true);
        attempts.push({ providerId: candidate.providerId, modelId: candidate.modelId, outcome: 'success' });
        return { response, attempts, decision };
      } catch (e: any) {
        this.record(candidate.providerId, false);
        attempts.push({
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          outcome: 'failure',
          error: e?.message || 'unknown error',
        });
        eventBus.emit('recovery.started', 'ModelRouter', {
          from: candidate.providerId,
          reason: e?.message,
        });
      }
    }

    const triedProviders = Array.from(new Set(attempts.map((a) => a.providerId))).join(', ');
    throw new Error(
      `All providers failed (tried: ${triedProviders || 'none'}): ${attempts.map((a) => `${a.providerId}/${a.modelId}(${a.error || 'failed'})`).join(' → ')}`
    );
  }

  async streamWithFallback(
    request: ModelRequest,
    taskType = 'reasoning'
  ): Promise<AsyncIterable<ModelStreamEvent>> {
    const chain = await this.fallbackChain(taskType);
    for (const candidate of chain.slice(0, 3)) {
      const provider = providerManager.get(candidate.providerId);
      if (!provider) continue;
      try {
        return provider.stream({ ...request, model: candidate.modelId });
      } catch {
        continue;
      }
    }
    throw new Error('No provider available for streaming');
  }

  async healthAll(): Promise<Record<string, HealthStatus>> {
    return providerManager.refreshAllHealth();
  }

  getRegistry() {
    return modelRegistry;
  }
}

export const modelRouter = new ModelRouter();
