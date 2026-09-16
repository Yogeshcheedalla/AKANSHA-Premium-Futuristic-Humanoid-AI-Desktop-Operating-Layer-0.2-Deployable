import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

import { canonicalJson, sha256Hex } from '@/core/models/local/ModelIntegrity';
import { loadSignedCatalog } from '@/core/catalog/catalogProvider';
import type { CatalogModel, ModelCatalog, SignedCatalog } from '@/core/catalog/ModelCatalog';
import { buildSetupViewModel, type SetupDeps } from '@/core/aiSetup/setupViewModel';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const GGUF = (() => { const h = Buffer.alloc(24); h.write('GGUF', 0, 'latin1'); h.writeUInt32LE(3, 4); h.writeBigUInt64LE(BigInt(7), 8); h.writeBigUInt64LE(BigInt(1), 16); return Buffer.concat([h, Buffer.from('general.architecture'), Buffer.from([8]), (() => { const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(5), 0); return l; })(), Buffer.from('qwen2')]); })();

const model: CatalogModel = {
  id: 'qwen-1.5b', family: 'qwen', version: '2.5', parameters: '1.5B', quantization: 'Q4_K_M',
  format: 'gguf', downloadSizeBytes: GGUF.length, installedSizeBytes: GGUF.length, minimumRamGB: 4,
  recommendedRamGB: 6, minimumStorageGB: 2, accelerationSupport: ['cpu'], platforms: ['win32'],
  architecture: ['x64'], runtimeRequirement: 'llama.cpp', contextLength: 32768, capabilities: ['chat'],
  quality: { chat: 'Good', reasoning: 'Medium', coding: 'Good' }, internetRequired: false,
  benchmark: { source: 'estimated', generationTokensPerSec: 24 }, license: 'apache-2.0',
  sourceUrl: 'https://hf.co/x/qwen.gguf', sha256: sha256Hex(GGUF), signature: 'x',
};
const catalog: ModelCatalog = { schema: 'akansha/model-catalog/1', version: 1, issuedAt: Date.now(), models: [model] };
const signed: SignedCatalog = { catalog, signatureBase64: cryptoSign(null, Buffer.from(canonicalJson(catalog), 'utf8'), privateKey).toString('base64') };

function tmpSignedCatalog(c: SignedCatalog): { dir: string; path: string; keyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'akan-cat-'));
  const path = join(dir, 'catalog.json');
  const keyPath = join(dir, 'pub.pem');
  writeFileSync(path, JSON.stringify(c));
  writeFileSync(keyPath, pubPem);
  return { dir, path, keyPath };
}

/* ── catalog provider: honest status ─────────────────────────────────────── */
test('catalogProvider: not-configured when no file/key (never fabricates a list)', () => {
  assert.equal(loadSignedCatalog({} as unknown as NodeJS.ProcessEnv).status, 'not-configured');
});

test('catalogProvider: ready only for a valid signed catalog', () => {
  const { path, keyPath } = tmpSignedCatalog(signed);
  const r = loadSignedCatalog({ AKANSHA_MODEL_CATALOG: path, AKANSHA_CATALOG_PUBKEY_FILE: keyPath } as any);
  assert.equal(r.status, 'ready', JSON.stringify(r.reasons));
  assert.equal(r.models[0].id, 'qwen-1.5b');
});

test('catalogProvider: invalid when the signature does not match the catalog', () => {
  const tampered: SignedCatalog = { catalog: { ...catalog, models: [{ ...model, minimumRamGB: 1 }] }, signatureBase64: signed.signatureBase64 };
  const { path, keyPath } = tmpSignedCatalog(tampered);
  const r = loadSignedCatalog({ AKANSHA_MODEL_CATALOG: path, AKANSHA_CATALOG_PUBKEY_FILE: keyPath } as any);
  assert.equal(r.status, 'invalid');
  assert.ok(r.reasons.includes('bad-signature'));
});

/* ── setup view model: honest, never fabricates readiness ────────────────── */
const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 12, totalRamGB: 16, freeRamGB: 8,
  freeDiskGB: 180, gpu: { detected: false }, tier: 3, ...over,
});
const baseDeps = (over: Partial<SetupDeps> = {}): SetupDeps => ({
  hardware: hw(),
  catalog: { status: 'ready', models: [model], reasons: [] },
  runtime: { available: false, name: 'none', supportsAcceleration: [] },
  usableLocalIds: [], openrouter: { connected: false, verified: false, label: null }, ...over,
});

test('setup vm: no runtime => LOCAL RUNTIME NOT DETECTED, offline not ready, cloud not ready', () => {
  const vm = buildSetupViewModel(baseDeps());
  assert.equal(vm.readiness.offline, 'LOCAL RUNTIME NOT DETECTED');
  assert.equal(vm.aiMode.offlineReady, false);
  assert.match(vm.readiness.online, /NOT CONFIGURED/);
});

test('setup vm: catalog not configured => no cards, honest status (no hard-coded models)', () => {
  const vm = buildSetupViewModel(baseDeps({ catalog: { status: 'not-configured', models: [], reasons: ['no signed catalog'] } }));
  assert.equal(vm.catalog.models.length, 0);
  assert.equal(vm.readiness.offline, 'MODEL CATALOG NOT CONFIGURED');
});

test('setup vm: runtime present but no installed model => LOCAL MODEL NOT INSTALLED; card compatible+estimated', () => {
  const vm = buildSetupViewModel(baseDeps({ runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] } }));
  assert.equal(vm.readiness.offline, 'LOCAL MODEL NOT INSTALLED');
  const card = vm.catalog.models[0];
  assert.equal(card.compatibility.runnable, true);
  assert.equal(card.performanceLabel, 'Estimated'); // source was estimated
  assert.equal(card.installable, true);
});

test('setup vm: online readiness only when openrouter connected AND verified', () => {
  const vm = buildSetupViewModel(baseDeps({ openrouter: { connected: true, verified: true, label: 'personal' } }));
  assert.equal(vm.readiness.online, 'ONLINE AI READY');
  assert.equal(vm.online.label, 'personal'); // label is safe; the key itself is never in the VM
  assert.ok(!JSON.stringify(vm).includes('sk-or'), 'view model must never contain a key');
});

test('setup vm: installed+usable local model => OFFLINE AI READY', () => {
  const vm = buildSetupViewModel(baseDeps({ runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] }, usableLocalIds: ['qwen-1.5b'] }));
  assert.equal(vm.readiness.offline, 'OFFLINE AI READY');
  assert.equal(vm.aiMode.offlineReady, true);
});
