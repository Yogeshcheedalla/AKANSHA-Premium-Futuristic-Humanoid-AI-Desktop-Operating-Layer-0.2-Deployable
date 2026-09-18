import { resolveApp } from '@/core/execution/appRegistry';
import { isSafeAppName } from './desktopCapabilities';

/**
 * Deterministic command → Action Fabric mapping.
 *
 * This is NOT a new command authority — it is the single place that recognises a
 * simple, allowlisted Windows "open/close <app>" instruction and resolves it to a
 * concrete registered action + structured payload. Anything ambiguous, multi-step,
 * shell-like, or referencing an unknown app returns null so the caller falls back to
 * the existing orchestrator/planner path. Unknown text NEVER becomes shell execution.
 */
export interface DesktopActionMap {
  actionId: 'desktop.app.launch' | 'desktop.app.close' | 'desktop.window.focus';
  application: string;
}

const LAUNCH = /^\s*(?:please\s+|can you\s+)?(?:open|launch|start|run|bring up|fire up)\s+(.+?)\s*[.!?,]*$/i;
const CLOSE = /^\s*(?:please\s+|can you\s+)?(?:close|quit|exit|kill|terminate|stop|shut)\s+(.+?)\s*[.!?,]*$/i;
const FOCUS = /^\s*(?:please\s+|can you\s+)?(?:focus|activate|raise|foreground|switch to)\s+(.+?)\s*[.!?,]*$/i;
const FOCUS_BRING = /^\s*(?:please\s+|can you\s+)?bring\s+(.+?)\s+to (?:the )?front\s*[.!?,]*$/i;

/** Rejects anything that is not a single, plain application target. */
const NOT_A_PLAIN_APP = /[;&|<>`$]|\band\b|\bthen\b|,/i;

export function mapToDesktopAction(text: string): DesktopActionMap | null {
  const t = (text || '').trim();
  if (!t) return null;

  let kind: 'launch' | 'close' | 'focus' | null = null;
  let rest = '';
  let m: RegExpMatchArray | null;

  if ((m = t.match(LAUNCH))) { kind = 'launch'; rest = m[1]; }
  else if ((m = t.match(CLOSE))) { kind = 'close'; rest = m[1]; }
  else if ((m = t.match(FOCUS_BRING))) { kind = 'focus'; rest = m[1]; }
  else if ((m = t.match(FOCUS))) { kind = 'focus'; rest = m[1]; }
  else return null;

  rest = rest.replace(/\s+/g, ' ').trim();
  // Words like "a new file", "google.com" etc. are not allowlisted apps → fall through.
  if (!rest || NOT_A_PLAIN_APP.test(rest) || rest.length > 64) return null;
  if (!isSafeAppName(rest)) return null;

  const spec = resolveApp(rest);
  if (!spec) return null; // unknown → never invent, let the orchestrator handle it

  const actionId = kind === 'launch' ? 'desktop.app.launch'
    : kind === 'close' ? 'desktop.app.close'
    : 'desktop.window.focus';

  return {
    actionId,
    // Canonical alias so "text editor" → "notepad" deterministically.
    application: spec.aliases[0],
  };
}
