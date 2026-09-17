import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectModel } from '@/core/models/ModelSelectionPolicy';

const hardware = { platform: 'win32', architecture: 'x64', cpuCores: 8, ramGB: 16, freeDiskGB: 200, gpu: { detected: false }, tier: 2 } as any;
const chat = [{ id: 'qwen-1.5b', file: 'q.gguf', url: 'https://x/q.gguf', sha256: 'a'.repeat(64), sizeBytes: 1.1e9, format: 'gguf', capabilities: ['chat'], minimumRamGB: 4 }] as any;
const LOCAL = ['qwen-1.5b'];

test('sensitive task with a verified local model is pinned to LOCAL (never cloud)', () => {
  const d = selectModel({ mode: 'both', hardware, catalog: chat, usableLocalIds: LOCAL, sensitive: true, networkAvailable: true });
  assert.equal(d.decision, 'LOCAL');
  assert.equal(d.policy, 'LOCAL_ONLY');
  assert.equal(d.privacy, 'sensitive');
});

test('sensitive task with NO local model refuses cloud (honest failover, no leak)', () => {
  const d = selectModel({ mode: 'both', hardware, catalog: chat, usableLocalIds: [], sensitive: true, networkAvailable: true });
  assert.equal(d.decision, 'FAILOVER');
  assert.equal(d.policy, 'LOCAL_ONLY');
  assert.equal(d.fallbackAvailable, false);
  assert.match(d.reason, /refusing to send to cloud/i);
});

test('current-information task goes ONLINE when the network is up', () => {
  const d = selectModel({ mode: 'auto', hardware, catalog: chat, usableLocalIds: LOCAL, requiresCurrentInfo: true, networkAvailable: true });
  assert.equal(d.decision, 'ONLINE');
  assert.equal(d.policy, 'PREFERRED_CLOUD');
});

test('current-information task with no network fails honestly (local cannot fetch live data)', () => {
  const d = selectModel({ mode: 'auto', hardware, catalog: chat, usableLocalIds: LOCAL, requiresCurrentInfo: true, networkAvailable: false });
  assert.equal(d.decision, 'FAILOVER');
  assert.equal(d.fallbackAvailable, false);
});

test('latency-sensitive + verified local prefers LOCAL', () => {
  const d = selectModel({ mode: 'both', hardware, catalog: chat, usableLocalIds: LOCAL, latencySensitive: true, networkAvailable: true });
  assert.equal(d.decision, 'LOCAL');
});

test('explicit cloud mode defers to the authoritative AiMode (ONLINE)', () => {
  const d = selectModel({ mode: 'cloud', hardware, catalog: chat, usableLocalIds: LOCAL, networkAvailable: true });
  assert.equal(d.decision, 'ONLINE');
  assert.equal(d.policy, 'CLOUD_ONLY');
});

test('offline mode with a usable model is LOCAL', () => {
  const d = selectModel({ mode: 'offline', hardware, catalog: chat, usableLocalIds: LOCAL });
  assert.equal(d.decision, 'LOCAL');
  assert.equal(d.policy, 'LOCAL_ONLY');
});
