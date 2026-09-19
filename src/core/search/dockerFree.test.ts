/**
 * Docker-freedom contract — the statement this file keeps TRUE:
 * "Akansha does not require Docker to deploy or operate Web Search."
 *
 *  • STRUCTURAL: the whole runtime web-search path (adapter, provider, mesh,
 *    readers, citation façade) contains zero Docker references and never
 *    imports child_process — nothing shells out to docker, talks to a socket,
 *    or inspects container state. Readiness is decided by HTTP probes alone.
 *  • BEHAVIOURAL: a REMOTE, non-localhost SEARXNG_URL works identically —
 *    no 127.0.0.1/localhost/container-hostname assumption anywhere; the
 *    endpoint's presence or absence of Docker is irrelevant: reachable +
 *    real results → READY, unreachable → UNAVAILABLE, always via HTTP truth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SearXNGSearchProvider } from '@/core/web/SearXNGSearchProvider';
import type { JsonFetcher } from './searxng';

/** Every module on the runtime Web Search path (product code, not scripts/docs). */
const WEB_SEARCH_MODULES = [
  'src/core/search/searxng.ts',
  'src/core/search/webSearch.ts',
  'src/core/web/SearXNGSearchProvider.ts',
  'src/core/web/WebCapability.ts',
  'src/core/web/HttpWebReaderProvider.ts',
  'src/core/web/PlaywrightWebReaderProvider.ts',
  'src/core/web/canonical.ts',
  'src/core/web/DuckDuckGoSearchProvider.ts',
  'src/core/web/WikipediaSearchProvider.ts',
  'src/core/web/types.ts',
];

test('§10.1/§10.3 structural: zero Docker references in the entire runtime web-search path', () => {
  for (const rel of WEB_SEARCH_MODULES) {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    assert.ok(!/docker/i.test(src), `${rel} must not mention Docker (it must not depend on it)`);
  }
});

test('§10.1 structural: the web-search path never shells out (no child_process)', () => {
  for (const rel of WEB_SEARCH_MODULES) {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    assert.ok(!/child_process/.test(src), `${rel} must not spawn processes to decide search readiness`);
  }
});

test('§10.8 production-safe endpoint: a REMOTE non-localhost SEARXNG_URL drives READY + search', async () => {
  const prev = process.env.SEARXNG_URL;
  // Deliberately remote: https, real hostname, port + base path. If any code
  // assumed localhost/127.0.0.1/a container name, these assertions would fail.
  process.env.SEARXNG_URL = 'https://search.example.org:9443/searx';
  try {
    const seenUrls: string[] = [];
    const fetcher: JsonFetcher = async (url) => {
      seenUrls.push(url);
      return { ok: true, status: 200, json: async () => ({ results: [{ title: 'Real Doc', url: 'https://docs.example.org/a', content: 'snippet', engine: 'google' }] }) };
    };
    const p = new SearXNGSearchProvider(fetcher);
    assert.equal((await p.health({ force: true })).status, 'READY');
    const rows = await p.search('latest release notes', { maxResults: 5 });
    assert.equal(rows.length, 1);
    assert.ok(seenUrls.every((u) => u.startsWith('https://search.example.org:9443/searx/search?')), 'requests go to the configured remote endpoint only');
  } finally {
    if (prev === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = prev;
  }
});

test('§10.3/§10.5 Docker ENV presence is ignored; only HTTP reachability decides status', async () => {
  const prevUrl = process.env.SEARXNG_URL;
  const prevDocker = process.env.DOCKER_HOST;
  process.env.SEARXNG_URL = 'http://searx-unreachable.test:8088';
  process.env.DOCKER_HOST = 'tcp://192.0.2.1:2375'; // pretend Docker exists & points somewhere
  try {
    const down: JsonFetcher = async () => { throw new Error('getaddrinfo ENOTFOUND searx-unreachable.test'); };
    const p = new SearXNGSearchProvider(down);
    const h = await p.health({ force: true });
    // Docker "available" must NOT upgrade anything — the HTTP probe says no:
    assert.equal(h.status, 'UNAVAILABLE');
    assert.match(h.reason || '', /unavailable/);
    assert.equal(await p.isAvailable(), false);
  } finally {
    if (prevUrl === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = prevUrl;
    if (prevDocker === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = prevDocker;
  }
});

test('§10.6 reachable endpoint whose query fails → DEGRADED, never READY-lie', async () => {
  const prev = process.env.SEARXNG_URL;
  process.env.SEARXNG_URL = 'https://search.example.org';
  try {
    const emptyButOk: JsonFetcher = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) });
    const h = await new SearXNGSearchProvider(emptyButOk).health({ force: true });
    assert.equal(h.status, 'DEGRADED');
  } finally {
    if (prev === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = prev;
  }
});
