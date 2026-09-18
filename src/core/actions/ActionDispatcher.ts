import { executionLedger } from '@/core/runtime/ExecutionLedger';
import { riskEngine } from '@/core/security/RiskEngine';
import { eventBus } from '@/core/events/EventBus';
import { actionRegistry, type ActionRegistry } from './ActionRegistry';
import { verify, requireObservedEvidence } from './VerificationEngine';
import type { ActionRequest, ActionResult, ActionFailure } from './types';

/**
 * ActionDispatcher — the single reusable execution path for a capability:
 *   authorize (existing RiskEngine) → execute → VERIFY (evidence) → recover → event.
 *
 * It is a SUBSTRATE, not a second orchestrator: it composes the existing
 * ExecutionLedger (idempotency), RiskEngine (hard rules), and EventBus. Higher-level
 * flows (MasterOrchestrator, command/execute routes) may delegate to it. A result is
 * COMPLETED only when a verification strategy observed real evidence.
 */
export class ActionDispatcher {
  constructor(private registry: ActionRegistry = actionRegistry) {}

  async dispatch(req: ActionRequest): Promise<ActionResult> {
    const startedAt = Date.now();
    const contract = this.registry.get(req.actionId);
    if (!contract) {
      return { actionId: req.actionId, requestId: req.requestId, status: 'UNAVAILABLE', startedAt, completedAt: Date.now(),
        failure: { code: 'UNKNOWN', stage: 'dispatch', message: `No action registered: ${req.actionId}`, retryable: false } };
    }

    return executionLedger.run(req.requestId, async () => {
      const fail = (code: ActionFailure['code'], stage: string, message: string, retryable: boolean): ActionResult =>
        ({ actionId: req.actionId, requestId: req.requestId, status: 'FAILED', startedAt, completedAt: Date.now(), failure: { code, stage, message, retryable } });

      // 1. Authorize via the EXISTING RiskEngine (hard rules cannot be overridden).
      if (contract.riskDescription) {
        const hard = riskEngine.hardRule(contract.riskDescription);
        if (hard && hard.action === 'DENY') return fail('PERMISSION_DENIED', 'authorize', hard.reason, false);
      }
      if (contract.requiresConfirmation && !req.confirmed) {
        return { actionId: req.actionId, requestId: req.requestId, status: 'AUTH_REQUIRED', startedAt, completedAt: Date.now(),
          failure: { code: 'AUTH_REQUIRED', stage: 'authorize', message: 'Action requires explicit user confirmation', retryable: false } };
      }

      this.emit('action.started', req);
      // 2. Execute the real operation.
      let exec = await contract.execute(req);
      // 3. VERIFY — evidence only.
      let v = verify(contract.verify || requireObservedEvidence, exec);
      // 4. One safe recovery attempt on a retryable failure.
      if (!v.verified && contract.recover) {
        const failure: ActionFailure = exec.failure || { code: 'VERIFICATION_FAILED', stage: 'verify', message: v.reason || 'not verified', retryable: true };
        if (failure.retryable) {
          const recovered = await contract.recover(req, failure);
          if (recovered) { exec = recovered; v = verify(contract.verify || requireObservedEvidence, recovered); }
        }
      }
      const completedAt = Date.now();

      if (v.verified) {
        this.emit('action.verified', req, { method: v.method });
        this.emit('action.completed', req, { evidence: exec.evidence?.summary });
        return { actionId: req.actionId, requestId: req.requestId, status: 'COMPLETED', startedAt, completedAt, output: exec.output, evidence: exec.evidence, verification: v };
      }
      const failure: ActionFailure = exec.failure || { code: 'VERIFICATION_FAILED', stage: 'verify', message: v.reason || 'Verification failed — no evidence of success', retryable: false };
      this.emit('action.failed', req, { code: failure.code, stage: failure.stage });
      return { actionId: req.actionId, requestId: req.requestId, status: 'FAILED', startedAt, completedAt, output: exec.output, evidence: exec.evidence, verification: v, failure };
    });
  }

  private emit(type: 'action.started' | 'action.progress' | 'action.output' | 'action.verified' | 'action.completed' | 'action.failed', req: ActionRequest, payload: Record<string, unknown> = {}) {
    try { eventBus.emit(type, 'ActionFabric', { actionId: req.actionId, ...payload }, { requestId: req.requestId, missionId: req.missionId }); } catch { /* events are best-effort */ }
  }
}

export const actionDispatcher = new ActionDispatcher();
