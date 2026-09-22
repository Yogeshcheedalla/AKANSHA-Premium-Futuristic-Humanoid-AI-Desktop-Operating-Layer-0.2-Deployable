/**
 * MissionContext — the goal-oriented layer the command pipeline was missing.
 *
 * It does NOT replace MasterOrchestrator/TaskManager/Action Fabric; it adds the
 * two capabilities that make Akansha reason about a GOAL across turns instead of
 * reacting to one command at a time:
 *
 *  1. Reference resolution — "it", "this", "that", "the file", "the program",
 *     "that contact", "the one we just created" resolve to the most recent
 *     relevant artifact the mission produced, so the user never repeats context.
 *  2. Ask-when-blocked as a FIRST-CLASS state — when a step needs genuinely
 *     missing/ambiguous info (a delivery platform, one-of-many contacts), the
 *     mission parks in WAITING_FOR_USER with a precise question + options; the
 *     user's next turn is a CLARIFICATION_RESPONSE that RESUMES the same mission
 *     from the blocked step (completed work is never re-run).
 *
 * Everything here is pure and unit-testable (no DOM, no fs, no network).
 */

export type ArtifactKind = 'file' | 'app' | 'entity' | 'result' | 'code';

export interface Artifact {
  kind: ArtifactKind;
  /** Canonical value, e.g. "ReverseString.java", "WhatsApp", "Rahul Kumar". */
  value: string;
  /** Human label for confirmations. */
  label: string;
  at: number;
}

export type TurnClass =
  | 'CHAT' | 'QUESTION' | 'TASK' | 'MISSION'
  | 'FOLLOW_UP' | 'CLARIFICATION_RESPONSE' | 'CORRECTION' | 'CANCELLATION';

export interface Awaiting {
  resumeKey: string;
  question: string;
  options?: string[];
  /** The field this answer fills, e.g. "platform", "recipient". */
  field: string;
}

const PRONOUN_TO_KIND: Array<{ re: RegExp; kind: ArtifactKind | 'any' }> = [
  { re: /\b(the file|that file|this file|the document|it|that|this)\b/i, kind: 'file' },
  { re: /\b(the program|the code|the java program|the script|that program|the one we just (created|made|wrote))\b/i, kind: 'code' },
  { re: /\b(that contact|the contact|the person|that person|him|her|them)\b/i, kind: 'entity' },
  { re: /\b(the app|that app|the application|the program i opened|the window)\b/i, kind: 'app' },
  { re: /\b(the result|the previous result|that result)\b/i, kind: 'result' },
];

/** Resolve pronoun/anaphora in `text` against the mission's recent artifacts. */
export function resolveReferences(text: string, artifacts: Artifact[]): { resolved: string; substituted: boolean } {
  let out = text;
  let substituted = false;
  for (const { re, kind } of PRONOUN_TO_KIND) {
    if (!re.test(out)) continue;
    // Prefer the newest artifact of the mapped kind, else any newest artifact.
    const match = [...artifacts].reverse().find((a) => (kind === 'any' ? true : a.kind === kind))
      ?? [...artifacts].reverse().find(() => true);
    if (!match) continue;
    out = out.replace(re, match.value);
    substituted = true;
  }
  return { resolved: out, substituted };
}

const CANCEL = /^(stop|cancel|abort|never ?mind|don'?t (do|bother)|wait)\b/i;
const CORRECTION = /\b(no,?\s|i meant|actually|instead|use .{0,20} instead|change (it|the)|not that)\b/i;
// A short answer that only supplies a value (matches an awaiting option/field).
function isClarificationResponse(text: string, awaiting?: Awaiting | null): boolean {
  if (!awaiting) return false;
  const t = text.trim();
  if (t.length > 60) return false;
  if (awaiting.options?.some((o) => t.toLowerCase().includes(o.toLowerCase()))) return true;
  // A bare word/phrase answering a pending question is a clarification response.
  return awaiting.field ? /\S/.test(t) : false;
}

/** Classify a user turn relative to the active mission. */
export function classifyTurn(text: string, opts: { hasActiveMission?: boolean; awaiting?: Awaiting | null } = {}): TurnClass {
  const t = text.trim();
  const hasActiveMission = !!opts.hasActiveMission;
  if (!t) return 'CHAT';
  if (CANCEL.test(t)) return 'CANCELLATION';
  if (opts.awaiting && isClarificationResponse(t, opts.awaiting)) return 'CLARIFICATION_RESPONSE';
  if (CORRECTION.test(t) && hasActiveMission) return 'CORRECTION';
  // Multi-clause / connective goals are missions; single imperative is a task.
  const multiStep = /\bthen\b|\band (then )?(save|send|email|message|share|upload|tell|verify)\b|\bafter that\b|,( then| and (then|save|send))/.test(t);
  const actionable = /\b(open|create|write|make|generate|save|send|email|message|share|upload|search|research|find|close|install|download|compare|schedule)\b/i.test(t);
  if (multiStep && actionable) return 'MISSION';
  if (actionable) return 'TASK';
  if (/\?$/.test(t)) return 'QUESTION';
  return 'CHAT';
}

/**
 * Per-owner mission state. Kept in-memory (working memory); durable mission
 * persistence stays in TaskManager. This is the ephemeral context that lets a
 * follow-up reference the last artifact and lets a blocked step resume.
 */
export class MissionContext {
  private artifacts: Artifact[] = [];
  private awaiting: Awaiting | null = null;
  private goal = '';
  private readonly cap = 40;

  setGoal(goal: string): void { this.goal = goal; }
  getGoal(): string { return this.goal; }

  remember(kind: ArtifactKind, value: string, label?: string): void {
    this.artifacts = this.artifacts.filter((a) => !(a.kind === kind && a.value === value));
    this.artifacts.push({ kind, value, label: label || value, at: Date.now() });
    if (this.artifacts.length > this.cap) this.artifacts = this.artifacts.slice(-this.cap);
  }

  artifacts_(): Artifact[] { return [...this.artifacts]; }

  resolve(text: string): { resolved: string; substituted: boolean } { return resolveReferences(text, this.artifacts); }

  awaitUser(a: Awaiting): void { this.awaiting = a; }
  getAwaiting(): Awaiting | null { return this.awaiting; }
  clearAwaiting(): void { this.awaiting = null; }

  classify(text: string): TurnClass {
    return classifyTurn(text, { hasActiveMission: this.artifacts.length > 0 || !!this.goal, awaiting: this.awaiting });
  }

  reset(): void { this.artifacts = []; this.awaiting = null; this.goal = ''; }
}
