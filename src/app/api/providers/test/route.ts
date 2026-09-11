import { NextResponse } from 'next/server';
import { providerManager } from '@/core/providers/ProviderManager';
import { modelRouter } from '@/core/models/ModelRouter';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Test a provider with REAL evidence: performs an actual health check and
 * model discovery. Never fabricates a success.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const providerId = body?.providerId;
    if (!providerId) return NextResponse.json({ ok: false, error: 'providerId required' }, { status: 400 });

    await providerManager.load();
    const { health, models } = await providerManager.testProvider(providerId);

    // Register discovered models so the router can use them immediately.
    for (const model of models) {
      modelRouter.getRegistry().register(model);
    }

    return NextResponse.json({
      ok: true,
      providerId,
      health,
      models: models.map((m) => ({
        id: m.id,
        displayName: m.displayName || m.id,
        capabilities: m.capabilities,
        contextWindow: m.contextWindow,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
