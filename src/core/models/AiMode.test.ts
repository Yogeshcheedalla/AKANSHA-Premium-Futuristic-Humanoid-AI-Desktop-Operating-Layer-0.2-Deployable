import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideAiMode } from '@/core/models/AiMode';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 8, totalRamGB: 16,
  freeRamGB: 8, freeDiskGB: 40, gpu: { detected: false }, tier: 3, ...over,
});
const chat: ManifestModelEntry = { id: 'qwen-1.5b', file: 'q.gguf', url: 'https://x/q.gguf', sha256: 'a'.repeat(64), sizeBytes: 1.1e9, format: 'gguf', capabilities: ['chat'] };

test('aimode: offline honored ONLY when a usable local model exists', () => {
  const d = decideAiMode({ mode: 'offline', hardware: hw(), catalog: [chat], usableLocalIds: ['qwen-1.5b'] });
  assert.equal(d.ok, true);
  assert.equal(d.mode, 'offline');
  assert.equal(d.policy, 'LOCAL_ONLY');
  assert.equal(d.fallbackUsed, false);
});

test('aimode: explicit offline with NO usable local model REFUSES (no silent cloud)', () => {
  const d = decideAiMode({ mode: 'offline', hardware: hw(), catalog: [chat], usableLocalIds: [] });
  assert.equal(d.ok, false);
  assert.equal(d.fallbackUsed, false);
  assert.match(d.reason, /refusing to silently use cloud/i);
});

test('aimode: cloud keeps existing resolution; local never overrides globally', () => {
  const d = decideAiMode({ mode: 'cloud', hardware: hw(), catalog: [chat], usableLocalIds: ['qwen-1.5b'] });
  assert.equal(d.mode, 'cloud');
  assert.equal(d.policy, 'CLOUD_ONLY');
});

test('aimode: auto prefers verified local; falls back to cloud ONLY with a stated reason', () => {
  const local = decideAiMode({ mode: 'auto', hardware: hw(), catalog: [chat], usableLocalIds: ['qwen-1.5b'] });
  assert.equal(local.mode, 'offline');
  assert.equal(local.fallbackUsed, false);
  const cloud = decideAiMode({ mode: 'auto', hardware: hw(), catalog: [chat], usableLocalIds: [] });
  assert.equal(cloud.mode, 'cloud');
  assert.equal(cloud.fallbackUsed, true);
});
