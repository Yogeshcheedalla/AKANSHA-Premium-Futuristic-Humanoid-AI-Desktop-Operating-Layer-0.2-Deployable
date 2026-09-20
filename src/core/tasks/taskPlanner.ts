/**
 * Deterministic multi-step task planner. A goal that chains several concrete
 * OS/browser actions (or contains an explicit wait) becomes a durable TASK with
 * ordered steps — NOT a single chat reply. Ambiguous/one-shot goals return null
 * so the normal single-action command path (or the model) handles them.
 */
import { routeCommand } from '../desktop/commandRouter';
import type { TaskStep } from './TaskManager';

const WAIT = /\bwait\s+(?:for\s+)?(\d+)\s*(seconds?|secs?|s|minutes?|mins?)\b/i;

// Split on connective phrases so each piece is one action or one wait.
function segments(goal: string): string[] {
  return goal
    .split(/\s*(?:,\s*|\band\s+then\b|\bthen\b|\bafter\s+that\b|\bnext\b|\band\b)\s*/i)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Returns ordered steps if the goal is a genuine multi-step / timed task,
 * otherwise null (single action → normal path).
 */
export async function planTask(goal: string): Promise<TaskStep[] | null> {
  const parts = segments(goal);
  const hasWait = WAIT.test(goal);
  if (parts.length < 2 && !hasWait) return null;

  const steps: TaskStep[] = [];
  let lastApp = '';
  for (let part of parts) {
    const w = part.match(WAIT);
    if (w) {
      const n = parseInt(w[1], 10);
      const raw = w[2].toLowerCase();
      const unit = raw.startsWith('min') ? 'minute' : raw.startsWith('sec') || raw === 's' ? 'second' : 'second';
      const ms = (unit === 'minute' ? n * 60_000 : n * 1000);
      if (ms > 0 && ms <= 30 * 60_000) { steps.push({ kind: 'wait', label: `wait ${n} ${unit}${n > 1 ? 's' : ''}`, ms }); continue; }
    }
    // Resolve a trailing pronoun to the last concrete app mentioned.
    if (lastApp && /\b(it|this|that|the app|the window)\b/i.test(part) && !/\b(notepad|chrome|brave|edge|firefox|youtube|calculator|calc|paint)\b/i.test(part)) {
      part = part.replace(/\b(it|this|that|the app|the window)\b/i, lastApp);
    }
    const routed = await routeCommand(part);
    if (routed) {
      steps.push({ kind: 'action', label: routed.label, actionId: routed.actionId, payload: routed.payload });
      const app = routed.payload.application;
      if (typeof app === 'string' && app) lastApp = app;
    }
  }

  // Need at least two real steps to justify a background task.
  return steps.length >= 2 ? steps : null;
}
