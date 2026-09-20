/**
 * Free-first cost policy — the missing cost dimension in Akansha's routing.
 * A pure, testable layer the existing ModelRouter consumes (NOT a second router).
 * Preference order: local ($0, private) → free cloud (e.g. OpenRouter free router)
 * → paid cloud. When only paid routes remain, it flags `requiresPaidConsent` so the
 * UI asks before spending — never silently consumes paid credits.
 */
export type CostTier = 'local' | 'free' | 'paid';
export const COST_ORDER: Record<CostTier, number> = { local: 0, free: 1, paid: 2 };

export interface CostHint { isLocal?: boolean; freeModel?: boolean; }

/**
 * Model-aware cost tier.
 *
 * CRITICAL correction (verified against OpenRouter's own docs): the OpenRouter
 * PROVIDER is not "free". Only the dedicated Free Models Router
 * (`openrouter/free`) and explicitly free variants (`...:free`) are zero-cost;
 * `openrouter/auto` and normal metered models CAN select paid models and must
 * go through paid consent. Provider-level heuristics remain only as a fallback
 * when no model id is known.
 */
export function modelCostTier(providerId: string, modelId?: string, hint: CostHint = {}): CostTier {
  if (hint.isLocal || providerId === 'local' || providerId === 'ollama') return 'local';
  if (providerId === 'pollinations') return 'free'; // keyless free default
  const m = (modelId || '').toLowerCase();
  if (hint.freeModel || m === 'openrouter/free' || m.endsWith(':free') || m.includes('/free')) return 'free';
  if (m) return 'paid'; // a known model that is not free-flagged is treated as paid-capable
  // No model id available: fall back to the conservative provider heuristic
  // (OpenRouter hosts a free router, so it MAY be free — but never claim it).
  return providerId === 'openrouter' ? 'free' : 'paid';
}

/** Classify a provider/model's cost tier. Provider-level heuristic + per-model override. */
export function costTierFor(providerId: string, hint: CostHint = {}): CostTier {
  return modelCostTier(providerId, undefined, hint);
}

export function costRank(providerId: string, hint?: CostHint): number {
  return COST_ORDER[costTierFor(providerId, hint)];
}

export function modelCostRank(providerId: string, modelId?: string, hint?: CostHint): number {
  return COST_ORDER[modelCostTier(providerId, modelId, hint)];
}

/** Stable comparator: cheaper first (used as a score tiebreaker in routing). */
export function freeFirstCompare(a: { providerId: string; modelId?: string }, b: { providerId: string; modelId?: string }): number {
  return modelCostRank(a.providerId, a.modelId) - modelCostRank(b.providerId, b.modelId);
}

export interface CostPlan<T extends { providerId: string }> {
  ordered: T[];
  recommended?: T;
  requiresPaidConsent: boolean;
  reason: string;
}

/** Order candidates cheapest-first and decide whether paid consent is required. */
export function planCostRoute<T extends { providerId: string; modelId?: string }>(candidates: T[]): CostPlan<T> {
  const ordered = [...candidates].sort((a, b) => modelCostRank(a.providerId, a.modelId) - modelCostRank(b.providerId, b.modelId));
  const recommended = ordered[0];
  const tier = recommended ? modelCostTier(recommended.providerId, recommended.modelId) : null;
  return {
    ordered,
    recommended,
    requiresPaidConsent: tier === 'paid',
    reason: !recommended
      ? 'no providers available'
      : tier === 'local'
        ? 'free local model available'
        : tier === 'free'
          ? 'free cloud route available (rate-limited)'
          : 'only paid routes available — ask before spending',
  };
}

/** True only when there are candidates and NONE is a free/local route. */
export function allRoutesPaid(candidates: { providerId: string; modelId?: string }[]): boolean {
  return candidates.length > 0 && candidates.every((c) => modelCostTier(c.providerId, c.modelId) === 'paid');
}

export interface PaidConsentPrompt {
  required: boolean;
  provider?: string;
  model?: string;
  cost: string;
  options: Array<'continue-paid' | 'use-free-local' | 'cancel'>;
}

/**
 * The explicit paid-consent decision. Returns required:true ONLY when every viable
 * route is paid (no free/local alternative) — so the UI must stop and ask before
 * spending. Never shown when a free/local route exists. Cost is honestly unknown
 * unless a provider supplies it.
 */
export function paidConsentPrompt<T extends { providerId: string; modelId?: string }>(candidates: T[]): PaidConsentPrompt {
  if (!allRoutesPaid(candidates)) return { required: false, cost: '', options: [] };
  const top = candidates[0];
  return {
    required: true,
    provider: top.providerId,
    model: top.modelId,
    cost: 'Cost unavailable from provider.',
    options: ['continue-paid', 'use-free-local', 'cancel'],
  };
}
