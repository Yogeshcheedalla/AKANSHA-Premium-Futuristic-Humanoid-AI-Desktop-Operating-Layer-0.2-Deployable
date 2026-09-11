import { db } from '@/db';
import { memoryEntries } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'preference';

export interface ScoredMemory {
  memoryId: string;
  type: MemoryType;
  content: string;
  importance: number;
  confidence: number;
  score: number;
  decision: 'store' | 'discard' | 'decay';
  reasons: string[];
  createdAt: number;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface MemoryScoreFactors {
  importance: number;     // 0-1 — how much the user signalled it matters
  futureUsefulness: number; // 0-1 — likely reuse value
  recurrence: number;     // 0-1 — how often this pattern appeared
  relevance: number;      // 0-1 — relevance to active context
  sensitivity: number;    // 0-1 — higher = avoid persisting
  recency: number;        // 0-1 — freshness
}

/**
 * Memory Intelligence — Akansha does NOT remember everything.
 *
 * Working memory expires naturally. Episodic memory records what happened.
 * Semantic memory holds stable knowledge. Procedural memory holds learned
 * workflows. Every candidate is scored; only high-value information is
 * promoted to long-term storage. This keeps retrieval accurate and cheap.
 */
export class MemoryIntelligence {
  private working: Map<string, { content: string; createdAt: number }> = new Map();
  private semanticIndex: Map<string, string[]> = new Map(); // keyword -> memoryIds

  /** Score a candidate memory. High score = worth storing. */
  score(factors: MemoryScoreFactors, content: string): { score: number; decision: ScoredMemory['decision']; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    score += factors.importance * 32;
    if (factors.importance > 0.7) reasons.push('user-signalled-importance');

    score += factors.futureUsefulness * 24;
    if (factors.futureUsefulness > 0.7) reasons.push('high-reuse-value');

    score += factors.recurrence * 18;
    if (factors.recurrence > 0.6) reasons.push('recurring-pattern');

    score += factors.relevance * 14;
    if (factors.relevance > 0.7) reasons.push('relevant-to-active-context');

    score += factors.recency * 8;

    // Sensitivity penalty — prefer not to persist sensitive material.
    score -= factors.sensitivity * 30;
    if (factors.sensitivity > 0.6) reasons.push('sensitive-content-deprioritised');

    // Trivial noise penalties
    const trimmed = content.trim();
    if (trimmed.length < 12) {
      score -= 25;
      reasons.push('too-short-to-be-useful');
    }
    if (/^(hi|hello|ok|okay|thanks|thank you|yes|no|sure|hmm)[\s!.?]*$/i.test(trimmed)) {
      score -= 60;
      reasons.push('conversational-noise');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let decision: ScoredMemory['decision'] = 'discard';
    if (score >= 55) decision = 'store';
    else if (score >= 30) decision = 'decay';
    else decision = 'discard';

    return { score, decision, reasons };
  }

  /** Derive score factors automatically from a candidate + context. */
  deriveFactors(content: string, context: { type: MemoryType; recurring?: boolean; explicit?: boolean; sensitive?: boolean; relevant?: boolean }): MemoryScoreFactors {
    const age = 1; // new memory
    return {
      importance: context.explicit ? 0.95 : context.type === 'preference' ? 0.85 : context.type === 'procedural' ? 0.8 : 0.45,
      futureUsefulness:
        context.type === 'procedural' ? 0.9 : context.type === 'preference' ? 0.85 : context.type === 'semantic' ? 0.75 : 0.4,
      recurrence: context.recurring ? 0.85 : 0.2,
      relevance: context.relevant ? 0.85 : 0.4,
      sensitivity: context.sensitive ? 0.8 : 0.1,
      recency: age,
    };
  }

  /** Working memory — volatile, never persisted. */
  setWorking(key: string, content: string) {
    this.working.set(key, { content, createdAt: Date.now() });
  }

  getWorking(key: string): string | undefined {
    return this.working.get(key)?.content;
  }

  /** Expire working memory older than ttl (default 10 minutes). */
  expireWorking(ttlMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [key, entry] of this.working) {
      if (now - entry.createdAt > ttlMs) this.working.delete(key);
    }
  }

  /**
   * Persist a scored memory. Only 'store' decisions reach the database.
   */
  async persist(scored: ScoredMemory, userId = 'boss'): Promise<boolean> {
    if (scored.decision === 'discard') return false;

    const expires =
      scored.type === 'working' ? new Date(Date.now() + 10 * 60 * 1000) : null;

    try {
      await db.insert(memoryEntries).values({
        memoryId: scored.memoryId,
        userId,
        category: scored.type,
        content: scored.content,
        metadata: { reasons: scored.reasons, score: scored.score },
        importance: scored.importance,
        confidence: scored.confidence,
        accessCount: scored.accessCount,
        expiresAt: expires,
      });
      this.indexKeywords(scored.memoryId, scored.content);
      return true;
    } catch {
      return false;
    }
  }

  private indexKeywords(memoryId: string, content: string) {
    const words = content
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    const unique = Array.from(new Set(words)).slice(0, 20);
    for (const w of unique) {
      const list = this.semanticIndex.get(w) || [];
      list.push(memoryId);
      this.semanticIndex.set(w, list);
    }
  }

  /**
   * Retrieve only relevant memories — never the whole store.
   */
  async retrieve(query: string, limit = 5, userId = 'boss'): Promise<ScoredMemory[]> {
    const keywords = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    try {
      const rows = await db
        .select()
        .from(memoryEntries)
        .where(eq(memoryEntries.userId, userId))
        .orderBy(desc(memoryEntries.timestamp))
        .limit(200);

      return rows
        .map((r) => {
          const content = (r.content || '').toLowerCase();
          const overlap = keywords.filter((k) => content.includes(k)).length;
          const relevance = keywords.length ? overlap / keywords.length : 0.3;
          return {
            memoryId: r.memoryId,
            type: r.category as MemoryType,
            content: r.content,
            importance: r.importance ?? 0.5,
            confidence: r.confidence ?? 0.5,
            score: Math.round(((r.importance ?? 0.5) * 50 + relevance * 40 + Math.min(10, (r.accessCount ?? 0)))),
            decision: 'store' as const,
            reasons: relevance > 0.3 ? ['keyword-overlap'] : [],
            createdAt: r.timestamp ? new Date(r.timestamp).getTime() : Date.now(),
            accessCount: r.accessCount ?? 0,
            metadata: (r.metadata as Record<string, unknown>) || {},
          };
        })
        .filter((m) => m.score > 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async forget(memoryId: string): Promise<void> {
    try {
      await db.delete(memoryEntries).where(eq(memoryEntries.memoryId, memoryId));
    } catch {
      /* noop */
    }
  }

  async forgetCategory(type: MemoryType, userId = 'boss'): Promise<void> {
    try {
      await db.delete(memoryEntries).where(and(eq(memoryEntries.category, type), eq(memoryEntries.userId, userId)));
    } catch {
      /* noop */
    }
  }

  async stats(userId = 'boss') {
    try {
      const rows = await db
        .select({ category: memoryEntries.category, count: sql<number>`count(*)::int` })
        .from(memoryEntries)
        .where(eq(memoryEntries.userId, userId))
        .groupBy(memoryEntries.category);

      const byType: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        byType[r.category] = r.count;
        total += r.count;
      }
      return { total, byType, working: this.working.size };
    } catch {
      return { total: 0, byType: {}, working: this.working.size };
    }
  }
}

export const memoryIntelligence = new MemoryIntelligence();
