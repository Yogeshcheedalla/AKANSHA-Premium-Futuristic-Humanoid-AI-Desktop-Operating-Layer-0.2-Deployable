/**
 * ProviderManager local-routing tests — the wiring that lets the ONE ModelRouter
 * dispatch to a genuinely-usable local GGUF, WITHOUT needing a real inference
 * (the gating/selection logic is pure). It proves:
 *
 *   1. syncLocalProviders stays INERT with no runtime configured (the Vercel case)
 *      and with no usable registry entry.
 *   2. It registers 'local-llama' (a LocalGgufProvider) ONLY when a runtime path
 *      exists AND a usable record (which itself can only exist after a real
 *      inference) is present.
 *   3. A record with an empty output is NOT trusted (usable-only-after-inference).
 *   4. ModelRouter under LOCAL_ONLY yields ONLY the local provider — no OpenRouter
 *      ever enters the chain — and refuses to silently fall back to cloud.
 *
 * No network, no binaries, no fabrication: runtime presence is simulated only by
 * pointing at an existing file (detectLlamaRuntime is a read-only existsSync check),
 * and a fake non-executable path makes local.generate() fail honestly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AKANSHA_HOME = mkdtempSync(join(tmpdir(), 'akan-pm-local-'));
delete process.env.DATABASE_URL;

import { providerManager } from '@/core/providers/ProviderManager';
import { modelRouter } from '@/core/models/ModelRouter';
import { registerUsable, unregister } from '@/core/models/local/LocalModelRegistry';
import { LocalGgufProvider } from '@/core/models/local/LocalGgufProvider';

// A file we KNOW exists on disk, used purely to satisfy detectLlamaRuntime's
// read-only existsSync check. It is NOT executable, so any real spawn fails fast.
const FAKE_RUNTIME = join(process.env.AKANSHA_HOME, 'fake-llama.bin');
writeFileSync(FAKE_RUNTIME, 'not-a-real-binary');
const HERE = FAKE_RUNTIME;

function resetProviders() {
  const pm = providerManager as any;
  pm.loaded = false;
  pm.providers.clear();
}

function seedUsable(id: string, text: string | undefined) {
  const entry: any = { id, file: id + '.gguf', url: '', sha256: 'a'.repeat(64), sizeBytes: 1, format: 'gguf', capabilities: ['chat'] };
  registerUsable(entry, 'C:/fake/' + id + '.gguf', text === undefined ? undefined : { genTps: 30, promptTps: 120, totalMs: 900, text });
}

test('no runtime configured -> local-llama is NOT registered (Vercel/server stays inert)', async () => {
  delete process.env.LLAMA_CPP_PATHS;
  unregister('m-noop');
  resetProviders();
  await providerManager.load();
  assert.equal(providerManager.get('local-llama'), undefined, 'must not register a local provider with no runtime path');
});

test('runtime present but NO usable entry -> local-llama NOT registered', async () => {
  process.env.LLAMA_CPP_PATHS = HERE; // detectLlamaRuntime only checks existence
  unregister('m-unusable');           // ensure no usable record for this id
  resetProviders();
  await providerManager.load();
  assert.equal(providerManager.get('local-llama'), undefined, 'must not register a local provider without a usable (inference-verified) model');
});

test('usable entry with empty output is NOT trusted (usable only after real inference)', async () => {
  process.env.LLAMA_CPP_PATHS = HERE;
  seedUsable('m-empty', '   '); // whitespace output -> provider treats as not usable
  resetProviders();
  await providerManager.load();
  assert.equal(providerManager.get('local-llama'), undefined, 'empty lastOutput must not register a provider');
  unregister('m-empty');
});

test('runtime + genuine usable entry -> local-llama registered as a AVAILABLE LocalGgufProvider', async () => {
  process.env.LLAMA_CPP_PATHS = HERE;
  seedUsable('m-good', 'verified ok'); // registry entries are only ever written after real inference
  resetProviders();
  await providerManager.load();
  const p = providerManager.get('local-llama');
  assert.ok(p, 'local-llama should be registered');
  assert.ok(p instanceof LocalGgufProvider, 'registered provider must be a LocalGgufProvider');
  assert.equal(p!.type, 'local');
  const health = await p!.healthCheck();
  assert.equal(health.state, 'AVAILABLE');
});

test('ModelRouter LOCAL_ONLY chain yields ONLY local-llama (OpenRouter excluded, no silent cloud)', async () => {
  process.env.LLAMA_CPP_PATHS = HERE;
  seedUsable('m-good', 'verified ok');
  resetProviders();
  await providerManager.load();

  // Register the discovered local model into the registry (mirrors initialize()
  // without touching the network — cloud listModels are never invoked here).
  const p = providerManager.get('local-llama')!;
  const models = await p.listModels();
  assert.ok(models.length > 0, 'usable local provider must list its model');
  for (const m of models) modelRouter.getRegistry().register(m);

  modelRouter.setPolicy('LOCAL_ONLY');
  const chain = await modelRouter.fallbackChain('question');
  assert.ok(chain.length > 0, 'there must be at least the local candidate');
  assert.ok(chain.every((c) => c.providerId === 'local-llama'), 'LOCAL_ONLY chain must contain only local providers');
  assert.ok(!chain.some((c) => c.providerId === 'openrouter'), 'OpenRouter must never appear under LOCAL_ONLY');

  // A real generation would need the actual binary; here the runtime path is just an
  // existing (non-executable) file, so local.generate() fails honestly and, under
  // LOCAL_ONLY, generateWithFallback must THROW rather than fall back to cloud.
  await assert.rejects(
    () => modelRouter.generateWithFallback({ messages: [{ role: 'user', content: 'hi' }] }, 'question'),
    (err: any) => typeof err.message === 'string' && !/openrouter/i.test(err.message),
    'offline must not silently route to OpenRouter'
  );
  unregister('m-good');
  modelRouter.setPolicy('BALANCED');
});
