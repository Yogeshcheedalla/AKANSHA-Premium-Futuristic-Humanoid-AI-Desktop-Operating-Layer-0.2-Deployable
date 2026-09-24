/**
 * Context budgeting — spec item #9. Preserve long missions WITHOUT exceeding a
 * model's context window. This is deliberately NOT a second brain or a fake
 * "infinite context": it (a) keeps every SYSTEM instruction, (b) keeps the most
 * RECENT turns verbatim up to a token budget, and (c) compresses the OLDEST
 * dropped turns into a single honest extractive digest (truncation, not a
 * hallucinated summary). When a model's context window is unknown we do nothing
 * (never guess a limit), so existing behavior is preserved.
 *
 * Token counts are estimates (~4 chars/token) unless the caller supplies real
 * counts; they are used only to decide what to trim, never shown as fact.
 */
import type { ChatMessage } from '../models/ModelProvider';

export function estimateTokens(text: string): number {
  const t = String(text || '');
  if (!t) return 0;
  // ~4 chars per token is the common heuristic for English; intentionally rough.
  return Math.ceil(t.length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0); // +4 per turn for roles/framing
}

export interface BudgetInput {
  messages: ChatMessage[];
  /** Model context window in tokens. If absent/<=0 we do NOT trim (no guessing). */
  contextWindow?: number;
  /** Tokens to reserve for the model's reply. */
  reserveForReply?: number;
  /** Hard safety cap even when contextWindow is generous (0 = none). */
  maxInputTokens?: number;
}

export interface BudgetResult {
  messages: ChatMessage[];
  trimmed: boolean;
  droppedTurns: number;
  summarized: boolean;
  estimatedInputTokens: number;
  budget: number;
}

const SUMMARY_PREFIX = 'Conversation summary (older turns condensed to fit context): ';

/**
 * Trim a conversation to fit a token budget. Strategy:
 *   keep all system turns → if still over, keep last N user/assistant turns
 *   within budget → prepend ONE extractive digest line describing what was dropped.
 * Never drops a system instruction. Never invents content: the digest only states
 * how many turns were omitted and shows a short verbatim snippet of the first and
 * last dropped turn so continuity is honest.
 */
export function budgetContext(input: BudgetInput): BudgetResult {
  const { messages } = input;
  const reserve = input.reserveForReply ?? 1024;

  const hasWindow = typeof input.contextWindow === 'number' && input.contextWindow > 0;
  if (!hasWindow) {
    // No verified context window → do not guess. Return untouched.
    return { messages, trimmed: false, droppedTurns: 0, summarized: false, estimatedInputTokens: estimateMessagesTokens(messages), budget: Number.POSITIVE_INFINITY };
  }

  let budget = Math.max(1, input.contextWindow! - reserve);
  if (input.maxInputTokens && input.maxInputTokens > 0) budget = Math.min(budget, input.maxInputTokens);

  const total = estimateMessagesTokens(messages);
  if (total <= budget) {
    return { messages, trimmed: false, droppedTurns: 0, summarized: false, estimatedInputTokens: total, budget };
  }

  const system = messages.filter((m) => m.role === 'system');
  const dialog = messages.filter((m) => m.role !== 'system');

  // Reserve tokens for the system turns + a digest line, then keep newest dialog turns.
  const sysTokens = estimateMessagesTokens(system);
  let keepBudget = Math.max(0, budget - sysTokens - estimateTokens(SUMMARY_PREFIX) - 128);

  const keptReverse: ChatMessage[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = dialog.length - 1; i >= 0; i--) {
    const cost = estimateTokens(dialog[i].content) + 4;
    if (used + cost > keepBudget && keptReverse.length > 0) {
      dropped = i + 1; // everything up to index i is dropped
      break;
    }
    used += cost;
    keptReverse.push(dialog[i]);
    if (i === 0) dropped = 0;
  }
  const kept = keptReverse.reverse();

  if (dropped <= 0) {
    return { messages, trimmed: false, droppedTurns: 0, summarized: false, estimatedInputTokens: total, budget };
  }

  // Honest extractive digest of the omitted window.
  const omitted = dialog.slice(0, dropped);
  const first = snippet(omitted[0]?.content);
  const last = snippet(omitted[omitted.length - 1]?.content);
  const digest: ChatMessage = {
    role: 'system',
    content: `${SUMMARY_PREFIX}${dropped} earlier turn(s) were omitted for length. First omitted: "${first}". Most recent omitted: "${last}".`,
  };

  const out = [...system, digest, ...kept];
  return { messages: out, trimmed: true, droppedTurns: dropped, summarized: true, estimatedInputTokens: estimateMessagesTokens(out), budget };
}

function snippet(s?: string): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}
