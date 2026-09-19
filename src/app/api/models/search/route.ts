import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { discoverAndRank } from '@/core/models/discovery/modelDiscovery';
import { loadCatalogForApp } from '@/core/catalog/catalogProvider';
import { getUsableLocalModelIds } from '@/core/models/local/LocalModelRegistry';
import { activeJobFor } from '@/core/catalog/installJobs';
import { deriveLifecycle, type LifecycleView } from '@/core/catalog/modelLifecycle';

export const dynamic = 'force-dynamic';

/** Map signed catalog entries (which pin a FILE) to the REPO they came from. */
export function catalogRepoMap(models: { sourceUrl?: string; id: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of models) {
    const g = /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\//i.exec(m.sourceUrl || '');
    if (g) map.set(g[1].toLowerCase(), m.id);
  }
  return map;
}

/**
 * GET /api/models/search?q=...  — Model Discovery (Hugging Face Hub, keyless).
 * Every row carries the ONE authoritative lifecycle view (state + permitted
 * action + reason) derived SERVER-side from: real artifact metadata, the
 * compatibility ladder, signed-catalog trust, runtime presence, active install
 * jobs and the usable registry. Discovery never pretends "found" means
 * "installable", and the UI never re-implements this contract.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, error: 'q required' }, { status: 400 });
  try {
    const hardware = detectHardwareLive();
    const rt = runtimeFor(detectRuntimes({}).find((r) => r.adapter.name === 'llama.cpp'));
    const results = await discoverAndRank(q, hardware, rt.available, { limit: 12, enrich: 6 });
    const catalog = loadCatalogForApp(process.env);
    // Catalog entries pin a specific FILE inside a repo; discovery rows are
    // REPOS. Match them so a signed repo can show an honest INSTALL action.
    const catalogRepos = catalogRepoMap(catalog.models || []);
    const usable = new Set(getUsableLocalModelIds());
    const rows = results.map((r) => {
      const catalogModelId = catalogRepos.get(r.id.toLowerCase());
      const lifecycle: LifecycleView = deriveLifecycle({
        verdict: r.fit.verdict,
        format: r.isGguf ? 'gguf' : r.artifact ? 'non-gguf' : undefined,
        inSignedCatalog: !!catalogModelId,
        metadataVerified: !!r.artifact,
        runtimeAvailable: rt.available,
        job: catalogModelId ? activeJobFor(catalogModelId) ?? undefined : undefined,
        usable: !!catalogModelId && usable.has(catalogModelId),
      });
      return { ...r, catalogModelId, lifecycle };
    });
    return NextResponse.json({ ok: true, query: q, runtimeAvailable: rt.available, count: rows.length, results: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'discovery failed', results: [] }, { status: 200 });
  }
}
