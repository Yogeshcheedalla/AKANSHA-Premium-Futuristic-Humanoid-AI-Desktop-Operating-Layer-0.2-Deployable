/**
 * Web capability contracts. These are the normalized shapes Akansha's Master
 * Orchestrator reasons over, independent of which provider produced them.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // provider id
  publishedAt?: string;
  relevance: number; // 0-1, provider/rank derived
  retrievedAt: number;
}

export interface WebDocument {
  url: string;
  title: string;
  text: string;
  headings: string[];
  links: { text: string; href: string }[];
  metadata: Record<string, string>;
  retrievedAt: number;
  ok: boolean;
  error?: string;
}

export interface SearchOptions {
  maxResults?: number;
  region?: string;
  language?: string;
  recencyDays?: number;
  safeSearch?: 'on' | 'off' | 'moderate';
  allowedDomains?: string[];
}

export interface WebSearchProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export interface WebReaderProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  read(url: string): Promise<WebDocument>;
}

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string; // present if the page was actually retrieved
  retrieved: boolean;
  retrievedAt: number;
}

export interface ResearchResult {
  query: string;
  answer: string;
  sources: ResearchSource[];
  synthesizedByModel: boolean;
  verified: boolean; // at least one source was actually retrieved
}
