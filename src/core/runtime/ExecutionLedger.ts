import { db } from '@/db';
import { requestLedger } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface LedgerEntry {
  requestId: string;
  intent: string;
  status: string;
  response: Record<string, unknown>;
  latencyMs: number;
}

/**
 * Execution Ledger — idempotency keyed by requestId.
 *
 * The same requestId never executes twice: the first completion wins and the
 * stored result is replayed for any duplicate arrival (duplicate HTTP,
 * duplicate WebSocket, duplicate ASR-final events).
 */
export class ExecutionLedger {
  private inflight = new Map<string, Promise<unknown>>();
  private cache = new Map<string, unknown>();

  async run<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
    // 1. Already completed → replay stored result.
    const cached = this.cache.get(requestId);
    if (cached !== undefined) return cached as T;

    // 2. Already running → join the in-flight promise.
    const existing = this.inflight.get(requestId);
    if (existing) return existing as Promise<T>;

    // 3. Otherwise execute once.
    const promise = (async () => {
      try {
        const result = await fn();
        this.cache.set(requestId, result);
        return result;
      } finally {
        this.inflight.delete(requestId);
      }
    })();

    this.inflight.set(requestId, promise);
    return promise;
  }

  async persist(entry: LedgerEntry) {
    try {
      await db
        .insert(requestLedger)
        .values({
          requestId: entry.requestId,
          intent: entry.intent,
          status: entry.status,
          response: entry.response,
          latencyMs: entry.latencyMs,
        })
        .onConflictDoNothing();
    } catch {
      /* ledger persistence is best-effort */
    }
  }

  async lookup(requestId: string): Promise<LedgerEntry | null> {
    try {
      const rows = await db.select().from(requestLedger).where(eq(requestLedger.requestId, requestId)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        requestId: row.requestId,
        intent: row.intent || '',
        status: row.status,
        response: (row.response as Record<string, unknown>) || {},
        latencyMs: row.latencyMs ?? 0,
      };
    } catch {
      return null;
    }
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
  }
}

export const executionLedger = new ExecutionLedger();
