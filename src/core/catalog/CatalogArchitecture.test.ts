import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, sha256Hex } from '@/core/models/local/ModelIntegrity';
import { validateSignedCatalog, toManifestEntry, type CatalogModel, type ModelCatalog } from '@/core/catalog/ModelCatalog';
import { evaluate, rankCatalog } from '@/core/catalog/CompatibilityEngine';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { initialPipelineState, planNext, recordIntegrity, recordInference } from '@/core/catalog/ModelManager';
import { verifyRelease, artifactBytesMatch, type ReleaseManifest } from '@/core/update/ReleaseManifest';
import { ConnectedServices } from '@/core/identity/ConnectedServices';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const sign = (obj: unknown) => cryptoSign(null, Buffer.from(canonicalJson(obj), 'utf8'), privateKey).toString('base64');

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 12, totalRamGB: 16,
  freeRamGB: 8, freeDiskGB: 180, gpu: { detected: false }, tier: 3, ...over,
});
const GGUF = (() => { const h = Buffer.alloc(24); h.write('GGUF', 0, 'latin1'); h.writeUInt32LE(3, 4); h.writeBigUInt64LE(BigInt(7), 8); h.writeBigUInt64LE(BigInt(1), 16); return Buffer.concat([h, Buffer.from('general.architecture'), Buffer.from([8]), (() => { const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(5), 0); return l; })(), Buffer.from('qwen2')]); })();

function catalogModel(over: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: 'qwen-1.5b', family: 'qwen', version: '2.5', parameters: '1.5B', quantization: 'Q4_K_M',
    format: 'gguf', downloadSizeBytes: 1.1e9, installedSizeBytes: 1.1e9, minimumRamGB: 4,
    recommendedRamGB: 6, minimumStorageGB: 2, accelerationSupport: ['cpu'], platforms: ['win32', 'darwin', 'linux'],
    architecture: ['x64'], runtimeRequirement: 'llama.cpp', contextLength: 32768, capabilities: ['chat', 'coding'],
    quality: { chat: 'Good', reasoning: 'Medium', coding: 'Good' }, internetRequired: false,
    benchmark: { source: 'estimated', generationTokensPerSec: 24 }, license: 'apache-2.0',
    sourceUrl: 'https://huggingface.co/q/qwen.gguf', sha256: sha256Hex(GGUF), signature: 'x', ...over,
  };
}
const catalog = (models: CatalogModel[]): ModelCatalog => ({ schema: 'akansha/model-catalog/1', version: 1, issuedAt: Date.now(), models });

test('catalog: signed catalog verifies; tampered model breaks the signature', () => {
  const c = catalog([catalogModel()]);
  const good = validateSignedCatalog({ catalog: c, signatureBase64: sign(c) }, pubPem);
  assert.equal(good.ok, true, JSON.stringify(good.reasons));
  const tampered: ModelCatalog = { ...c, models: [{ ...c.models[0], sha256: 'b'.repeat(64) }] };
  const bad = validateSignedCatalog({ catalog: tampered, signatureBase64: sign(c) }, pubPem);
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes('bad-signature'));
});

test('compat: excellent when GPU-accelerated + big RAM headroom; measured vs estimated labelled', () => {
  const gpuRt = { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu', 'cuda'] };
  const r = evaluate(catalogModel({ accelerationSupport: ['cpu', 'cuda'] }), hw({ totalRamGB: 32, gpu: { detected: true, vendor: 'nvidia', vramGB: 8 } }), gpuRt);
  assert.equal(r.runnable, true);
  assert.ok(['EXCELLENT', 'GOOD'].includes(r.rating), r.rating);
  assert.equal(r.performanceLabel, 'Estimated'); // model.benchmark.source is estimated
  const measured = evaluate(catalogModel({ benchmark: { source: 'measured', generationTokensPerSec: 21, memoryGB: 5.8 } }), hw(), gpuRt);
  assert.equal(measured.performanceLabel, 'Measured');
});

test('compat: unsupported when runtime missing (never claims runnable)', () => {
  const r = evaluate(catalogModel(), hw(), { available: false, name: 'none', supportsAcceleration: [] });
  assert.equal(r.runnable, false);
  assert.equal(r.rating, 'UNSUPPORTED');
  assert.ok(r.reasons.some((x) => x.startsWith('runtime-missing')));
});

test('compat: rank orders runnable-best-first', () => {
  const big = catalogModel({ id: 'qwen-7b', downloadSizeBytes: 5e9, minimumRamGB: 16, minimumStorageGB: 8 });
  const small = catalogModel({ id: 'phi-3b', minimumRamGB: 3 });
  const ranked = rankCatalog([big, small], hw({ totalRamGB: 4 }), { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] });
  assert.equal(ranked[0].compat.runnable, true); // only the small fits 4GB
  assert.equal(ranked[0].model.id, 'phi-3b');
});

test('runtime manager: no candidate paths => not available; never fabricates a runtime', () => {
  const runtimes = detectRuntimes({}, { includeDefaults: false }); // absence provable on any machine
  assert.ok(runtimes.every((r) => r.healthy === false));
  assert.equal(runtimeFor(runtimes[0]).available, false);
});

test('pipeline: blocks without runtime; usable ONLY after real inference', () => {
  const m = catalogModel({ downloadSizeBytes: GGUF.length, installedSizeBytes: GGUF.length });
  const entry = toManifestEntry(m);
  const s0 = initialPipelineState(m.id);
  const blocked = planNext(s0, { compat: evaluate(m, hw(), { available: false, name: 'none', supportsAcceleration: [] }), freeDiskGB: 100, networkAvailable: true, runtimeAvailable: false }, entry);
  assert.equal(blocked.action, 'block');
  const dl = planNext(s0, { compat: evaluate(m, hw(), { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] }), freeDiskGB: 100, networkAvailable: true, runtimeAvailable: true }, entry);
  assert.equal(dl.nextStage, 'download');

  let s = recordIntegrity({ ...s0, stage: 'download' }, entry, new Uint8Array(GGUF));
  assert.equal(s.stage, 'install');
  assert.equal(s.usable, false);
  s = recordInference({ ...s, stage: 'inference' }, { ok: false, text: '' });
  assert.equal(s.usable, false);
  assert.equal(s.stage, 'failed');
  const ok = recordInference({ ...s0, stage: 'inference' }, { ok: true, text: 'READY' });
  assert.equal(ok.usable, true);
  assert.equal(ok.stage, 'ready');
});

test('release: signed app artifact verifies; bad signature / wrong platform rejected', () => {
  const manifest: ReleaseManifest = { schema: 'akansha/release/1', channel: 'stable', issuedAt: Date.now(), artifacts: [{ id: 'a', component: 'app', version: '1.4.0', platform: 'win32', arch: 'x64', url: 'https://cdn/Akansha.exe', sha256: 'a'.repeat(64), sizeBytes: 1 }] };
  const good = verifyRelease({ manifest, signatureBase64: sign(manifest) }, pubPem, { component: 'app', platform: 'win32', arch: 'x64' });
  assert.equal(good.ok, true, JSON.stringify(good.reasons));
  const badSig = verifyRelease({ manifest, signatureBase64: 'nope' }, pubPem, { component: 'app', platform: 'win32', arch: 'x64' });
  assert.ok(badSig.reasons.includes('bad-signature'));
  const noPlat = verifyRelease({ manifest, signatureBase64: sign(manifest) }, pubPem, { component: 'app', platform: 'darwin', arch: 'arm64' });
  assert.ok(noPlat.reasons.includes('no-artifact-for-platform'));
  assert.equal(artifactBytesMatch(manifest.artifacts[0], 'not-the-bytes'), false);
});

test('connected services: OpenRouter is separate from Akansha; key never leaks in list()', () => {
  const cs = new ConnectedServices();
  assert.throws(() => cs.connect({ provider: 'akansha', apiKey: 'x', verified: true }));
  cs.connect({ provider: 'openrouter', apiKey: 'sk-or-secret-abcdef123456', label: 'personal', verified: true });
  const listed = JSON.stringify(cs.list());
  assert.ok(!listed.includes('sk-or-secret'), 'list must not expose the raw key');
  assert.equal(cs.get('openrouter')?.verified, true);
  assert.equal(cs.resolveKey('openrouter'), 'sk-or-secret-abcdef123456');
  assert.equal(cs.disconnect('openrouter'), true);
  assert.equal(cs.resolveKey('openrouter'), null);
});
