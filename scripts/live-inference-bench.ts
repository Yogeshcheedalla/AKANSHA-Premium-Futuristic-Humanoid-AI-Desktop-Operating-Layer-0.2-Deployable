/**
 * LIVE inference benchmark — runs the ACTUAL Akansha production pipeline against a
 * real llama.cpp runtime and the real SIGNED production GGUF. NOT a unit test and
 * NOT run by `npm test`; it needs a desktop llama.cpp binary + the 1.1 GB model, so
 * it is a manual, evidence-producing harness.
 *
 *   signed catalog -> Ed25519 signature verify -> toManifestEntry ->
 *   verifyArtifact (SHA-256 + GGUF container) -> provisionAndVerify (REAL llama.cpp
 *   inference self-test) -> usable=true ->
 *   providerManager.load() [+ syncLocalProviders() runtime gate] ->
 *   MasterOrchestrator.createMission/runMission -> ModelRouter(LOCAL_ONLY) ->
 *   LocalGgufProvider -> llama.cpp -> generated tokens
 *
 * METRIC HONESTY: only values llama.cpp actually prints are reported (Prompt t/s,
 * Generation t/s, wall-clock ms). llama.cpp single-turn mode does NOT print absolute
 * token counts, so token counts are reported as NOT AVAILABLE and throughput is
 * NEVER derived/estimated from them. Exits non-zero if any real stage fails.
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Isolate the local-model registry to a fresh temp home BEFORE importing modules.
process.env.AKANSHA_HOME = mkdtempSync(join(tmpdir(), 'akan-bench-home-'));

const LLAMA_CLI = process.argv[2] || 'C:/Users/LENOVO/AppData/Local/Temp/akan-llama-live2/llama-cli.exe';
const MODEL_FILE = process.argv[3] || 'C:/Users/LENOVO/.qwenwork/workspace/mtwu90y10igbcx4a/chat-home/models/qwen2.5-1.5b-instruct-q4_k_m/qwen2.5-1.5b-instruct-q4_k_m.gguf';
const MODEL_ID = 'qwen2.5-1.5b-instruct-q4_k_m';
process.env.LLAMA_CPP_PATHS = LLAMA_CLI;

// A real, generative benchmark prompt (same for every iteration for comparability).
const BENCH_PROMPT = 'Explain in two short sentences what an operating system does.';
const ITERATIONS = 3;

function stats(vals: number[]) {
  if (!vals.length) return { min: null, max: null, avg: null, median: null };
  const s = [...vals].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { min: s[0], max: s[s.length - 1], avg: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)), median: med };
}

async function main() {
  const { loadCatalogForApp } = await import('@/core/catalog/catalogProvider');
  const { toManifestEntry } = await import('@/core/catalog/ModelCatalog');
  const { verifyArtifact, isChecksumVerified, checksumMatches } = await import('@/core/models/local/ModelIntegrity');
  const { provisionAndVerify, getUsableLocalModelIds } = await import('@/core/models/local/LocalModelRegistry');
  const { providerManager } = await import('@/core/providers/ProviderManager');
  const { modelRouter } = await import('@/core/models/ModelRouter');
  const { masterOrchestrator } = await import('@/core/orchestration/MasterOrchestrator');
  const { LocalGgufProvider } = await import('@/core/models/local/LocalGgufProvider');

  const t0 = Date.now();
  const result: Record<string, unknown> = {
    startedAt: new Date(t0).toISOString(),
    modelId: MODEL_ID,
    prompt: BENCH_PROMPT,
    iterations: ITERATIONS,
  };

  // ── STEP 2/3a: signed catalog + Ed25519 signature verification ────────────
  const catalog = loadCatalogForApp();
  result.catalogStatus = catalog.status;          // 'ready' => signature + metadata verified
  result.catalogReasons = catalog.reasons;
  if (catalog.status !== 'ready') throw new Error('signed catalog not ready: ' + catalog.status + ' ' + catalog.reasons.join(','));
  const catModel = catalog.models.find((m) => m.id === MODEL_ID);
  if (!catModel) throw new Error('model not in signed catalog');
  const entry = toManifestEntry(catModel);
  result.signedSha256 = entry.sha256;
  result.signedSizeBytes = entry.sizeBytes;
  result.catalogSignatureValid = catalog.status === 'ready';   // loadCatalogForApp validated the Ed25519 sig

  // ── STEP 3: model integrity (SHA-256 + GGUF container) on the real bytes ──
  if (!existsSync(MODEL_FILE)) throw new Error('model file not found on disk');
  const tRead = Date.now();
  const bytes = new Uint8Array(readFileSync(MODEL_FILE));
  result.modelReadMs = Date.now() - tRead;
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  result.actualSha256 = actualSha;
  result.sha256Valid = checksumMatches(actualSha, entry.sha256);
  result.sizeValid = bytes.length === entry.sizeBytes;
  result.checksumFormatValid = isChecksumVerified(entry);
  const art = verifyArtifact(entry, bytes);
  result.ggufValid = art.ok;
  result.ggufReasons = art.reasons;
  result.ggufVersion = art.header?.version;
  result.ggufTensors = art.header?.nTensors;
  result.overallIntegrity = result.sha256Valid && result.sizeValid && art.ok;
  if (!art.ok || !result.sha256Valid) throw new Error('integrity failed: ' + art.reasons.join(','));

  // ── STEP 7 + acceptance B/C: provisionAndVerify = a REAL inference self-test
  const pv = await provisionAndVerify({
    entry, artifactPath: MODEL_FILE,
    runtime: { binaryPath: LLAMA_CLI, exists: true },
    prompt: BENCH_PROMPT, maxTokens: 64, timeoutMs: 180000,
  });
  result.selfTestUsable = pv.usable;
  result.selfTestStage = pv.stage;
  result.selfTestMeasuredGenTps = pv.benchmark?.genTps ?? 'NOT AVAILABLE';
  result.selfTestMeasuredPromptTps = pv.benchmark?.promptTps ?? 'NOT AVAILABLE';
  result.selfTestTotalMs = pv.benchmark?.totalMs ?? 'NOT AVAILABLE';
  result.selfTestOutput = pv.benchmark?.text;
  result.usableIdsAfterSelfTest = getUsableLocalModelIds();
  if (!pv.usable) throw new Error('self-test did not yield usable model: ' + pv.reason);

  // ── STEP 4/5: real production provider wiring (runtime-gated) ─────────────
  await providerManager.load();
  const localProvider = providerManager.get('local-llama');
  result.localProviderRegistered = !!localProvider;
  if (!localProvider) throw new Error('syncLocalProviders did not register local-llama');
  const health = await localProvider.healthCheck();
  result.localProviderHealth = health.state;
  const isRealLocal = localProvider instanceof LocalGgufProvider;
  result.providerIsLocalGgufProvider = isRealLocal;

  const disc = await modelRouter.initialize();
  result.modelDiscovery = disc;
  // Force OFFLINE: only local providers may be considered. OpenRouter is filtered out.
  modelRouter.setPolicy('LOCAL_ONLY');
  result.routingPolicy = modelRouter.getPolicy();
  const chain = await modelRouter.fallbackChain('question');
  result.fallbackChainProviders = chain.map((c) => c.providerId);
  result.cloudProvidersInChain = chain.filter((c) => c.providerId !== 'local-llama').map((c) => c.providerId);
  await masterOrchestrator.initialize();

  // ── BENCHMARK: ≥3 iterations through the AUTHORITATIVE chain ──────────────
  const runs: any[] = [];
  for (let i = 1; i <= ITERATIONS; i++) {
    const mission = await masterOrchestrator.createMission(BENCH_PROMPT, { intent: 'question', requestId: `bench-${i}-${Date.now()}` });
    const r0 = Date.now();
    const done = await masterOrchestrator.runMission(mission.id);
    const wallMs = Date.now() - r0;
    // Read the REAL metrics the provider recorded from this genuine llama.cpp run.
    const m = isRealLocal ? (localProvider as InstanceType<typeof LocalGgufProvider>).getLastMetrics() : null;
    runs.push({
      run: i,
      missionStatus: done.status,
      providerUsed: done.context.model?.provider ?? null,
      modelUsed: done.context.model?.modelId ?? null,
      verified: !!done.context.verification?.verified,
      output: done.context.answer ?? done.context.reply ?? '',
      // wallMs includes model load (llama-cli loads the GGUF each process spawn).
      wallMs,
      genTps: m?.genTps ?? 'NOT AVAILABLE',
      promptTps: m?.promptTps ?? 'NOT AVAILABLE',
      generatedTokenCount: 'NOT AVAILABLE',
      promptTokenCount: 'NOT AVAILABLE',
    });
  }
  result.runs = runs;

  const allLocal = runs.every((r) => r.providerUsed === 'local-llama' && r.missionStatus === 'COMPLETED' && r.verified);
  const noCloud = runs.every((r) => r.providerUsed === 'local-llama');
  const nonEmpty = runs.every((r) => typeof r.output === 'string' && r.output.trim().length > 0);
  const wallVals = runs.map((r) => r.wallMs);
  const genVals = runs.map((r) => r.genTps).filter((v) => typeof v === 'number') as number[];
  const latency = stats(wallVals);
  const genTps = genVals.length ? stats(genVals) : null;
  result.latencyStats = latency;
  result.genTpsStats = genTps ?? 'NOT AVAILABLE (llama did not report generation t/s)';
  result.firstRunColdMs = wallVals[0] ?? null;
  result.warmRunsAvgMs = wallVals.length > 1 ? Number((wallVals.slice(1).reduce((a, b) => a + b, 0) / (wallVals.length - 1)).toFixed(2)) : 'NOT AVAILABLE';

  // ── STEP 6: OFFLINE independence — no OpenRouter, no cloud fallback ───────
  result.offlineNoCloudInChain = (result.cloudProvidersInChain as string[]).length === 0;
  result.offlineNoCloudFallbackOccurred = noCloud;
  result.offlineFinalState = allLocal ? 'LOCAL_INFERENCE_SUCCESS' : 'OFFLINE_AI_FAILURE';

  result.acceptanceA_pipeline = allLocal;
  result.acceptanceB_signedModelIntegrity = !!result.catalogSignatureValid && !!result.sha256Valid && !!result.ggufValid;
  result.acceptanceC_measuredBenchmark = runs.length >= 3 && latency.min != null;
  result.acceptanceD_offline = !!result.offlineNoCloudFallbackOccurred && allLocal;

  result.totalMs = Date.now() - t0;
  result.ok = !!(result.acceptanceA_pipeline && result.acceptanceB_signedModelIntegrity && result.acceptanceC_measuredBenchmark && result.acceptanceD_offline && nonEmpty && isRealLocal && health.state === 'AVAILABLE');

  // ── Human summary ─────────────────────────────────────────────────────────
  console.log('\n===== AKANSHA LIVE INFERENCE BENCHMARK =====');
  console.log(`catalog Ed25519 verify   : ${catalog.status.toUpperCase()}`);
  console.log(`signed  SHA-256          : ${entry.sha256}`);
  console.log(`actual  SHA-256          : ${actualSha}  -> match=${result.sha256Valid}  size ok=${result.sizeValid}`);
  console.log(`GGUF container           : valid=${art.ok} version=${art.header?.version} tensors=${art.header?.nTensors}`);
  console.log(`self-test (provisionAndVerify): usable=${pv.usable} gen=${result.selfTestMeasuredGenTps} tok/s prompt=${result.selfTestMeasuredPromptTps} tok/s totalMs=${pv.benchmark?.totalMs}`);
  console.log(`provider registered      : ${result.localProviderRegistered} type LocalGgufProvider=${result.providerIsLocalGgufProvider} health=${health.state}`);
  console.log(`routing policy / chain   : ${result.routingPolicy} -> [${(result.fallbackChainProviders as string[]).join(', ')}]`);
  console.log(`cloud providers in chain : ${JSON.stringify(result.cloudProvidersInChain)}`);
  runs.forEach((r) => {
    console.log(`  RUN ${r.run}: status=${r.missionStatus} provider=${r.providerUsed} verified=${r.verified} wall=${r.wallMs}ms gen=${r.genTps} tok/s prompt=${r.promptTps} tok/s`);
    console.log(`        out: ${JSON.stringify(String(r.output).slice(0, 160))}`);
  });
  console.log(`latency (wall ms incl load): min=${latency.min} max=${latency.max} avg=${latency.avg} median=${latency.median}`);
  console.log(`generation t/s (llama):    ${JSON.stringify(genTps ?? 'NOT AVAILABLE')}`);
  console.log(`cold start ms / warm avg ms: ${result.firstRunColdMs} / ${result.warmRunsAvgMs}`);
  console.log(`token counts (llama-cli):   NOT AVAILABLE (single-turn mode does not print them)`);
  console.log('ACCEPTANCE -> A(pipeline)=' + result.acceptanceA_pipeline + ' B(integrity)=' + result.acceptanceB_signedModelIntegrity + ' C(benchmark)=' + result.acceptanceC_measuredBenchmark + ' D(offline)=' + result.acceptanceD_offline);
  console.log('===========================================\n');
  console.log('BENCHMARK ' + JSON.stringify(result, null, 2));

  if (!result.ok) { console.error('BENCHMARK ACCEPTANCE NOT MET'); process.exit(2); }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('BENCHMARK FAILED:', e?.message || e);
  process.exit(1);
});
