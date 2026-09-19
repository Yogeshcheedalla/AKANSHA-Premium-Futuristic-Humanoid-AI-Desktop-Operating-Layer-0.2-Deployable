import type {
  SearchResult,
  SearchOptions,
  WebDocument,
  WebSearchProvider,
  WebReaderProvider,
  ResearchResult,
  ResearchSource,
} from './types';
import { duckDuckGoSearch } from './DuckDuckGoSearchProvider';
import { wikipediaSearch } from './WikipediaSearchProvider';
import { httpWebReader } from './HttpWebReaderProvider';
import { searxngSearch } from './SearXNGSearchProvider';
import { playwrightWebReader } from './PlaywrightWebReaderProvider';
import { canonicalizeUrl } from './canonical';

/**
 * WebCapability — the single web entry point the Master Orchestrator uses.
 * It is a thin, provider-agnostic facade over a search provider and a reader
 * provider. It performs REAL retrieval; a research result is only "verified"
 * when at least one source page was actually fetched and content extracted.
 *
 * Search providers run in preference order; each is checked by a REAL probe.
 * SearXNG (self-hosted, keyless) leads when SEARXNG_URL is configured and a
 * real search succeeds — when it is unavailable the mesh honestly degrades to
 * the key-free fallbacks and never fabricates results.
 *
 * Least-privilege routing: research uses search + read (no browser automation).
 * Playwright is only an HTTP-failure fallback and only when actually installed.
 * Browser/computer-use escalation is a separate, higher tier.
 */
export class WebCapability {
  private searchProviders: WebSearchProvider[] = [searxngSearch, duckDuckGoSearch, wikipediaSearch];
  private reader: WebReaderProvider = httpWebReader;

  registerSearchProvider(p: WebSearchProvider) {
    this.searchProviders = [p, ...this.searchProviders];
  }

  /**
   * Provider-preference search: ask providers in order; the first one that
   * returns real results wins (SearXNG already aggregates engines, and we must
   * not hammer every upstream on every query). Normalizes, dedupes by canonical
   * URL (highest relevance wins) and ranks before returning.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const merged: SearchResult[] = [];
    for (const p of this.searchProviders) {
      try {
        if (await p.isAvailable()) {
          const found = await p.search(query, options);
          if (found.length) {
            merged.push(...found);
            break; // a healthy provider answered — fallbacks are only for failure.
          }
        }
      } catch {
        /* a provider failing is non-fatal; try the next */
      }
    }
    // De-duplicate by CANONICAL URL (same shared key as the search adapter),
    // keeping the highest relevance — engine duplicates collapse to one row.
    const byUrl = new Map<string, SearchResult>();
    for (const r of merged) {
      const key = canonicalizeUrl(r.url);
      const existing = byUrl.get(key);
      if (!existing || r.relevance > existing.relevance) byUrl.set(key, r);
    }
    const max = options.maxResults ?? 8;
    return Array.from(byUrl.values()).sort((a, b) => b.relevance - a.relevance).slice(0, max);
  }

  /**
   * Read a page: HTTP first (cheap, polite). The Playwright tier is used ONLY
   * when HTTP failed AND the package is genuinely installed — it is never
   * launched per-result and never claimed when absent.
   */
  async read(url: string): Promise<WebDocument> {
    const doc = await this.reader.read(url);
    if (doc.ok) return doc;
    if (await playwrightWebReader.isAvailable()) {
      const rendered = await playwrightWebReader.read(url);
      if (rendered.ok) return rendered;
      return { ...doc, error: `${doc.error || 'http failed'}; browser: ${rendered.error || 'no content'}` };
    }
    return doc;
  }

  /**
   * Research a query: search, then actually retrieve the top sources and
   * extract their content. Returns an extractive answer built ONLY from real
   * retrieved content (the model may later synthesize it, but the evidence —
   * the sources — is real regardless).
   */
  async research(query: string, opts: { maxSources?: number } = {}): Promise<ResearchResult> {
    const maxSources = opts.maxSources ?? 3;
    const results = await this.search(query, { maxResults: maxSources + 2 });
    const sources: ResearchSource[] = [];

    for (const r of results) {
      if (sources.filter((s) => s.retrieved).length >= maxSources) break;
      const doc = await this.read(r.url);
      sources.push({
        sourceId: `src-${sources.length + 1}`,
        url: r.url,
        title: doc.ok && doc.title ? doc.title : r.title,
        snippet: r.snippet,
        content: doc.ok && doc.text ? doc.text.slice(0, 4000) : undefined,
        retrieved: doc.ok,
        contentStatus: !doc.ok ? 'retrieval_failed' : doc.text ? 'extracted' : 'empty',
        via: doc.ok ? doc.via : undefined,
        retrievedAt: doc.retrievedAt,
      });
    }

    const retrieved = sources.filter((s) => s.retrieved);
    const verified = retrieved.length > 0;

    // Extractive fallback answer from real snippets/titles (no fabrication).
    const lines: string[] = [];
    lines.push(`Here is what I found on "${query}" from ${retrieved.length} source(s) I actually retrieved:`);
    for (const s of retrieved) {
      const blurb = (s.snippet || (s.content ? s.content.slice(0, 180) + '…' : '')).trim();
      lines.push(`• ${s.title} — ${blurb} (${s.url})`);
    }
    if (!verified) {
      lines.push('I could not actually retrieve any source page, so I am not claiming a researched answer.');
    }

    return {
      query,
      answer: lines.join('\n'),
      sources,
      synthesizedByModel: false,
      verified,
    };
  }
}

export const webCapability = new WebCapability();
export * from './types';
