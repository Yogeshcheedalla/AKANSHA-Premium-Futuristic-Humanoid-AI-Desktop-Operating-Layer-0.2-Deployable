import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyArtifact, getReleases, clearReleaseCache, type ReleaseArtifactConfig } from '@/core/releases/releaseManifest';

function mockFetch(handler: (url: string, init?: any) => any): typeof fetch {
  return (async (url: any, init?: any) => handler(String(url), init)) as unknown as typeof fetch;
}
const head = (ok: boolean, status: number, len?: number) => ({ ok, status, headers: new Headers(len != null ? { 'content-length': String(len) } : {}) });

const artifact: ReleaseArtifactConfig = { platform: 'windows', architecture: 'x64', type: 'installer', filename: 'Akansha-Setup-x64.exe', url: 'https://releases.example/Akansha-Setup-x64.exe', sha256: 'a'.repeat(64), version: '3.0.0' };

test('verifyArtifact: HEAD 200 + content-length => available with real size', async () => {
  const r = await verifyArtifact(artifact, mockFetch((u, init) => { assert.equal(init?.method, 'HEAD'); return head(true, 200, 145000000); }));
  assert.equal(r.available, true);
  assert.equal(r.size, 145000000);
});

test('verifyArtifact: HEAD 404 => NOT available (no fake button)', async () => {
  const r = await verifyArtifact(artifact, mockFetch(() => head(false, 404)));
  assert.equal(r.available, false);
  assert.equal(r.size, null);
});

test('verifyArtifact: HEAD unsupported (405) => 1-byte range GET, size from content-range', async () => {
  let method = '';
  const r = await verifyArtifact(artifact, mockFetch((u, init) => {
    if (init?.method === 'HEAD') return head(false, 405);
    method = init?.method || '';
    return { ok: true, status: 206, headers: new Headers({ 'content-range': 'bytes 0-0/52428800' }) };
  }));
  assert.equal(method, 'GET');
  assert.equal(r.available, true);
  assert.equal(r.size, 52428800);
});

test('verifyArtifact: network failure => available:false reason unreachable (never throws)', async () => {
  const r = await verifyArtifact(artifact, mockFetch(() => { throw new Error('ECONNRESET'); }));
  assert.equal(r.available, false);
  assert.equal(r.reason, 'unreachable');
});

test('verifyArtifact: timeout => available:false reason timeout', async () => {
  const r = await verifyArtifact(artifact, mockFetch(() => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }));
  assert.equal(r.available, false);
  assert.equal(r.reason, 'timeout');
});

test('getReleases: no configuration => empty manifest (nothing downloadable)', async () => {
  clearReleaseCache();
  const { releases } = await getReleases({} as any, mockFetch(() => head(true, 200, 1)));
  assert.deepEqual(releases, []);
});

test('getReleases: configured but unreachable URL => available:false (bad URL never becomes true)', async () => {
  clearReleaseCache();
  const env = { AKANSHA_RELEASES: JSON.stringify([{ platform: 'windows', url: 'https://nope.invalid/Akansha.exe' }]) } as any;
  const { releases } = await getReleases(env, mockFetch(() => head(false, 404)));
  assert.equal(releases.length, 1);
  assert.equal(releases[0].available, false);
});

test('getReleases: configured + verified => available:true with metadata', async () => {
  clearReleaseCache();
  const env = { AKANSHA_RELEASES: JSON.stringify([artifact]) } as any;
  const { version, releases } = await getReleases(env, mockFetch(() => head(true, 200, 145000000)));
  assert.equal(typeof version, 'string');
  assert.equal(releases[0].available, true);
  assert.equal(releases[0].sha256, artifact.sha256);
  assert.ok(releases[0].verifiedAt);
  clearReleaseCache();
});
