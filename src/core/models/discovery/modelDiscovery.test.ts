import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchModels, classifyForDevice, discoverAndRank, fetchArtifactInfo, type JsonFetcher } from './modelDiscovery';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';

const hw = { platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 8, totalRamGB: 16, freeRamGB: 6, freeDiskGB: 100, gpu: { detected: false }, tier: 3 } as HardwareProfile;

const fetcherReturning = (arr: unknown): JsonFetcher => async () => ({ ok: true, status: 200, json: async () => arr });
const throwingFetcher: JsonFetcher = async () => { throw new Error('offline'); };
const notOkFetcher: JsonFetcher = async () => ({ ok: false, status: 429, json: async () => [] });

const sample = [
  { modelId: 'Qwen/Qwen2.5-Coder-7B-GGUF', downloads: 5000, likes: 40, tags: ['gguf', 'license:apache-2.0'] },
  { modelId: 'meta-llama/Llama-3-8B', downloads: 9000, likes: 100, tags: ['safetensors'] },
  { modelId: 'bartowski/Phi-3-mini-GGUF', downloads: 3000, likes: 20, tags: ['gguf'] },
];

test('empty query returns []', async () => {
  assert.deepEqual(await searchModels('   ', { fetcher: fetcherReturning(sample) }), []);
});

test('normalizes HF results + detects GGUF + license', async () => {
  const r = await searchModels('qwen', { fetcher: fetcherReturning(sample) });
  assert.equal(r.length, 3);
  const q = r.find((m) => m.id === 'Qwen/Qwen2.5-Coder-7B-GGUF')!;
  assert.equal(q.isGguf, true);
  assert.equal(q.author, 'Qwen');
  assert.equal(q.license, 'apache-2.0');
  assert.equal(q.repoUrl, 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-GGUF');
  assert.equal(r.find((m) => m.id === 'meta-llama/Llama-3-8B')!.isGguf, false);
});

test('offline / non-OK fetcher degrades to [] (never fabricates results)', async () => {
  assert.deepEqual(await searchModels('qwen', { fetcher: throwingFetcher }), []);
  assert.deepEqual(await searchModels('qwen', { fetcher: notOkFetcher }), []);
});

test('classify: GGUF + runtime => installable; no runtime => not; non-GGUF => not', () => {
  const gguf = { id: 'a/b-GGUF', author: 'a', downloads: 1, likes: 0, tags: ['gguf'], isGguf: true, repoUrl: 'x', source: 'huggingface' as const };
  const safetensors = { ...gguf, id: 'c/d', isGguf: false, tags: ['safetensors'] };
  assert.equal(classifyForDevice(gguf, hw, true).installable, true);
  const noRuntime = classifyForDevice(gguf, hw, false);
  assert.equal(noRuntime.installable, false);
  assert.match(noRuntime.reason, /runtime/i);
  const badFormat = classifyForDevice(safetensors, hw, true);
  assert.equal(badFormat.installable, false);
  assert.match(badFormat.reason, /GGUF|format/i);
});

test('discoverAndRank puts installable first, then by downloads', async () => {
  const ranked = await discoverAndRank('qwen', hw, true, { fetcher: fetcherReturning(sample) });
  assert.equal(ranked[0].classification.installable, true);
  assert.ok(ranked[0].id.includes('GGUF'));
  // non-gguf Llama (highest downloads) must rank BELOW installable GGUF models
  const llamaIdx = ranked.findIndex((m) => m.id === 'meta-llama/Llama-3-8B');
  const lastInstallable = ranked.map((m) => m.classification.installable).lastIndexOf(true);
  assert.ok(llamaIdx > lastInstallable, 'unsupported model ranked below installable ones');
});

/* ── hardware-fit ladder integration ────────────────────────────────────── */

const DETAILS = {
  gguf: { total: 3212749888, architecture: 'llama', context_length: 131072 },
  siblings: [
    { rfilename: 'x-Q2_K.gguf', size: 2300000000 },
    { rfilename: 'x-Q4_K_M.gguf', size: 4100000000 },
    { rfilename: 'README.md', size: 1000 },
  ],
  tags: ['gguf'],
};

const routingFetcher: JsonFetcher = async (url) => {
  const u = decodeURIComponent(url); // the real fetcher encodes "author/repo"
  return u.includes('/api/models/Qwen/Qwen2.5-Coder-7B-GGUF') || u.includes('/api/models/bartowski/Phi-3-mini-GGUF')
    ? { ok: true, status: 200, json: async () => DETAILS }
    : { ok: true, status: 200, json: async () => sample };
};

test('§14 ladder integration: enrich pulls REAL structured metadata and every row carries a fit report', async () => {
  const ranked = await discoverAndRank('qwen', hw, true, { fetcher: routingFetcher, enrich: 3 });
  assert.equal(ranked.length, 3);
  for (const m of ranked) assert.ok(m.fit && ['FIT', 'POSSIBLE', 'UNSUPPORTED'].includes(m.fit.verdict));

  const enriched = ranked.find((m) => m.artifact) !;
  assert.equal(enriched.artifact!.architecture, 'llama');           // real gguf.architecture
  assert.equal(enriched.artifact!.parameters, 3212749888);          // real gguf.total
  assert.equal(enriched.artifact!.smallestArtifactBytes, 2300000000); // real smallest .gguf sibling
  const arch = enriched.fit.rungs.find((r) => r.id === 'architecture')!;
  assert.equal(arch.status, 'PASS');
  assert.equal(arch.basis, 'measured'); // real metadata, unsigned → measured, never "declared"

  // non-GGUF repo: concrete FAIL evidence, ranked last regardless of popularity
  const llama = ranked.find((m) => m.id === 'meta-llama/Llama-3-8B')!;
  assert.equal(llama.fit.verdict, 'UNSUPPORTED');
  assert.match(llama.fit.rungs.find((r) => r.id === 'format')!.evidence, /no GGUF artifact/i);

  // quantization stays UNKNOWN despite screaming filenames (never name-guessed)
  assert.equal(enriched.fit.rungs.find((r) => r.id === 'quantization')!.status, 'UNKNOWN');
  // estimated RAM evidence ⇒ POSSIBLE ceiling, never FIT from discovery alone
  assert.notEqual(enriched.fit.verdict, 'FIT');
});

test('fetchArtifactInfo: null on failure/gated/non-object — ladder then stays UNKNOWN, never crashes', async () => {
  assert.equal(await fetchArtifactInfo('x/y', { fetcher: throwingFetcher }), null);
  assert.equal(await fetchArtifactInfo('x/y', { fetcher: notOkFetcher }), null);
  const junk = await fetchArtifactInfo('x/y', { fetcher: fetcherReturning('<html>login wall</html>') });
  assert.ok(!junk || junk.ggufFileCount === 0);
});
