import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { providerBootstrap } from '@/core/providers/providerBootstrap';
import { systemDimensions } from '@/core/runtime/systemStatus';
import { freeRouteRegistry } from '@/core/routing/freeRouteRegistry';
import { fabricTrace } from '@/core/observability/fabricTrace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/runtime — the ONE authoritative AI-inference status the UI may
 * show. Derived only from live probes (provider health, local model registry),
 * never hard-coded. Cheap: results come from the bootstrap health cache; pass
 * ?refresh=1 to force fresh probes (used by AI Center's refresh).
 *
 * This deliberately separates AKANSHA-SYSTEM-ONLINE (this route answered)
 * from AI-INFERENCE-READY (status field) — the old header conflated them.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    await providerBootstrap.run(url.searchParams.get('refresh') === '1');
    const snapshot = providerBootstrap.currentView()!;
    const dimensions = systemDimensions(snapshot);
    return NextResponse.json({
      ok: true,
      dimensions,
      fabric: {
        note: 'Continuous Free Inference Fabric — many free providers with automatic routing + failover and local fallback. This is graceful degradation, NOT unlimited quota.',
        routes: freeRouteRegistry.dashboard(),
        failover: fabricTrace.failoverStats(),
      },
      ...snapshot,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'runtime status failed' }, { status: 500 });
  }
}
