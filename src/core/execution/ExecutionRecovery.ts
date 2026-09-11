import type { FailureClass } from './types';

export interface RecoveryDecision {
  action: 'retry' | 'wait' | 'refocus' | 'reobserve' | 'fail';
  delayMs: number;
  reason: string;
}

/**
 * Execution Recovery — classify a failure and choose a bounded recovery.
 * Never loops forever: callers cap attempts via the resource/step attempt count.
 */
export class ExecutionRecovery {
  classify(err: string | undefined, obsFound: boolean): FailureClass {
    const e = (err || '').toLowerCase();
    if (!obsFound && /not found|no window|window not/.test(e)) return 'WINDOW_NOT_FOUND';
    if (/permission|denied|unauthorized/.test(e)) return 'PERMISSION_DENIED';
    if (/timeout|timed out/.test(e)) return 'TIMEOUT';
    if (/not installed|cannot find|app not/.test(e)) return 'APP_NOT_FOUND';
    if (/element/.test(e)) return 'ELEMENT_NOT_FOUND';
    if (/network|dns|econn/.test(e)) return 'NETWORK_ERROR';
    if (/provider|powershell|spawn/.test(e)) return 'PROVIDER_ERROR';
    if (!obsFound) return 'WINDOW_NOT_FOUND';
    return 'UNKNOWN_STATE';
  }

  decide(failureClass: FailureClass, attempts: number, maxAttempts = 3): RecoveryDecision {
    if (attempts >= maxAttempts) {
      return { action: 'fail', delayMs: 0, reason: `recovery budget exhausted after ${attempts} attempts` };
    }
    switch (failureClass) {
      case 'TIMEOUT':
      case 'WINDOW_NOT_FOUND':
        // The window may still be coming up — wait and re-observe.
        return { action: 'wait', delayMs: 800, reason: 'window may still be initializing; re-observe' };
      case 'UI_CHANGED':
      case 'ELEMENT_NOT_FOUND':
        return { action: 'reobserve', delayMs: 300, reason: 'UI changed; rediscover before retry' };
      case 'PROVIDER_ERROR':
        return { action: 'retry', delayMs: 500, reason: 'transient provider error; retry' };
      case 'PERMISSION_DENIED':
      case 'APP_NOT_FOUND':
        return { action: 'fail', delayMs: 0, reason: 'not recoverable without user action' };
      default:
        return { action: 'retry', delayMs: 400, reason: 'generic retry' };
    }
  }
}

export const executionRecovery = new ExecutionRecovery();
