/**
 * Token continuation — spec item #10. For long answers a model truncates because
 * it hit its OUTPUT token cap (finish_reason === 'length'), we ask the SAME route
 * to continue from the exact logical point, preserving prior text, and merge the
 * pieces. This is bounded and honest: a hard continuation ceiling, a no-progress
 * guard, and completion verification. It is explicitly NOT "unlimited context" —
 * once the ceiling is hit we return what we have and mark it truncated.
 */
import type { ChatMessage, ModelResponse } from '../models/ModelProvider';

/** A response is truncated only when the provider says it stopped at the length cap. */
export function isTruncated(finishReason?: string): boolean {
  return String(finishReason || '').toLowerCase() === 'length';
}

export interface ContinuationRequestBase {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Build the follow-up request: original conversation + the assistant's partial
 * answer as real prior turns + a crisp instruction to continue, not repeat.
 */
export function buildContinuationMessages(base: ContinuationRequestBase, accumulated: string): ChatMessage[] {
  return [
    ...base.messages,
    { role: 'assistant', content: accumulated },
    {
      role: 'user',
      content:
        'Continue your previous answer EXACTLY from where it stopped. Do not repeat any text already written. Do not restate the question. Only output the remaining continuation.',
    },
  ];
}

/** Heuristic: is the partial already a complete sentence/thought? Avoid needless continuation. */
export function looksComplete(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  // Ends in terminal punctuation and not mid-list/mid-code fence → likely complete.
  const endsTerminal = /[.!?]"?'?`?\s*$/.test(t);
  const openFence = (t.match(/```/g) || []).length % 2 !== 0;
  const endsOpenList = /[,:;]\s*$/.test(t);
  return endsTerminal && !openFence && !endsOpenList;
}

/** Merge a continuation into the accumulated answer. Removes the duplicated
 *  seam (the longest suffix of `acc` that equals a prefix of `next`), then joins
 *  with a single space — models frequently repeat a few trailing tokens when told
 *  to continue. */
export function mergeResponses(acc: string, next: string): string {
  const a = String(acc || '');
  let b = String(next || '').replace(/^\s+/, '');
  if (!b) return a;
  const maxWin = Math.min(40, a.length, b.length);
  let overlap = 0;
  for (let k = maxWin; k > 0; k--) {
    if (a.slice(-k).toLowerCase() === b.slice(0, k).toLowerCase()) { overlap = k; break; }
  }
  if (overlap) b = b.slice(overlap).replace(/^\s+/, '');
  if (!b) return a;
  const sep = a && b && !/\s$/.test(a) && !/^\s/.test(b) ? ' ' : '';
  return a + sep + b;
}

function sumUsage(a: ModelResponse['usage'], b: ModelResponse['usage']): ModelResponse['usage'] {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export interface ContinuationDeps {
  /** Issue one model turn against the chosen route (injected for testability). */
  generate: (messages: ChatMessage[], maxTokens?: number) => Promise<ModelResponse>;
  base: ContinuationRequestBase;
  first: ModelResponse;
  /** Hard ceiling on extra continuation turns (never run away). */
  maxContinuations?: number;
  signal?: AbortSignal;
  shouldStop?: () => boolean; // e.g. an active AbortSignal → stop merging more
}

export interface ContinuationResult {
  content: string;
  finishReason: string;
  usage?: ModelResponse['usage'];
  turns: number;
  continuationUsed: number;
  truncated: boolean; // still capped after the ceiling → be honest about it
  madeProgress: boolean; // at least one continuation added real text
}

/**
 * Drive bounded continuation for a truncated first response. Pure w.r.t. its deps:
 * it performs no I/O itself; the caller's `generate` does.
 */
export async function continueIfTruncated(deps: ContinuationDeps): Promise<ContinuationResult> {
  const ceiling = Math.max(0, Math.min(deps.maxContinuations ?? 2, 5));
  let res = deps.first;
  let content = res.content || '';
  let usage = res.usage;
  let continuationUsed = 0;
  let madeProgress = false;

  // Only continue when the provider says it hit the length cap AND the text
  // doesn't already look complete. Guards prevent infinite/pedantic continuation.
  while (isTruncated(res.finishReason) && !looksComplete(content) && continuationUsed < ceiling) {
    if (deps.shouldStop?.()) break;
    const messages = buildContinuationMessages({ ...deps.base }, content);
    let next: ModelResponse;
    try {
      next = await deps.generate(messages, deps.base.maxTokens);
    } catch {
      // A failed continuation must not lose the partial we already have.
      break;
    }
    const added = (next.content || '').trim();
    if (!added) break; // no progress → stop rather than loop
    const before = content.length;
    content = mergeResponses(content, next.content);
    if (content.length > before) madeProgress = true;
    usage = sumUsage(usage, next.usage);
    res = { ...next, content } as ModelResponse;
    continuationUsed += 1;
  }

  return {
    content,
    finishReason: res.finishReason,
    usage,
    turns: 1 + continuationUsed,
    continuationUsed,
    truncated: isTruncated(res.finishReason),
    madeProgress,
  };
}
