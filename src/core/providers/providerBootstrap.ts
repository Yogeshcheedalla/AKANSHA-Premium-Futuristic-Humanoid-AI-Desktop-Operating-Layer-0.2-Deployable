/**
 * Provider bootstrap — the authoritative "Akansha starts → a usable route exists"
 * pipeline. It EXTENDS the existing ProviderManager/ModelRouter; it is not a
 * second router and holds no UI logic.
 *
 * Responsibilities:
 *  1. Run once at first use: load persisted providers + vault, discover models,
 *     health-check configured providers, probe the local model registry.
 *  2. Maintain a short-lived provider HEALTH CACHE with honest TTLs so we never
 *     hammer providers (and never re-hammer AUTH_REQUIRED ones).
 *  3. Publish AI_RUNTIME_STATUS derived ONLY from live evidence — the UI reads
 *     this instead of inventing "ONLINE".
 *  4. Self-heal: when a real generation fails with auth/billing/rate/network,
 *     the route is demoted in the cache so the next request skips it honestly.
 *  5. Trust LIVE evidence over catalog metadata for keyless free providers —
 *     a documented "no key" endpoint is only AVAILABLE if a real probe says so.
 */
import { providerManager } from './ProviderManager';
import { modelRouter } from '../models/ModelRouter';
import { getUsableLocalModelIds } from '../models/local/LocalModelRegistry';
import { detectLlamaRuntime, defaultLlamaCandidates } from '../models/local/LocalGgufProvider';
import { modelCostTier, type CostTier } from '../routing/costPolicy';

export type AiRuntimeStatus =
  | 'LOCAL_READY'
  | 'FREE_ONLINE_READY'
  | 'ONLINE_READY'
  | 'PAID_ONLY'
  | 'AUTH_REQUIRED'
  | 'NO_PROVIDER'
  | 'DEGRADED';

export type CachedHealth = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNKNOWN';

export interface RouteState {
  providerId: string;
  name: string;
  enabled: boolean;
  credentialConfigured: boolean;
  health: CachedHealth;
  modelCount: number;
  costTier: CostTier | 'unknown';
  bestModel?: string;
  lastChecked: number;
}

export interface RuntimeSnapshot {
  status: AiRuntimeStatus;
  activeRoute: { providerId: string; modelId: string; costTier: CostTier | 'local' } | null;
  routes: RouteState[];
  local: { runtimeReady: boolean; readyModels: number };
  checkedAt: number;
}

// Healthy results are reused briefly; failures retry sooner; auth failures are
// NOT hammered (long cooldown — nothing retries an absent key by asking again).
const TTL: Record<CachedHealth, number> = {
  AVAILABLE: 60_000,
  DEGRADED: 30_000,
  UNAVAILABLE: 20_000,
  RATE_LIMITED: 30_000,
  AUTH_REQUIRED: 300_000,
  UNKNOWN: 0,
};

/** Classify a generation error into a health state (used by router + bootstrap). */
export function classifyGenerationError(msg: string): CachedHealth {
  const m = String(msg || '').toLowerCase();
  if (/401|403|unauthorized|invalid (api )?key|permission denied/.test(m)) return 'AUTH_REQUIRED';
  // Billing exhaustion is PERMANENT until the account changes — check it before
  // the generic 429 so a "429 no credits" gets the long cooldown, not 30s retries.
  if (/credit|billing|quota exceeded|insufficient funds|payment required/.test(m)) return 'AUTH_REQUIRED';
  if (/429|rate.?limit|too many requests/.test(m)) return 'RATE_LIMITED';
  if (/timeout|unreachable|network|fetch failed|econn/.test(m)) return 'UNAVAILABLE';
  return 'DEGRADED';
}

/**
 * Pure status computation from live evidence only. Unit-testable; the UI must
 * derive nothing itself.
 */
export function computeRuntimeStatus(input: {
  localReady: boolean;
  routes: Array<Pick<RouteState, 'enabled' | 'credentialConfigured' | 'health' | 'modelCount' | 'costTier'>>;
}): { status: AiRuntimeStatus; usable: boolean } {
  const enabled = input.routes.filter((r) => r.enabled);
  const healthy = enabled.filter((r) => r.health === 'AVAILABLE' && r.modelCount > 0);
  const usable = input.localReady || healthy.length > 0;
  if (input.localReady) return { status: 'LOCAL_READY', usable };
  if (healthy.some((r) => r.costTier === 'free')) return { status: 'FREE_ONLINE_READY', usable: true };
  if (healthy.some((r) => r.costTier === 'paid')) return { status: 'PAID_ONLY', usable: true };
  if (healthy.length) return { status: 'ONLINE_READY', usable: true };
  const authBlocked = enabled.some((r) => r.credentialConfigured && (r.health === 'AUTH_REQUIRED' || r.health === 'RATE_LIMITED' || r.health === 'UNAVAILABLE'));
  const needsAuth = enabled.some((r) => !r.credentialConfigured && r.health === 'AUTH_REQUIRED');
  if (authBlocked || needsAuth) return { status: 'AUTH_REQUIRED', usable: false };
  if (enabled.some((r) => r.credentialConfigured && r.health === 'DEGRADED')) return { status: 'DEGRADED', usable: false };
  return { status: 'NO_PROVIDER', usable: false };
}

class ProviderBootstrap {
  private cache = new Map<string, { health: CachedHealth; ts: number; detail?: string }>();
  private booting: Promise<RuntimeSnapshot> | null = null;
  private snapshot: RuntimeSnapshot | null = null;

  /** Cached health only if still fresh; undefined = no evidence yet. */
  cachedHealth(providerId: string): CachedHealth | undefined {
    const e = this.cache.get(providerId);
    if (!e) return undefined;
    if (Date.now() - e.ts > TTL[e.health]) return undefined;
    return e.health;
  }

  /** Self-heal hook used by ModelRouter on real failures — never optimistic. */
  markRouteFailed(providerId: string, errorMsg: string): void {
    this.cache.set(providerId, { health: classifyGenerationError(errorMsg), ts: Date.now() });
  }

  private async probe(p: { id: string; healthCheck(): Promise<{ state: string }> }): Promise<CachedHealth> {
    try {
      const h = await p.healthCheck();
      const state = String(h.state).toUpperCase();
      const mapped: CachedHealth =
        state === 'AVAILABLE' ? 'AVAILABLE' :
        state === 'DEGRADED' ? 'DEGRADED' :
        state === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' :
        state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN';
      this.cache.set(p.id, { health: mapped, ts: Date.now() });
      return mapped;
    } catch {
      this.cache.set(p.id, { health: 'UNAVAILABLE', ts: Date.now() });
      return 'UNAVAILABLE';
    }
  }

  /** Keyless catalog providers get a REAL inference probe — live evidence wins. */
  private async probeKeyless(providerId: string): Promise<void> {
    const p = providerManager.get(providerId);
    if (!p) return;
    try {
      const res = await p.generate({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 } as never);
      this.cache.set(providerId, { health: res && (res.content !== undefined || res) ? 'AVAILABLE' : 'DEGRADED', ts: Date.now() });
    } catch (e: any) {
      this.cache.set(providerId, { health: classifyGenerationError(e?.message || ''), ts: Date.now() });
    }
  }

  async run(force = false): Promise<RuntimeSnapshot> {
    if (!force && this.snapshot) return this.snapshot;
    if (!force && this.booting) return this.booting;
    this.booting = (async () => {
      await providerManager.load();
      await modelRouter.initialize();

      const rows = await providerManager.listRecords();
      const routes: RouteState[] = [];
      for (const row of rows) {
        const p = providerManager.get(row.providerId);
        let health = force ? undefined : this.cachedHealth(row.providerId);
        if (!health) health = p ? await this.probe(p) : (row.enabled ? 'UNKNOWN' : 'UNKNOWN');
        const models = p ? modelRouter.getRegistry().listByProvider(row.providerId) : [];
        const chatModels = models.filter((m) => m.capabilities?.chat);
        // Cost tier of the provider's BEST free chat model if any, else its default.
        const freeModel = chatModels.find((m) => modelCostTier(row.providerId, m.id) === 'free');
        const bestModel = freeModel?.id || (row.defaultModel && chatModels.some((m) => m.id === row.defaultModel) ? row.defaultModel : chatModels[0]?.id);
        routes.push({
          providerId: row.providerId,
          name: row.name,
          enabled: row.enabled,
          credentialConfigured: row.credentialConfigured,
          health,
          modelCount: chatModels.length,
          costTier: bestModel ? modelCostTier(row.providerId, bestModel) : 'unknown',
          bestModel,
          lastChecked: this.cache.get(row.providerId)?.ts ?? 0,
        });
      }

      // Keyless providers get a REAL inference probe each startup (cheap, 1 token).
      // pollinations is the verified no-key default → proving it here pins the free
      // activeRoute so a fresh install answers out-of-the-box (never "connect model").
      for (const id of ['pollinations', 'kilo', 'llm7', 'ovhcloud']) {
        const r = routes.find((x) => x.providerId === id);
        if (r && r.enabled && !r.credentialConfigured) await this.probeKeyless(id);
      }
      // Refresh their route rows from the post-probe cache.
      for (const r of routes) {
        if (!r.credentialConfigured) {
          const h = this.cachedHealth(r.providerId);
          if (h) r.health = h;
        }
      }

      const readyModels = getUsableLocalModelIds();
      const runtimeReady = !!detectLlamaRuntime(defaultLlamaCandidates());
      const { status } = computeRuntimeStatus({ localReady: readyModels.length > 0, routes });

      let activeRoute: RuntimeSnapshot['activeRoute'] = null;
      if (status === 'FREE_ONLINE_READY' || status === 'ONLINE_READY' || status === 'PAID_ONLY') {
        const best = routes
          .filter((r) => r.enabled && r.health === 'AVAILABLE' && r.modelCount > 0)
          .sort((a, b) => (a.costTier === 'free' ? -1 : 1) - (b.costTier === 'free' ? -1 : 1) || b.lastChecked - a.lastChecked)[0];
        if (best?.bestModel) activeRoute = { providerId: best.providerId, modelId: best.bestModel, costTier: best.costTier === 'unknown' ? 'paid' : best.costTier };
      }

      this.snapshot = { status, activeRoute, routes, local: { runtimeReady, readyModels: readyModels.length }, checkedAt: Date.now() };
      this.booting = null;
      return this.snapshot;
    })().catch((e) => {
      this.booting = null;
      this.snapshot = { status: 'NO_PROVIDER', activeRoute: null, routes: [], local: { runtimeReady: false, readyModels: 0 }, checkedAt: Date.now() };
      return this.snapshot;
    });
    return this.booting;
  }

  get(): RuntimeSnapshot | null { return this.snapshot; }

  /**
   * Refresh the published snapshot from the CURRENT cache with zero network
   * calls — so header polling reflects self-healing (a route demoted by a real
   * failure) immediately, without re-probing providers.
   */
  currentView(): RuntimeSnapshot | null {
    const s = this.snapshot;
    if (!s) return null;
    for (const r of s.routes) {
      const h = this.cache.get(r.providerId);
      if (h) r.health = h.health;
    }
    const { status } = computeRuntimeStatus({ localReady: s.local.readyModels > 0, routes: s.routes });
    s.status = status;
    if (status === 'LOCAL_READY') s.activeRoute = null;
    else if (status === 'FREE_ONLINE_READY' || status === 'ONLINE_READY' || status === 'PAID_ONLY') {
      const best = s.routes.filter((r) => r.enabled && r.health === 'AVAILABLE' && r.modelCount > 0)
        .sort((a, b) => (a.costTier === 'free' ? -1 : 1) - (b.costTier === 'free' ? -1 : 1))[0];
      s.activeRoute = best?.bestModel ? { providerId: best.providerId, modelId: best.bestModel, costTier: best.costTier === 'unknown' ? 'paid' : best.costTier } : null;
    } else s.activeRoute = null;
    return s;
  }

  /** Called by ModelRouter.rank(): hard eligibility gate from live evidence. */
  isEligible(providerId: string): boolean {
    const h = this.cachedHealth(providerId);
    return h !== 'AUTH_REQUIRED' && h !== 'UNAVAILABLE' && h !== 'RATE_LIMITED';
  }
}

export const providerBootstrap = new ProviderBootstrap();
