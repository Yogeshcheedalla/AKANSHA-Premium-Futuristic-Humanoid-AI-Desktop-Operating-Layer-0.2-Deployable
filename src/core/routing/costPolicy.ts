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

/** Classify a provider/model's cost tier. Provider-level heuristic + per-model override. */
export function costTierFor(providerId: string, hint: CostHint = {}): CostTier {
  if (hint.isLocal || providerId === 'local' || providerId === 'ollama') return 'local';
  if (hint.freeModel || providerId === 'openrouter') return 'free'; // OpenRouter exposes a free router/tier
  return 'paid';
}

export function costRank(providerId: string, hint?: CostHint): number {
  return COST_ORDER[costTierFor(providerId, hint)];
}

/** Stable comparator: cheaper first (used as a score tiebreaker in routing). */
export function freeFirstCompare(a: { providerId: string }, b: { providerId: string }): number {
  return costRank(a.providerId) - costRank(b.providerId);
}

export interface CostPlan<T extends { providerId: string }> {
  ordered: T[];
  recommended?: T;
  requiresPaidConsent: boolean;
  reason: string;
}

/** Order candidates cheapest-first and decide whether paid consent is required. */
export function planCostRoute<T extends { providerId: string }>(candidates: T[]): CostPlan<T> {
  const ordered = [...candidates].sort((a, b) => costRank(a.providerId) - costRank(b.providerId));
  const recommended = ordered[0];
  const tier = recommended ? costTierFor(recommended.providerId) : null;
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
export function allRoutesPaid(candidates: { providerId: string }[]): boolean {
  return candidates.length > 0 && candidates.every((c) => costTierFor(c.providerId) === 'paid');
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
