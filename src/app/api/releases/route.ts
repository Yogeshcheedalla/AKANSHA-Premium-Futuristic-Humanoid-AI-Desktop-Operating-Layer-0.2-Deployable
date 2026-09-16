import { NextResponse } from 'next/server';
import { getReleases } from '@/core/releases/releaseManifest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/releases — the single authoritative, truth-driven release manifest.
 * Availability is verified live (HEAD / 1-byte range) against configured artifact
 * URLs; nothing is invented. The public landing consumes this to decide whether a
 * platform button is a real download or an honest "Coming soon / Build required".
 */
export async function GET() {
  const { version, releases } = await getReleases(process.env);
  return NextResponse.json({ ok: true, version, releases });
}
