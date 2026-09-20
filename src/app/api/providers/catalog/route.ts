import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { FREE_PROVIDER_CATALOG } from '@/core/providers/freeProviderCatalog';
import { providerManager } from '@/core/providers/ProviderManager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/providers/catalog — the normalized FREE-TIER provider catalog
 * (sourced from mnfst/awesome-free-llm-apis at a pinned revision) enriched with
 * LIVE status from the existing ProviderManager. Catalog is metadata only:
 * nothing here connects, stores, or routes anything — connecting goes through
 * the existing POST /api/providers → CredentialVault → health-check path.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    await providerManager.load();
    const live = await providerManager.listRecords();
    const byUrl = new Map(live.map((r) => [(r.baseUrl || '').replace(/\/+$/, ''), r]));
    const byId = new Map(live.map((r) => [r.providerId, r]));
    const providers = FREE_PROVIDER_CATALOG.providers.map((p) => {
      const rec = byId.get(p.providerId) || byUrl.get(p.baseUrl.replace(/\/+$/, ''));
      return {
        ...p,
        status: !rec ? 'NOT_CONFIGURED'
          : rec.enabled === false ? 'DISABLED'
          : !rec.credentialConfigured && p.requiresKey === true ? 'CONFIGURED' /* key not stored yet */
          : (rec.health?.status || 'CONFIGURED'),
        connected: !!rec,
        providerRecordId: rec?.providerId ?? null,
      };
    });
    return NextResponse.json({
      ok: true,
      source: FREE_PROVIDER_CATALOG.source,
      sourceUrl: FREE_PROVIDER_CATALOG.sourceUrl,
      sourceRevision: FREE_PROVIDER_CATALOG.sourceRevision,
      checkedAt: FREE_PROVIDER_CATALOG.checkedAt,
      attribution: FREE_PROVIDER_CATALOG.attribution,
      providers,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'catalog failed', providers: [] }, { status: 200 });
  }
}
