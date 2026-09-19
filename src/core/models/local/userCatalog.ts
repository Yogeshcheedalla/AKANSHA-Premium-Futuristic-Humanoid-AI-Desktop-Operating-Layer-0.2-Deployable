/**
 * User trust catalog — the explicit "Trust & install" path for discovered
 * models that are NOT in the operator-signed catalog. This does NOT weaken the
 * security contract; it routes through the same evidence rules with the USER
 * as the approving authority:
 *
 *  • the pinned SHA-256 + size come from HuggingFace's OWN LFS record for the
 *    exact file (authoritative content hash from the source) — never inferred,
 *    never from the model name; a file without a real LFS sha256 is REFUSED;
 *  • architecture / params / context come from the repo's structured gguf
 *    metadata when present; anything absent stays honest (unknown → generic);
 *  • RAM/storage floors are the same conservative size-derived bounds used by
 *    the signed builder (bounds, not vendor claims);
 *  • installation still runs the FULL pipeline: download → SHA-256+GGUF
 *    integrity vs the pinned hash → real inference → measured benchmark →
 *    READY. Trust only opens the gate; it never shortcuts verification.
 *
 * Stored under the app's own home (data/user-model-catalog.json), never committed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CatalogModel, ModelFamily } from '@/core/catalog/ModelCatalog';

export interface TrustResult { ok: boolean; entry?: CatalogModel; selectedFile?: string; reason?: string }

function storePath(): string {
  return process.env.AKANSHA_HOME
    ? join(process.env.AKANSHA_HOME, 'data', 'user-model-catalog.json')
    : join(process.cwd(), 'data', 'akansha', 'data', 'user-model-catalog.json');
}

export function readUserCatalog(): CatalogModel[] {
  try {
    const p = storePath();
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(j.models) ? j.models : [];
  } catch { return []; }
}

function writeUserCatalog(models: CatalogModel[]): void {
  const p = storePath();
  try { mkdirSync(dirname(p), { recursive: true }); } catch { /* exists */ }
  writeFileSync(p, JSON.stringify({ updated: Date.now(), models }, null, 2), 'utf8');
}

export function listTrustedRepos(): Set<string> {
  return new Set(readUserCatalog().map((m) => repoOf(m).toLowerCase()));
}

export function untrustModel(id: string): void {
  writeUserCatalog(readUserCatalog().filter((m) => m.id !== id));
}

/** author/repo extracted from the pinned resolve URL. */
export function repoOf(m: { sourceUrl?: string }): string {
  const g = /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\//i.exec(m.sourceUrl || '');
  return g ? g[1] : '';
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const defaultFetcher: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'akansha-trust' }, signal: AbortSignal.timeout(15000) });
  return { ok: r.ok, status: r.status, json: () => r.json() };
};

const ARCH_FAMILY: [RegExp, ModelFamily][] = [
  [/^qwen/i, 'qwen'], [/^llama/i, 'llama'], [/^gemma/i, 'gemma'],
  [/^(mistral|mixtral)/i, 'mistral'], [/^phi/i, 'phi'],
];
const MAX_TRUST_BYTES = 8e9; // refuse to pin absurd artifacts through this path

/**
 * Trust one file of a GGUF repo: prefers Q4_K_M, then any Q4, then the
 * smallest real ≤8 GB artifact whose LFS record carries a genuine SHA-256.
 */
export async function trustModelRepo(
  repo: string,
  opts: { fetcher?: Fetcher; file?: string } = {},
): Promise<TrustResult> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const idPath = (repo || '').trim().split('/').map(encodeURIComponent).join('/');
  if (!/^[^/]+\/[^/]+$/.test((repo || '').trim())) return { ok: false, reason: 'repo must be "author/name"' };
  let res;
  try { res = await fetcher(`https://huggingface.co/api/models/${idPath}?blobs=true`); }
  catch (e: any) { return { ok: false, reason: 'fetch-failed:' + String(e?.message || e).slice(0, 100) }; }
  if (!res.ok) return { ok: false, reason: `hf-http-${res.status}` };
  let j: any;
  try { j = await res.json(); } catch { return { ok: false, reason: 'hf-invalid-json' }; }
  if (!j || typeof j !== 'object') return { ok: false, reason: 'hf-unexpected-shape' };

  const files: { rfilename: string; size: number; sha256: string }[] = (j.siblings || [])
    .filter((f: any) => typeof f?.rfilename === 'string' && /\.gguf$/i.test(f.rfilename))
    .map((f: any) => ({ rfilename: f.rfilename, size: Number(f.size ?? f.lfs?.size ?? 0), sha256: String(f.lfs?.sha256 || f.lfs?.oid || '').toLowerCase() }))
    .filter((f: any) => Number.isFinite(f.size) && f.size > 0 && /^[a-f0-9]{64}$/.test(f.sha256)); // REAL checksum or nothing
  if (!files.length) return { ok: false, reason: 'no GGUF artifact with a verifiable LFS SHA-256' };

  const wanted = opts.file ? files.filter((f) => f.rfilename === opts.file) : [];
  const pool = wanted.length ? wanted : files.filter((f) => f.size <= MAX_TRUST_BYTES);
  if (!pool.length) return { ok: false, reason: opts.file ? 'requested file not verifiable' : 'all artifacts exceed the 8 GB trust ceiling' };
  const pick = pool.find((f) => /q4_k_m/i.test(f.rfilename))
    || pool.find((f) => /q4/i.test(f.rfilename))
    || pool.sort((a, b) => a.size - b.size)[0];

  const g = (j.gguf && typeof j.gguf === 'object') ? j.gguf : {};
  const arch = typeof g.architecture === 'string' ? g.architecture : '';
  const family: ModelFamily = (ARCH_FAMILY.find(([re]) => re.test(arch)) || [null, 'other'])[1];
  const sizeGB = pick.size / 1e9;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const licenseTag = (Array.isArray(j.tags) ? j.tags : []).find((t: string) => t.startsWith('license:'));

  const entry: CatalogModel = {
    id: `user-${slug(repo)}-${slug(pick.rfilename.replace(/\.gguf$/i, ''))}`,
    family, version: 'user-trusted',
    parameters: Number.isFinite(g.total) && g.total > 0 ? `${(g.total / 1e9).toFixed(1)}B` : 'unknown',
    quantization: undefined, // never name-inferred
    format: 'gguf', downloadSizeBytes: pick.size, installedSizeBytes: pick.size,
    minimumRamGB: Math.ceil(sizeGB + 2), recommendedRamGB: Math.ceil(sizeGB * 1.3 + 3),
    minimumStorageGB: Math.ceil(sizeGB + 2),
    accelerationSupport: ['cpu'], platforms: ['win32', 'darwin', 'linux'], architecture: ['x64', 'arm64'],
    runtimeRequirement: 'llama.cpp',
    contextLength: Number.isFinite(g.context_length) && g.context_length > 0 ? Math.round(g.context_length) : 4096,
    capabilities: ['chat'],
    quality: { chat: 'Unknown', reasoning: 'Unknown', coding: 'Unknown' }, // no editorial claims here
    internetRequired: false,
    benchmark: { source: 'estimated' },
    license: j.cardData?.license || (licenseTag ? licenseTag.slice(8) : 'UNKNOWN'),
    sourceUrl: `https://huggingface.co/${repo.trim()}/resolve/main/${pick.rfilename}`,
    sha256: pick.sha256,
    signature: '', // user-approved local entry — trust is the approval itself, integrity is the pinned sha256
  };

  const list = readUserCatalog().filter((m) => m.id !== entry.id);
  list.push(entry);
  writeUserCatalog(list);
  return { ok: true, entry, selectedFile: pick.rfilename };
}
