/**
 * Deterministic voice/text phrasing for the AI-mode switch.
 *
 * "enable offline mode" / "go online" are ROUTING-policy changes, not desktop
 * actions — they map to the EXISTING ModelRouter policy via applyAiMode.
 * Anything that merely ASKS about modes ("what is offline mode") must NOT
 * match, so the question forms are explicitly excluded.
 */
import type { AiMode } from './AiMode';

export interface ModePhrase { mode: AiMode }

const OFFLINE = /^\s*(?:please\s+|can you\s+)?(?:enable|switch to|set|use|turn on|go(?:\s+to)?|activate)\s+(?:the\s+)?(?:fully\s+)?offline(?:\s+ai)?(?:\s+mode)?\s*[.!?,]*$/i;
const ONLINE = /^\s*(?:please\s+|can you\s+)?(?:enable|switch to|set|use|turn on|go(?:\s+to)?|activate)\s+(?:the\s+)?(?:online|cloud)(?:\s+ai)?(?:\s+mode)?\s*[.!?,]*$/i;
const BOTH = /^\s*(?:enable|switch to|set|use)\s+both(?:\s+mode)?\s*[.!?,]*$/i;
const AUTO = /^\s*(?:enable|switch to|set|use)\s+(?:auto|balanced)(?:\s+mode)?\s*[.!?,]*$/i;

// Questions are NOT commands — "what is offline mode" must reach the model.
const QUESTION = /^(?:what|why|how|when|is|are|can|does|do|tell me)\b/i;

export function mapToAiModePhrase(text: string): ModePhrase | null {
  const t = (text || '').trim();
  if (!t || QUESTION.test(t)) return null;
  if (OFFLINE.test(t)) return { mode: 'offline' };
  if (ONLINE.test(t)) return { mode: 'cloud' };
  if (BOTH.test(t)) return { mode: 'both' };
  if (AUTO.test(t)) return { mode: 'auto' };
  return null;
}
