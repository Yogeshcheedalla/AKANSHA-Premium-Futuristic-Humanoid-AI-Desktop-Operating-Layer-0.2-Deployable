import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTier, classifyGpu, toGB } from '@/core/runtime/HardwareProbe';
import { assessModel, selectLocalModel } from '@/core/models/local/LocalModelSelector';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 8,
  totalRamGB: 16, freeRamGB: 8, freeDiskGB: 40, gpu: { detected: false }, tier: 3, ...over,
});
const entry = (over: Partial<ManifestModelEntry> = {}): ManifestModelEntry => ({
  id: 'm', file: 'm.gguf', url: 'https://x/m.gguf', sha256: 'a'.repeat(64), sizeBytes: 1.1e9,
  format: 'gguf', capabilities: ['chat'], ...over,
});

test('hw: tier is driven by real RAM/disk, not assumed', () => {
  assert.equal(classifyTier({ totalRamGB: 32, freeDiskGB: 60 }), 4);
  assert.equal(classifyTier({ totalRamGB: 16, freeDiskGB: 40 }), 3);
  assert.equal(classifyTier({ totalRamGB: 2, freeDiskGB: 1 }), 0);
  assert.equal(toGB(1.234e9), 1.2);
});

test('hw: GPU is only claimed when a vendor is actually detected', () => {
  assert.deepEqual(classifyGpu('NVIDIA RTX 4060'), { detected: true, vendor: 'nvidia' });
  assert.deepEqual(classifyGpu('some unknown card'), { detected: false });
});

test('select: insufficient RAM => not installable, reason honest', () => {
  const a = assessModel(entry({ minimumRamGB: 32 }), hw({ totalRamGB: 16 }));
  assert.equal(a.status, 'INSUFFICIENT_RAM');
  assert.equal(a.installable, false);
});

test('select: insufficient storage => not installable', () => {
  const a = assessModel(entry({ sizeBytes: 4.9e9, minimumStorageGB: 8 }), hw({ freeDiskGB: 3 }));
  assert.equal(a.status, 'INSUFFICIENT_STORAGE');
  assert.equal(a.installable, false);
});

test('select: fits => CPU_ONLY (no GPU) and recommended id set', () => {
  const a = assessModel(entry(), hw({ gpu: { detected: false } }), { recommendedId: 'm' });
  assert.equal(a.status, 'RECOMMENDED');
  assert.equal(a.installable, true);
  const b = assessModel(entry({ id: 'other' }), hw({ gpu: { detected: false } }));
  assert.equal(b.status, 'CPU_ONLY');
});

test('select: recommends the best-fitting model; nothing fits => offlineReady false (no silent cloud)', () => {
  const big = entry({ id: 'qwen-1.5b', capabilities: ['chat'] });
  const bigger = entry({ id: 'qwen-7b', sizeBytes: 4.9e9, minimumStorageGB: 8, minimumRamGB: 16, capabilities: ['chat', 'reasoning', 'coding'] });
  const roomy = selectLocalModel([big, bigger], hw({ totalRamGB: 32, freeDiskGB: 60 }));
  assert.equal(roomy.offlineReady, true);
  assert.equal(roomy.recommendedId, 'qwen-7b'); // richer + fits
  const tiny = selectLocalModel([bigger], hw({ totalRamGB: 4, freeDiskGB: 5 }));
  assert.equal(tiny.offlineReady, false);
  assert.equal(tiny.recommendedId, null);
});

test('select: installed models report INSTALLED', () => {
  const r = selectLocalModel([entry({ id: 'm' })], hw(), ['m']);
  assert.equal(r.assessments[0].status, 'INSTALLED');
});
