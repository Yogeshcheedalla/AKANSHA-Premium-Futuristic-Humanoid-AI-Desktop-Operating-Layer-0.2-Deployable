/**
 * Packaged-provisioning primitives: the download utility's honesty guards and
 * the stale-READY existence filter. (The full end-to-end chain — real download,
 * real inference, restart read-back — is proven live by
 * scripts/verify-packaged-ready.ts on a packaged build; unit tests here only
 * pin the invariants that must NEVER regress.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadArtifactToFile } from './downloadArtifact';
import { registerUsable, getUsableLocalModelIds, getStaleUsableModelIds } from './LocalModelRegistry';
import type { ManifestModelEntry } from './ModelIntegrity';

const entry = (over: Partial<ManifestModelEntry> = {}): ManifestModelEntry => ({
  id: 'test-model', file: 'test.gguf', url: 'https://example.test/test.gguf', sha256: 'a'.repeat(64),
  sizeBytes: 10, format: 'gguf', ...over,
});

/* ── downloadArtifactToFile ─────────────────────────────────────────────── */

test('refuses non-https artifact URLs outright', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'akan-dl-'));
  const r = await downloadArtifactToFile('http://evil.test/x.gguf', join(dir, 'x.gguf'), 10);
  assert.equal(r.ok, false);
  assert.match(r.reason || '', /https/);
});

test('streams to disk, renames only on success, size-sanity-checks the stream', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'akan-dl-'));
  const dest = join(dir, 'sub', 'model.gguf');
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const ok = await downloadArtifactToFile('https://ok.test/m.gguf', dest, bytes.length, {
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  assert.equal(ok.ok, true);
  assert.ok(existsSync(dest));
  assert.ok(!existsSync(dest + '.part'));
  assert.deepEqual([...readFileSync(dest)], [...bytes]);

  // too big vs declared → rejected, no artifact left behind
  const bad = await downloadArtifactToFile('https://big.test/m.gguf', join(dir, 'big.gguf'), 4, {
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  assert.equal(bad.ok, false);
  assert.ok(!existsSync(join(dir, 'big.gguf')));

  // upstream HTTP error surfaces, no fake file
  const err = await downloadArtifactToFile('https://x.test/m.gguf', join(dir, 'e.gguf'), 8, {
    fetchImpl: async () => new Response('nope', { status: 429 }),
  });
  assert.equal(err.ok, false);
  assert.match(err.reason || '', /429/);
});

/* ── stale-READY existence filter ───────────────────────────────────────── */

test('a persisted READY survives restart ONLY while the artifact exists; missing file => degraded, never stale READY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'akan-home-'));
  const prev = process.env.AKANSHA_HOME;
  process.env.AKANSHA_HOME = dir;
  try {
    const artifact = join(dir, 'data', 'm.gguf');
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(artifact, 'present'); // artifact really on disk
    registerUsable(entry(), artifact, { genTps: 24 });
    assert.deepEqual(getUsableLocalModelIds(), ['test-model']);

    // simulate the artifact vanishing (moved/deleted install):
    rmSync(artifact, { force: true });
    assert.deepEqual(getUsableLocalModelIds(), [], 'stale record must NOT count as usable');
    assert.deepEqual(getStaleUsableModelIds(), ['test-model'], '…but must be visible as degraded');

    // artifact restored => readiness restored from the same honest pipeline record
    writeFileSync(artifact, 'x');
    assert.deepEqual(getUsableLocalModelIds(), ['test-model']);
  } finally {
    if (prev === undefined) delete process.env.AKANSHA_HOME; else process.env.AKANSHA_HOME = prev;
  }
});

/* ── execute route gates (auth + catalog honesty) ───────────────────────── */

test('execute route: unauthenticated callers are refused (sensitive level) — no provisioning without a session', async () => {
  const prev = process.env.AKANSHA_AUTH_DISABLED;
  delete process.env.AKANSHA_AUTH_DISABLED;
  const prevToken = process.env.AKANSHA_ACCESS_TOKEN;
  delete process.env.AKANSHA_ACCESS_TOKEN;
  try {
    const { POST } = await import('@/app/api/ai/install/execute/route');
    const req = new Request('http://localhost/api/ai/install/execute', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: 'anything' }),
    });
    const res = await POST(req);
    assert.equal(res.status, 401);
  } finally {
    if (prev !== undefined) process.env.AKANSHA_AUTH_DISABLED = prev;
    if (prevToken !== undefined) process.env.AKANSHA_ACCESS_TOKEN = prevToken;
  }
});

test('execute route: a model NOT in the signed catalog is refused with 404 before any gate runs', async () => {
  process.env.AKANSHA_AUTH_DISABLED = 'true';
  try {
    const { POST } = await import('@/app/api/ai/install/execute/route');
    const req = new Request('http://localhost/api/ai/install/execute', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: 'no-such-model-9000' }),
    });
    const res = await POST(req);
    assert.equal(res.status, 404);
    const j: any = await res.json();
    assert.equal(j.blocked, 'model-not-in-catalog');
    assert.equal(j.usable, false);
  } finally {
    delete process.env.AKANSHA_AUTH_DISABLED;
  }
});
