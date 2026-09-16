import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isModelUsable, localHealth, detectLlamaRuntime, runLocalInference, LocalGgufProvider, localCapabilities } from '@/core/models/local/LocalGgufProvider';
import type { LocalModelState, LocalRuntime } from '@/core/models/local/LocalGgufProvider';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

const entry: ManifestModelEntry = { id: 'qwen', file: 'qwen.gguf', url: 'https://x/qwen.gguf', sha256: 'a'.repeat(64), sizeBytes: 10, format: 'gguf', capabilities: ['chat'] };
const state = (over: Partial<LocalModelState> = {}): LocalModelState => ({ entry, artifactPath: '/x/qwen.gguf', integrityVerified: false, inferenceVerified: false, ...over });
const noRuntime: LocalRuntime = { binaryPath: null, exists: false };

test('local gate: NOT usable without integrity AND a real inference output', () => {
  assert.equal(isModelUsable(state()), false);
  assert.equal(isModelUsable(state({ integrityVerified: true })), false);
  assert.equal(isModelUsable(state({ integrityVerified: true, inferenceVerified: true })), false); // no output
  assert.equal(isModelUsable(state({ integrityVerified: true, inferenceVerified: true, lastOutput: '  ' })), false); // whitespace
  assert.equal(isModelUsable(state({ integrityVerified: true, inferenceVerified: true, lastOutput: 'hello' })), true);
});

test('local health: honestly UNAVAILABLE with no runtime, DEGRADED until verified', () => {
  assert.equal(localHealth(state(), noRuntime).state, 'UNAVAILABLE');
  assert.equal(localHealth(state(), { binaryPath: '/llama', exists: true }).state, 'DEGRADED'); // integrity not verified
  assert.equal(localHealth(state({ integrityVerified: true, inferenceVerified: true, lastOutput: 'ok' }), { binaryPath: '/llama', exists: true }).state, 'AVAILABLE');
});

test('local runtime detection is read-only and reports missing as missing', () => {
  assert.deepEqual(detectLlamaRuntime(['/definitely/not/here/llama-cli', '']), { binaryPath: null, exists: false });
});

test('runLocalInference: refuses without a runtime (no fabricated text)', async () => {
  const r = await runLocalInference(noRuntime, '/x/qwen.gguf', 'hi');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'runtime-missing');
});

test('provider never lists models or generates until usable', async () => {
  const p = new LocalGgufProvider(state(), noRuntime);
  assert.deepEqual(await p.listModels(), []);
  await assert.rejects(() => p.generate({ messages: [{ role: 'user', content: 'x' }] }));
  // Honest capability claim: streaming/tools are OFF for CPU llama.cpp.
  const caps = localCapabilities();
  assert.equal(caps.streaming, false);
  assert.equal(caps.tools, false);
  assert.equal(caps.chat, true);
});
