import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { agentSupervisor } from '@/core/agents/AgentSupervisor';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents — the REAL supervisor state from the single AgentSupervisor
 * (its live registry, resource budget, and whether dispatch is currently allowed).
 * Agents report their true status (idle/busy/paused/terminated); freshly seeded
 * agents are honestly 'idle', never a fabricated 'online/success'.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const agents = agentSupervisor.getAgents();
    return NextResponse.json({
      ok: true,
      agents: agents.map((a) => ({
        agentId: a.agentId, name: a.name, role: a.role,
        capabilities: a.capabilities, permissions: a.permissions,
        status: a.status, currentTask: a.currentTask ?? null,
        heartbeat: a.heartbeat ?? null,
        resourceUsage: a.resourceUsage ?? null,
        successRate: a.successRate,
      })),
      budget: agentSupervisor.getBudget(),
      canDispatch: agentSupervisor.canDispatch(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'agents_unavailable' }, { status: 500 });
  }
}
