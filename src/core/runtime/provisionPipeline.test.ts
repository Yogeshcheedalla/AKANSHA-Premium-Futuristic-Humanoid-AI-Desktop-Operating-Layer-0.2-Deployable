import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the local-model registry to a temp home BEFORE importing it.
process.env.AKANSHA_HOME = mkdtempSync(join(tmpdir(), 'akan-reg-'));

import { provisionRuntime, sha256Hex, type Fetcher, type Extractor, type PinnedRuntime } from '@/core/runtime/RuntimeProvisioner';
import { buildFixtureCatalog } from '@/core/catalog/fixtureCatalog';
import { toManifestEntry } from '@/core/catalog/ModelCatalog';
import { provisionAndVerify, getUsableLocalModelIds, unregister, registerUsable } from '@/core/models/local/LocalModelRegistry';

const GGUF = buildFixtureCatalog().artifactBytes['fixture-qwen-1.5b'];

function pinned(over: Partial<PinnedRuntime> = {}): PinnedRuntime {
  return { version: 'b10809', url: 'https://github.com/x/llama.zip', sha256: sha256Hex(GGUF), sizeBytes: GGUF.length, binaryRelativePath: 'llama/llama-cli.exe', ...over };
}
const okFetch: Fetcher = async () => ({ ok: true, status: 200, arrayBuffer: async () => GGUF.buffer.slice(GGUF.byteOffset, GGUF.byteOffset + GGUF.byteLength) as ArrayBuffer });
const noopExtract: Extractor = async () => {};

/* ── RuntimeProvisioner: real pipeline, offline-injected ─────────────────── */
test('runtime: insecure url refused', async () => {
  const r = await provisionRuntime({ pinned: pinned({ url: 'http://x/llama.zip' }), destDir: '/tmp/x', fetcher: okFetch, extractor: noopExtract });
  assert.equal(r.ok, false); assert.equal(r.reason, 'insecure-url');
});
test('runtime: no pinned checksum refused (never invents one)', async () => {
  const r = await provisionRuntime({ pinned: pinned({ sha256: '' }), destDir: '/tmp/x', fetcher: okFetch, extractor: noopExtract });
  assert.equal(r.ok, false); assert.equal(r.reason, 'no-pinned-checksum');
});
test('runtime: checksum mismatch fails but reports computed sha (to pin honestly)', async () => {
  const r = await provisionRuntime({ pinned: pinned({ sha256: 'f'.repeat(64) }), destDir: '/tmp/x', fetcher: okFetch, extractor: noopExtract });
  assert.equal(r.ok, false); assert.equal(r.reason, 'checksum-mismatch'); assert.equal(r.sha256, sha256Hex(GGUF));
});
test('runtime: size mismatch fails', async () => {
  const r = await provisionRuntime({ pinned: pinned({ sizeBytes: GGUF.length + 5 }), destDir: '/tmp/x', fetcher: okFetch, extractor: noopExtract });
  assert.equal(r.ok, false); assert.match(String(r.reason), /size-mismatch/);
});
test('runtime: extract failure surfaces', async () => {
  const r = await provisionRuntime({ pinned: pinned(), destDir: '/tmp/x', fetcher: okFetch, extractor: async () => { throw new Error('no tar'); } });
  assert.equal(r.ok, false); assert.match(String(r.reason), /extract-failed/);
});
test('runtime: happy path returns binary path + version (binary must actually exist)', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'akan-rt-dest-'));
  // extractor that actually writes the pinned binary, like a real unzip would
  const writeExtract: Extractor = async (_bytes, dir) => {
    const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
    const { dirname: dn } = await import('node:path');
    const p = join(dir, 'llama/llama-cli.exe'); mk(dn(p), { recursive: true }); wf(p, 'MZ');
  };
  const r = await provisionRuntime({ pinned: pinned(), destDir: dest, fetcher: okFetch, extractor: writeExtract });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.binaryPath && r.binaryPath.endsWith('llama-cli.exe')); assert.equal(r.version, 'b10809');
});
test('runtime: extract succeeded but binary absent at pinned path => binary-not-found (no false ok)', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'akan-rt-dest-'));
  const r = await provisionRuntime({ pinned: pinned(), destDir: dest, fetcher: okFetch, extractor: noopExtract });
  assert.equal(r.ok, false); assert.match(String(r.reason), /binary-not-found/);
});

/* ── Model provisioning: usable ONLY after a real inference ───────────────── */
test('model: integrity failure (bytes != signed sha) => not usable, not registered', async () => {
  const entry = toManifestEntry(buildFixtureCatalog().signed.catalog.models[0]);
  const r = await provisionAndVerify({ entry, artifactPath: join(process.env.AKANSHA_HOME!, 'missing.gguf'), runtime: { binaryPath: null, exists: false }, prompt: 'hi', fetchDownload: async () => new Uint8Array([1, 2, 3]) });
  assert.equal(r.usable, false); assert.equal(r.stage, 'integrity');
  assert.ok(!getUsableLocalModelIds().includes(entry.id));
});
test('model: integrity ok but no runtime/inference => NOT usable (never READY from download)', async () => {
  const entry = toManifestEntry(buildFixtureCatalog().signed.catalog.models[0]);
  const r = await provisionAndVerify({ entry, artifactPath: join(process.env.AKANSHA_HOME!, 'missing.gguf'), runtime: { binaryPath: null, exists: false }, prompt: 'hi', fetchDownload: async () => GGUF });
  assert.equal(r.usable, false); assert.equal(r.stage, 'inference');
  assert.ok(!getUsableLocalModelIds().includes(entry.id));
});
test('registry: registerUsable + getUsableLocalModelIds + unregister', () => {
  const entry = toManifestEntry(buildFixtureCatalog().signed.catalog.models[0]);
  unregister(entry.id);
  assert.equal(getUsableLocalModelIds().includes(entry.id), false);
  // registerUsable is exercised indirectly via provisionAndVerify only on real inference;
  // here assert the read/write helpers are consistent by a direct round-trip.
  // The artifact must really exist — readiness only ever honors records whose
  // file is present (stale READY is refused by design; see packagedProvision).
  const artifact = join(process.env.AKANSHA_HOME!, 'reg-roundtrip.gguf');
  writeFileSync(artifact, 'GGUF');
  try {
    registerUsable(entry, artifact, { genTps: 24, totalMs: 500, text: 'ok' });
    assert.equal(getUsableLocalModelIds().includes(entry.id), true);
    unregister(entry.id);
    assert.equal(getUsableLocalModelIds().includes(entry.id), false);
  } finally {
    try { unlinkSync(artifact); } catch { /* temp */ }
  }
});
