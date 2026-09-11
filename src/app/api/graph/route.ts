import { NextResponse } from 'next/server';
import { integrationManager } from '@/integrations/IntegrationManager';
import { providerManager } from '@/core/providers/ProviderManager';
import { modelRouter } from '@/core/models/ModelRouter';
import { skillRegistry } from '@/core/skills/SkillRegistry';
import { capabilityGraph } from '@/core/capabilities/CapabilityRegistry';
import { mcpMesh } from '@/core/mcp/MCPMesh';
import { memoryIntelligence } from '@/core/memory/MemoryIntelligence';
import { learningEngine } from '@/core/learning/LearningEngine';
import { agentSupervisor } from '@/core/agents/AgentSupervisor';
import { db } from '@/db';
import { decisionTraces } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { eventBus } from '@/core/events/EventBus';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Single graph endpoint powering the spatial UI: capability graph, model
 * layer, memory graph, agent network, MCP mesh, and recent decision traces.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    await integrationManager.initialize();

    const providers = providerManager.getAll();
    const registry = modelRouter.getRegistry();
    const modelsByProvider = registry.countByProvider();

    const capabilityNodes = capabilityGraph.getAll().map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      permissions: c.permissions,
      latencyMs: c.latencyEstimateMs,
      reliability: c.reliabilityScore,
      available: c.available,
    }));

    const skillNodes = skillRegistry.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      providers: s.providers,
      riskLevel: s.riskLevel,
      reliability: s.reliabilityProfile,
      latencyMs: s.latencyProfile.typical,
      recentSuccessRate: s.learningHistory.length
        ? s.learningHistory.filter((h) => h.outcome === 'success').length / s.learningHistory.length
        : null,
    }));

    let traces: unknown[] = [];
    try {
      const rows = await db.select().from(decisionTraces).orderBy(desc(decisionTraces.createdAt)).limit(12);
      traces = rows.map((r) => ({
        traceId: r.traceId,
        requestId: r.requestId,
        kind: r.kind,
        candidates: r.candidates,
        selected: r.selected,
        reasons: r.reasons,
        createdAt: r.createdAt,
      }));
    } catch {
      traces = [];
    }

    const memoryStats = await memoryIntelligence.stats();

    return NextResponse.json({
      ok: true,
      models: {
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          models: modelsByProvider[p.id] || 0,
        })),
        totalModels: registry.listAll().length,
        policy: modelRouter.getPolicy(),
      },
      capabilities: capabilityNodes,
      skills: skillNodes,
      agents: agentSupervisor.getAgents().map((a) => ({
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        status: a.status,
        capabilities: a.capabilities,
        successRate: a.successRate,
      })),
      mcp: mcpMesh.getSummary(),
      mcpNodes: mcpMesh.getNodesByCategory('browser').concat(mcpMesh.getNodesByCategory('page-agent')).map((n) => ({
        serverId: n.serverId,
        name: n.name,
        health: n.health,
        latencyMs: n.latencyMs,
      })),
      memory: memoryStats,
      lessons: learningEngine.getLessons().slice(-8).map((l) => ({
        id: l.id,
        domain: l.domain,
        strategy: l.strategy,
        outcome: l.outcome,
        confidence: l.confidence,
      })),
      traces,
      events: eventBus.getHistory(25).map((e) => ({
        type: e.type,
        source: e.source,
        timestamp: e.timestamp,
        payload: e.payload,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
