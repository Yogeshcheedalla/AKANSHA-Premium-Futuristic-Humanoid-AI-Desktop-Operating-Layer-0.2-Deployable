import type { ExecutionStep, WindowObservation } from './types';

export interface VerificationOutcome {
  passed: boolean;
  method: string;
  detail: string;
}

/**
 * Execution Verifier — deterministic, cheapest-first verification of a step's
 * post-condition against the real observation. NO EVIDENCE = NO SUCCESS: a step
 * only counts as done when its expected state is actually observed.
 */
export class ExecutionVerifier {
  verify(step: ExecutionStep, obs: WindowObservation): VerificationOutcome {
    const expect = step.expect;
    if (!expect) {
      // No post-condition: the action itself succeeding (provider ok) is the evidence.
      return { passed: obs.found, method: 'action-ack', detail: obs.found ? 'action reported success' : 'action did not take effect' };
    }

    if (expect.windowTitleContains) {
      const needle = expect.windowTitleContains.toLowerCase();
      const passed = !!obs.title && obs.title.toLowerCase().includes(needle);
      return { passed, method: 'window-title', detail: `expected window title containing "${expect.windowTitleContains}", observed "${obs.title ?? 'none'}"` };
    }

    if (expect.appRunning) {
      const needle = expect.appRunning.toLowerCase();
      const passed = !!obs.title && obs.title.toLowerCase().includes(needle);
      return { passed, method: 'app-running', detail: `expected "${expect.appRunning}" window present, observed "${obs.title ?? 'none'}"` };
    }

    if (expect.textContains) {
      const passed = !!obs.text && obs.text.toLowerCase().includes(expect.textContains.toLowerCase());
      return { passed, method: 'visible-text', detail: `expected visible text to contain "${expect.textContains}", observed "${obs.text ?? ''}"` };
    }

    return { passed: obs.found, method: 'found', detail: obs.found ? 'window found' : 'window not found' };
  }
}

export const executionVerifier = new ExecutionVerifier();
