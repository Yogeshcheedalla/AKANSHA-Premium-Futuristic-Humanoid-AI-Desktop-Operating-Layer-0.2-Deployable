import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { memoryFabric, MEMORY_TYPES } from '@/core/memory/MemoryFabric';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory — the REAL contents of the running memory fabric (single
 * MemoryFabric singleton; no second store). TTL-expired records are dropped first,
 * so what is shown is exactly what Akansha can currently recall. Returns an honest
 * empty list until memories actually exist — nothing is fabricated here.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    memoryFabric.expire();
    const stats = memoryFabric.stats();

    const seen = new Set<string>();
    const items: Array<{
      memoryId: string; type: string; content: string; importance: number;
      confidence: number; sensitivity: string; trust: string; source: string;
      userAuthored: boolean; securityScanned: boolean; tags: string[];
      createdAt: number; updatedAt: number; expiresAt: number | null;
    }> = [];

    for (const type of MEMORY_TYPES) {
      for (const m of memoryFabric.byType(type, 50)) {
        if (seen.has(m.memoryId)) continue;
        seen.add(m.memoryId);
        items.push({
          memoryId: m.memoryId,
          type: m.type,
          content: m.content,
          importance: m.importance,
          confidence: m.confidence,
          sensitivity: m.sensitivity,
          trust: m.provenance.trustLevel,
          source: m.provenance.sourceType,
          userAuthored: m.provenance.userAuthored,
          securityScanned: m.provenance.securityScanned,
          tags: m.tags,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          expiresAt: m.expiresAt,
        });
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({
      ok: true,
      stats,
      working: stats.byType.working || 0,
      items: items.slice(0, 60),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'memory_unavailable' }, { status: 500 });
  }
}
