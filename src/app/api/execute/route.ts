import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { integrationManager } from '@/integrations/IntegrationManager';
import { riskEngine, escalationDecision } from '@/core/security/RiskEngine';
import { permissionEngine } from '@/core/execution/PermissionEngine';
import { executionPlanner } from '@/core/execution/ExecutionPlanner';
import { executionEngine } from '@/core/execution/ExecutionEngine';
import { windowsComputerUseProvider } from '@/core/execution/WindowsComputerUseProvider';
import { executionLedger } from '@/core/runtime/ExecutionLedger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/execute  { goal, requestId?, confirm? }   (SENSITIVE — auth required)
 *
 * Direct computer-execution endpoint. It never bypasses security: the request
 * must be authenticated AND authorized (sensitive), then the goal passes the
 * RiskEngine and PermissionEngine, and only then does it run through the real
 * execution backend. A COMPLETED status requires observed + verified evidence
 * for every step. NO EVIDENCE = NO SUCCESS.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;

  try {
    await integrationManager.initialize();
    const body = await request.json();
    const goal: string = (body?.goal || body?.text || '').toString().trim();
    const confirm: boolean = body?.confirm === true;
    const requestId: string =
      body?.requestId || `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (!goal) return NextResponse.json({ ok: false, error: 'goal required' }, { status: 400 });

    return await executionLedger.run(requestId, async () => {
      // 1. Risk gate.
      const risk = riskEngine.assess(goal, { confidence: 0.85 });
      const escalation = escalationDecision({ confidence: 0.85, risk });
      if (escalation.decision === 'REFUSE') {
        return NextResponse.json({
          ok: false, status: 'REFUSED', requestId, risk,
          error: `Refused by security policy: ${risk.hardRuleTriggered || risk.reasons.join(', ')}`,
        }, { status: 403 });
      }

      // 2. Provider availability (real capability check).
      if (!(await windowsComputerUseProvider.isAvailable())) {
        return NextResponse.json({
          ok: false, status: 'FAILED', requestId, failureClass: 'CAPABILITY_NOT_CONNECTED',
          error: 'The Windows computer-use backend is not available in this environment.',
        }, { status: 503 });
      }

      // 3. Plan.
      const plan = executionPlanner.plan(goal, risk.tier, [], false);
      if (!plan) {
        return NextResponse.json({
          ok: false, status: 'FAILED', requestId, failureClass: 'UNKNOWN_STATE',
          error: 'Could not derive a concrete, safe step plan from that goal.',
        }, { status: 400 });
      }

      // 4. Permission / confirmation gate.
      const perm = permissionEngine.evaluate(plan.steps.map((s) => s.action), risk.tier);
      plan.requiresConfirmation = perm.requiresConfirmation;
      const needsConfirm = perm.requiresConfirmation && !(escalation.decision === 'EXECUTE' || escalation.decision === 'EXECUTE_AND_NOTIFY');
      if (needsConfirm && !confirm) {
        return NextResponse.json({
          ok: false, status: 'NEEDS_CONFIRMATION', requestId, permissions: perm.permissions,
          plan: plan.steps.map((s) => s.description),
          error: 'This mutating desktop action requires explicit confirmation (send confirm:true).',
        }, { status: 202 });
      }

      // 5. Execute with observation + verification + evidence.
      const result = await executionEngine.execute(plan, windowsComputerUseProvider, { requestId, missionId: requestId });
      return NextResponse.json({
        ok: result.status === 'COMPLETED',
        status: result.status,
        requestId,
        principal: { role: guard.principal?.role, sub: guard.principal?.sub },
        risk: { action: risk.action, tier: risk.tier },
        permissions: perm.permissions,
        summary: result.summary,
        failureClass: result.failureClass || null,
        evidence: result.evidence,
      });
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
