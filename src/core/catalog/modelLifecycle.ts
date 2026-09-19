/**
 * Model lifecycle contract — the ONE authoritative state model the Model Center
 * renders from. It exists because "found on Hugging Face", "runs on this
 * hardware", "trusted by Akansha" and "READY" are DIFFERENT facts that must
 * never be visually confused. Nothing here computes compatibility (that is the
 * CompatibilityEngine's job) or performs installs (ModelManager/LocalModelRegistry
 * job's job) — this module only DERIVES the honest user-facing state + the one
 * action that state permits, from evidence produced by those existing systems.
 */

export type ModelLifecycle =
  | 'DISCOVERED'            // found upstream; metadata not yet verified
  | 'METADATA_VERIFIED'     // real artifact metadata read from the source
  | 'INSTALLABLE'           // GGUF + signed catalog entry + hardware FIT + runtime present
  | 'TRUST_REQUIRED'        // compatible GGUF but NOT in the signed catalog (no checksum pin)
  | 'POSSIBLE'              // could run, but key evidence is estimated/unknown
  | 'UNSUPPORTED'           // concrete evidence it cannot run here (format/hardware/runtime)
  | 'METADATA_INCOMPLETE'   // source exposes no verified artifact metadata
  | 'ALREADY_INSTALLED'     // registered usable (passed real inference)
  | 'INSTALLING' | 'CANCELLING' | 'VERIFYING' | 'INFERENCE_TESTING'
  | 'CANCELLED' | 'FAILED' | 'READY';

export type ModelAction =
  | 'install' | 'cancel' | 'retry' | 'review-source' | 'use-model' | 'open' | 'none';

export interface LifecycleView {
  state: ModelLifecycle;
  /** The single action the UI may render for this state. No dead buttons. */
  action: ModelAction;
  /** Human reason shown next to the state — always non-empty. */
  reason: string;
}

export interface LifecycleEvidence {
  /** From the compatibility ladder. */
  verdict?: 'FIT' | 'POSSIBLE' | 'UNSUPPORTED';
  /** Artifact format actually verified from source metadata ('gguf' | other | undefined). */
  format?: string;
  /** True when the repo/model is present in the SIGNED catalog (checksum-pinned). */
  inSignedCatalog: boolean;
  /** True when a real artifact metadata fetch succeeded. */
  metadataVerified: boolean;
  /** True when the required runtime is detected & healthy. */
  runtimeAvailable?: boolean;
  /** Current install-job state, if any. */
  job?: { state: 'INSTALLING' | 'CANCELLING' | 'VERIFYING' | 'INFERENCE_TESTING' | 'CANCELLED' | 'FAILED' | 'READY'; stage?: string; progressPct?: number | null };
  /** True when LocalModelRegistry reports this model usable (real inference passed). */
  usable?: boolean;
}

/**
 * Derive the honest lifecycle view. Order matters: READY/installed first, then
 * active jobs, then trust/format/compatibility gates.
 */
export function deriveLifecycle(e: LifecycleEvidence): LifecycleView {
  if (e.usable || e.job?.state === 'READY') {
    return { state: 'READY', action: 'use-model', reason: 'Installed and verified by a real inference test on this device.' };
  }
  if (e.job) {
    switch (e.job.state) {
      case 'INSTALLING': return { state: 'INSTALLING', action: 'cancel', reason: `Downloading artifact${pct(e.job.progressPct)}.` };
      case 'CANCELLING': return { state: 'CANCELLING', action: 'none', reason: 'Cancelling — stopping download/process…' };
      case 'VERIFYING': return { state: 'VERIFYING', action: 'none', reason: 'Verifying SHA-256 + GGUF integrity…' };
      case 'INFERENCE_TESTING': return { state: 'INFERENCE_TESTING', action: 'none', reason: 'Running the real llama.cpp inference self-test…' };
      case 'CANCELLED': return { state: 'CANCELLED', action: 'retry', reason: 'Installation was cancelled. Partial files were cleaned up.' };
      case 'FAILED': return { state: 'FAILED', action: 'retry', reason: e.job.stage ? `Install failed during ${e.job.stage}.` : 'Installation failed.' };
    }
  }
  if (!e.format) {
    return e.metadataVerified
      ? { state: 'METADATA_INCOMPLETE', action: 'review-source', reason: 'The source exposes no verified GGUF artifact metadata.' }
      : { state: 'DISCOVERED', action: 'review-source', reason: 'Found upstream; artifact metadata not yet verified.' };
  }
  if (e.format !== 'gguf') {
    return { state: 'UNSUPPORTED', action: 'review-source', reason: `Artifact is ${e.format}, not GGUF — Akansha's llama.cpp loader cannot run it.` };
  }
  if (e.verdict === 'UNSUPPORTED') {
    return { state: 'UNSUPPORTED', action: 'review-source', reason: 'Concrete hardware/runtime evidence says this device cannot run it.' };
  }
  if (!e.inSignedCatalog) {
    return { state: 'TRUST_REQUIRED', action: 'review-source', reason: 'Compatible GGUF, but not in Akansha’s signed catalog — installation requires a checksum-pinned, trusted entry. Review the source.' };
  }
  if (e.runtimeAvailable === false) {
    return { state: 'POSSIBLE', action: 'none', reason: 'Trusted & compatible, but the llama.cpp runtime is not detected yet.' };
  }
  if (e.verdict === 'POSSIBLE') {
    return { state: 'POSSIBLE', action: 'install', reason: 'Hardware fit is estimated/uncertain — installable, but it may run slowly or not at all.' };
  }
  return { state: 'INSTALLABLE', action: 'install', reason: 'Verified GGUF + signed checksum + hardware fit — ready to install.' };
}

function pct(p?: number | null): string {
  return typeof p === 'number' && Number.isFinite(p) ? ` (${Math.max(0, Math.min(100, Math.round(p)))}%)` : '…';
}
