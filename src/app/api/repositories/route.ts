import { NextResponse } from 'next/server';
import { repositoryRegistry } from '@/core/repositories/RepositoryRegistry';
import { integrationMatrix } from '@/integrations/registry/IntegrationMatrix';
import { capabilityGraph } from '@/core/capabilities/CapabilityRegistry';
import { skillRegistry } from '@/core/skills/SkillRegistry';
import { integrationManager } from '@/integrations/IntegrationManager';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Exposes the canonical repository registry: layers, integration status,
 * the derived pipeline, browser escalation ladder, and security gates.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    await integrationManager.initialize();
    const sync = integrationMatrix.syncCapabilities();

    return NextResponse.json({
      ok: true,
      stats: repositoryRegistry.stats(),
      layers: repositoryRegistry.byLayer().map((l) => ({
        layer: l.layer,
        label: l.label,
        description: l.description,
        integrated: l.integrated,
        adapterReady: l.adapterReady,
        rejected: l.rejected,
        repositories: l.repositories.map((r) => ({
          id: r.id,
          slug: r.slug,
          url: r.url,
          name: r.name,
          description: r.description,
          status: r.status,
          integrationMode: r.integrationMode,
          roleInAkansha: r.roleInAkansha,
          capabilitiesProvided: r.capabilitiesProvided,
          permissions: r.permissions,
          sandboxRequired: r.sandboxRequired,
          windowsCompatible: r.windowsCompatible,
          fallbackFor: r.fallbackFor || [],
          notes: r.notes,
          rejectionReason: r.rejectionReason,
        })),
      })),
      pipeline: integrationMatrix.pipeline().map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        capabilities: s.capabilities,
        repositories: s.repositories.map((r) => ({ id: r.id, name: r.name, status: r.status })),
      })),
      escalation: integrationMatrix.escalationLadder().map((r) => ({
        level: r.level,
        label: r.label,
        reason: r.reason,
        repository: r.repository ? { id: r.repository.id, name: r.repository.name, status: r.repository.status } : null,
      })),
      securityGates: integrationMatrix.securityGates().map((g) => ({
        repository: g.repository.name,
        slug: g.repository.slug,
        sandboxRequired: g.sandboxRequired,
        highPrivilege: g.highPrivilege,
        permissions: g.permissions,
      })),
      rejections: integrationMatrix.rejections().map((r) => ({
        name: r.name,
        slug: r.slug,
        reason: r.rejectionReason,
      })),
      live: {
        capabilitiesRegistered: capabilityGraph.getAll().length,
        skillsRegistered: skillRegistry.getAll().length,
        synced: sync,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
