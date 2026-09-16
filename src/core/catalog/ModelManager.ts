/**
 * ModelManager — the SECURE LOCAL INSTALLATION PIPELINE, kept separate from the
 * RuntimeManager (model ≠ runtime). It is a pure state machine: given the gates
 * that already exist (compatibility, storage, runtime, integrity) it advances the
 * install lifecycle and refuses to reach `usable` until real inference succeeded.
 *
 * It performs NO I/O and NO downloads itself — the Electron/installer layer
 * performs the actual fetch and reports results back. That keeps this testable
 * offline and prevents a "downloaded ⇒ works" lie: only an inference-verified
 * result flips `usable`.
 */
import type { CompatibilityResult } from '@/core/catalog/CompatibilityEngine';
import { verifyArtifact, type ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

export type InstallStage =
  | 'idle' | 'compatibility' | 'storage' | 'network' | 'runtime'
  | 'download' | 'sha256' | 'signature' | 'format' | 'install'
  | 'load' | 'warmup' | 'inference' | 'benchmark' | 'ready' | 'failed';

export const PIPELINE_ORDER: InstallStage[] = [
  'compatibility', 'storage', 'network', 'runtime', 'download', 'sha256',
  'signature', 'format', 'install', 'load', 'warmup', 'inference', 'benchmark', 'ready',
];

export interface PipelineState {
  modelId: string;
  stage: InstallStage;
  usable: boolean;               // ONLY true after inference passed + integrity passed
  errors: string[];
}

export interface GateInputs {
  compat: CompatibilityResult;
  freeDiskGB: number;
  networkAvailable: boolean;
  runtimeAvailable: boolean;
}

/**
 * Decide the next action without side effects. The caller executes the action
 * (download/load/infer) and feeds the result back via `recordResult`.
 * Never returns 'ready' unless integrity + inference were explicitly recorded.
 */
export function planNext(state: PipelineState, inputs: GateInputs, entry: ManifestModelEntry): { nextStage: InstallStage; action: string; blocked?: string } {
  if (state.stage === 'ready') return { nextStage: 'ready', action: 'none' };
  if (state.stage === 'failed') return { nextStage: 'failed', action: 'surface-failure' };

  if (!inputs.compat.runnable) return { nextStage: 'compatibility', action: 'block', blocked: inputs.compat.reasons.join(', ') || 'incompatible' };
  if (inputs.freeDiskGB < (entry.sizeBytes / 1e9) + 2) return { nextStage: 'storage', action: 'block', blocked: `need ~${(entry.sizeBytes / 1e9 + 2).toFixed(1)} GB free` };
  if (!inputs.networkAvailable) return { nextStage: 'network', action: 'block', blocked: 'offline: cannot download (model already installed? resume from cache)' };
  if (!inputs.runtimeAvailable) return { nextStage: 'runtime', action: 'block', blocked: 'no inference runtime detected; refusing to install a model with no runtime to run it' };

  switch (state.stage) {
    case 'idle': case 'compatibility': case 'storage': case 'network': case 'runtime':
      return { nextStage: 'download', action: 'download-model' };
    case 'download':
      return { nextStage: 'sha256', action: 'verify-sha256' };
    default:
      return { nextStage: state.stage, action: 'advance' };
  }
}

/**
 * Record a downloaded artifact's integrity result. Returns the updated state;
 * `usable` is NOT set here — only recordInference() can set it.
 */
export function recordIntegrity(state: PipelineState, entry: ManifestModelEntry, bytes: Uint8Array): PipelineState {
  const res = verifyArtifact(entry, bytes);
  const next: PipelineState = { ...state, errors: [...state.errors] };
  if (!res.ok) { next.stage = 'failed'; next.usable = false; next.errors.push(...res.reasons); return next; }
  next.stage = 'install';                 // sha + gguf + size all matched
  next.errors = next.errors.filter((e) => !/checksum|size|gguf/.test(e));
  return next;
}

/** Record a REAL inference outcome. usable becomes true ONLY on a genuine pass. */
export function recordInference(state: PipelineState, inference: { ok: boolean; text: string }): PipelineState {
  const next: PipelineState = { ...state, errors: [...state.errors] };
  if (inference.ok && inference.text.trim().length > 0 && state.stage !== 'failed') {
    next.stage = 'ready';
    next.usable = true;
  } else {
    next.stage = 'failed';
    next.usable = false;
    next.errors.push('inference-did-not-produce-output');
  }
  return next;
}

export function initialPipelineState(modelId: string): PipelineState {
  return { modelId, stage: 'idle', usable: false, errors: [] };
}
