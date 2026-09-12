import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { mcpRegistry, type MCPServerDef } from '@/core/mcp/MCPRegistry';
import { mcpClientManager } from '@/core/mcp/MCPClientManager';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/mcp            (authenticated) — list registered MCP servers + state.
 * POST /api/mcp            (admin)         — discover -> security-evaluate -> connect.
 *   body: MCPServerDef { serverId, name, transport, command/args|url, trustLevel,
 *                        declaredPermissions, sandboxed }
 *
 * Servers are never auto-trusted: unknown source or unsandboxed privileged
 * servers are BLOCKED and not connected.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    ok: true,
    servers: mcpRegistry.all().map((e) => ({
      serverId: e.serverId, name: e.name, transport: e.transport, state: e.state,
      trustLevel: e.trustLevel, sandboxed: e.sandboxed, declaredPermissions: e.declaredPermissions,
      tools: e.tools, connected: mcpClientManager.isConnected(e.serverId), lastError: e.lastError,
    })),
  });
}

export async function POST(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const body = (await request.json()) as MCPServerDef;
    if (!body?.serverId || !body?.transport) {
      return NextResponse.json({ ok: false, error: 'serverId and transport required' }, { status: 400 });
    }
    mcpRegistry.discover(body);
    const evaluation = mcpRegistry.evaluate(body.serverId);
    if (!evaluation.approved) {
      return NextResponse.json({ ok: false, status: 'BLOCKED', evaluation }, { status: 403 });
    }
    const conn = await mcpClientManager.connect(body.serverId);
    return NextResponse.json({ ok: conn.ok, status: conn.ok ? 'CONNECTED' : 'DISCONNECTED', evaluation, tools: conn.tools, error: conn.error });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
