import { NextResponse } from 'next/server';
import { providerManager } from '@/core/providers/ProviderManager';
import { modelRouter } from '@/core/models/ModelRouter';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const { id } = await ctx.params;
    const body = await request.json();
    const record = await providerManager.updateProvider(id, body);
    if (!record) return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 });
    return NextResponse.json({ ok: true, provider: record });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const { id } = await ctx.params;
    await providerManager.removeProvider(id);
    modelRouter.getRegistry().clearProvider(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
