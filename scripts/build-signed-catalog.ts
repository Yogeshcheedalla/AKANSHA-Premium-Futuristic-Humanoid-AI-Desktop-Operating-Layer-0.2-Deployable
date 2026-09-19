/**
 * Build + sign the PRODUCTION model catalog from live Hugging Face metadata.
 *
 * Honesty rules (enforced by this script, not just by review):
 *  • every entry's sizeBytes + sha256 come from the artifact's REAL LFS record
 *    on HuggingFace (authoritative content hash); an entry is REFUSED if the
 *    file, size or sha256 cannot be fetched — no placeholders, ever;
 *  • RAM/storage floors are operator-derived CONSERVATIVE bounds from the real
 *    file size (size + 2 GB minimum, size × 1.3 + 3 GB recommended) — a GGUF
 *    must at minimum fit in memory; they are bounds, not vendor claims;
 *  • quantization is NOT name-inferred — omitted unless separately verified;
 *  • benchmarks are left EMPTY (performance UNKNOWN) — only a real measured
 *    inference run may ever fill them, and that happens post-install.
 *
 * Usage:  npx tsx scripts/build-signed-catalog.ts
 * Writes: src/core/catalog/catalog.production.json (signed with .akansha-keys/catalog.private.pem)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sign as cryptoSign } from 'node:crypto';
import { canonicalJson } from '@/core/models/local/ModelIntegrity';
import { validateSignedCatalog, type CatalogModel, type ModelCatalog, type SignedCatalog } from '@/core/catalog/ModelCatalog';

const PUB_PEM = readFileSync('src/core/catalog/keys/catalog.pub.pem', 'utf8');
const PRIV_PEM = readFileSync('.akansha-keys/catalog.private.pem', 'utf8');
const sign = (obj: unknown) => cryptoSign(null, Buffer.from(canonicalJson(obj), 'utf8'), PRIV_PEM).toString('base64');

interface Spec {
  id: string; repo: string; file: string; family: CatalogModel['family']; version: string;
  parameters: string; capabilities: string[]; contextLength: number;
  quality: CatalogModel['quality']; bestFor: string; drawbacks: string; license?: string;
}

const SPECS: Spec[] = [
  { id: 'qwen2.5-coder-1.5b-instruct-q4_k_m', repo: 'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF', file: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf', family: 'qwen', version: '2.5-Coder', parameters: '1.5B', capabilities: ['coding', 'chat'], contextLength: 32768, quality: { chat: 'Medium', reasoning: 'Medium', coding: 'Good' }, bestFor: 'Lightweight local coding assistance', drawbacks: 'Small model — complex reasoning is limited' },
  { id: 'llama-3.2-1b-instruct-q4_k_m', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', family: 'llama', version: '3.2', parameters: '1.2B', capabilities: ['chat'], contextLength: 131072, quality: { chat: 'Medium', reasoning: 'Medium', coding: 'Medium' }, bestFor: 'Very fast general chat on low-end hardware', drawbacks: 'Smallest Llama — shallow reasoning' },
  { id: 'llama-3.2-3b-instruct-q4_k_m', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', family: 'llama', version: '3.2', parameters: '3.2B', capabilities: ['chat', 'reasoning'], contextLength: 131072, quality: { chat: 'Good', reasoning: 'Good', coding: 'Medium' }, bestFor: 'Balanced chat/reasoning on 16 GB machines', drawbacks: 'Noticeably slower than 1B on CPU' },
  { id: 'gemma-3-1b-it-q4_k_m', repo: 'ggml-org/gemma-3-1b-it-GGUF', file: 'gemma-3-1b-it-Q4_K_M.gguf', family: 'gemma', version: '3', parameters: '1B', capabilities: ['chat'], contextLength: 32768, quality: { chat: 'Medium', reasoning: 'Medium', coding: 'Medium' }, bestFor: 'Tiny multilingual chat', drawbacks: 'Small context-friendly model, limited depth' },
  { id: 'qwen3-4b-q4_k_m', repo: 'Qwen/Qwen3-4B-GGUF', file: 'Qwen3-4B-Q4_K_M.gguf', family: 'qwen', version: '3', parameters: '4B', capabilities: ['chat', 'reasoning'], contextLength: 40960, quality: { chat: 'Good', reasoning: 'Good', coding: 'Medium' }, bestFor: 'Strong reasoning for its size (thinking mode)', drawbacks: '~2.5 GB download; slower on pure CPU' },
  { id: 'llama-3.1-8b-instruct-q4_k_m', repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', family: 'llama', version: '3.1', parameters: '8B', capabilities: ['chat', 'reasoning', 'coding'], contextLength: 131072, quality: { chat: 'Good', reasoning: 'Good', coding: 'Good' }, bestFor: 'Best quality that still fits 16 GB RAM (CPU)', drawbacks: '~4.9 GB download; token speed is modest on CPU' },
];

async function fetchDetails(repo: string) {
  const path = repo.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`https://huggingface.co/api/models/${path}?blobs=true`, { headers: { 'User-Agent': 'akansha-catalog-builder' } });
  if (!r.ok) throw new Error(`${repo}: HTTP ${r.status}`);
  return await r.json() as any;
}

async function main() {
  // KEEP existing entries (e.g. the already-installed+verified model) — merge,
  // never replace; a rebuilt catalog must not orphan installed registry records.
  const models: CatalogModel[] = [];
  try {
    const prev = JSON.parse(readFileSync('src/core/catalog/catalog.production.json', 'utf8')) as SignedCatalog;
    for (const m of prev.catalog?.models || []) models.push(m);
  } catch { /* first build */ }
  const known = new Set(models.map((m) => m.id));
  for (const s of SPECS) {
    if (known.has(s.id)) { console.log(`KEEP ${s.id} (already in catalog)`); continue; }
    let j: any;
    try { j = await fetchDetails(s.repo); } catch (e: any) { console.log(`SKIP ${s.id}: ${e.message}`); continue; }
    const sib = (j.siblings || []).find((f: any) => f.rfilename === s.file);
    const size = Number(sib?.size ?? sib?.lfs?.size);
    const sha = String(sib?.lfs?.sha256 || sib?.lfs?.oid || '');
    if (!Number.isFinite(size) || size <= 0) { console.log(`SKIP ${s.id}: no real size from HF`); continue; }
    if (!/^[a-f0-9]{64}$/i.test(sha)) { console.log(`SKIP ${s.id}: no real sha256 from HF`); continue; }
    const sizeGB = size / 1e9;
    const license = s.license || (j.cardData?.license ?? j.tags?.find((t: string) => t.startsWith('license:'))?.slice(8) ?? 'UNKNOWN');
    const entry: CatalogModel = {
      id: s.id, family: s.family, version: s.version, parameters: s.parameters,
      quantization: undefined, // never name-inferred
      format: 'gguf', downloadSizeBytes: size, installedSizeBytes: size,
      minimumRamGB: Math.ceil(sizeGB + 2), recommendedRamGB: Math.ceil(sizeGB * 1.3 + 3),
      minimumStorageGB: Math.ceil(sizeGB + 2),
      accelerationSupport: ['cpu'], platforms: ['win32', 'darwin', 'linux'], architecture: ['x64', 'arm64'],
      runtimeRequirement: 'llama.cpp', contextLength: s.contextLength, capabilities: s.capabilities,
      quality: s.quality, bestFor: s.bestFor, drawbacks: s.drawbacks, internetRequired: false,
      benchmark: { source: 'estimated' }, // no numbers: UNKNOWN until measured
      license, sourceUrl: `https://huggingface.co/${s.repo}/resolve/main/${s.file}`, sha256: sha.toLowerCase(),
      signature: '',
    } as CatalogModel;
    const { signature: _x, ...body } = entry;
    entry.signature = sign(JSON.parse(JSON.stringify(body))); // sign the persisted form
    models.push(entry);
    console.log(`OK   ${s.id}  size=${size}  sha=${sha.slice(0, 12)}…`);
  }
  if (!models.length) { console.error('No models could be verified — refusing to write a catalog.'); process.exit(1); }

  const catalog: ModelCatalog = { schema: 'akansha/model-catalog/1', version: 1, issuedAt: Date.now(), models };
  // Sign the EXACT persisted form: JSON round-trip drops `undefined` keys so
  // the canonical bytes signed here match the canonical bytes readers parse.
  const clean = JSON.parse(JSON.stringify(catalog)) as ModelCatalog;
  const signed: SignedCatalog = { catalog: clean, signatureBase64: sign(clean) };
  const v = validateSignedCatalog(signed, PUB_PEM);
  if (!v.ok) { console.error('Self-check failed:', v.reasons); process.exit(1); }
  writeFileSync('src/core/catalog/catalog.production.json', JSON.stringify(signed, null, 2));
  // Post-write check: re-read the FILE (exactly what the app's static import
  // will parse) and validate its signature — not just the in-memory object.
  const reread = JSON.parse(readFileSync('src/core/catalog/catalog.production.json', 'utf8')) as SignedCatalog;
  const v2 = validateSignedCatalog(reread, PUB_PEM);
  if (!v2.ok) { console.error('POST-WRITE verification failed:', v2.reasons); process.exit(1); }
  console.log(`\nWROTE signed catalog with ${models.length} models — signature self-check PASSED (in-memory + re-read-from-file).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
