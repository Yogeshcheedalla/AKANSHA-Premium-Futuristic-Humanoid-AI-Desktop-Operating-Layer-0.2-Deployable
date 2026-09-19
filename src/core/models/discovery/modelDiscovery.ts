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

export interface DeviceClassification {
  installable: boolean;
  formatSupported: boolean;
  runtimeSupported: boolean;
  reason: string;
}

export interface RankedDiscoveredModel extends DiscoveredModel {
  classification: DeviceClassification;
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

/** Discover + classify + rank (installable first, then popularity). */
export async function discoverAndRank(
  query: string,
  hardware: HardwareProfile,
  runtimeAvailable: boolean,
  opts: { fetcher?: JsonFetcher; limit?: number } = {},
): Promise<RankedDiscoveredModel[]> {
  const models = await searchModels(query, opts);
  return models
    .map((m) => ({ ...m, classification: classifyForDevice(m, hardware, runtimeAvailable) }))
    .sort((a, b) =>
      Number(b.classification.installable) - Number(a.classification.installable)
      || b.downloads - a.downloads);
}
