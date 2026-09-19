import type { SearchResult, SearchOptions, WebSearchProvider } from './types';
import { searchWeb, searchHealth, searxngEndpoint, type JsonFetcher } from '@/core/search/searxng';

export type WebSearchStatus = 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export interface WebSearchHealth {
  status: WebSearchStatus;
  /** True only when SEARXNG_URL is configured (never assumes a default host). */
  configured: boolean;
  checkedAt: number;
  reason?: string;
}

export interface WebSearchCapabilities {
  keyless: boolean;
  selfHosted: boolean;
  aggregatesEngines: boolean;
  recencyFilter: boolean;
  /** Search content is treated as untrusted data end-to-end. */
  untrustedContent: boolean;
}

const HEALTH_TTL_MS = 20_000;

/**
 * SearXNGSearchProvider — the self-hosted SearXNG backend registered as a
 * provider in the EXISTING web capability mesh (no second orchestrator).
 * Contract: search() · health() · capabilities(). A real probe is required for
 * READY: health follows a real search returning real results, never a mere
 * container start. Results carry only upstream-provided metadata.
 */
export class SearXNGSearchProvider implements WebSearchProvider {
  readonly id = 'searxng';
  private cached: { at: number; value: WebSearchHealth } | null = null;
  private readonly fetcher?: JsonFetcher;

  constructor(fetcher?: JsonFetcher) {
    this.fetcher = fetcher;
  }

  /** Endpoint resolution lives in the client: env-only, trailing-slash trimmed. */
  endpoint(): string {
    return searxngEndpoint();
  }

  capabilities(): WebSearchCapabilities {
    return { keyless: true, selfHosted: true, aggregatesEngines: true, recencyFilter: true, untrustedContent: true };
  }

  /**
   * Real health (20s cached so UI+pipeline probes don't hammer the instance).
   * READY = reachable AND a real query returned real results. DEGRADED =
   * reachable but empty (rate limit/upstream). UNAVAILABLE = not configured or
   * unreachable. Never fabricated.
   */
  async health(opts: { force?: boolean } = {}): Promise<WebSearchHealth> {
    const checkedAt = Date.now();
    if (!opts.force && this.cached && checkedAt - this.cached.at < HEALTH_TTL_MS) return this.cached.value;
    const endpoint = this.endpoint();
    const configured = !!endpoint;
    let value: WebSearchHealth;
    if (!configured) {
      value = { status: 'UNAVAILABLE', configured: false, checkedAt, reason: 'SEARXNG_URL not configured' };
    } else {
      const h = await searchHealth({ endpoint, fetcher: this.fetcher });
      value = h.ok
        ? { status: 'READY', configured: true, checkedAt }
        : { status: h.reason?.includes('no results') ? 'DEGRADED' : 'UNAVAILABLE', configured: true, checkedAt, reason: h.reason };
    }
    this.cached = { at: checkedAt, value };
    return value;
  }

  /** The existing WebSearchProvider availability gate maps onto real health. */
  async isAvailable(): Promise<boolean> {
    return (await this.health()).status === 'READY';
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const endpoint = this.endpoint();
    if (!endpoint) return [];
    const r = await searchWeb(query, {
      endpoint,
      fetcher: this.fetcher,
      limit: options.maxResults ?? 8,
      ...(options.recencyDays ? { timeRange: (options.recencyDays <= 1 ? 'day' : options.recencyDays <= 7 ? 'week' : options.recencyDays <= 31 ? 'month' : 'year') as 'day' | 'week' | 'month' | 'year' } : {}),
    });
    if (!r.available) throw new Error(r.reason || 'searxng unavailable');
    return r.results;
  }
}

/** Singleton used by WebCapability (endpoint read from env at call time). */
export const searxngSearch = new SearXNGSearchProvider();
