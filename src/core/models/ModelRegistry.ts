import type { ModelInfo, ProviderCapabilities } from './ModelProvider';

export interface ModelCapabilityProfile {
  id: string;
  provider: string;
  providerType: string;
  name: string;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  maxOutputTokens: number;
  latencyEstimateMs: number;
  reliabilityScore: number;
  available: boolean;
  preferredTasks: string[];
  discoveredAt: number;
}

/**
 * Model Registry — dynamic, discovered models. No hard-coded model IDs.
 */
export class ModelRegistry {
  private models = new Map<string, ModelCapabilityProfile>();

  register(model: ModelInfo) {
    const preferred: string[] = [];
    if (model.capabilities.reasoning) preferred.push('reasoning', 'research', 'planning');
    if (model.capabilities.vision) preferred.push('vision', 'screen_analysis');
    if (model.capabilities.tools) preferred.push('coding', 'tool_use');
    preferred.push('conversation');

    this.models.set(`${model.provider}::${model.id}`, {
      id: model.id,
      provider: model.provider,
      providerType: model.providerType,
      name: model.displayName || model.id,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow ?? 128000,
      maxOutputTokens: model.maxOutputTokens ?? 8192,
      latencyEstimateMs: model.latencyMs ?? 500,
      reliabilityScore: model.healthScore ?? 1,
      available: model.available,
      preferredTasks: preferred,
      discoveredAt: Date.now(),
    });
  }

  get(providerId: string, modelId: string): ModelCapabilityProfile | undefined {
    return this.models.get(`${providerId}::${modelId}`);
  }

  listByProvider(providerId: string): ModelInfo[] {
    return Array.from(this.models.values())
      .filter((m) => m.provider === providerId && m.available)
      .map((m) => ({
        id: m.id,
        provider: m.provider,
        providerType: m.providerType as ModelInfo['providerType'],
        displayName: m.name,
        capabilities: m.capabilities,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        available: m.available,
        latencyMs: m.latencyEstimateMs,
        healthScore: m.reliabilityScore,
      }));
  }

  listAll(): ModelCapabilityProfile[] {
    return Array.from(this.models.values());
  }

  countByProvider(): Record<string, number> {
    return this.listAll().reduce<Record<string, number>>((acc, m) => {
      acc[m.provider] = (acc[m.provider] || 0) + 1;
      return acc;
    }, {});
  }

  clearProvider(providerId: string) {
    for (const key of Array.from(this.models.keys())) {
      if (key.startsWith(`${providerId}::`)) this.models.delete(key);
    }
  }
}

export const modelRegistry = new ModelRegistry();
