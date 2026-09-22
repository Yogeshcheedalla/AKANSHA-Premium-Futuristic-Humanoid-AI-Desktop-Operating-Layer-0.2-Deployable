/**
 * Goal Planner — turns a natural-language GOAL into a dependency-ordered
 * subtask graph, tagging each subtask with the capability it needs and inserting
 * a CLARIFY subtask when a required input (e.g. a delivery platform) is missing.
 *
 * It EXTENDS the existing deterministic taskPlanner/TaskManager — it is not a
 * second orchestrator. The output feeds TaskManager via toTaskSteps(), so a
 * missing platform parks the mission in WAITING_FOR_USER and answer() resumes it.
 *
 * Dependencies default to a safe sequential chain (each subtask depends on the
 * previous); parallel execution of independent subtasks is a later increment.
 */
import { routeCommand } from '../desktop/commandRouter';
import type { TaskStep } from './TaskManager';
import { capabilitiesFor, missingDeliveryPlatform, agentFor } from '../routing/capabilityRegistry';
import { preferenceMemory } from '../memory/preferenceMemory';

export interface Subtask {
  id: string;
  label: string;
  capability: string | null;
  agentId: string;
  actionId?: string;
  payload?: Record<string, unknown>;
  dependsOn: string[];
  clarify?: { field: string; question: string; options?: string[] };
}

const WAIT = /\bwait\s+(?:for\s+)?(\d+)\s*(seconds?|secs?|s|minutes?|mins?)\b/i;

function segments(goal: string): string[] {
  return goal
    .split(/\s*(?:,\s*|\band\s+then\b|\bthen\b|\bafter\s+that\b|\bnext\b|\band\b)\s*/i)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Plan a goal into an ordered subtask DAG (sequential dependencies). */
export async function planGoal(goal: string): Promise<Subtask[]> {
  const parts = segments(goal);
  const subtasks: Subtask[] = [];
  let prevId = '';
  let lastApp = '';
  let n = 0;
  const add = (s: Omit<Subtask, 'id' | 'dependsOn' | 'agentId'>): Subtask => {
    const id = `s${++n}`;
    const st: Subtask = { id, agentId: agentFor(s.capability), ...s, dependsOn: prevId ? [prevId] : [] };
    subtasks.push(st); prevId = id; return st;
  };

  for (let part of parts) {
    const w = part.match(WAIT);
    if (w) {
      const sec = parseInt(w[1], 10);
      const mins = /min/i.test(w[2]);
      const ms = (mins ? sec * 60_000 : sec * 1000);
      if (ms > 0 && ms <= 30 * 60_000) { add({ label: `wait ${sec} ${mins ? 'min' : 'sec'}`, capability: null }); continue; }
    }
    // Resolve a trailing pronoun to the last concrete app mentioned (cheap coref).
    if (lastApp && /\b(it|this|that|the app|the window)\b/i.test(part) && !/\b(notepad|chrome|brave|edge|firefox|youtube|calculator|calc|paint)\b/i.test(part)) {
      part = part.replace(/\b(it|this|that|the app|the window)\b/i, lastApp);
    }
    // A delivery with no platform: use a stored preference if one exists (memory
    // influences planning), otherwise CLARIFY (park for the user) — never guess.
    const miss = missingDeliveryPlatform(part);
    if (miss) {
      const pref = preferenceMemory.resolve('delivery', 'platform');
      if (pref.value) add({ label: `send via ${pref.value}`, capability: 'communication' });
      else add({ label: `ask ${miss.field}`, capability: 'communication', clarify: miss });
      continue;
    }

    const routed = await routeCommand(part);
    if (routed) {
      const caps = capabilitiesFor(part);
      add({ label: routed.label, capability: caps[0] ?? 'desktop', actionId: routed.actionId, payload: routed.payload });
      const app = routed.payload.application;
      if (typeof app === 'string' && app) lastApp = app;
    } else {
      // Unrouted segment: keep it as a capability-tagged placeholder the executor
      // can hand to the model/agent later (never dropped silently).
      const caps = capabilitiesFor(part);
      add({ label: part, capability: caps[0] ?? null });
    }
  }
  return subtasks;
}

/** Adapt the DAG to TaskManager steps (sequential order; clarify preserved). */
export function toTaskSteps(subtasks: Subtask[]): TaskStep[] {
  return subtasks.map((s) => {
    if (s.clarify) return { kind: 'clarify', label: s.label, field: s.clarify.field, question: s.clarify.question, options: s.clarify.options };
    if (s.label.startsWith('wait ')) {
      const m = s.label.match(/wait (\d+) (sec|min)/);
      const ms = m ? (m[2] === 'min' ? +m[1] * 60000 : +m[1] * 1000) : 1000;
      return { kind: 'wait', label: s.label, ms };
    }
    return { kind: 'action', label: s.label, actionId: s.actionId || 'noop', payload: s.payload || {} };
  });
}
