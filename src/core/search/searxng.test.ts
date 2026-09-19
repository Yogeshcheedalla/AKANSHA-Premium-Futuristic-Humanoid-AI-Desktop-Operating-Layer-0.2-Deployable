import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchWeb, searchHealth, searxngEndpoint, normalizeResult, canonicalizeUrl,
  dedupeByUrl, rankResults, type JsonFetcher, type SearchResult,
} from './searxng';

const jsonFetcher = (payload: unknown, ok = true, status = 200): JsonFetcher => async () => ({ ok, status, json: async () => payload });
const throwingFetcher: JsonFetcher = async () => { throw new Error('ECONNREFUSED (timeout)'); };
const EP = 'http://sx:8080';

test('no endpoint → UNAVAILABLE, never fabricates', async () => {
  const r = await searchWeb('q', { endpoint: '' });
  assert.equal(r.available, false);
  assert.equal(r.results.length, 0);
  assert.match(r.reason || '', /not configured/);
});

test('typed normalization: every §3 field present, absent metadata stays undefined', async () => {
  const f = jsonFetcher({ results: [
    { title: 'A', url: 'https://x.com/a', content: 'snip', engine: 'google', score: 0.9, publishedDate: '2026-09-01' },
    { title: 'Bare', url: 'https://y.com/b' },
  ]});
  const r = await searchWeb('a', { endpoint: EP, fetcher: f });
  assert.equal(r.available, true);
  assert.equal(r.results.length, 2);
  const [a, b] = r.results;
  assert.equal(a.title, 'A');
  assert.equal(a.url, 'https://x.com/a');
  assert.equal(a.snippet, 'snip');
  assert.equal(a.source, 'searxng');
  assert.equal(a.engine, 'google');
  assert.equal(a.publishedAt, '2026-09-01');
  assert.equal(a.score, 0.9);
  assert.ok(typeof a.retrievedAt === 'number' && a.retrievedAt > 0);
  // Nothing upstream → nothing invented:
  assert.equal(b.engine, undefined);
  assert.equal(b.publishedAt, undefined);
  assert.equal(b.score, undefined);
  assert.equal(b.snippet, '');
});

test('results without a URL are dropped, not guessed', () => {
  const now = Date.now();
  assert.equal(normalizeResult({ title: 'orphan', url: 42 }, now), null);
  assert.equal(normalizeResult({ title: 'empty', url: '   ' }, now), null);
});

test('malformed result rows (nulls, wrong types) normalize safely', async () => {
  const f = jsonFetcher({ results: [
    { title: null, url: 'https://ok.com', content: { nested: 1 }, engine: 7, score: 'x' },
    'not-an-object',
  ]});
  const r = await searchWeb('a', { endpoint: EP, fetcher: f });
  assert.equal(r.available, true);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].title, '');
  assert.equal(r.results[0].snippet, '');
  assert.equal(r.results[0].engine, undefined);
  assert.equal(r.results[0].score, undefined);
});

test('dedupe across engines by canonical URL (tracking params + trailing slash + www)', async () => {
  const f = jsonFetcher({ results: [
    { title: 'A', url: 'https://x.com/page/', engine: 'google' },
    { title: 'A dup', url: 'https://www.x.com/page?utm_source=news', engine: 'bing' },
    { title: 'A dup2', url: 'https://x.com/page#section', engine: 'duckduckgo' },
    { title: 'B', url: 'https://x.com/other' },
  ]});
  const r = await searchWeb('a', { endpoint: EP, fetcher: f });
  assert.equal(r.rawCount, 4);
  assert.equal(r.results.length, 2, 'same canonical URL collapses across engines');
});

test('canonicalizeUrl: scheme/host lowercase, tracking stripped, parse failure keeps raw', () => {
  assert.equal(canonicalizeUrl('HTTPS://WWW.Example.COM/Path/?utm_medium=x&keep=1#/frag'), 'https://example.com/Path?keep=1');
  assert.equal(canonicalizeUrl('https://example.com/a/'), 'https://example.com/a');
  assert.equal(canonicalizeUrl('not a url'), 'not a url');
  assert.equal(canonicalizeUrl(''), '');
});

test('rank: engine score first, upstream order tie-break', () => {
  const now = Date.now();
  const mk = (url: string, score?: number): SearchResult => ({ title: url, url, snippet: '', source: 'searxng', relevance: 0.5, retrievedAt: now, ...(score !== undefined ? { score } : {}) });
  const ranked = rankResults([mk('a'), mk('b', 0.2), mk('c', 0.8)]);
  assert.deepEqual(ranked.map((r) => r.url), ['c', 'b', 'a']);
});

test('dedupeByUrl keeps the highest score', () => {
  const now = Date.now();
  const mk = (url: string, score?: number): SearchResult => ({ title: url, url, snippet: '', source: 'searxng', relevance: 0.5, retrievedAt: now, ...(score !== undefined ? { score } : {}) });
  assert.equal(dedupeByUrl([mk('https://x.com', 0.1), mk('https://x.com/', 0.9)])[0].score, 0.9);
});

test('non-OK response (rate limit) → unavailable with honest reason', async () => {
  const r = await searchWeb('a', { endpoint: EP, fetcher: jsonFetcher({}, false, 429) });
  assert.equal(r.available, false);
  assert.match(r.reason || '', /429/);
});

test('provider timeout / unreachable → unavailable, not a crash', async () => {
  const r = await searchWeb('a', { endpoint: EP, fetcher: throwingFetcher });
  assert.equal(r.available, false);
  assert.match(r.reason || '', /unavailable/);
});

test('malformed JSON body → unavailable, no fake results', async () => {
  const bad: JsonFetcher = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  const r = await searchWeb('a', { endpoint: EP, fetcher: bad });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'invalid-json');
});

test('empty results → available but zero rows (DEGRADED material), never fabricated', async () => {
  const r = await searchWeb('zzz', { endpoint: EP, fetcher: jsonFetcher({ results: [] }) });
  assert.equal(r.available, true);
  assert.equal(r.results.length, 0);
});

test('searchHealth: READY only with a REAL result; empty = not ok; unreachable = not ok', async () => {
  const ready = await searchHealth({ endpoint: EP, fetcher: jsonFetcher({ results: [{ title: 'T', url: 'https://a.com' }] }) });
  assert.equal(ready.ok, true);
  const empty = await searchHealth({ endpoint: EP, fetcher: jsonFetcher({ results: [] }) });
  assert.equal(empty.ok, false);
  assert.match(empty.reason || '', /no results/);
  const down = await searchHealth({ endpoint: EP, fetcher: throwingFetcher });
  assert.equal(down.ok, false);
  const unconf = await searchHealth({ endpoint: '' });
  assert.equal(unconf.ok, false);
  assert.match(unconf.reason || '', /not configured/);
});

test('searxngEndpoint: env-only, trailing slashes trimmed, no default host', () => {
  assert.equal(searxngEndpoint({}), '');
  assert.equal(searxngEndpoint({ SEARXNG_URL: ' http://h:1// ' }), 'http://h:1');
});
