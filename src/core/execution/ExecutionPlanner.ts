import { resolveApp, APP_REGISTRY } from './appRegistry';
import type { ExecutionPlan, ExecutionStep, RiskTier } from './types';

const APP_LIST = APP_REGISTRY;

let stepSeq = 0;
const newStep = (partial: Omit<ExecutionStep, 'id' | 'status' | 'attemptCount'>): ExecutionStep => ({
  id: `step-${Date.now()}-${stepSeq++}`,
  status: 'PENDING',
  attemptCount: 0,
  ...partial,
});

/**
 * Execution Planner — deterministically turns an OS-execution goal into an
 * ordered step plan with post-conditions. Kept rule-based (no LLM) so the plan
 * is predictable and auditable; the orchestrator can fall back to an LLM planner
 * for goals this cannot parse.
 */
export class ExecutionPlanner {
  plan(goal: string, riskTier: RiskTier, permissions: string[], requiresConfirmation: boolean): ExecutionPlan | null {
    const g = goal.toLowerCase().trim();

    // Detect a known app mentioned anywhere.
    const app = this.findApp(goal);

    // "open <app> and (write|type) <text>"
    const openAndType = g.match(/open\s+(.+?)\s+(?:and\s+)?(?:write|type|enter)\s+(?:"([^"]+)"|(.+))$/i);
    if (openAndType && app) {
      const text = (openAndType[2] || openAndType[3] || '').trim();
      return {
        goal,
        riskTier,
        permissions,
        requiresConfirmation,
        steps: [
          newStep({ action: { kind: 'launch', app: app.name }, description: `Launch ${app.name}`, expect: { windowTitleContains: app.titleHint } }),
          text ? newStep({ action: { kind: 'type', text, target: app.name }, description: `Type "${text}" into ${app.name}`, expect: { textContains: text } }) : null,
        ].filter(Boolean) as ExecutionStep[],
      };
    }

    // "open <app>" — but ONLY a single action. If there is an additional clause
    // ("and search…", "then click…") that this planner cannot express as steps,
    // return null so the orchestrator fails honestly instead of falsely completing.
    const open = g.match(/^(?:open|launch|start|run)\s+(.+)$/i);
    if (open && app) {
      const remainder = open[1] || '';
      const hasUnhandledClause = /\b(?:and|then)\b|,/.test(remainder.replace(app.name, ''));
      if (hasUnhandledClause) return null;
      return {
        goal,
        riskTier,
        permissions,
        requiresConfirmation,
        steps: [newStep({ action: { kind: 'launch', app: app.name }, description: `Launch ${app.name}`, expect: { windowTitleContains: app.titleHint } })],
      };
    }

    // "close <app>"
    const close = g.match(/^(?:close|quit|exit)\s+(.+)$/i);
    if (close && app) {
      return {
        goal,
        riskTier,
        permissions,
        requiresConfirmation,
        steps: [
          newStep({ action: { kind: 'focus', target: app.name }, description: `Focus ${app.name}` }),
          newStep({ action: { kind: 'key', keys: '%{F4}', target: app.name }, description: `Close ${app.name}` }),
        ],
      };
    }

    // "type/write <text>" into the current window
    const type = g.match(/^(?:type|write|enter)\s+(?:"([^"]+)"|(.+))$/i);
    if (type) {
      const text = (type[1] || type[2] || '').trim();
      if (text) {
        return {
          goal,
          riskTier,
          permissions,
          requiresConfirmation,
          steps: [newStep({ action: { kind: 'type', text }, description: `Type "${text}"`, expect: { textContains: text } })],
        };
      }
    }

    return null;
  }

  private findApp(goal: string): { name: string; titleHint: string } | null {
    const lower = goal.toLowerCase();
    for (const spec of APP_LIST) {
      for (const alias of spec.aliases) {
        if (lower.includes(alias)) return { name: alias, titleHint: spec.titleHint };
      }
    }
    return null;
  }
}

export const executionPlanner = new ExecutionPlanner();
