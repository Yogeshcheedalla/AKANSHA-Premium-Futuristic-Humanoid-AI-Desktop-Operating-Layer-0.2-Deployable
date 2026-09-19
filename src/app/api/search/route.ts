import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { searchAndRetrieve, needsWebSearch } from '@/core/search/webSearch';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=…[&retrieve=1] — Akansha's web-search capability entry
 * (self-hosted SearXNG through the existing provider mesh). Status is derived
 * from REAL probes, never assumed: READY · DEGRADED · UNAVAILABLE. With
 * retrieve=1 the top sources are actually fetched and returned as citation
 * RECORDS (retrieval/content status per source). Results are UNTRUSTED data:
 * the client renders them as text/links and never executes anything inside.
 * currentInfoEligible reports the existing SearchDecision policy's verdict —
 * ordinary questions are deliberately not force-searched.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, error: 'q required' }, { status: 400 });
  const retrieve = params.get('retrieve') === '1';

  const answer = await searchAndRetrieve(q, { retrieveTop: retrieve ? 2 : 0 });
  return NextResponse.json({
    ok: answer.status !== 'UNAVAILABLE',
    status: answer.status,
    query: q,
    count: answer.results.length,
    results: answer.results,
    citations: retrieve ? answer.citations : [],
    summary: retrieve ? answer.summary : undefined,
    currentInfoEligible: needsWebSearch(q),
    reason: answer.reason,
  });
}
