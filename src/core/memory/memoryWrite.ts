/**
 * Memory WRITE pipeline — decides WHAT (if anything) to remember, then persists
 * through the EXISTING MemorySystem (no second memory engine).
 *
 *   input -> sensitivity filter -> importance -> dedupe key -> decision
 *         -> STORE | DO_NOT_STORE | ASK_USER | EPHEMERAL
 *
 * Hard rules:
 *  - Secrets (passwords, API keys, tokens, OAuth secrets, private keys, cookies,
 *    raw audio, payment data) are NEVER stored.
 *  - Nothing is stored unless the persistence call actually succeeded (we verify
 *    by reading the entry back). No fake "remembered".
 *  - Repeated facts are DEDUPLICATED by a stable key: an existing memory is
 *    updated (provenance + timestamps + importance kept honest) rather than
 *    duplicated endlessly.
 */
import { memorySystem, type MemoryEntry } from './MemorySystem';

export type MemoryAction = 'STORE' | 'DO_NOT_STORE' | 'ASK_USER' | 'EPHEMERAL';
export type MemoryCategory = MemoryEntry['category'];
export type SensitivityKind = 'password' | 'apikey' | 'token' | 'oauth' | 'privatekey' | 'cookie' | 'audio' | 'payment' | 'none';

const SECRET_PATTERNS: Array<{ kind: Exclude<SensitivityKind, 'none'>; re: RegExp }> = [
  { kind: 'password', re: /\bpassword\b\s*(?:[:=]|is)\s*\S+/i },
  { kind: 'apikey', re: /\b(api[_-]?key|secret[_-]?key|access[_-]?key)\b\s*[:=]?\s*[A-Za-z0-9_\-]{8,}/i },
  { kind: 'apikey', re: /\bsk-[A-Za-z0-9_\-]{12,}\b/ },
  { kind: 'token', re: /\b(bearer|access[_-]?token|refresh[_-]?token)\b\s*[:=]?\s*[A-Za-z0-9._\-]{8,}/i },
  { kind: 'oauth', re: /\b(client[_-]?secret|oauth[_-]?secret)\b\s*[:=]?\s*\S+/i },
  { kind: 'privatekey', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'cookie', re: /\b(set-cookie|session[_-]?cookie)\b\s*[:=]\s*\S+/i },
  { kind: 'payment', re: /\b(\d{13,19}|credit[_-]?card|cvv)\b/i },
  { kind: 'audio', re: /\b(raw\s+audio|\.wav|\.mp3|recording)\b/i },
];

export function classifySensitivity(text: string): { sensitive: boolean; kind: SensitivityKind } {
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) return { sensitive: true, kind: p.kind };
  return { sensitive: false, kind: 'none' };
}

/** Stable-ish dedupe key: normalized content signature. */
export function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

export function computeImportance(text: string, explicit: boolean): number {
  let score = 0.4;
  if (explicit) score += 0.4;
  if (/\b(always|never|prefer|my name is|i like|i use|my default)\b/i.test(text)) score += 0.15;
  if (/\b(today|tonight|this time|for now|temporarily)\b/i.test(text)) score -= 0.2;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export interface MemoryDecision {
  action: MemoryAction;
  category: MemoryCategory;
  importance: number;
  dedupeKey: string;
  sensitivity: SensitivityKind;
  reason: string;
}

export function decideMemory(input: { text: string; explicitRemember?: boolean }): MemoryDecision {
  const text = (input.text || '').trim();
  const sens = classifySensitivity(text);
  const key = dedupeKey(text);
  const explicit = !!input.explicitRemember || /^\s*(remember|note that|don't forget|keep in mind)\b/i.test(text);

  if (!text) return { action: 'DO_NOT_STORE', category: 'short_term', importance: 0, dedupeKey: key, sensitivity: sens.kind, reason: 'empty' };
  if (sens.sensitive) return { action: 'DO_NOT_STORE', category: 'short_term', importance: 0, dedupeKey: key, sensitivity: sens.kind, reason: `sensitive:${sens.kind}` };
  if (/\b(today|tonight|this time|for now|temporarily|for this build|use this filename)\b/i.test(text)) {
    return { action: 'EPHEMERAL', category: 'task_memory', importance: computeImportance(text, explicit), dedupeKey: key, sensitivity: 'none', reason: 'temporary context' };
  }
  if (explicit) return { action: 'STORE', category: 'preference', importance: computeImportance(text, true), dedupeKey: key, sensitivity: 'none', reason: 'explicit remember' };
  if (/\b(my name is|i prefer|i always|i never|i use|my default)\b/i.test(text)) {
    return { action: 'STORE', category: 'preference', importance: computeImportance(text, false), dedupeKey: key, sensitivity: 'none', reason: 'stable preference' };
  }
  if (/\b(project|repo|codebase|architecture|decision)\b/i.test(text)) {
    return { action: 'ASK_USER', category: 'project_memory', importance: computeImportance(text, false), dedupeKey: key, sensitivity: 'none', reason: 'possible project fact — confirm' };
  }
  return { action: 'DO_NOT_STORE', category: 'short_term', importance: computeImportance(text, false), dedupeKey: key, sensitivity: 'none', reason: 'low value' };
}

export interface WriteOutcome { action: MemoryAction; stored: boolean; updated: boolean; memoryId: string | null; reason: string; }

/** Run the pipeline and persist through the existing MemorySystem. */
export function processMemory(input: { text: string; userId?: string; source?: string; explicitRemember?: boolean }, sys = memorySystem): WriteOutcome {
  const d = decideMemory(input);
  if (d.action === 'DO_NOT_STORE' || d.action === 'EPHEMERAL' || d.action === 'ASK_USER') {
    return { action: d.action, stored: false, updated: false, memoryId: null, reason: d.reason };
  }
  // STORE with dedupe: update an existing memory with the same key rather than duplicate.
  const existing = sys.getAllMemories().find((m) => m.metadata?.dedupeKey === d.dedupeKey && (input.userId ? m.userId === input.userId : true));
  const now = Date.now();
  if (existing) {
    const updated: MemoryEntry = { ...existing, content: input.text, importance: Math.max(existing.importance, d.importance), timestamp: now, metadata: { ...existing.metadata, updatedAt: now, source: input.source ?? existing.metadata?.source } };
    sys.storeMemory(updated);
    const ok = sys.retrieveMemory(updated.id) != null;
    return { action: 'STORE', stored: ok, updated: ok, memoryId: ok ? updated.id : null, reason: ok ? 'deduped-update' : 'persist-failed' };
  }
  const id = `mem-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: MemoryEntry = { id, category: d.category, content: input.text, metadata: { dedupeKey: d.dedupeKey, sensitivity: d.sensitivity, source: input.source ?? 'conversation', createdAt: now, updatedAt: now }, userId: input.userId, timestamp: now, accessCount: 0, importance: d.importance };
  sys.storeMemory(entry);
  const ok = sys.retrieveMemory(id) != null; // verify the write actually landed
  return { action: 'STORE', stored: ok, updated: false, memoryId: ok ? id : null, reason: ok ? 'stored' : 'persist-failed' };
}
