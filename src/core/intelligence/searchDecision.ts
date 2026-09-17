/**
 * SearchDecision — ONE authoritative policy for whether a request needs web
 * search, a connected service, a desktop action, memory, or just model reasoning.
 * It DECIDES; it never performs or claims a search. The existing WebCapability +
 * MasterOrchestrator do the actual work when the decision says so.
 */
export type SearchMode = 'NO_SEARCH' | 'LOCAL_KNOWLEDGE' | 'WEB_SEARCH' | 'CONNECTED_SERVICE' | 'DESKTOP_ACTION' | 'MODEL_ONLY';

export interface SearchDecision {
  mode: SearchMode;
  reason: string;
  requiresCurrentInfo: boolean;
}

const CURRENT_CUES = /\b(today|todays|now|current|latest|recent|weather|price|news|score|version|release|as of|this week|live)\b/i;
const EXPLICIT_SEARCH = /\b(search|look up|google|find online|documentation|docs|reference|website|web)\b/i;
const DESKTOP_ACTION = /\b(open|launch|close|start|stop|minimize|maximize|click|type|create (a )?folder|delete|move|rename|screenshot|print)\b/i;
const MEMORY_RECALL = /\b(what did i (say|tell you)|remember\b|my (project|preference|name)|you know (that|i)|earlier|last time)\b/i;
const EDUCATIONAL = /\b(explain|what is|what are|how (do|does|to)|define|difference between|why)\b/i;

export function decideSearch(
  text: string,
  ctx: { hasMemoryHit?: boolean; networkAvailable?: boolean; connectedServices?: string[] } = {}
): SearchDecision {
  const t = (text || '').trim();
  if (!t) return { mode: 'NO_SEARCH', reason: 'empty', requiresCurrentInfo: false };

  if (DESKTOP_ACTION.test(t) && !EXPLICIT_SEARCH.test(t)) {
    return { mode: 'DESKTOP_ACTION', reason: 'desktop action verb', requiresCurrentInfo: false };
  }
  if (MEMORY_RECALL.test(t) || ctx.hasMemoryHit) {
    return { mode: 'LOCAL_KNOWLEDGE', reason: 'answer from memory/context', requiresCurrentInfo: false };
  }
  const wantsCurrent = CURRENT_CUES.test(t) || EXPLICIT_SEARCH.test(t);
  if (wantsCurrent) {
    if (ctx.networkAvailable === false) {
      // Honest: current information is needed but there is no connection.
      return { mode: 'NO_SEARCH', reason: 'requires an online connection (unavailable)', requiresCurrentInfo: true };
    }
    return { mode: 'WEB_SEARCH', reason: 'current/external information requested', requiresCurrentInfo: true };
  }
  if (EDUCATIONAL.test(t)) {
    return { mode: 'MODEL_ONLY', reason: 'answerable from model knowledge, no live data needed', requiresCurrentInfo: false };
  }
  return { mode: 'NO_SEARCH', reason: 'no retrieval signal', requiresCurrentInfo: false };
}
