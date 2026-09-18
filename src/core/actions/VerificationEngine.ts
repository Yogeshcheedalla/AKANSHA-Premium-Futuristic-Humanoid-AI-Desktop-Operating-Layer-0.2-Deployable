import type { VerificationStrategy, Verification } from './types';

/**
 * Verification strategies. The default REQUIRES observed evidence: an action is
 * only COMPLETED when something was actually observed to happen. A provider
 * reply, an HTTP 200, or an LLM saying "done" is NOT success on its own.
 */
export const requireObservedEvidence: VerificationStrategy = ({ evidence }) =>
  evidence && evidence.observed
    ? { verified: true, method: 'requireObservedEvidence', reason: evidence.summary }
    : { verified: false, method: 'requireObservedEvidence', reason: 'No observed evidence — success not claimed (NO EVIDENCE = NO SUCCESS).' };

export const evidenceKind = (kind: string): VerificationStrategy => ({ evidence }) =>
  evidence && evidence.observed && evidence.kind === kind
    ? { verified: true, method: `evidence:${kind}`, reason: evidence.summary }
    : { verified: false, method: `evidence:${kind}`, reason: `Expected observed '${kind}' evidence` };

/** HTTP 200 alone is NOT success — the parsed content must satisfy a predicate. */
export const httpOkWithContent = (predicate: (data: unknown) => boolean): VerificationStrategy => ({ evidence }) => {
  const ok = !!evidence && evidence.observed && evidence.kind === 'http' && !!evidence.data && predicate(evidence.data);
  return ok
    ? { verified: true, method: 'httpOkWithContent', reason: evidence!.summary }
    : { verified: false, method: 'httpOkWithContent', reason: 'HTTP response present but content did not verify' };
};

export function verify(strategy: VerificationStrategy | undefined, ctx: { output?: unknown; evidence?: import('./types').Evidence }): Verification {
  return (strategy || requireObservedEvidence)(ctx);
}
