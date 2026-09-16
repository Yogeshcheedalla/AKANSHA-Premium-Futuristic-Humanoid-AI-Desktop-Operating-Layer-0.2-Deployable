import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRepositories } from '@/ui/workspaces/repositoriesLoader';

function mockFetch(handler: (url: string, init?: any) => any): typeof fetch {
  return (async (url: any, init?: any) => handler(String(url), init)) as unknown as typeof fetch;
}

test('loadRepositories: ok:true response resolves data', async () => {
  const r = await loadRepositories(mockFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, stats: { total: 31 } }) })));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.data as any).stats.total, 31);
});

test('loadRepositories: HTTP 500 => ok:false with error (never hangs)', async () => {
  const r = await loadRepositories(mockFetch(() => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) })));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /boom/);
});

test('loadRepositories: HTTP 401 => "Authentication required"', async () => {
  const r = await loadRepositories(mockFetch(() => ({ ok: false, status: 401, json: async () => ({}) })));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Authentication required/);
});

test('loadRepositories: body ok:false => treated as failure', async () => {
  const r = await loadRepositories(mockFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'nope' }) })));
  assert.equal(r.ok, false);
});

test('loadRepositories: timeout (abort) => ok:false timeout message, resolves', async () => {
  const fetcher = (_u: any, init: any) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const r = await loadRepositories(fetcher as unknown as typeof fetch, 25);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Timed out/);
});

test('loadRepositories: network throw => ok:false', async () => {
  const r = await loadRepositories(mockFetch(() => { throw new Error('offline'); }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /offline/);
});
