import { NextResponse } from 'next/server';
import { integrationManager } from '@/integrations/IntegrationManager';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const status = await integrationManager.initialize();
    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
