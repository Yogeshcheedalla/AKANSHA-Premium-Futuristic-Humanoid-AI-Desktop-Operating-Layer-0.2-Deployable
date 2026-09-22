/**
 * Preference memory — durable user preferences that INFLUENCE planning without
 * overriding the user's current instruction.
 *
 * Rules (per spec):
 *  - An explicit value in the current request always wins over memory.
 *  - If the current request is silent on a field and a stored preference exists,
 *    the planner MAY use it (returned as source 'memory').
 *  - If neither exists, the field is unresolved -> the mission parks (need-user),
 *    it does not guess.
 *  - A wrong/outdated memory must never blindly control execution: the caller can
 *    re-confirm, and any explicit user instruction overrides it.
 *
 * In-memory by default; an optional persist hook mirrors the TaskManager store.
 */

export type PrefSource = 'explicit' | 'memory' | 'need-user';
export interface ResolvedField { value: string | null; source: PrefSource; }

export class PreferenceMemory {
  private store = new Map<string, string>();

  private key(category: string, field: string) { return `${category}.${field}`; }

  set(category: string, field: string, value: string): void { this.store.set(this.key(category, field), value); }
  get(category: string, field: string): string | undefined { return this.store.get(this.key(category, field)); }
  has(category: string, field: string): boolean { return this.store.has(this.key(category, field)); }
  clear(category?: string): void {
    if (!category) { this.store.clear(); return; }
    for (const k of [...this.store.keys()]) if (k.startsWith(`${category}.`)) this.store.delete(k);
  }
  all(): Record<string, string> { return Object.fromEntries(this.store); }

  /**
   * Resolve a field for a subtask. `explicit` is a value the user stated in THIS
   * request (always wins). Otherwise fall back to a stored preference, else
   * 'need-user' (the caller should park the mission and ask).
   */
  resolve(category: string, field: string, explicit?: string | null): ResolvedField {
    const e = (explicit || '').trim();
    if (e) return { value: e, source: 'explicit' };
    const mem = this.get(category, field);
    if (mem) return { value: mem, source: 'memory' };
    return { value: null, source: 'need-user' };
  }
}

export const preferenceMemory = new PreferenceMemory();
