import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { discoverAndRank } from '@/core/models/discovery/modelDiscovery';

export const dynamic = 'force-dynamic';

/**
 * GET /api/models/search?q=...  — Model Discovery (Hugging Face Hub, keyless).
 * Returns candidate models classified AND ladder-fitted against the REAL device
 * + runtime (Hardware-Fit Ladder — an extension of the same CompatibilityEngine,
 * read from real structured HF artifact metadata where available). This is a
 * capability plugged under the existing Model Center; it does not replace it and
 * does not perform installs (that stays with ModelManager/RuntimeManager).
 * INSTALL is only flagged when a supported format + runtime actually exist.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, error: 'q required' }, { status: 400 });
  try {
    const hardware = detectHardwareLive();
    const rt = runtimeFor(detectRuntimes({}).find((r) => r.adapter.name === 'llama.cpp'));
    const results = await discoverAndRank(q, hardware, rt.available, { limit: 12, enrich: 6 });
    return NextResponse.json({ ok: true, query: q, runtimeAvailable: rt.available, count: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'discovery failed', results: [] }, { status: 200 });
  }
}
