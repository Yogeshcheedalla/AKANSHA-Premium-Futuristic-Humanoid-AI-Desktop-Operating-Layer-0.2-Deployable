/**
 * SearXNG adapter — Akansha's keyless web-search backend. A capability, NOT an
 * orchestrator: it talks to a self-hosted SearXNG endpoint (SEARXNG_URL) and
 * normalizes/dedupes/ranks results into Akansha's typed SearchResult. It NEVER
 * fabricates results: no endpoint, an unreachable instance, or a non-OK/invalid
 * response all return available:false with a reason. Search content is UNTRUSTED
 * data (rendered as text only, never executed).
 *
 * Endpoint comes ONLY from SEARXNG_URL (never hard-coded localhost in logic).
 */
import type { SearchResult } from '@/core/web/types';
import { canonicalizeUrl } from '@/core/web/canonical';

export type { SearchResult };

/** The provider id surfaced as SearchResult.source. */
export const SEARXNG_SOURCE = 'searxng';

/** Raw SearXNG JSON result (untrusted, partially-shaped) before normalization. */
export interface SearxngRaw {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  engine?: unknown;
  publishedDate?: unknown;
  score?: unknown;
  positions?: unknown;
}

export interface SearchResponse {
  available: boolean;
  query: string;
  results: SearchResult[];
  /** Present only when available:false — an honest, non-fabricated reason. */
  reason?: string;
  /** How many raw results SearXNG returned before dedupe (diagnostics). */
  rawCount?: number;
}

export type JsonFetcher = (url: string, opts?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetcher: JsonFetcher = async (url, opts) => {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'akansha-search', Accept: 'application/json' }, ...(opts?.signal ? { signal: opts.signal } : {}) });
  return { ok: r.ok, status: r.status, json: () => r.json() };
};

/** Read + trim the configured endpoint from env (no default host). */
export function searxngEndpoint(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return (env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
}

/**
 * Canonical URL used as the dedupe key (single shared implementation with the
 * web capability mesh lives in @/core/web/canonical). Re-exported here so the
 * search adapter and the mesh always agree on what "same page" means.
 */
export { canonicalizeUrl };

/**
 * Normalize one raw SearXNG result into Akansha's typed SearchResult. Fields the
 * upstream does not provide stay null/omitted — never invented. `relevance` is the
 * engine score when present, else derived from rank order by the caller.
 */
export function normalizeResult(raw: SearxngRaw, retrievedAt: number, upstreamIndex = 0): SearchResult | null {
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) return null; // a result without a URL is not citable → dropped.
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null;
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    url,
    snippet: typeof raw.content === 'string' ? raw.content.trim() : '',
    source: SEARXNG_SOURCE,
    engine: typeof raw.engine === 'string' && raw.engine ? raw.engine : undefined,
    publishedAt: typeof raw.publishedDate === 'string' && raw.publishedDate ? raw.publishedDate : undefined,
    score: score ?? undefined,
    // Upstream rank is real signal: relevance decays from the position SearXNG gave it.
    relevance: Math.max(0.1, 1 - upstreamIndex * 0.05),
    retrievedAt,
  };
}

/**
 * Rank: prefer higher engine score when present; tie-break by earliest position;
 * finally preserve upstream order. Mutates nothing on the input.
 */
export function rankResults(results: SearchResult[]): SearchResult[] {
  const position = new Map<SearchResult, number>();
  results.forEach((r, i) => position.set(r, i));
  return [...results].sort((a, b) => {
    const sa = a.score ?? -Infinity;
    const sb = b.score ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return (position.get(a) ?? 0) - (position.get(b) ?? 0);
  });
}

/** Deduplicate by canonical URL, keeping the highest-scoring / earliest entry. */
export function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const r of results) {
    const key = canonicalizeUrl(r.url);
    if (!key) continue;
    const existing = best.get(key);
    if (!existing || (r.score ?? -Infinity) > (existing.score ?? -Infinity)) best.set(key, r);
  }
  return [...best.values()];
}

/** Query SearXNG (JSON). Returns available:false on any failure — never fake results. */
export async function searchWeb(
  query: string,
  opts: { endpoint?: string; fetcher?: JsonFetcher; timeoutMs?: number; limit?: number; timeRange?: 'day' | 'week' | 'month' | 'year' } = {},
): Promise<SearchResponse> {
  const q = (query || '').trim();
  const endpoint = opts.endpoint ?? searxngEndpoint();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const limit = opts.limit ?? 10;
  if (!q) return { available: !!endpoint, query: q, results: [] };
  if (!endpoint) return { available: false, query: q, results: [], reason: 'SEARXNG_URL not configured' };

  const url = `${endpoint}/search?q=${encodeURIComponent(q)}&format=json${opts.timeRange ? `&time_range=${encodeURIComponent(opts.timeRange)}` : ''}`;
  let res: Awaited<ReturnType<JsonFetcher>>;
  try {
    res = await fetcher(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 12000) });
  } catch (e: any) {
    return { available: false, query: q, results: [], reason: 'search-unavailable:' + String(e?.message || e).slice(0, 60) };
  }
  if (!res.ok) return { available: false, query: q, results: [], reason: `search-http-${res.status}` };
  let j: any;
  try {
    j = await res.json();
  } catch {
    return { available: false, query: q, results: [], reason: 'invalid-json' };
  }
  const raw = Array.isArray(j?.results) ? j.results : [];
  const retrievedAt = Date.now();
  const normalized = raw
    .map((r: SearxngRaw, i: number) => normalizeResult(r, retrievedAt, i))
    .filter((r: SearchResult | null): r is SearchResult => !!r);
  const results = rankResults(dedupeByUrl(normalized)).slice(0, limit);
  return { available: true, query: q, results, rawCount: raw.length };
}

/**
 * Real health probe — a provider is healthy ONLY if the instance answers a real
 * search with real results. It never reports READY from a mere HTTP 200.
 */
export async function searchHealth(opts: { endpoint?: string; fetcher?: JsonFetcher; query?: string } = {}): Promise<{ ok: boolean; reason?: string }> {
  const endpoint = opts.endpoint ?? searxngEndpoint();
  if (!endpoint) return { ok: false, reason: 'SEARXNG_URL not configured' };
  const r = await searchWeb(opts.query || 'akansha health check', { endpoint, fetcher: opts.fetcher, timeoutMs: 8000, limit: 1 });
  if (!r.available) return { ok: false, reason: r.reason };
  if (r.results.length === 0) return { ok: false, reason: 'no results (rate limited or upstream issue)' };
  return { ok: true };
}
