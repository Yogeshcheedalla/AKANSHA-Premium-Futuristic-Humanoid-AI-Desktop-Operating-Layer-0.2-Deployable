import type { ComputerUseProvider } from './types';
import type { ExecutionPlan, ExecutionResult, ExecutionEvidence, WindowObservation, ComputerAction } from './types';
import { executionVerifier } from './ExecutionVerifier';
import { executionRecovery } from './ExecutionRecovery';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execution Engine — runs a plan against a real ComputerUseProvider and enforces
 * NO EVIDENCE = NO SUCCESS: a mission is COMPLETED only if every step's
 * post-condition was actually observed and verified. Produces structured
 * evidence for every action. Idempotent per toolCallId.
 */
export class ExecutionEngine {
  private completed = new Set<string>();

  private async applyAction(provider: ComputerUseProvider, action: ComputerAction): Promise<WindowObservation> {
    switch (action.kind) {
      case 'launch':
        return provider.launch(action.app);
      case 'focus':
        return provider.focus(action.target);
      case 'observe':
        return provider.observe(action.target);
      case 'type':
        return provider.type(action.text, action.target);
      case 'key':
        return provider.key(action.keys, action.target);
      case 'click':
        return provider.click(action.target, action.double);
      case 'scroll':
        return provider.scroll(action.direction, action.amount, action.target);
      case 'listWindows':
        return { found: true, windows: await provider.listWindows() };
      case 'screenshot':
        return provider.observe();
      default:
        return { found: false };
    }
  }

  async execute(
    plan: ExecutionPlan,
    provider: ComputerUseProvider,
    ctx: { requestId: string; missionId: string }
  ): Promise<ExecutionResult> {
    const evidence: ExecutionEvidence[] = [];
    const maxAttempts = 3;

    for (const step of plan.steps) {
      const toolCallId = `${ctx.missionId}:${step.id}`;
      if (this.completed.has(toolCallId)) {
        // Idempotent: a duplicate logical step is never executed twice.
        continue;
      }

      step.status = 'EXECUTING';
      let obs: WindowObservation = { found: false };
      let verified = { passed: false, method: 'none', detail: 'not attempted' };
      let attempts = 0;
      let lastErr: string | undefined;

      while (attempts < maxAttempts) {
        attempts++;
        step.attemptCount = attempts;
        const startedAt = Date.now();
        try {
          obs = await this.applyAction(provider, step.action);
        } catch (e: any) {
          lastErr = e?.message;
          obs = { found: false };
        }

        step.status = 'OBSERVING';
        // For state-changing window actions, re-observe to read back real state,
        // but never clobber a good observation the action already returned.
        const observeTarget = (step.action as any).target || (step.action as any).app;
        const shouldReobserve =
          !!step.expect &&
          obs.found &&
          ['type', 'key', 'click', 'scroll'].includes(step.action.kind) &&
          !!observeTarget;
        if (shouldReobserve) {
          try {
            const fresh = await provider.observe(observeTarget);
            if (fresh.found) obs = { ...obs, found: true, title: fresh.title ?? obs.title, text: fresh.text ?? obs.text };
            else if (fresh.text) obs = { ...obs, text: fresh.text };
          } catch {
            /* keep the action's own observation */
          }
        }

        step.status = 'VERIFYING';
        verified = executionVerifier.verify(step, obs);

        const ev: ExecutionEvidence = {
          requestId: ctx.requestId,
          missionId: ctx.missionId,
          toolCallId,
          action: step.action.kind,
          target: (step.action as any).target || (step.action as any).app || (step.action as any).text || '',
          startedAt,
          completedAt: Date.now(),
          observation: obs,
          verification: verified,
          status: verified.passed ? 'ok' : 'failed',
          failureReason: verified.passed ? undefined : verified.detail || lastErr,
          provider: provider.id,
          attempts,
        };
        evidence.push(ev);
        step.evidence = ev;

        if (verified.passed) {
          step.status = 'DONE';
          this.completed.add(toolCallId);
          break;
        }

        const failureClass = executionRecovery.classify(lastErr, obs.found);
        const recovery = executionRecovery.decide(failureClass, attempts, maxAttempts);
        if (recovery.action === 'fail') {
          step.status = 'FAILED';
          ev.failureClass = failureClass;
          return {
            status: 'FAILED',
            summary: `Step "${step.description}" failed (${failureClass}): ${verified.detail || lastErr || 'no evidence of effect'}`,
            evidence,
            failureClass,
          };
        }
        await sleep(recovery.delayMs);
      }

      if (step.status !== 'DONE') {
        return {
          status: 'FAILED',
          summary: `Step "${step.description}" could not be verified after ${attempts} attempts.`,
          evidence,
          failureClass: 'VERIFICATION_FAILED',
        };
      }
    }

    return {
      status: 'COMPLETED',
      summary: `All ${plan.steps.length} step(s) executed and verified with real evidence.`,
      evidence,
    };
  }
}

export const executionEngine = new ExecutionEngine();
