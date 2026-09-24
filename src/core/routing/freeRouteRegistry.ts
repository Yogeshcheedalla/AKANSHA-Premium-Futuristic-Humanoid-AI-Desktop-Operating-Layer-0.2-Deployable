/**
 * Free Route Registry — live, measured health for every route the fabric has
 * actually exercised. Spec item #2.
 *
 * IMPORTANT: this is NOT a second router and NOT a second source of truth for
 * eligibility. providerBootstrap remains authoritative for the hard gate
 * (isEligible) and cooldowns. The registry only ACCUMULATES real measurements —
 * latency (EWMA), success rate, attempt counts, last-healthy timestamp, the
 * fine-grained RouteHealthState from the last failure — so routing can score
 * candidates by observed behavior and the dashboard can show REAL values.
 *
 * Every number here is derived from an actual attempt; nothing is invented. An
 * unseen route simply has no samples, and `view()` reports that honestly.
 */
import { COOLDOWN_MS, type RouteHealthState } from './routeHealth';

export interface RouteMetrics {
  providerId: string;
  modelId?: string;
  costTier: 'local' | 'free' | 'paid' | 'unknown';
  local: boolean;
  capabilities?: { reasoning?: boolean; vision?: boolean; tools?: boolean; streaming?: boolean };
  contextWindow?: number;
  attempts: number;
  successes: number;
  failures: number;
  /** Exponentially-weighted moving average latency (ms). 0 until first sample. */
  latencyEwmaMs: number;
  lastLatencyMs?: number;
  successRate: number; // 0..1, or 0 when no samples
  lastState: RouteHealthState;
  lastError?: string;
  lastHealthyAt?: number;
  lastAttemptAt?: number;
  cooldownUntil?: number;
}

const EWMA_ALPHA = 0.3;
const keyOf = (providerId: string, modelId?: string) => `${providerId}::${modelId || '*'}`;

class FreeRouteRegistry {
  private routes = new Map<string, RouteMetrics>();

  private getOrInit(providerId: string, modelId?: string): RouteMetrics {
    const k = keyOf(providerId, modelId);
    let m = this.routes.get(k);
    if (!m) {
      m = {
        providerId, modelId, costTier: 'unknown', local: false,
        attempts: 0, successes: 0, failures: 0, latencyEwmaMs: 0, successRate: 0,
        lastState: 'READY',
      };
      this.routes.set(k, m);
    }
    return m;
  }

  /** Declare a route's static attributes (cost/local/caps/context) for scoring. */
  annotate(providerId: string, modelId: string | undefined, info: Partial<RouteMetrics>): void {
    const m = this.getOrInit(providerId, modelId);
    if (info.costTier) m.costTier = info.costTier;
    if (typeof info.local === 'boolean') m.local = info.local;
    if (info.capabilities) m.capabilities = { ...m.capabilities, ...info.capabilities };
    if (info.contextWindow) m.contextWindow = info.contextWindow;
  }

  recordSuccess(providerId: string, modelId: string | undefined, latencyMs: number, meta: Partial<RouteMetrics> = {}): void {
    const m = this.getOrInit(providerId, modelId);
    this.annotate(providerId, modelId, meta);
    m.attempts += 1;
    m.successes += 1;
    m.lastLatencyMs = latencyMs;
    m.latencyEwmaMs = m.latencyEwmaMs === 0 ? latencyMs : Math.round(EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * m.latencyEwmaMs);
    m.successRate = m.successes / m.attempts;
    m.lastState = 'READY';
    m.lastHealthyAt = Date.now();
    m.lastAttemptAt = Date.now();
    m.cooldownUntil = undefined;
  }

  recordFailure(providerId: string, modelId: string | undefined, latencyMs: number, state: RouteHealthState, error?: string): void {
    const m = this.getOrInit(providerId, modelId);
    m.attempts += 1;
    m.failures += 1;
    m.lastLatencyMs = latencyMs;
    m.successRate = m.attempts ? m.successes / m.attempts : 0;
    m.lastState = state;
    m.lastError = error ? String(error).slice(0, 200) : undefined;
    m.lastAttemptAt = Date.now();
    // Cooldown is advisory here; providerBootstrap still does the hard gate.
    const cd = COOLDOWN_MS[state];
    m.cooldownUntil = cd > 0 ? Date.now() + cd : undefined;
  }

  get(providerId: string, modelId?: string): RouteMetrics | undefined {
    return this.routes.get(keyOf(providerId, modelId));
  }

  /** Is this route currently past its advisory cooldown? */
  available(providerId: string, modelId?: string, now = Date.now()): boolean {
    const m = this.routes.get(keyOf(providerId, modelId));
    if (!m) return true; // unseen = not blocked by evidence
    return !m.cooldownUntil || m.cooldownUntil <= now;
  }

  /**
   * A measured 0..1 health score used as a routing multiplier. Starts neutral
   * (0.5) with no evidence; rises with success rate + low latency + freshness;
   * falls with failures and an active cooldown. Never optimistic without data.
   */
  score(providerId: string, modelId?: string, now = Date.now()): number {
    const m = this.routes.get(keyOf(providerId, modelId));
    if (!m || m.attempts === 0) return 0.5; // no evidence → neutral, do not boost
    let s = 0.4 + m.successRate * 0.4; // 0.4..0.8 from reliability
    if (m.latencyEwmaMs > 0) {
      if (m.latencyEwmaMs < 1500) s += 0.15;
      else if (m.latencyEwmaMs < 5000) s += 0.05;
      else s -= 0.1;
    }
    if (m.cooldownUntil && m.cooldownUntil > now) s -= 0.3; // in cooldown
    if (m.lastState === 'QUOTA_EXHAUSTED' || m.lastState === 'AUTH_REQUIRED') s -= 0.2;
    return Math.max(0, Math.min(1, s));
  }

  view(): RouteMetrics[] {
    return Array.from(this.routes.values());
  }

  /** Dashboard-ready rows: only routes with real evidence, sorted cheapest+healthiest. */
  dashboard(): Array<{ providerId: string; modelId?: string; costTier: string; state: RouteHealthState; attempts: number; successRate: number; latencyEwmaMs: number; cooldown: boolean }> {
    return this.view()
      .filter((m) => m.attempts > 0)
      .map((m) => ({
        providerId: m.providerId, modelId: m.modelId, costTier: m.costTier,
        state: this.available(m.providerId, m.modelId) ? m.lastState : ('COOLDOWN' as RouteHealthState),
        attempts: m.attempts, successRate: Number(m.successRate.toFixed(2)),
        latencyEwmaMs: m.latencyEwmaMs, cooldown: !!m.cooldownUntil && m.cooldownUntil > Date.now(),
      }))
      .sort((a, b) => (b.successRate - a.successRate) || (a.latencyEwmaMs - b.latencyEwmaMs));
  }

  reset(): void { this.routes.clear(); }
}

export const freeRouteRegistry = new FreeRouteRegistry();
