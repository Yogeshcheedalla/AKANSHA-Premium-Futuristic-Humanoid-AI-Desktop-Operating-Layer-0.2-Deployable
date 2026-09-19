/**
 * URL canonicalization — the ONE canonical form used for search-result dedupe
 * across engines/providers. Lowercase scheme+host, strip `www.`, drop fragment,
 * drop volatile tracking params, drop trailing slash. Unparseable URLs keep a
 * best-effort lowercase form — we never drop a result over a parse error.
 */
const TRACKING = /^(utm_|gclid|fbclid|mc_|ref$|src$)/i;

export function canonicalizeUrl(url: string): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const proto = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
    const qs = keep.length ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${proto}//${host}${path}${qs}`;
  } catch {
    return raw.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}
