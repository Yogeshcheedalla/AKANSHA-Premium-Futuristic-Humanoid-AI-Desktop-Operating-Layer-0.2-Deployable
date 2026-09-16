import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { getSetupViewModel } from '@/core/aiSetup/setupViewModel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/setup — the honest first-run + Model Center view model.
 * Composes real device/runtime/catalog/connection state. Returns NO secrets
 * (only masked/label data from connected services). Public because it exposes
 * only non-sensitive device + catalog metadata, so the first-run wizard can
 * render before login; mode/install remain authenticated/sensitive.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'public');
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ ok: true, setup: getSetupViewModel() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'setup failed' }, { status: 500 });
  }
}
