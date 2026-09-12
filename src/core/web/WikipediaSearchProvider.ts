import type { SearchResult, SearchOptions, WebSearchProvider } from './types';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Key-free web search via the Wikipedia search API (JSON, reliable, no bot
 * challenge). Provides real, citable article URLs + snippets. Complements the
 * DuckDuckGo Instant Answer provider; the WebCapability merges/dedupes results.
 */
export class WikipediaSearchProvider implements WebSearchProvider {
  readonly id = 'wikipedia';

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch('https://en.wikipedia.org/w/api.php?action=opensearch&search=test&format=json&limit=1', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const max = options.maxResults ?? 8;
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${max}&srprop=snippet%7Ctimestamp`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    const j: any = await res.json();
    const hits = j?.query?.search || [];
    const now = Date.now();
    return hits.slice(0, max).map((h: any, i: number) => ({
      title: h.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
      snippet: (h.snippet || '').replace(/<[^>]+>/g, '').trim(),
      source: this.id,
      publishedAt: h.timestamp,
      relevance: Math.max(0.3, 1 - i * 0.1),
      retrievedAt: now,
    }));
  }
}

export const wikipediaSearch = new WikipediaSearchProvider();
