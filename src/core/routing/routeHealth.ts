/**
 * Route health — a richer, honest provider-state vocabulary layered on top of
 * the existing providerBootstrap cache. This is NOT a second router or a second
 * health cache: providerBootstrap stays authoritative for eligibility/cooldown,
 * and this module only gives the fabric a finer-grained *classification* of WHY a
 * route is unhealthy so failover, observability and the dashboard can distinguish
 * a transient rate-limit from a permanent quota exhaustion.
 *
 * Every state here maps back onto a providerBootstrap CachedHealth so nothing in
 * the existing router breaks. Local fallback is a routing OUTCOME, not a provider
 * health value — we still expose LOCAL_FALLBACK so callers can label "we degraded
 * to the local model" honestly in traces and the UI.
 */

export type RouteHealthState =
  | 'READY'
  | 'DEGRADED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'UNAVAILABLE'
  | 'AUTH_REQUIRED'
  | 'MODEL_UNAVAILABLE'
  | 'COOLDOWN'
  | 'LOCAL_FALLBACK';

/** Cooldown (ms) before a route is retried, per state. Permanent-ish faults wait longest. */
export const COOLDOWN_MS: Record<RouteHealthState, number> = {
  READY: 0,
  DEGRADED: 15_000,
  RATE_LIMITED: 30_000,
  // Quota/billing exhaustion does not heal by asking again within seconds; give it a
  // long window (matches the existing providerBootstrap AUTH_REQUIRED stance).
  QUOTA_EXHAUSTED: 300_000,
  UNAVAILABLE: 20_000,
  AUTH_REQUIRED: 300_000,
  MODEL_UNAVAILABLE: 60_000,
  COOLDOWN: 30_000,
  LOCAL_FALLBACK: 0,
};

/** Whether the route may be attempted again right now (a transient vs hard stop). */
export function isRetryable(state: RouteHealthState): boolean {
  return state !== 'AUTH_REQUIRED' && state !== 'QUOTA_EXHAUSTED';
}

/**
 * Never re-issue the SAME invalid request. These are caller bugs / bad model ids,
 * not something a retry with the same body will fix — failover must move to a
 * DIFFERENT route (or fail honestly), it must not blindly hammer.
 */
export function isPermanentForRequest(state: RouteHealthState): boolean {
  return state === 'MODEL_UNAVAILABLE' || state === 'AUTH_REQUIRED' || state === 'QUOTA_EXHAUSTED';
}

/**
 * Classify a generation failure (message + optional HTTP status) into a
 * RouteHealthState. Order matters: a "429 no credits" is QUOTA (permanent until
 * the account changes), not a transient RATE_LIMITED — so the billing/quota test
 * runs before the generic 429 test, mirroring classifyGenerationError upstream.
 */
export function classifyRouteError(msg: string, httpStatus?: number): RouteHealthState {
  const m = String(msg || '').toLowerCase();
  const s = typeof httpStatus === 'number' ? httpStatus : extractStatus(m);

  if (s === 401 || s === 403 || /\bunauthorized\b|invalid (api )?key|permission denied|api key|forbidden/.test(m)) {
    return 'AUTH_REQUIRED';
  }
  // Quota / billing exhaustion — check before generic 429.
  if (s === 402 || /credit|billing|quota( exceeded)?|insufficient (funds|quota|balance)|payment required|out of (funds|budget)|spend limit/.test(m)) {
    return 'QUOTA_EXHAUSTED';
  }
  // Model-specific unavailability (bad id / model gone) — not fixable by retry.
  if (s === 404 || /model.{0,15}(not (be )?found|unavailable|does not exist|not supported)|unknown model|no such model|invalid model/.test(m)) {
    return 'MODEL_UNAVAILABLE';
  }
  if (s === 429 || /rate.?limit|too many requests|overloaded|slow down/.test(m)) {
    return 'RATE_LIMITED';
  }
  if (s === 408 || s === 504 || /timeout|timed out|deadline exceeded/.test(m)) {
    return 'UNAVAILABLE';
  }
  if (s && s >= 500) return 'UNAVAILABLE';
  if (s === 400 || /context.{0,10}(length|window)|too (long|large)|maximum context|token limit exceeded|invalid request/.test(m)) {
    // Context overflow / invalid request — the route is fine, the REQUEST is not.
    return 'DEGRADED';
  }
  if (/unreachable|network|fetch failed|econn|enotfound|socket/.test(m)) return 'UNAVAILABLE';
  return 'DEGRADED';
}

function extractStatus(m: string): number | undefined {
  const http = m.match(/http\s*(\d{3})/);
  if (http) return Number(http[1]);
  const bare = m.match(/\b(4\d{2}|5\d{2})\b/);
  return bare ? Number(bare[1]) : undefined;
}

/** Map a fine-grained state back onto providerBootstrap's coarse CachedHealth. */
export function toCachedHealth(state: RouteHealthState): 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNKNOWN' {
  switch (state) {
    case 'READY':
    case 'LOCAL_FALLBACK':
      return 'AVAILABLE';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'QUOTA_EXHAUSTED':
    case 'AUTH_REQUIRED':
      return 'AUTH_REQUIRED';
    case 'UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'MODEL_UNAVAILABLE':
    case 'DEGRADED':
    case 'COOLDOWN':
      return 'DEGRADED';
    default:
      return 'UNKNOWN';
  }
}
