import { actionRegistry } from './ActionRegistry';
import { evidenceKind } from './VerificationEngine';
import { processMemory } from '@/core/memory/memoryWrite';

/**
 * Register REAL capabilities on the Action Fabric. Each executor calls an existing
 * service and reports OBSERVED evidence; the fabric's verification step decides
 * success. No mocks, no simulated capability.
 */
export function registerCoreActions() {
  actionRegistry.register({
    actionId: 'memory.write',
    capabilityId: 'memory',
    execute: async (req) => {
      const p = (req.payload || {}) as { text?: string; userId?: string; source?: string; explicitRemember?: boolean };
      if (!p.text) {
        return { evidence: { kind: 'memory', observed: false, summary: 'missing text' },
          failure: { code: 'UNKNOWN', stage: 'validate', message: 'text is required', retryable: false } };
      }
      // Real operation: the existing memory pipeline (sensitivity/dedupe/importance) + read-back.
      const out = processMemory({ text: p.text, userId: p.userId, source: p.source, explicitRemember: p.explicitRemember });
      const observed = out.stored && !!out.memoryId;
      return {
        output: out,
        evidence: { kind: 'memory', observed, summary: `${out.action}: ${out.reason}`,
          data: { memoryId: out.memoryId, action: out.action, deduped: out.updated } },
        failure: observed ? undefined
          : { code: 'VERIFICATION_FAILED', stage: 'execute', message: `not stored (${out.action}: ${out.reason})`, retryable: false },
      };
    },
    verify: evidenceKind('memory'), // COMPLETED only if a memory was actually stored + read back
  });
  return actionRegistry;
}

// Register on import so the fabric has real capabilities available.
registerCoreActions();
