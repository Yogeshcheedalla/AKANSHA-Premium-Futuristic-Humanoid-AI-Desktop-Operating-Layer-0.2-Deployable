/**
 * Model Discovery — a NEW capability that plugs into the existing Model Center.
 * It does NOT create a second orchestrator/catalog/installer: it discovers candidate
 * models from an authoritative registry (Hugging Face Hub, keyless public API),
 * normalizes them, and classifies each against the REAL device + runtime using the
 * same honest principle as everywhere else — INSTALL is only offered when a supported
 * format + runtime actually exist; nothing is faked.
 *
 * Download + integrity + inference + READY remain the existing ModelManager/Runtime
 * pipeline's job; discovery only answers "what exists, is it supported here, and where
 * does it come from."
 */
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import { buildFitReport, type FitFacts, type FitReport } from '@/core/catalog/CompatibilityEngine';

export interface DiscoveredModel {
  id: string;
  author: string;
  downloads: number;
  likes: number;
  tags: string[];
  isGguf: boolean;
  license?: string;
  repoUrl: string;
  source: 'huggingface';
}

/**
 * Real GGUF artifact metadata, read ONLY from structured fields of the Hugging
 * Face details API (gguf.architecture / gguf.total / gguf.context_length and
 * the per-file sibling sizes). Quantization is intentionally NOT inferred from
 * file names — an absent value stays undefined (UNKNOWN on the ladder).
 */
export interface GgufArtifactInfo {
  architecture?: string;
  parameters?: number;         // gguf.total — real parameter count
  contextLength?: number;      // gguf.context_length
  smallestArtifactBytes?: number; // smallest real GGUF file in the repo
  ggufFileCount: number;
  multimodal: boolean;         // vision/multimodal indicated by structured tags
}

export interface DeviceClassification {
  installable: boolean;
  formatSupported: boolean;
  runtimeSupported: boolean;
  reason: string;
}

export interface RankedDiscoveredModel extends DiscoveredModel {
  classification: DeviceClassification;
  artifact: GgufArtifactInfo | null;
  fit: FitReport;
}

export type JsonFetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetcher: JsonFetcher = async (url) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'akansha-model-discovery' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  return { ok: r.ok, status: r.status, json: () => r.json() };
};

/** Search Hugging Face Hub (public, no API key). Returns [] on any failure (offline-safe). */
export async function searchModels(
  query: string,
  opts: { fetcher?: JsonFetcher; limit?: number } = {},
): Promise<DiscoveredModel[]> {
  const q = (query || '').trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 50));
  const fetcher = opts.fetcher ?? defaultFetcher;
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=${limit}`;
  let res;
  try { res = await fetcher(url); } catch { return []; }
  if (!res || !res.ok) return [];
  let arr: unknown;
  try { arr = await res.json(); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return (arr as any[])
    .map((m): DiscoveredModel | null => {
      const id = String(m.modelId || m.id || '');
      if (!id) return null;
      const tags: string[] = Array.isArray(m.tags) ? m.tags.map(String) : [];
      const isGguf = tags.some((t) => /gguf/i.test(t)) || /gguf/i.test(id);
      const licenseTag = tags.find((t) => t.startsWith('license:'));
      return {
        id,
        author: id.split('/')[0] || String(m.author || ''),
        downloads: Number(m.downloads || 0),
        likes: Number(m.likes || 0),
        tags,
        isGguf,
        license: m.license || (licenseTag ? licenseTag.replace('license:', '') : undefined),
        repoUrl: `https://huggingface.co/${id}`,
        source: 'huggingface',
      };
    })
    .filter((x): x is DiscoveredModel => !!x);
}

/**
 * Honest per-device classification. INSTALL is offered only when the format is a
 * supported loader (GGUF) AND a local runtime is actually available. Size/hardware fit
 * is verified during the existing install pipeline — never fabricated here.
 */
export function classifyForDevice(m: DiscoveredModel, _hardware: HardwareProfile, runtimeAvailable: boolean): DeviceClassification {
  const formatSupported = m.isGguf;
  const runtimeSupported = runtimeAvailable;
  if (!formatSupported) return { installable: false, formatSupported, runtimeSupported, reason: 'Not a GGUF artifact — no supported loader for this format yet' };
  if (!runtimeSupported) return { installable: false, formatSupported, runtimeSupported, reason: 'No local llama.cpp runtime available on this device' };
  return { installable: true, formatSupported, runtimeSupported, reason: 'GGUF + local runtime available — installable (size/fit verified during install)' };
}

/**
 * Fetch REAL GGUF artifact metadata for one repo from the HF details API.
 * Only structured fields are read (gguf.*, sibling sizes, tags) — anything the
 * API does not state stays undefined. Returns null on ANY failure (offline,
 * 401/gated, 404, malformed) — the ladder then simply reports those rungs
 * UNKNOWN. Never throws.
 */
export async function fetchArtifactInfo(
  modelId: string,
  opts: { fetcher?: JsonFetcher } = {},
): Promise<GgufArtifactInfo | null> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  try {
    // HF rejects %2F-encoded repo ids (400 "Invalid repo name") — encode each
    // path segment separately and keep the separator. Verified live.
    const idPath = (modelId || '').split('/').map(encodeURIComponent).join('/');
    const res = await fetcher(`https://huggingface.co/api/models/${idPath}?blobs=true`);
    if (!res || !res.ok) return null;
    const j: any = await res.json();
    if (!j || typeof j !== 'object') return null;
    const gguf = (j.gguf && typeof j.gguf === 'object') ? j.gguf : {};
    const files: any[] = Array.isArray(j.siblings) ? j.siblings : [];
    const ggufFiles = files.filter((f) => typeof f?.rfilename === 'string' && /\.gguf$/i.test(f.rfilename));
    const sizes = ggufFiles.map((f) => Number(f.size)).filter((n) => Number.isFinite(n) && n > 0);
    const tags: string[] = Array.isArray(j.tags) ? j.tags.map(String) : [];
    const info: GgufArtifactInfo = {
      ggufFileCount: ggufFiles.length,
      multimodal: j.pipeline_tag === 'image-text-to-text' || tags.some((t) => /^(vision|multimodal|image)/i.test(t)),
    };
    if (typeof gguf.architecture === 'string' && gguf.architecture) info.architecture = gguf.architecture;
    if (Number.isFinite(gguf.total) && gguf.total > 0) info.parameters = Math.round(gguf.total);
    if (Number.isFinite(gguf.context_length) && gguf.context_length > 0) info.contextLength = Math.round(gguf.context_length);
    if (sizes.length) info.smallestArtifactBytes = Math.min(...sizes);
    return info;
  } catch {
    return null;
  }
}

/** Map a discovered model (+ real artifact metadata, if any) onto ladder facts. */
export function factsForDiscovered(m: DiscoveredModel, art: GgufArtifactInfo | null): FitFacts {
  return {
    modelId: m.id,
    family: m.author,
    format: m.isGguf ? 'gguf' : 'non-gguf', // confirmed absence of GGUF artifacts is real evidence → FAIL rung
    architecture: art?.architecture,
    parameters: art?.parameters,
    quantization: undefined, // HF exposes no authoritative per-file quantization — stays UNKNOWN
    fileSizeBytes: art?.smallestArtifactBytes,
    declaredTrusted: false, // discovery metadata is real but UNSIGNED: basis "measured", never "declared"
    declared: {
      // No vendor-declared RAM/VRAM/storage floors exist for discovery — the
      // ladder falls back to size-based ESTIMATED rungs or UNKNOWN, by design.
      runtime: m.isGguf ? 'llama.cpp' : undefined,
      contextLength: art?.contextLength,
      capabilities: art?.multimodal ? ['vision'] : undefined,
    },
  };
}

/** Discover + classify + rank (installable first, then popularity). */
export async function discoverAndRank(
  query: string,
  hardware: HardwareProfile,
  runtimeAvailable: boolean,
  opts: { fetcher?: JsonFetcher; limit?: number; enrich?: number } = {},
): Promise<RankedDiscoveredModel[]> {
  const models = await searchModels(query, opts);
  // Enrich the TOP candidates with real artifact metadata (sequential, bounded
  // — respect the upstream AND the request budget; absence of data only
  // widens the UNKNOWN rungs, it never blocks the answer).
  const enrich = Math.max(0, Math.min(opts.enrich ?? 0, models.length));
  const artifacts: (GgufArtifactInfo | null)[] = models.map(() => null);
  const deadline = Date.now() + 6000; // keep the route well inside serverless budgets
  for (let i = 0; i < enrich && Date.now() < deadline; i++) artifacts[i] = await fetchArtifactInfo(models[i].id, opts);

  const runtime = { available: runtimeAvailable, name: 'llama.cpp', supportsAcceleration: runtimeAvailable ? ['cpu'] : [] };
  const ranked = models.map((m, i) => ({
    ...m,
    artifact: artifacts[i],
    classification: classifyForDevice(m, hardware, runtimeAvailable),
    fit: buildFitReport(factsForDiscovered(m, artifacts[i]), hardware, runtime),
  }));
  return ranked.sort((a, b) =>
    Number(b.classification.installable) - Number(a.classification.installable)
    || VERDICT_RANK[a.fit.verdict] - VERDICT_RANK[b.fit.verdict]
    || b.downloads - a.downloads);
}

const VERDICT_RANK: Record<FitReport['verdict'], number> = { FIT: 0, POSSIBLE: 1, UNSUPPORTED: 2 };
