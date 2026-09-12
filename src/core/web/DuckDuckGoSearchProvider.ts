import type { SearchResult, SearchOptions, WebSearchProvider } from './types';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function strip(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Key-free web search via the DuckDuckGo Instant Answer API (JSON, not the
 * bot-gated HTML endpoint). Returns real, citable sources (abstract + related
 * topic URLs). A Brave/Tavily/SerpAPI provider can be registered for news-grade
 * recency when a key is configured; the WebCapability tries providers in order.
 */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = 'duckduckgo';

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch('https://api.duckduckgo.com/?q=test&format=json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const max = options.maxResults ?? 8;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    const j: any = await res.json();
    const now = Date.now();
    const out: SearchResult[] = [];

    if (j.AbstractText && j.AbstractURL) {
      out.push({ title: j.Heading || query, url: j.AbstractURL, snippet: j.AbstractText, source: this.id, relevance: 1, retrievedAt: now });
    }
    const collect = (topics: any[]) => {
      for (const t of topics || []) {
        if (out.length >= max) return;
        if (t.FirstURL && t.Text) out.push({ title: strip(t.Text).slice(0, 120), url: t.FirstURL, snippet: strip(t.Text), source: this.id, relevance: Math.max(0.3, 1 - out.length * 0.1), retrievedAt: now });
        if (t.Topics) collect(t.Topics);
      }
    };
    collect(j.RelatedTopics);
    if (j.Answer) out.push({ title: query, url: j.Entity || 'https://duckduckgo.com', snippet: strip(j.Answer), source: this.id, relevance: 0.9, retrievedAt: now });

    return out.slice(0, max);
  }
}

export const duckDuckGoSearch = new DuckDuckGoSearchProvider();
