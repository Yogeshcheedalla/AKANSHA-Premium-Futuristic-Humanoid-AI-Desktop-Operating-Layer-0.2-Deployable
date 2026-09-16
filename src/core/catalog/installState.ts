/**
 * installState — the single pure mapping from REAL signals (compatibility, runtime
 * availability, and an actual install/verify/inference result) to the UI card state
 * the first-run Model Center shows:
 *
 *   AVAILABLE · CHECKING · INCOMPATIBLE · INSTALLING · VERIFYING · FAILED · READY · BLOCKED
 *
 * READY is reachable ONLY when a result reports a real inference pass (usable=true).
 * There is no path to READY from "downloaded" alone, and no fixture shortcut.
 */
export type CardState =
  | 'AVAILABLE' | 'CHECKING' | 'INCOMPATIBLE' | 'INSTALLING'
  | 'VERIFYING' | 'FAILED' | 'READY' | 'BLOCKED';

export interface InstallOutcome {
  ok: boolean;
  stage?: string;
  action?: string;
  blocked?: string | null;
  usable?: boolean;
  runtimeAvailable?: boolean;
  reasons?: string[];
  error?: string;
}

export interface ResolveInput {
  runnable: boolean;            // compatibility.runnable
  runtimeAvailable: boolean;
  installable: boolean;         // from the view model card
  result?: InstallOutcome;      // present once an install has been attempted
}

export function resolveCardState(i: ResolveInput): CardState {
  if (!i.runnable) return 'INCOMPATIBLE';
  if (i.result) {
    const r = i.result;
    if (r.usable === true && r.ok) return 'READY';                 // ONLY real inference
    if (r.error) return 'FAILED';
    if (!r.ok) return r.blocked ? 'BLOCKED' : 'FAILED';
    // ok but still mid-pipeline → map stage
    const stage = String(r.stage || '');
    if (['download', 'install'].includes(stage)) return 'INSTALLING';
    if (['sha256', 'signature', 'format', 'load', 'warmup', 'inference', 'benchmark'].includes(stage)) return 'VERIFYING';
    return 'CHECKING';
  }
  if (i.installable) return 'AVAILABLE';
  return 'BLOCKED';
}
