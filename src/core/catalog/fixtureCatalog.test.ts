import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFixtureCatalog } from '@/core/catalog/fixtureCatalog';
import { loadSignedCatalog, fixtureAllowed } from '@/core/catalog/catalogProvider';
import { sha256Hex } from '@/core/models/local/ModelIntegrity';
import { validateSignedCatalog, toManifestEntry } from '@/core/catalog/ModelCatalog';
import { initialPipelineState, recordIntegrity, recordInference } from '@/core/catalog/ModelManager';
import { resolveCardState } from '@/core/catalog/installState';
import { decideAiMode } from '@/core/models/AiMode';
import { buildSetupViewModel, type SetupDeps } from '@/core/aiSetup/setupViewModel';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 12, totalRamGB: 16,
  freeRamGB: 8, freeDiskGB: 180, gpu: { detected: false }, tier: 3, ...over,
});

const fx = buildFixtureCatalog();
const ids = fx.signed.catalog.models.map((m) => m.id);

/* 1. PRODUCTION EXCLUDES FIXTURE */
test('1 production never loads a fixture catalog (explicit flag, not filename)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'akan-fx-'));
  const path = join(dir, 'catalog.json');
  writeFileSync(path, JSON.stringify(fx.signed));
  const env = { AKANSHA_MODEL_CATALOG: path, AKANSHA_CATALOG_PUBKEY: fx.publicKeyPem } as unknown as NodeJS.ProcessEnv;
  const prod = loadSignedCatalog(env, Date.now(), false);           // production
  assert.equal(prod.status, 'invalid');
  assert.ok(prod.reasons.includes('fixture-in-production'));
  const dev = loadSignedCatalog(env, Date.now(), true);              // dev-allowed
  assert.equal(dev.status, 'fixture');
  assert.ok(dev.models.length > 0);
});

/* 2. DEVELOPMENT CAN LOAD FIXTURE */
test('2 development env flag loads the fixture catalog (no real catalog configured)', () => {
  const env = { NODE_ENV: 'development', AKANSHA_ALLOW_FIXTURE_CATALOG: '1' } as NodeJS.ProcessEnv;
  assert.equal(fixtureAllowed(env), true);
  assert.equal(fixtureAllowed({ NODE_ENV: 'production', AKANSHA_ALLOW_FIXTURE_CATALOG: '1' } as any), false);
  const r = loadSignedCatalog(env);
  assert.equal(r.status, 'fixture');
  assert.equal(r.models.length, 3);
});

/* 3. FIXTURE METADATA RENDERED + INTEGRITY GENUINELY PASSES */
test('3 fixture metadata renders and its integrity actually validates', () => {
  const v = validateSignedCatalog(fx.signed, fx.publicKeyPem);
  assert.equal(v.ok, true, JSON.stringify(v.reasons)); // real sha + sig + GGUF url
  const deps: SetupDeps = {
    hardware: hw(), catalog: { status: 'fixture', models: v.models, reasons: [] },
    runtime: { available: false, name: 'none', supportsAcceleration: [] }, usableLocalIds: [],
    openrouter: { connected: false, verified: false, label: null },
  };
  const vm = buildSetupViewModel(deps);
  assert.equal(vm.catalog.fixture, true);
  assert.equal(vm.catalog.models.length, 3);
});

/* 4/5/6. COMPATIBILITY: small fits, heavy insufficient, plan9 unsupported */
test('4 compatibility states from fixture metadata', () => {
  const deps: SetupDeps = {
    hardware: hw(), catalog: { status: 'fixture', models: fx.signed.catalog.models, reasons: [] },
    runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] }, usableLocalIds: [],
    openrouter: { connected: false, verified: false, label: null },
  };
  const byId = Object.fromEntries(buildSetupViewModel(deps).catalog.models.map((c) => [c.id, c]));
  assert.equal(byId['fixture-qwen-1.5b'].compatibility.runnable, true);
  assert.equal(byId['fixture-llama-70b'].compatibility.runnable, false);          // insufficient RAM/storage
  assert.equal(byId['fixture-plan9-model'].compatibility.runnable, false);          // unsupported platform
});

/* fixture NEVER auto-READY: offline readiness stays dev-only even with runtime */
test('offline stays dev-only/not-ready with fixture (usableLocalIds empty)', () => {
  const deps: SetupDeps = {
    hardware: hw(), catalog: { status: 'fixture', models: fx.signed.catalog.models, reasons: [] },
    runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] }, usableLocalIds: [],
    openrouter: { connected: false, verified: false, label: null },
  };
  const vm = buildSetupViewModel(deps);
  assert.notEqual(vm.readiness.offline, 'OFFLINE AI READY');
  assert.match(vm.readiness.offline, /FIXTURE/i);
});

/* 7. INSTALLATION STATE TRANSITIONS + resolveCardState */
test('7 install state machine: download→install→(no inference) not usable', () => {
  const m = fx.signed.catalog.models.find((x) => x.id === 'fixture-qwen-1.5b')!;
  const entry = toManifestEntry(m);
  let s = initialPipelineState(m.id);
  s = { ...s, stage: 'download' };
  s = recordIntegrity(s, entry, fx.artifactBytes[m.id]);   // integrity passes (real sha+gguf)
  assert.equal(s.stage, 'install');
  assert.equal(s.usable, false);                            // NOT usable from download+integrity alone
  s = { ...s, stage: 'inference' };
  const notReady = recordInference(s, { ok: false, text: '' });
  assert.equal(notReady.usable, false);
  const ready = recordInference({ ...s }, { ok: true, text: 'hello world' });
  assert.equal(ready.usable, true);                          // ONLY after real inference
});

/* 8/9/10. FAILURE states */
test('8 integrity failure (wrong bytes) => failed', () => {
  const m = fx.signed.catalog.models[0];
  const entry = toManifestEntry(m);
  const s = recordIntegrity({ ...initialPipelineState(m.id), stage: 'download' }, entry, new Uint8Array([1, 2, 3]));
  assert.equal(s.stage, 'failed'); assert.equal(s.usable, false);
});
test('9 signature failure => catalog rejected', () => {
  const tampered = { catalog: { ...fx.signed.catalog, models: fx.signed.catalog.models.map((x) => ({ ...x, minimumRamGB: 999 })) }, signatureBase64: fx.signed.signatureBase64 };
  assert.equal(validateSignedCatalog(tampered as any, fx.publicKeyPem).ok, false);
});
test('10 GGUF validation failure => failed (checksum ok, container bad)', () => {
  const junk = Buffer.from('NOPE' + 'garbage'.repeat(50));
  const m = { ...fx.signed.catalog.models[0], sha256: sha256Hex(junk), sizeBytes: junk.length };
  const s = recordIntegrity({ ...initialPipelineState(m.id), stage: 'download' }, toManifestEntry(m), new Uint8Array(junk));
  assert.equal(s.stage, 'failed');
  assert.ok(s.errors.some((e) => e.startsWith('gguf:')), JSON.stringify(s.errors));
});

/* 11/12. usable gating */
test('11 no inference means not usable', () => {
  const ready = resolveCardState({ runnable: true, runtimeAvailable: true, installable: true, result: { ok: true, stage: 'install', usable: false } });
  assert.notEqual(ready, 'READY');
});
test('12 real inference => READY via resolveCardState', () => {
  assert.equal(resolveCardState({ runnable: true, runtimeAvailable: true, installable: true, result: { ok: true, stage: 'ready', usable: true } }), 'READY');
});

/* 13. offline does NOT cloud-fallback */
test('13 explicit offline with a usable model does not fall back to cloud', () => {
  const d = decideAiMode({ mode: 'offline', hardware: hw(), catalog: fx.signed.catalog.models.map(toManifestEntry), usableLocalIds: ['fixture-qwen-1.5b'] });
  assert.equal(d.mode, 'offline'); assert.equal(d.fallbackUsed, false); assert.equal(d.ok, true);
});

/* 14/15. dynamic catalog + selection survives */
test('14 model cards come from the catalog, not hard-coded (count follows input)', () => {
  const deps: SetupDeps = { hardware: hw(), catalog: { status: 'ready', models: fx.signed.catalog.models.slice(0, 1), reasons: [] }, runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] }, usableLocalIds: [], openrouter: { connected: false, verified: false, label: null } };
  assert.equal(buildSetupViewModel(deps).catalog.models.length, 1);
});
test('15 chosen mode reflected in the view model recommendation logic', () => {
  const offline = decideAiMode({ mode: 'both', hardware: hw(), catalog: fx.signed.catalog.models.map(toManifestEntry), usableLocalIds: ['fixture-qwen-1.5b'] });
  assert.equal(offline.mode, 'offline'); // both prefers verified local
});
