/**
 * Model Center Search view mapping — pure + testable. Turns /api/models/search
 * results into cards, and gates INSTALL to models the EXISTING signed ModelManager
 * pipeline can actually handle (present in the catalog + classified installable).
 * A discovered model that isn't a signed, checksum-pinned catalog entry is shown
 * with its source + reason, never a fake one-click INSTALL.
 *
 * The hardware-fit LADDER (FIT / POSSIBLE / UNSUPPORTED with evidence) is shown
 * alongside installability — but they are DIFFERENT statements: fit is a forecast
 * from real metadata + the real device; INSTALL remains gated by the signed
 * catalog + ModelManager, and READY only follows a real inference test.
 */
import type { RankedDiscoveredModel } from '@/core/models/discovery/modelDiscovery';
import type { LifecycleView, ModelLifecycle, ModelAction } from '@/core/catalog/modelLifecycle';

/** Server row: discovery result + the authoritative lifecycle view from /api/models/search. */
export type SearchRow = RankedDiscoveredModel & { lifecycle?: LifecycleView; catalogModelId?: string | null };

export interface SearchCard {
  id: string;
  name: string;
  publisher: string;
  gguf: boolean;
  downloads: number;
  likes: number;
  license?: string;
  repoUrl: string;
  installable: boolean;
  installReason: string;
  /** Lifecycle state + the ONE action the UI may render (server-derived). */
  state: ModelLifecycle;
  action: ModelAction;
  stateReason: string;
  /** Catalog entry id when this repo is signed+checksum-pinned (install target). */
  catalogModelId: string | null;
  // Ladder display (never invented — 'Unknown' when metadata is absent):
  verdict: 'FIT' | 'POSSIBLE' | 'UNSUPPORTED';
  confidence: 'high' | 'moderate' | 'low';
  fitReasons: string[];
  parameters: string;      // e.g. '3.2B' or 'Unknown'
  architecture: string;    // e.g. 'llama' or 'Unknown'
  quantization: string;    // 'Unknown' unless authoritatively declared
  size: string;            // e.g. '0.75 GB (smallest GGUF)' or 'Unknown'
  context: string;         // e.g. '131072' or 'Unknown'
  runtime: string;         // 'llama.cpp' for GGUF, 'Unknown' otherwise
  multimodal: boolean;
}

const fmtParams = (n?: number) => (n ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : 'Unknown');
const fmtSize = (b?: number) => (b ? `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 2)} GB` : 'Unknown');

export function toSearchCards(results: SearchRow[], catalogModelIds: Iterable<string>): SearchCard[] {
  const catalog = new Set(catalogModelIds);
  return results.map((r) => {
    const inCatalog = catalog.has(r.id);
    const installable = inCatalog && r.classification.installable;
    const installReason = !inCatalog
      ? 'Not in Akansha’s signed catalog — one-click install needs a checksum-pinned entry. Open the source page to review.'
      : r.classification.reason;
    return {
      id: r.id,
      name: (r.id.split('/').pop() || r.id),
      publisher: r.author,
      gguf: r.isGguf,
      downloads: r.downloads,
      likes: r.likes,
      license: r.license,
      repoUrl: r.repoUrl,
      installable,
      installReason,
      verdict: r.fit.verdict,
      confidence: r.fit.confidence,
      fitReasons: r.fit.reasons.slice(0, 6),
      parameters: fmtParams(r.artifact?.parameters),
      architecture: r.artifact?.architecture || 'Unknown',
      quantization: 'Unknown', // HF exposes no authoritative per-file quantization — never name-guessed
      size: r.artifact?.smallestArtifactBytes ? `${fmtSize(r.artifact.smallestArtifactBytes)} (smallest GGUF)` : 'Unknown',
      context: r.artifact?.contextLength ? String(r.artifact.contextLength) : 'Unknown',
      runtime: r.isGguf ? 'llama.cpp' : 'Unknown',
      multimodal: !!r.artifact?.multimodal,
      // Server-derived lifecycle; if an older server build omits it, derive via
      // the SAME shared pure function (one contract, never a React re-implementation).
      state: r.lifecycle?.state ?? 'DISCOVERED',
      action: r.lifecycle?.action ?? 'review-source',
      stateReason: r.lifecycle?.reason ?? 'Found upstream; artifact metadata not yet verified.',
      catalogModelId: r.catalogModelId ?? null,
    };
  });
}
