import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { mcpRegistry } from '@/core/mcp/MCPRegistry';
import { mcpClientManager } from '@/core/mcp/MCPClientManager';
import { riskEngine } from '@/core/security/RiskEngine';
import { executionLedger } from '@/core/runtime/ExecutionLedger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/call   (SENSITIVE — auth + risk gate)
 *   body: { serverId, tool, args?, requestId? }
 *
 * Calls a tool on an already-connected, APPROVED MCP server. The result is
 * returned as evidence; the caller verifies it. A tool call is NOT success.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const serverId: string = body?.serverId;
    const tool: string = body?.tool;
    const args: Record<string, unknown> = body?.args || {};
    const requestId: string = body?.requestId || `mcp-${Date.now().toString(36)}`;
    if (!serverId || !tool) return NextResponse.json({ ok: false, error: 'serverId and tool required' }, { status: 400 });

    const entry = mcpRegistry.get(serverId);
    if (!entry) return NextResponse.json({ ok: false, error: 'server not registered' }, { status: 404 });
    if (entry.state !== 'CONNECTED') return NextResponse.json({ ok: false, error: `server not connected (state=${entry.state})` }, { status: 409 });

    // Risk gate the specific operation using the tool name + server permissions.
    const risk = riskEngine.assess(`${entry.name} ${tool}`, { confidence: 0.9 });
    if (risk.action === 'DENY') {
      return NextResponse.json({ ok: false, status: 'REFUSED', reason: risk.hardRuleTriggered || 'blocked' }, { status: 403 });
    }

    return await executionLedger.run(requestId, async () => {
      const result = await mcpClientManager.callTool(serverId, tool, args);
      return NextResponse.json({
        ok: result.ok,
        serverId, tool, requestId,
        latencyMs: result.latencyMs,
        content: result.content,
        error: result.error,
        verified: result.ok, // caller may add stronger verification
      });
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
