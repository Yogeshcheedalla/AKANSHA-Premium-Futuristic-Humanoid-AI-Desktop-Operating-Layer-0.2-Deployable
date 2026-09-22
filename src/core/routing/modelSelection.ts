/**
 * Model Selection Engine — task-aware, policy-enforcing model/route choice.
 *
 * This EXTENDS the existing ModelRouter + costPolicy; it is NOT a second router.
 * It answers, for one (sub)task: given required capabilities + a cost/privacy
 * policy + candidate models with measured health, which route/model should be
 * used, why, and what the verified fallbacks are.
 *
 * Hard rules (never violated):
 *  - FREE_ONLY: a paid model is NEVER selected.
 *  - OFFLINE_ONLY: a remote model is NEVER selected.
 *  - A required capability that a model does not declare is treated as NOT
 *    satisfied (UNKNOWN is never promoted to capable).
 *  - A local model whose RAM requirement exceeds available RAM is BLOCKED by
 *    hardware, not attempted.
 *  - Unhealthy providers (UNAVAILABLE / AUTH_REQUIRED / RATE_LIMITED) are
 *    circuit-broken out of the candidate set.
 *  - No fake quality scores: reasons cite only measured criteria.
 */
import type { CostTier } from './costPolicy';

export type ModelPolicy =
  | 'FREE_ONLY' | 'FREE_FIRST' | 'OFFLINE_ONLY' | 'OFFLINE_FIRST'
  | 'BEST_AVAILABLE' | 'FASTEST' | 'QUALITY_FIRST' | 'PRIVACY_FIRST' | 'AUTO';

export interface TaskRequirements {
  coding?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  multimodal?: boolean;
  toolCalling?: boolean;
  structuredOutput?: boolean;
  contextTokens?: number;
  latencySensitive?: boolean;
  privacySensitive?: boolean;
}

export type ModelHealth = 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNKNOWN';

export interface ModelCandidate {
  providerId: string;
  modelId: string;
  costTier: CostTier;
  local: boolean;
  capabilities: Partial<Record<keyof TaskRequirements | 'chat', boolean>>;
  contextTokens?: number;
  latencyMs?: number;
  health: ModelHealth;
  ramGB?: number;
  vramGB?: number;
}

export interface SelectionContext { freeRamGB?: number; }

export interface RouteLike {
  providerId: string; bestModel?: string | null; modelId?: string | null;
  costTier?: string; health?: string; enabled?: boolean;
}
const LOCAL_PROVIDERS = new Set(['ollama', 'local', 'local-server']);
function mapHealth(h?: string): ModelHealth {
  switch (h) {
    case 'AVAILABLE': return 'READY';
    case 'DEGRADED': return 'DEGRADED';
    case 'AUTH_REQUIRED': return 'AUTH_REQUIRED';
    case 'RATE_LIMITED': return 'RATE_LIMITED';
    case 'UNAVAILABLE': return 'UNAVAILABLE';
    default: return 'UNKNOWN';
  }
}

/** Map providerBootstrap routes into selectable ModelCandidates. */
export function candidatesFromRoutes(routes: RouteLike[]): ModelCandidate[] {
  const out: ModelCandidate[] = [];
  for (const r of routes) {
    if (r.enabled === false) continue;
    const modelId = r.bestModel || r.modelId;
    if (!modelId) continue;
    const local = LOCAL_PROVIDERS.has(r.providerId);
    const tier: CostTier = local ? 'local' : (r.costTier === 'paid' ? 'paid' : 'free');
    out.push({ providerId: r.providerId, modelId, costTier: tier, local, capabilities: { chat: true }, health: mapHealth(r.health) });
  }
  return out;
}

/**
 * Policy-aware selection for a turn. Returns a decision ONLY for an explicit
 * restrictive policy (FREE_ONLY / OFFLINE_ONLY / PRIVACY_FIRST); otherwise null
 * so callers keep their existing verified free-first behavior. Never fabricates.
 */
export function selectForTurn(text: string, routes: RouteLike[], ctx: SelectionContext = {}): ModelDecision | null {
  const policy = derivePolicy(text);
  if (policy !== 'FREE_ONLY' && policy !== 'OFFLINE_ONLY' && policy !== 'PRIVACY_FIRST') return null;
  return selectModel({}, policy, candidatesFromRoutes(routes), ctx).decision;
}

export interface ModelDecision {
  providerId: string;
  modelId: string;
  source: 'local' | 'omniroute' | 'cloud';
  costTier: CostTier;
  reason: string;
  capabilitiesMatched: string[];
  fallbacks: Array<{ providerId: string; modelId: string; costTier: CostTier }>;
  requiresPaidConsent: boolean;
}

export interface SelectionResult {
  decision: ModelDecision | null;
  policy: ModelPolicy;
  blockedReason: string | null;
  considered: number;
}

const UNHEALTHY: ModelHealth[] = ['UNAVAILABLE', 'AUTH_REQUIRED', 'RATE_LIMITED'];
const HARD_REQS: Array<keyof TaskRequirements> = ['vision', 'audio', 'multimodal', 'toolCalling', 'structuredOutput'];

export function derivePolicy(text: string): ModelPolicy {
  const t = (text || '').toLowerCase();
  if (/\b(no internet|offline|don'?t (use )?(the )?internet|local only|keep everything local|without internet)\b/.test(t)) return 'OFFLINE_ONLY';
  if (/\bfree only|only free|no paid|don'?t (pay|spend)|zero cost|without paying\b/.test(t)) return 'FREE_ONLY';
  if (/\bfree\b/.test(t) && /\b(offline|local)\b/.test(t)) return 'OFFLINE_FIRST';
  if (/\bfree\b/.test(t)) return 'FREE_FIRST';
  if (/\bfast(est)?|quick(ly)?\b/.test(t)) return 'FASTEST';
  if (/\bbest\b|whatever is best|strongest/.test(t)) return 'BEST_AVAILABLE';
  if (/\bprivate|privacy|don'?t send my data/.test(t)) return 'PRIVACY_FIRST';
  return 'AUTO';
}

function sourceOf(c: ModelCandidate): 'local' | 'omniroute' | 'cloud' {
  if (c.local) return 'local';
  if (c.providerId === 'omniroute' || c.providerId === 'pollinations') return 'omniroute';
  return 'cloud';
}

function meetsHardReqs(c: ModelCandidate, reqs: TaskRequirements): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const k of HARD_REQS) {
    if (reqs[k] && c.capabilities[k] !== true) missing.push(k);
  }
  if (reqs.contextTokens && (c.contextTokens ?? 0) < reqs.contextTokens) missing.push('context');
  return { ok: missing.length === 0, missing };
}

function score(c: ModelCandidate, reqs: TaskRequirements, policy: ModelPolicy): number {
  let s = 0;
  if (reqs.coding && c.capabilities.coding) s += 25;
  if (reqs.reasoning && c.capabilities.reasoning) s += 20;
  if (c.capabilities.chat) s += 5;
  // Cost/privacy preference.
  if (c.costTier === 'local') s += 30;
  else if (c.costTier === 'free') s += 20;
  else s += 2; // paid, last
  if (policy === 'PRIVACY_FIRST' && c.local) s += 25;
  if (policy === 'OFFLINE_FIRST' && c.local) s += 25;
  if (policy === 'FASTEST') s += Math.max(0, 20 - Math.floor((c.latencyMs ?? 1500) / 200));
  if (policy === 'QUALITY_FIRST' || policy === 'BEST_AVAILABLE') s += (c.capabilities.reasoning ? 8 : 0) + (c.capabilities.coding ? 8 : 0);
  if (c.health === 'READY') s += 10; else if (c.health === 'UNKNOWN') s += 3; else if (c.health === 'DEGRADED') s -= 5;
  return s;
}

export function selectModel(
  reqs: TaskRequirements,
  policy: ModelPolicy,
  candidates: ModelCandidate[],
  ctx: SelectionContext = {},
): SelectionResult {
  const considered = candidates.length;
  let pool = candidates.filter((c) => !UNHEALTHY.includes(c.health));
  const notes: string[] = [];
  if (pool.length < considered) notes.push('skipped unhealthy');

  // Policy planes.
  if (policy === 'OFFLINE_ONLY' || policy === 'PRIVACY_FIRST') pool = pool.filter((c) => c.local);
  if (policy === 'FREE_ONLY') pool = pool.filter((c) => c.costTier !== 'paid');

  // Hardware gate for local models: block if RAM requirement exceeds available.
  if (ctx.freeRamGB != null) {
    pool = pool.filter((c) => {
      if (!c.local) return true;
      if (c.ramGB != null && c.ramGB > ctx.freeRamGB!) { notes.push(`blocked ${c.modelId} (needs ${c.ramGB}GB > ${ctx.freeRamGB}GB free)`); return false; }
      return true;
    });
  }

  // Hard capability filter (UNKNOWN never promoted to capable).
  const hasHardReq = HARD_REQS.some((k) => reqs[k]) || !!reqs.contextTokens;
  const capable = pool.filter((c) => meetsHardReqs(c, reqs).ok);
  if (hasHardReq && capable.length === 0) {
    const missing = [...new Set(pool.flatMap((c) => meetsHardReqs(c, reqs).missing))];
    return { decision: null, policy, blockedReason: `no eligible model meets required capability: ${missing.join(', ') || 'capability'}`, considered };
  }
  const used = capable.length ? capable : pool;

  if (used.length === 0) {
    return { decision: null, policy, blockedReason: notes[0] || 'no eligible model under this policy', considered };
  }

  const ranked = used.map((c) => ({ c, s: score(c, reqs, policy) })).sort((a, b) => b.s - a.s);
  const top = ranked[0].c;
  const requiresPaidConsent = top.costTier === 'paid' && policy !== 'FREE_ONLY';
  const matched = HARD_REQS.filter((k) => reqs[k] && top.capabilities[k] === true) as string[];
  if (reqs.coding && top.capabilities.coding) matched.push('coding');
  if (reqs.reasoning && top.capabilities.reasoning) matched.push('reasoning');
  const reason = `${top.costTier}${top.local ? '/local' : ''} ${matched.length ? '· ' + matched.join('+') : ''} · ${top.health}${notes.length ? ' · (' + notes.join('; ') + ')' : ''}`;

  return {
    decision: {
      providerId: top.providerId, modelId: top.modelId, source: sourceOf(top), costTier: top.costTier,
      reason, capabilitiesMatched: matched,
      fallbacks: ranked.slice(1, 4).map(({ c }) => ({ providerId: c.providerId, modelId: c.modelId, costTier: c.costTier })),
      requiresPaidConsent,
    },
    policy, blockedReason: null, considered,
  };
}
