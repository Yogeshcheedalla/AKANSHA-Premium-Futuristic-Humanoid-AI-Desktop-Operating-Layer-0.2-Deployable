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

/**
 * WebCapability — the single web entry point the Master Orchestrator uses.
 * It is a thin, provider-agnostic facade over a search provider and a reader
 * provider. It performs REAL retrieval; a research result is only "verified"
 * when at least one source page was actually fetched and content extracted.
 *
 * Least-privilege routing: research uses search + read (no browser automation).
 * Browser/computer-use escalation is a separate, higher tier.
 */
export class WebCapability {
  private searchProviders: WebSearchProvider[] = [duckDuckGoSearch, wikipediaSearch];
  private reader: WebReaderProvider = httpWebReader;

  registerSearchProvider(p: WebSearchProvider) {
    this.searchProviders = [p, ...this.searchProviders];
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const merged: SearchResult[] = [];
    for (const p of this.searchProviders) {
      try {
        if (await p.isAvailable()) merged.push(...(await p.search(query, options)));
      } catch {
        /* a provider failing is non-fatal; try the next */
      }
    }
    // De-duplicate by normalized URL, keeping the highest relevance.
    const byUrl = new Map<string, SearchResult>();
    for (const r of merged) {
      const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
      const existing = byUrl.get(key);
      if (!existing || r.relevance > existing.relevance) byUrl.set(key, r);
    }
    const max = options.maxResults ?? 8;
    return Array.from(byUrl.values()).sort((a, b) => b.relevance - a.relevance).slice(0, max);
  }

  async read(url: string): Promise<WebDocument> {
    return this.reader.read(url);
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
        url: r.url,
        title: doc.ok && doc.title ? doc.title : r.title,
        snippet: r.snippet,
        content: doc.ok ? doc.text.slice(0, 4000) : undefined,
        retrieved: doc.ok,
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
