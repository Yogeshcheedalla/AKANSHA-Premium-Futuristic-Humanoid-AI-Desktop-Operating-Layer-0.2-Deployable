import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { masterOrchestrator } from '@/core/orchestration/MasterOrchestrator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/missions — the REAL active missions from the single MasterOrchestrator.
 * Reads the orchestrator's live mission map via getActiveMissions(); when none are
 * running it honestly returns an empty list (the panel shows "No active missions")
 * rather than the previous hardcoded demo missions.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const active = masterOrchestrator.getActiveMissions().map((m) => {
      const steps = m.steps || [];
      const running = steps.find((s) => s.status === 'RUNNING');
      const completed = steps.filter((s) => s.status === 'COMPLETED').length;
      return {
        id: m.id,
        goal: m.goal,
        status: m.status,
        stepCount: steps.length,
        completedSteps: completed,
        currentStep: running ? running.description : null,
        artifacts: m.artifacts?.length || 0,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ ok: true, active });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'missions_unavailable' }, { status: 500 });
  }
}
