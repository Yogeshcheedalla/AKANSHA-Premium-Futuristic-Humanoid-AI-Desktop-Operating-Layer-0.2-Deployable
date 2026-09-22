/**
 * Capability Registry — declares the tools/capabilities the goal planner can
 * compose, each with its risk, verification method and fallbacks. This is the
 * discovery surface the planner uses so new capabilities are selectable WITHOUT
 * a special phrase-handler per user sentence (the spec's "composition, not
 * command-matching" principle).
 *
 * Pure + deterministic. UNKNOWN capability => not claimed.
 */

export type Risk = 'low' | 'medium' | 'high';

export interface Capability {
  id: string;
  description: string;
  verbs: RegExp;
  risk: Risk;
  /** How success is VERIFIED (evidence, not "tool called"). */
  verification: string;
  /** Ordered fallback capability ids (compatible only). */
  fallbacks: string[];
  /** Whether this capability needs an external account/credential. */
  requiresAuth?: boolean;
}

export const CAPABILITIES: Capability[] = [
  { id: 'desktop', description: 'Open/close/focus local Windows applications', verbs: /\b(open|close|launch|start|focus|minimize|maximize|quit)\b/i, risk: 'low', verification: 'process + window observed', fallbacks: ['browser'] },
  { id: 'filesystem', description: 'Create/read/write/move/delete files and folders', verbs: /\b(save|create|write|new folder|rename|move|copy|delete|file|folder)\b/i, risk: 'medium', verification: 'filesystem existence + content read-back', fallbacks: [] },
  { id: 'coding', description: 'Generate/modify source code', verbs: /\b(code|program|script|function|write .* (java|python|js|javascript|typescript)|generate .* code|fix .* bug)\b/i, risk: 'low', verification: 'artifact + (compile/test if requested)', fallbacks: [] },
  { id: 'compiler', description: 'Compile/build code', verbs: /\b(compile|build|run .* (code|program|test))\b/i, risk: 'medium', verification: 'compiler exit code + artifact', fallbacks: [] },
  { id: 'browser', description: 'Navigate/open websites in a chosen browser', verbs: /\b(browse|website|url|http|youtube|google|github)\b/i, risk: 'low', verification: 'browser process + page window', fallbacks: ['webFetch'] },
  { id: 'webSearch', description: 'Search the web for current information', verbs: /\b(search|research|look up|find out|latest|current|news|compare)\b/i, risk: 'low', verification: 'retrieved sources + citations', fallbacks: ['webFetch'] },
  { id: 'communication', description: 'Send messages/email through a platform', verbs: /\b(send|email|message|share|forward|whatsapp|telegram|reply to)\b/i, risk: 'high', verification: 'provider/app send confirmation', fallbacks: [], requiresAuth: true },
  { id: 'documents', description: 'Create/export documents and PDFs', verbs: /\b(document|report|pdf|docx|presentation|slides|spreadsheet)\b/i, risk: 'low', verification: 'file exists + content', fallbacks: ['filesystem'] },
  { id: 'memory', description: 'Recall/store user facts and preferences', verbs: /\b(remember|recall|what did i|my preference|i prefer|you know (that|i))\b/i, risk: 'low', verification: 'read-back from memory store', fallbacks: [] },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function capability(id: string): Capability | undefined { return BY_ID.get(id); }

/** Which capabilities a natural-language segment implies (may be several). */
export function capabilitiesFor(text: string): string[] {
  const hits = CAPABILITIES.filter((c) => c.verbs.test(text)).map((c) => c.id);
  return hits.length ? [...new Set(hits)] : [];
}

/** Primary capability for a segment (highest-specificity hit), or null. */
export function primaryCapability(text: string): string | null {
  const hits = capabilitiesFor(text);
  if (!hits.length) return null;
  // Prefer a more specific capability over generic 'desktop'/'filesystem'.
  const order = ['communication', 'coding', 'compiler', 'webSearch', 'documents', 'browser', 'memory', 'filesystem', 'desktop'];
  return hits.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}

/**
 * Detect a delivery step that is missing a required destination platform.
 * Returns a clarify descriptor so the planner can park the mission for the user
 * instead of guessing (never silently pick a platform / never silently paid).
 */
export function missingDeliveryPlatform(text: string): { field: string; question: string; options: string[] } | null {
  if (!/\b(send|share|forward|email|message)\b/i.test(text)) return null;
  const named = /\b(whatsapp|telegram|email|e-?mail|slack|signal|discord|sms|text)\b/i.test(text);
  if (named) return null;
  return {
    field: 'platform',
    question: 'Which platform should I use to send it — WhatsApp, email, or Telegram?',
    options: ['WhatsApp', 'email', 'Telegram'],
  };
}
