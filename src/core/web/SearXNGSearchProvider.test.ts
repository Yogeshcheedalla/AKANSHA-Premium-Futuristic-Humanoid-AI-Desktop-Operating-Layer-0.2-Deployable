import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SearXNGSearchProvider } from './SearXNGSearchProvider';
import type { JsonFetcher } from '@/core/search/searxng';

const withEndpoint = async (url: string, fn: () => Promise<void>) => {
  const prev = process.env.SEARXNG_URL;
  if (url) process.env.SEARXNG_URL = url; else delete process.env.SEARXNG_URL;
  try { await fn(); } finally { if (prev === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = prev; }
};

const rows: JsonFetcher = async () => ({ ok: true, status: 200, json: async () => ({ results: [
  { title: 'Release', url: 'https://github.com/ggml-org/llama.cpp/releases', content: 'the latest release', engine: 'google', score: 0.5 },
]})});

test('unconfigured provider: UNAVAILABLE + not available + empty search — no network, no fabrication', async () => {
  await withEndpoint('', async () => {
    const p = new SearXNGSearchProvider(rows);
    const h = await p.health({ force: true });
    assert.equal(h.status, 'UNAVAILABLE');
    assert.equal(h.configured, false);
    assert.equal(await p.isAvailable(), false);
    assert.deepEqual(await p.search('anything'), []);
  });
});

test('READY only after a REAL probe query returns REAL results', async () => {
  await withEndpoint('http://sx:8080', async () => {
    const p = new SearXNGSearchProvider(rows);
    const h = await p.health({ force: true });
    assert.equal(h.status, 'READY');
    assert.equal(await p.isAvailable(), true);
    const r = await p.search('llama.cpp release', { maxResults: 5 });
    assert.equal(r.length, 1);
    assert.equal(r[0].source, 'searxng');
    assert.equal(r[0].engine, 'google');
    assert.equal(r[0].score, 0.5);
    assert.ok(r[0].relevance > 0 && r[0].relevance <= 1);
  });
});

test('reachable-but-empty instance is DEGRADED (not READY, not silent)', async () => {
  await withEndpoint('http://sx:8080', async () => {
    const empty: JsonFetcher = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) });
    const p = new SearXNGSearchProvider(empty);
    const h = await p.health({ force: true });
    assert.equal(h.status, 'DEGRADED');
    assert.match(h.reason || '', /no results/);
  });
});

test('unreachable instance → UNAVAILABLE with the real reason; search throws, never fakes', async () => {
  await withEndpoint('http://sx:8080', async () => {
    const down: JsonFetcher = async () => { throw new Error('connect ECONNREFUSED'); };
    const p = new SearXNGSearchProvider(down);
    const h = await p.health({ force: true });
    assert.equal(h.status, 'UNAVAILABLE');
    assert.match(h.reason || '', /unavailable/);
    await assert.rejects(() => p.search('q'), /ECONNREFUSED/);
  });
});

test('health probe is cached briefly (rate-limit politeness), force bypasses', async () => {
  await withEndpoint('http://sx:8080', async () => {
    let calls = 0;
    const counting: JsonFetcher = async () => { calls++; return { ok: true, status: 200, json: async () => ({ results: [{ title: 'x', url: 'https://x.com' }] }) }; };
    const p = new SearXNGSearchProvider(counting);
    await p.health({ force: true });
    await p.health();
    await p.health();
    assert.equal(calls, 1, '20s cache prevents hammering the instance');
    await p.health({ force: true });
    assert.equal(calls, 2);
  });
});

test('capabilities describe the honest contract', () => {
  const p = new SearXNGSearchProvider();
  assert.deepEqual(p.capabilities(), { keyless: true, selfHosted: true, aggregatesEngines: true, recencyFilter: true, untrustedContent: true });
});
