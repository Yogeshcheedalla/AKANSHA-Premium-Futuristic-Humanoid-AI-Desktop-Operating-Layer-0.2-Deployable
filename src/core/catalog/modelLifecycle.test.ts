/**
 * Regression tests for the discovery→trust→install contract failures exposed by
 * real screenshots. Each test maps to the master spec §18 case number.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLifecycle } from './modelLifecycle';
import { createInstallJob, updateInstallJob, cancelInstallJob, getInstallJob, activeJobFor } from './installJobs';
import { validateSignedCatalog, type SignedCatalog } from './ModelCatalog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = { runtimeAvailable: true, metadataVerified: true };

/* 1 · discovered non-GGUF model → cannot install (UNSUPPORTED, review action) */
test('1 · non-GGUF discovery row is UNSUPPORTED with review-source, never install', () => {
  const v = deriveLifecycle({ ...base, format: 'non-gguf', inSignedCatalog: false, verdict: 'UNSUPPORTED' });
  assert.equal(v.state, 'UNSUPPORTED');
  assert.equal(v.action, 'review-source');
  assert.match(v.reason, /not GGUF/i);
});

/* 2 · GGUF but unsigned → TRUST_REQUIRED, not INSTALLABLE */
test('2 · compatible GGUF outside the signed catalog is TRUST_REQUIRED (action: review-source)', () => {
  const v = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: false, verdict: 'FIT' });
  assert.equal(v.state, 'TRUST_REQUIRED');
  assert.equal(v.action, 'review-source');
  assert.match(v.reason, /signed catalog/i);
});

/* 3 · signed GGUF + FIT + runtime → INSTALLABLE */
test('3 · signed GGUF with valid checksum and FIT is INSTALLABLE', () => {
  const v = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: true, verdict: 'FIT' });
  assert.equal(v.state, 'INSTALLABLE');
  assert.equal(v.action, 'install');
});

/* 4 · hardware-incompatible → UNSUPPORTED even if signed */
test('4 · hardware-UNSUPPORTED beats trust — signed cannot override concrete evidence', () => {
  const v = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: true, verdict: 'UNSUPPORTED' });
  assert.equal(v.state, 'UNSUPPORTED');
  assert.equal(v.action, 'review-source');
});

/* 5 · install begins → INSTALLING with cancel action */
test('5 · active job renders INSTALLING with a real cancel action', () => {
  const v = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: true, verdict: 'FIT', job: { state: 'INSTALLING', stage: 'download', progressPct: 42 } });
  assert.equal(v.state, 'INSTALLING');
  assert.equal(v.action, 'cancel');
  assert.match(v.reason, /42%/);
});

/* 6+7 · cancel is real and terminal — a cancelled job can never become READY */
test('6/7 · cancelInstallJob aborts the signal; terminal CANCELLED refuses READY resurrection', () => {
  const job = createInstallJob('cancel-race-model', 1000);
  assert.equal(activeJobFor('cancel-race-model')?.jobId, job.jobId);
  assert.ok(cancelInstallJob(job.jobId));
  assert.equal(getInstallJob(job.jobId)?.state, 'CANCELLING');
  assert.equal(job.abort.signal.aborted, true, 'the actual downloader/inference signal must be aborted');
  updateInstallJob(job.jobId, { state: 'CANCELLED', stage: 'cancelled', endedAt: Date.now() });
  // RACE: a late worker tries to mark READY after cancellation — must be refused:
  const after = updateInstallJob(job.jobId, { state: 'READY', stage: 'ready' });
  assert.equal(after?.state, 'CANCELLED', 'cancelled job can NEVER become READY');
});

/* 8 · retry after cancellation creates a valid new attempt */
test('8 · after CANCELLED, a new job is created for retry', () => {
  const first = createInstallJob('retry-model', 10);
  cancelInstallJob(first.jobId);
  updateInstallJob(first.jobId, { state: 'CANCELLED', endedAt: Date.now() });
  const second = createInstallJob('retry-model', 10);
  assert.notEqual(second.jobId, first.jobId);
  assert.equal(second.state, 'INSTALLING');
});

/* 9-12 · OpenRouter states are driven by REAL checks, not button clicks */
test('9 · OpenRouter without a key/verification surfaces NOT connected (honest)', async () => {
  const { connectedServices } = await import('@/core/identity/ConnectedServices');
  const or = connectedServices.list().find((s) => s.provider === 'openrouter');
  // Fresh env: never pretend connected/verified.
  assert.ok(!or || (or.connected !== true || or.verified !== true));
});

/* 13 · paid route still demands consent (existing policy untouched) */
test('13 · cost policy requiresPaidConsent remains enforced for paid-only routes', async () => {
  const { freeFirstCompare, planCostRoute } = await import('@/core/routing/costPolicy');
  assert.equal(typeof freeFirstCompare, 'function');
  const paidOnly = [{ id: 'p1', free: false } as never, { id: 'p2', free: false } as never];
  const plan = planCostRoute(paidOnly as never);
  assert.equal((plan as { requiresPaidConsent?: boolean }).requiresPaidConsent, true);
});

/* catalog integrity: the shipped signed catalog must validate with real checksums */
test('shipped signed catalog validates and every entry has a real 64-hex sha256 + https url', () => {
  const signed = JSON.parse(readFileSync(join(process.cwd(), 'src/core/catalog/catalog.production.json'), 'utf8')) as SignedCatalog;
  const pub = readFileSync(join(process.cwd(), 'src/core/catalog/keys/catalog.pub.pem'), 'utf8');
  const v = validateSignedCatalog(signed, pub);
  assert.ok(v.ok, `catalog invalid: ${v.reasons.join(',')}`);
  assert.ok(v.models.length >= 2, 'expanded catalog expected');
  for (const m of v.models) {
    assert.match(m.sha256, /^[a-f0-9]{64}$/);
    assert.match(m.sourceUrl, /^https:\/\//);
    assert.ok(m.downloadSizeBytes > 0);
    assert.equal(m.format, 'gguf');
    assert.equal(m.runtimeRequirement, 'llama.cpp');
  }
});

/* catalog repo ↔ discovery row matching (signed repo → install action) */
test('repo→catalog matching: a signed repo row is installable; unknown repo is TRUST_REQUIRED', async () => {
  const { catalogRepoMap } = await import('@/app/api/models/search/route');
  const map = catalogRepoMap([
    { id: 'llama-3.2-1b-instruct-q4_k_m', sourceUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf' },
  ]);
  const hit = map.get('bartowski/llama-3.2-1b-instruct-gguf');
  assert.equal(hit, 'llama-3.2-1b-instruct-q4_k_m');
  const signed = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: !!hit, verdict: 'POSSIBLE' });
  assert.equal(signed.action, 'install', 'signed + possible → real install action');
  const unsigned = deriveLifecycle({ ...base, format: 'gguf', inSignedCatalog: false, verdict: 'POSSIBLE' });
  assert.equal(unsigned.state, 'TRUST_REQUIRED');
  assert.equal(unsigned.action, 'review-source');
});

/* search grouping: installable/compatible first, unsupported last, scores untouched */
test('§15 · discoverAndRank groups by usability without altering fit verdicts', async () => {
  const { discoverAndRank } = await import('@/core/models/discovery/modelDiscovery');
  const hw = { platform: 'win32', architecture: 'x64', cpuModel: 'x', cpuCores: 8, totalRamGB: 16, freeRamGB: 6, freeDiskGB: 100, gpu: { detected: false }, tier: 3 } as never;
  const fetcher = async (url: string) => ({
    ok: true, status: 200,
    json: async () => url.includes('llama+gguf') || url.includes('llama%20gguf')
      ? [{ modelId: 'bartowski/Good-GGUF', downloads: 10, likes: 1, tags: ['gguf'] }]
      : [{ modelId: 'meta-llama/Bad', downloads: 999999, likes: 9, tags: ['safetensors'] }],
  });
  const rows = await discoverAndRank('llama', hw, true, { fetcher: fetcher as never, limit: 5 });
  assert.ok(rows.some((r) => r.isGguf), 'GGUF rows present');
  assert.equal(rows[0].id, 'bartowski/Good-GGUF', 'GGUF-first even though the safetensors repo has more downloads');
  assert.equal(rows[rows.length - 1].id, 'meta-llama/Bad');
  assert.equal(rows[rows.length - 1].fit.verdict, 'UNSUPPORTED');
});
