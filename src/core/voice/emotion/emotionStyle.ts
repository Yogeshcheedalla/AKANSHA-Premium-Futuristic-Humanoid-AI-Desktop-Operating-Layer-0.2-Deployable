/**
 * Emotion / prosody layer — expressive DELIVERY, not claimed feeling.
 *
 * Akansha does not have human emotions and must not pretend to. This selects a
 * speech STYLE (rate/pitch/emphasis) from the actual situation — intent,
 * success/failure, urgency, user wording — so voice delivery is warm/confident
 * on success, calm/transparent on failure, focused/concise when urgent. It feeds
 * the EXISTING single TTS authority (AudioEngine.speak); it never adds a second
 * TTS engine and never changes the FACTS of a response.
 */
export type EmotionStyle =
  | 'NEUTRAL' | 'WARM' | 'EXCITED' | 'CALM' | 'CONCERNED'
  | 'FOCUSED' | 'CELEBRATORY' | 'APOLOGETIC' | 'URGENT';

export interface Prosody { style: EmotionStyle; rate: number; pitch: number; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface StyleInput {
  intent?: string;
  status?: string;          // COMPLETED / FAILED / BLOCKED / ...
  failureClass?: string | null;
  isGreeting?: boolean;
  isAchievement?: boolean;
  urgentWords?: boolean;
  distressedWords?: boolean;
}

/** Pure selection from the situation. Deterministic and unit-testable. */
export function deriveEmotionStyle(i: StyleInput): EmotionStyle {
  if (i.urgentWords) return 'URGENT';
  if (i.distressedWords) return 'CONCERNED';
  if (i.isGreeting) return 'WARM';
  if (i.status === 'FAILED' || i.status === 'BLOCKED' || i.failureClass) return 'APOLOGETIC';
  if (i.isAchievement || i.status === 'COMPLETED') return 'CELEBRATORY';
  if (i.intent === 'coding' || i.intent === 'mission' || i.intent === 'automation') return 'FOCUSED';
  return 'NEUTRAL';
}

/** Map a style to concrete TTS prosody within safe SpeechSynthesisUtterance bounds. */
export function prosodyFor(style: EmotionStyle): Prosody {
  switch (style) {
    case 'WARM': return { style, rate: 0.98, pitch: 1.12 };
    case 'EXCITED': case 'CELEBRATORY': return { style, rate: 1.08, pitch: 1.2 };
    case 'CALM': return { style, rate: 0.92, pitch: 1.02 };
    case 'CONCERNED': case 'APOLOGETIC': return { style, rate: 0.9, pitch: 0.98 };
    case 'FOCUSED': case 'URGENT': return { style, rate: 1.12, pitch: 1.0 };
    default: return { style: 'NEUTRAL', rate: 1.0, pitch: 1.05 };
  }
}

// Lightweight wording cues (never overclaim; just delivery hints).
const URGENT = /\b(urgent|asap|immediately|right now|hurry|quick)\b/i;
const DISTRESS = /\b(exhausted|tired|stressed|anxious|worried|overwhelmed|sad|frustrated|angry)\b/i;
const GREET = /^(hi|hey|hello|good (morning|afternoon|evening)|yo|namaste)\b/i;

export function styleFromTurn(text: string, result: { status?: string; failureClass?: string | null; intent?: string }): Prosody {
  const style = deriveEmotionStyle({
    intent: result.intent,
    status: result.status,
    failureClass: result.failureClass,
    isGreeting: GREET.test((text || '').trim()),
    isAchievement: result.status === 'COMPLETED' && /\b(done|completed|finished|success|opened|sent|scheduled|installed|verified)\b/i.test(result.status || ''),
    urgentWords: URGENT.test(text || ''),
    distressedWords: DISTRESS.test(text || ''),
  });
  const p = prosodyFor(style);
  return { ...p, rate: clamp(p.rate, 0.7, 1.3), pitch: clamp(p.pitch, 0.6, 1.6) };
}
