/**
 * Map a persistence failure to an honest, actionable HTTP response. On a
 * packaged desktop install without DATABASE_URL the db proxy throws; provider
 * writes must then say "persistence is not configured" (503) instead of
 * surfacing a raw 500 — the same no-fake-success rule as everywhere else.
 */
import { NextResponse } from 'next/server';

export function providerError(e: unknown) {
  const msg = String((e as any)?.message || e);
  if (/DATABASE_URL is not set|persistence is disabled/i.test(msg)) {
    return NextResponse.json(
      { ok: false, error: 'Persistence is not configured on this install — provider changes need a DATABASE_URL (Settings → Persistence). Nothing was saved.' },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}
