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

const OFFLINE = /^\s*(?:please\s+|can you\s+)?(?:enable|switch to|set|use|turn on|go(?:\s+to)?|activate)\s+(?:the\s+)?(?:fully\s+)?(?:offline(?:\s+ai)?|local(?:\s+ai)?)(?:\s+mode)?\s*[.!?,]*$/i;
const ONLINE = /^\s*(?:please\s+|can you\s+)?(?:enable|switch to|set|use|turn on|go(?:\s+to)?|activate)\s+(?:the\s+)?(?:online|cloud|free(?:\s+ai)?)(?:\s+mode)?\s*[.!?,]*$/i;
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

// ── Guided offline model-install flow ────────────────────────────────────
// "show recommended models" / "what can I install" → surface recommendations.
// "install recommended model" / "install this" / "yes install it" → start the
// real install job for the top fit. Questions ("what is a recommended model?")
// are excluded so they still reach the model.
const SHOW_RECO = /^\s*(?:please\s+)?(?:show|list|display|see|open)(?: me)?(?: the| your| some)?(?: recommended| best| suggested| available)?\s*(?:local\s*)?(?:ai\s*)?models?(?:\s+for\s+(?:this|my)\s+(?:device|pc|machine|computer))?\s*[.!?,]*$|^\s*(?:what|which)\s+(?:models?|ai\s+models?)\s+(?:can\s+i|should\s+i|are\s+(?:available|recommended))\b|^\s*(?:what|which)\b[\s\S]*\bmodels?\b[\s\S]*\b(?:install|recommend|should|can|suitable|run|best|top|available|free)\b|\b(?:recommend|suggest)\b[\s\S]*\bmodels?\b|^\s*(?:the\s+)?(?:best|recommended|top)\b[\s\S]*\bmodels?\b/i;
const INSTALL_RECO = /^\s*(?:please\s+)?(?:install|download|set\s?up|add|get)(?: the| this| a)?\s*(?:recommended| best| suggested| that| it)?\s*(?:model|ai\s*model|one|this one)?\s*[.!?,]*$|^\s*(?:yes[,]?\s+)?(?:install|do it|go ahead|install it|install this)\b/i;

export type ModelFlowCommand = 'show-recommendations' | 'install-recommended';

export function parseModelFlowCommand(text: string): ModelFlowCommand | null {
  const t = (text || '').trim();
  if (!t) return null;
  if (INSTALL_RECO.test(t)) return 'install-recommended';
  if (SHOW_RECO.test(t)) return 'show-recommendations';
  return null;
}
