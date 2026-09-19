/**
 * Target-machine model READY verification — runs the REAL LocalModelRegistry
 * provisionAndVerify pipeline (integrity → real llama.cpp inference → persistent
 * registerUsable) against the already-downloaded signed GGUF, writing to the app's
 * real dev registry (data/akansha/…, gitignored). Produces genuine READY evidence,
 * not the temp-home bench. Read-only use of the runtime binary.
 *   npm run db:runtimecheck is the DB one; this is: npx tsx scripts/verify-model-ready.ts
 */
import { existsSync } from 'node:fs';
import { loadCatalogForApp } from '@/core/catalog/catalogProvider';
import { toManifestEntry } from '@/core/catalog/ModelCatalog';
import { provisionAndVerify, readUsable } from '@/core/models/local/LocalModelRegistry';

const GGUF = process.argv[2] || 'C:/Users/LENOVO/.qwenwork/workspace/mtwu90y10igbcx4a/chat-home/models/qwen2.5-1.5b-instruct-q4_k_m/qwen2.5-1.5b-instruct-q4_k_m.gguf';
const LLAMA = process.argv[3] || 'C:/Users/LENOVO/Desktop/Akansha-source/data/akansha/runtime/llama/llama-cli.exe';
const MODEL_ID = 'qwen2.5-1.5b-instruct-q4_k_m';

async function main() {
  if (!existsSync(GGUF)) { console.log('GGUF missing:', GGUF); process.exit(1); }
  if (!existsSync(LLAMA)) { console.log('llama-cli missing:', LLAMA); process.exit(1); }
  const cat = loadCatalogForApp(process.env);
  if (cat.status !== 'ready') { console.log('catalog not ready:', cat.status); process.exit(1); }
  const model = cat.models.find((m) => m.id === MODEL_ID);
  if (!model) { console.log('model not in catalog'); process.exit(1); }
  const entry = toManifestEntry(model);

  console.log('Running REAL provisionAndVerify (integrity → inference → registerUsable)…');
  const res = await provisionAndVerify({
    entry,
    artifactPath: GGUF,
    runtime: { binaryPath: LLAMA, exists: true } as any,
    prompt: 'Reply with exactly: AKANSHA OFFLINE ORCHESTRATION READY',
    maxTokens: 24,
    timeoutMs: 90000,
  });
  console.log('provisionAndVerify:', JSON.stringify(res, null, 1));

  const usable = readUsable();
  const rec = usable.find((u) => u.id === MODEL_ID);
  console.log('\nPersistent registry read-back:', rec ? `READY — ${rec.id} sha=${rec.sha256.slice(0, 12)}… gen=${rec.benchmark?.genTps} t/s prompt=${rec.benchmark?.promptTps} t/s text="${(rec.benchmark?.text || '').slice(0, 60)}"` : 'NOT registered');
  console.log(`\nModel Center READY: ${res.ok && res.usable && rec ? 'VERIFIED (real inference + measured benchmark + persisted)' : 'NOT VERIFIED'}`);
  process.exit(res.ok && res.usable && rec ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
