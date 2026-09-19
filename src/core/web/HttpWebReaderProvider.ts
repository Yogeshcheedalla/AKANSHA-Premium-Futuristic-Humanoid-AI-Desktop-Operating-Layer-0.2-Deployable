import type { WebDocument, WebReaderProvider } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MAX_BYTES = 1_500_000; // cap fetched body

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Typed HTML→document extraction — the SINGLE extraction layer for both the
 * HTTP and the browser tier. Pulls title, canonical URL, author, publication
 * date, metadata, headings, links and visible body text WHEN THE PAGE ACTUALLY
 * DECLARES THEM; unavailable fields stay undefined (never invented). Script,
 * style, nav and footer content are dropped so boilerplate and page code never
 * become "content" (web pages remain untrusted DATA, never instructions).
 */
export function extractDocument(html: string, url?: string): Omit<WebDocument, 'ok' | 'retrievedAt'> {
  const raw = html || '';
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  const headings: string[] = [];
  let hm: RegExpExecArray | null;
  const hRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  while ((hm = hRe.exec(raw)) && headings.length < 20) {
    const h = stripTags(hm[1]);
    if (h) headings.push(h);
  }

  const links: { text: string; href: string }[] = [];
  let lm: RegExpExecArray | null;
  const aRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((lm = aRe.exec(raw)) && links.length < 40) {
    const href = lm[1];
    const text = stripTags(lm[2]);
    if (text && /^https?:/i.test(href)) links.push({ text, href });
  }

  const metadata: Record<string, string> = {};
  let mm: RegExpExecArray | null;
  const metaRe = /<meta[^>]+(?:name|property)="([^"]+)"[^>]+content="([^"]*)"/gi;
  while ((mm = metaRe.exec(raw)) && Object.keys(metadata).length < 15) {
    metadata[mm[1].toLowerCase()] = decodeEntities(mm[2]);
  }

  // Declared fields — present only when the page really declares them.
  const canonicalMatch = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i.exec(raw) || /<link[^>]+href="([^"]+)"[^>]+rel="canonical"/i.exec(raw);
  let canonicalUrl = canonicalMatch ? decodeEntities(canonicalMatch[1]) : undefined;
  if (canonicalUrl && url) {
    try { canonicalUrl = new URL(canonicalUrl, url).toString(); } catch { /* keep as declared */ }
  }
  const author =
    metadata['author'] || metadata['article:author'] ||
    /<meta[^>]+name="author"[^>]+content="([^"]*)"/i.exec(raw)?.[1] || undefined;
  const publishedAt =
    metadata['article:published_time'] || metadata['date'] || metadata['publication_date'] ||
    /"datePublished"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ||
    /<time[^>]+datetime="([^"]+)"/i.exec(raw)?.[1] || undefined;

  // Visible body text: take the body and drop boilerplate regions (nav, header,
  // footer, aside) so menus/copyright blocks never masquerade as article content.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
  const boilerplateFree = (bodyMatch ? bodyMatch[1] : raw)
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  const text = stripTags(boilerplateFree).slice(0, 40000);

  return {
    url: url || canonicalUrl || '',
    title,
    text,
    headings,
    links,
    metadata,
    ...(author ? { author: decodeEntities(author) } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
  };
}

/**
 * HTTP web reader: fetches a URL and extracts title, visible text, headings and
 * links with a dependency-free parser. Real retrieval — a page is only reported
 * as read if the HTTP request actually succeeded and content was extracted.
 */
export class HttpWebReaderProvider implements WebReaderProvider {
  readonly id = 'http-reader';

  async isAvailable(): Promise<boolean> {
    return true; // uses global fetch
  }

  async read(url: string): Promise<WebDocument> {
    const retrievedAt = Date.now();
    const base: WebDocument = { url, title: '', text: '', headings: [], links: [], metadata: {}, retrievedAt, ok: false };
    try {
      if (!/^https?:\/\//i.test(url)) {
        return { ...base, error: 'only http(s) URLs are supported' };
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
      const ct = res.headers.get('content-type') || '';
      const buf = await res.arrayBuffer();
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, MAX_BYTES));

      if (ct.includes('application/json')) {
        return { ...base, ok: true, text: raw.slice(0, 20000), title: url, via: 'http' };
      }
      if (ct && !ct.includes('html') && !ct.includes('text')) {
        return { ...base, error: `unsupported content-type ${ct}` };
      }

      const doc = extractDocument(raw, url);
      return { ...doc, url, via: 'http', retrievedAt, ok: true };
    } catch (e: any) {
      return { ...base, error: e?.message || 'read failed' };
    }
  }
}

export const httpWebReader = new HttpWebReaderProvider();
