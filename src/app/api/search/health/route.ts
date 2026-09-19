import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { searxngSearch } from '@/core/web/SearXNGSearchProvider';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/health — REAL Web Search capability status for the UI badge.
 * READY requires a real search returning real results on the configured
 * SEARXNG_URL instance (cached ~20s); nothing is inferred from "container up".
 * UNAVAILABLE here NEVER affects local model availability.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const health = await searxngSearch.health();
  return NextResponse.json({ ok: true, health, capabilities: searxngSearch.capabilities() });
}
