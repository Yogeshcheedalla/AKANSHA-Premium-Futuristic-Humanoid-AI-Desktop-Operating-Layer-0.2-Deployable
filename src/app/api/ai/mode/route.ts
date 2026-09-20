import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { applyAiMode } from '@/core/models/AiModeApply';
import type { AiMode } from '@/core/models/AiMode';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/mode { mode: 'offline'|'cloud'|'both'|'auto' }
 * Applies the user's AI-mode choice to the EXISTING ModelRouter (policy) and returns
 * an honest decision. It NEVER silently falls back to cloud for an 'offline' choice
 * that can't be satisfied — offlineReady:false + reason are returned instead.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || 'auto') as AiMode;
    if (!['offline', 'cloud', 'both', 'auto'].includes(mode)) {
      return NextResponse.json({ ok: false, error: 'invalid mode' }, { status: 400 });
    }
    const r = applyAiMode(mode);
    return NextResponse.json({
      ok: true,
      ...r,
      noSilentCloudFallback: mode === 'offline' ? !r.fallbackUsed : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'mode failed' }, { status: 500 });
  }
}
