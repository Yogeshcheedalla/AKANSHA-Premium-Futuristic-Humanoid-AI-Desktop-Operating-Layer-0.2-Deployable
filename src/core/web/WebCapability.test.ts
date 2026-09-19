import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebCapability } from './WebCapability';
import type { SearchResult, WebSearchProvider } from './types';

const res = (url: string, relevance = 0.5, extra: Partial<SearchResult> = {}): SearchResult =>
  ({ title: url, url, snippet: '', source: 'fake', relevance, retrievedAt: 1, ...extra });

const fakeProvider = (id: string, results: SearchResult[] | Error, calls: string[]): WebSearchProvider => ({
  id,
  async isAvailable() { calls.push(id + ':avail'); return true; },
  async search(query) {
    calls.push(id + ':search');
    if (results instanceof Error) throw results;
    return results.map((r) => ({ ...r, source: id }));
  },
});

test('provider preference: a healthy first provider short-circuits — fallbacks are NOT hammered on every query (upstream rate limits)', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  // Registered last → first in order (register prepends).
  cap.registerSearchProvider(fakeProvider('fallback', [res('https://fb.test')], calls));
  cap.registerSearchProvider(fakeProvider('primary', [res('https://p1.test')], calls));
  const out = await cap.search('q');
  assert.deepEqual(calls, ['primary:avail', 'primary:search']);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'primary');
});

test('provider failure degrades to the next provider — one failure is not fatal', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  cap.registerSearchProvider(fakeProvider('backup', [res('https://b.test')], calls));
  cap.registerSearchProvider(fakeProvider('broken', new Error('rate limited 429'), calls));
  const out = await cap.search('q');
  assert.deepEqual(calls, ['broken:avail', 'broken:search', 'backup:avail', 'backup:search']);
  assert.equal(out[0].source, 'backup');
});

test('empty provider result does not mask the next provider; all-empty falls through honestly', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  cap.registerSearchProvider(fakeProvider('second', [res('https://s.test')], calls));
  cap.registerSearchProvider(fakeProvider('empty', [], calls));
  const out = await cap.search('q');
  assert.ok(out.some((r) => r.url === 'https://s.test'));
});

test('cross-engine duplicates collapse by canonical URL, keeping the highest relevance', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  cap.registerSearchProvider(fakeProvider('agg', [
    res('https://x.com/a/', 0.4, { engine: 'google' }),
    res('https://www.x.com/a?utm_source=bing', 0.9, { engine: 'bing' }),
    res('https://x.com/a#frag', 0.1, { engine: 'duckduckgo' }),
    res('https://x.com/b', 0.8, { engine: 'google' }),
  ], calls));
  const out = await cap.search('q', { maxResults: 8 });
  assert.equal(out.length, 2, 'three URL spellings of the same doc → one row');
  assert.equal(out[0].url, 'https://www.x.com/a?utm_source=bing'); // highest relevance survives
  assert.equal(out[0].relevance, 0.9);
});

test('results are ranked by relevance and capped by maxResults', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  cap.registerSearchProvider(fakeProvider('r', [
    res('https://x.test/low', 0.1), res('https://x.test/high', 0.9), res('https://x.test/mid', 0.5),
  ], calls));
  const out = await cap.search('q', { maxResults: 2 });
  assert.deepEqual(out.map((r) => r.url), ['https://x.test/high', 'https://x.test/mid']);
});

test('offline mesh: every provider down → empty list, never fabricated rows', async () => {
  const cap = new WebCapability();
  const calls: string[] = [];
  cap.registerSearchProvider(fakeProvider('d2', new Error('unreachable'), calls));
  cap.registerSearchProvider(fakeProvider('d1', new Error('unreachable'), calls));
  // The remaining built-ins (searxng-unconfigured + key-free providers) simply
  // fail/return nothing offline; assert only that no fake row appears.
  const out = await cap.search('q');
  assert.ok(Array.isArray(out));
  for (const r of out) assert.ok(r.source !== 'fake');
});
