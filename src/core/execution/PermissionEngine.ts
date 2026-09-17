import type { ComputerAction, RiskTier } from './types';

export interface PermissionDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  permissions: string[];
  riskTier: RiskTier;
  reason: string;
}

/**
 * Permission Engine — capability-level AUTHORIZATION (distinct from the
 * RiskEngine's action-risk scoring and from authentication).
 *
 * It answers: does this class of action need a specific OS permission, and is
 * it safe to run automatically, or must a human confirm first? Destructive or
 * system-level operations are never auto-approved here; they are escalated to
 * the RiskEngine/confirmation flow by the caller.
 */

const PERMISSION_FOR_ACTION: Record<ComputerAction['kind'], string[]> = {
  launch: ['WINDOWS_CONTROL'],
  focus: ['WINDOWS_CONTROL'],
  observe: ['WINDOWS_CONTROL'],
  type: ['WINDOWS_CONTROL', 'KEYBOARD_INPUT'],
  key: ['WINDOWS_CONTROL', 'KEYBOARD_INPUT'],
  click: ['WINDOWS_CONTROL', 'POINTER_INPUT'],
  scroll: ['WINDOWS_CONTROL', 'POINTER_INPUT'],
  screenshot: ['SCREEN_CAPTURE'],
  listWindows: ['WINDOWS_CONTROL'],
};

// Read-only / low-impact actions can run automatically.
const AUTO_OK: ComputerAction['kind'][] = ['observe', 'listWindows', 'focus', 'scroll', 'screenshot'];

export class PermissionEngine {
  evaluate(actions: ComputerAction[], baseRisk: RiskTier = 'low'): PermissionDecision {
    const permissions = new Set<string>();
    let highest: RiskTier = baseRisk;
    const order: RiskTier[] = ['low', 'medium', 'high', 'critical'];

    for (const a of actions) {
      (PERMISSION_FOR_ACTION[a.kind] || []).forEach((p) => permissions.add(p));
      // Typing/keys/clicking into arbitrary targets is medium risk at least.
      if (['type', 'key', 'click'].includes(a.kind) && order.indexOf(highest) < order.indexOf('medium')) {
        highest = 'medium';
      }
    }

    const kinds = actions.map((a) => a.kind);
    const onlyAuto = kinds.every((k) => AUTO_OK.includes(k as ComputerAction['kind']));
    const requiresConfirmation = !onlyAuto; // mutating actions require confirmation by default

    return {
      allowed: true,
      requiresConfirmation,
      permissions: Array.from(permissions),
      riskTier: highest,
      reason: onlyAuto
        ? 'Read-only / non-mutating desktop actions'
        : 'Mutating desktop action — requires confirmation policy check',
    };
  }
}

export const permissionEngine = new PermissionEngine();

/**
 * Read-only view of the REAL desktop-action authorization model, for the Security
 * workspace. Exposes exactly the action→permission mapping the engine uses and which
 * action kinds are considered non-mutating (auto-run) — so the UI can never drift from
 * the code that actually gates execution. Adds no new decision logic.
 */
export function permissionCatalog(): {
  actionPermissions: Record<string, string[]>;
  autoRunKinds: string[];
  confirmingKinds: string[];
} {
  const all = Object.keys(PERMISSION_FOR_ACTION);
  return {
    actionPermissions: PERMISSION_FOR_ACTION as Record<string, string[]>,
    autoRunKinds: [...AUTO_OK],
    confirmingKinds: all.filter((k) => !(AUTO_OK as string[]).includes(k)),
  };
}
