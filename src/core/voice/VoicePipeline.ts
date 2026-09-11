import { clamp } from '../ml/AkanshaML';
import { eventBus } from '../events/EventBus';

/* ═══════════════ AUDIO MODES ═══════════════ */

export type AudioMode = 'MUTED' | 'AMBIENT_STANDBY' | 'LISTENING' | 'ACTIVE_CONVERSATION' | 'PROCESSING' | 'SPEAKING';

export const AUDIO_MODE_LABEL: Record<AudioMode, string> = {
  MUTED: 'Microphone disabled',
  AMBIENT_STANDBY: 'Local wake-word detection only',
  LISTENING: 'Akansha is listening to you',
  ACTIVE_CONVERSATION: 'Continuous turn-taking',
  PROCESSING: 'Understanding…',
  SPEAKING: 'Akansha is responding',
};

export const AUDIO_MODE_PRIVACY: Record<AudioMode, { cloud: boolean; transcribed: boolean; retained: boolean }> = {
  MUTED: { cloud: false, transcribed: false, retained: false },
  AMBIENT_STANDBY: { cloud: false, transcribed: false, retained: false },
  LISTENING: { cloud: true, transcribed: true, retained: false },
  ACTIVE_CONVERSATION: { cloud: true, transcribed: true, retained: false },
  PROCESSING: { cloud: false, transcribed: false, retained: false },
  SPEAKING: { cloud: false, transcribed: false, retained: false },
};

/* ═══════════════ WAKE / VAD / OWNERSHIP ═══════════════ */

export type WakeOutcome = 'NOT_DETECTED' | 'WAKE_WORD' | 'ADDRESSING_PHRASE' | 'CONTINUING_SESSION' | 'BARGE_IN';

export interface AudioFrame {
  /** RMS energy 0-1 */
  level: number;
  /** Estimated speech probability from VAD 0-1 */
  speechProbability: number;
  /** Zero-crossing rate, helps distinguish speech from noise */
  zcr?: number;
  timestamp: number;
}

export interface OwnershipSignals {
  wakeWordDetected?: boolean;
  addressingPhrase?: boolean;      // "hey assistant" / "can you"
  speakerKnown?: boolean;
  speakerIsPrimaryUser?: boolean;
  /** Silence duration in ms before this utterance */
  precedingSilenceMs?: number;
  /** Is there an active voice session? */
  sessionActive?: boolean;
  /** Did the previous turn belong to Akansha? */
  akanshaSpokeLast?: boolean;
  /** Interrogative phrasing detected */
  looksLikeQuestion?: boolean;
  /** Imperative/command phrasing detected */
  looksLikeCommand?: boolean;
  /** Confidence the user is addressing someone else */
  talkingToSomeoneElse?: boolean;
  /** Text if partial ASR is available */
  partialTranscript?: string;
}

export interface OwnershipVerdict {
  owned: boolean;
  confidence: number;
  reason: string;
  shouldExecute: boolean;
}

const WAKE_WORDS = ['akansha', 'akanshaa', 'akansa', 'ok akansha', 'hey akansha'];
const ADDRESSING = ['can you', 'could you', 'please', 'would you', 'i need you', 'help me'];
const NON_ADDRESS = ['he said', 'she said', 'they said', 'as i was saying', 'anyway', 'so basically'];

/**
 * Voice Activity Detection — energy + spectral heuristic.
 * Runs entirely locally. No audio leaves the machine in this stage.
 */
export class VAD {
  private noiseFloor = 0.02;
  private speechFrames = 0;
  private silenceFrames = 0;

  constructor(
    private speechThreshold = 0.35,
    private enterFrames = 3,
    private exitFrames = 12
  ) {}

  observe(frame: AudioFrame): { speaking: boolean; started: boolean; ended: boolean; noiseFloor: number } {
    // Adaptively track the noise floor when not speaking
    if (frame.level < this.noiseFloor * 1.8) {
      this.noiseFloor = this.noiseFloor * 0.95 + frame.level * 0.05;
    }

    const aboveThreshold = frame.speechProbability > this.speechThreshold && frame.level > this.noiseFloor * 2.2;

    const wasSpeaking = this.speechFrames >= this.enterFrames;
    if (aboveThreshold) {
      this.speechFrames++;
      this.silenceFrames = 0;
    } else {
      this.silenceFrames++;
      if (this.silenceFrames > 2) this.speechFrames = Math.max(0, this.speechFrames - 1);
    }
    const nowSpeaking = this.speechFrames >= this.enterFrames;

    return {
      speaking: nowSpeaking,
      started: nowSpeaking && !wasSpeaking,
      ended: !nowSpeaking && wasSpeaking && this.silenceFrames >= this.exitFrames,
      noiseFloor: this.noiseFloor,
    };
  }
}

/**
 * Phrases that indicate the wake word is being MENTIONED rather than used to
 * ADDRESS Akansha. "I was telling her that akansha is a great name" must not
 * trigger a wake.
 */
const THIRD_PERSON_MARKERS = [
  /\b(?:telling|told|said|mentioned|explains?|think|thought|heard)\b[^.]{0,30}\b(?:that|about)\b/,
  /\bthe\s+word\b/,
  /\bis\s+(?:what|a|the|called|named)\b/,
  /\b(?:is|was|are|were|should|would|could|appears?|seems?|means?)\s+(?:a|an|the|what|great|good|nice|my|our)\b/,
  /\b(?:named|called|renamed)\b/,
  /\b(?:notes?|docs?|documentation|file|folder|project|repo|app)\b[^.]{0,20}\b(?:is|has|contains?)\b/,
];

/** Verbs that commonly follow a genuine address and imply a command. */
const COMMAND_LEADS = ['open', 'close', 'start', 'run', 'launch', 'find', 'search', 'show', 'tell', 'explain', 'what', 'how', 'why', 'when', 'where', 'who', 'can', 'could', 'please', 'do', 'make', 'create', 'build', 'delete', 'read', 'write', 'set', 'get', 'check', 'fix', 'help', 'is', 'are', 'will', 'would', 'stop', 'go'];

/**
 * Is this utterance merely MENTIONING the assistant rather than addressing it?
 *
 * This check must apply BOTH at wake time AND during an active session —
 * otherwise any third-person chatter following a genuine wake would be
 * executed as a command.
 */
export function isThirdPersonMention(text: string): boolean {
  const t = (text || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!t) return false;
  return THIRD_PERSON_MARKERS.some((m) => m.test(t));
}

/**
 * Wake-Word Detector — keyword spotting boundary.
 *
 * This is the PRIVACY BOUNDARY. Higher-cost speech recognition must only run
 * after a wake signal or an explicitly configured interaction condition.
 *
 * A wake word only counts when it is used to ADDRESS Akansha — at the start of
 * the utterance (optionally preceded by a greeting/please), or right after an
 * addressing phrase — and followed by a comma or a command lead. A mere
 * mention of the name in third person does not wake the assistant.
 */
export class WakeWordDetector {
  private lastWake = 0;

  detect(text: string): WakeOutcome {
    const t = (text || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!t) return 'NOT_DETECTED';

    if (ADDRESSING.some((a) => t.startsWith(a))) return 'ADDRESSING_PHRASE';

    for (const w of WAKE_WORDS) {
      // 1. Utterance-leading wake word: "akansha, open notepad"
      const leading = new RegExp(`^(?:hey\\s+|ok\\s+|hi\\s+|hello\\s+|please\\s+)?${w}\\b[,.]?\\s*(.*)$`).exec(t);
      if (leading) {
        const rest = (leading[1] || '').trim();
        // If the wake word is followed by predication, it is a mention, not an address:
        // "akansha is a great name" / "akansha should format the disk"
        if (THIRD_PERSON_MARKERS.some((m) => m.test(t))) break;
        if (rest && !COMMAND_LEADS.includes(rest.split(/\s+/)[0])) {
          // Followed by a noun/subject rather than a command verb → likely predication
          break;
        }
        this.lastWake = Date.now();
        return 'WAKE_WORD';
      }

      // 2. Wake word preceded by an address cue: "please akansha do X"
      const cued = new RegExp(`\\b(?:hey|ok|hi|hello|please|hey\\s+there)\\s+${w}\\b`).test(t);
      if (cued) {
        if (THIRD_PERSON_MARKERS.some((m) => m.test(t))) break;
        this.lastWake = Date.now();
        return 'WAKE_WORD';
      }
    }

    // Within a short window after a wake, treat continued speech as the same session
    if (Date.now() - this.lastWake < 12000) return 'CONTINUING_SESSION';
    return 'NOT_DETECTED';
  }

  /** Explicit barge-in: user starts speaking while Akansha is talking. */
  isBargeIn(speaking: boolean, akanshaSpeaking: boolean): boolean {
    return speaking && akanshaSpeaking;
  }
}

/**
 * Conversation Ownership Engine.
 *
 * Decides "was the user actually talking to me?" This directly fixes the
 * false-execution problem: a partial transcript like "for the whole structure…"
 * must NEVER trigger a command.
 */
export class ConversationOwnershipEngine {
  constructor(private wake = new WakeWordDetector()) {}

  /** Detect a wake word in a transcript. */
  wakeOutcome(text: string): WakeOutcome {
    return this.wake.detect(text);
  }

  /**
   * Decide ownership of an utterance. NEVER returns owned=true for a partial
   * or mid-thought transcript.
   */
  decide(signals: OwnershipSignals, isFinalTranscript: boolean): OwnershipVerdict {
    // ── HARD GATE 1: partial ASR never executes ──
    if (!isFinalTranscript) {
      return {
        owned: false,
        confidence: 0,
        reason: 'Partial ASR transcript — display only, never executed',
        shouldExecute: false,
      };
    }

    // ── HARD GATE 2: clearly talking to someone else ──
    const partial = (signals.partialTranscript || '').toLowerCase();
    if (signals.talkingToSomeoneElse || NON_ADDRESS.some((n) => partial.startsWith(n))) {
      return {
        owned: false,
        confidence: 0.9,
        reason: 'Utterance appears addressed to another person',
        shouldExecute: false,
      };
    }

    // ── HARD GATE 3: mentioning the assistant is not addressing it.
    //    This applies EVEN during an active session, so that third-person
    //    chatter following a genuine wake is never executed as a command. ──
    if (isThirdPersonMention(signals.partialTranscript || '')) {
      return {
        owned: false,
        confidence: 0.85,
        reason: 'Assistant mentioned in third person, not addressed',
        shouldExecute: false,
      };
    }

    let score = 0;
    const reasons: string[] = [];

    if (signals.wakeWordDetected) { score += 0.6; reasons.push('wake word'); }
    if (signals.addressingPhrase) { score += 0.3; reasons.push('addressing phrase'); }
    if (signals.sessionActive) { score += 0.35; reasons.push('active session'); }
    if (signals.akanshaSpokeLast) { score += 0.15; reasons.push('Akansha spoke last'); }
    if (signals.looksLikeQuestion) { score += 0.2; reasons.push('question phrasing'); }
    if (signals.looksLikeCommand) { score += 0.25; reasons.push('command phrasing'); }
    if (signals.speakerIsPrimaryUser) { score += 0.15; reasons.push('primary speaker verified'); }
    else if (signals.speakerKnown === false) { score -= 0.35; reasons.push('unknown speaker'); }

    // Long preceding silence suggests the user deliberately started speaking
    if ((signals.precedingSilenceMs ?? 0) > 2500) { score += 0.12; reasons.push('deliberate start after silence'); }

    // Mid-thought markers — trailing conjunction with no completion
    if (/\b(and then|so that|because the|which means|for the whole)\b/i.test(partial) && !/[.?!]$/.test(partial.trim())) {
      score -= 0.45;
      reasons.push('mid-thought fragment');
    }

    const confidence = clamp(score, 0, 1);
    const owned = confidence >= 0.5;

    return {
      owned,
      confidence,
      reason: owned
        ? `Owned (${reasons.join(', ')})`
        : `Not addressed to Akansha (${reasons.join(', ') || 'no ownership signals'})`,
      shouldExecute: owned,
    };
  }
}

/* ═══════════════ SPEAKER VERIFICATION ═══════════════ */

export interface VoiceProfile {
  userId: string;
  /** Embedding from enrolled samples */
  embedding: number[];
  samplesEnrolled: number;
  createdAt: number;
}

/**
 * Speaker Verifier — optional, local, and explicitly NOT authentication.
 *
 * Cosine similarity over speaker embeddings. Used to decide "is the primary
 * user speaking?" — never to authorise a sensitive action on its own.
 */
export class SpeakerVerifier {
  private profiles = new Map<string, VoiceProfile>();
  private threshold = 0.72;

  enrol(userId: string, embeddings: number[][]) {
    if (embeddings.length === 0) return;
    const dim = embeddings[0].length;
    const mean = new Array(dim).fill(0);
    for (const e of embeddings) for (let i = 0; i < dim; i++) mean[i] += e[i] / embeddings.length;
    this.profiles.set(userId, { userId, embedding: mean, samplesEnrolled: embeddings.length, createdAt: Date.now() });
  }

  verify(embedding: number[]): { speaker: string | null; similarity: number; known: boolean } {
    let best: { speaker: string; similarity: number } | null = null;
    for (const p of this.profiles.values()) {
      const sim = cosine(embedding, p.embedding);
      if (!best || sim > best.similarity) best = { speaker: p.userId, similarity: sim };
    }
    if (!best) return { speaker: null, similarity: 0, known: false };
    const known = best.similarity >= this.threshold;
    return { speaker: known ? best.speaker : null, similarity: best.similarity, known };
  }

  calibrate(threshold: number) {
    this.threshold = clamp(threshold, 0.5, 0.95);
  }

  enrolled(): string[] {
    return Array.from(this.profiles.keys());
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/* ═══════════════ SINGLE SPEECH AUTHORITY ═══════════════ */

export interface SpeechRequest {
  speechId: string;
  responseId: string;
  text: string;
  priority: 'normal' | 'important' | 'critical';
}

/**
 * SpeechOutputManager — the ONE authoritative TTS path.
 *
 * No component may call speech synthesis directly. One responseId produces
 * exactly one speechId. Overlapping speech and duplicate TTS are impossible
 * by construction. Barge-in cancels the current stream immediately.
 */
export class SpeechOutputManager {
  private queue: SpeechRequest[] = [];
  private current: SpeechRequest | null = null;
  private spoken = new Set<string>();
  private listeners: Array<(state: { speaking: boolean; text?: string; speechId?: string }) => void> = [];

  /** Enqueue speech. Duplicate responseIds are silently dropped. */
  speak(request: SpeechRequest): { accepted: boolean; reason: string } {
    if (this.spoken.has(request.responseId)) {
      return { accepted: false, reason: `responseId ${request.responseId} already spoken — duplicate suppressed` };
    }
    if (this.current?.responseId === request.responseId) {
      return { accepted: false, reason: 'already speaking this response' };
    }

    // Critical speech pre-empts everything
    if (request.priority === 'critical') {
      this.interrupt();
      this.current = request;
      this.spoken.add(request.responseId);
      this.emit(true);
      return { accepted: true, reason: 'critical priority — immediate' };
    }

    this.queue.push(request);
    if (!this.current) this.advance();
    return { accepted: true, reason: 'queued' };
  }

  private advance() {
    const next = this.queue.shift();
    if (!next) { this.current = null; this.emit(false); return; }
    this.current = next;
    this.spoken.add(next.responseId);
    this.emit(true);
  }

  /** Barge-in: stop immediately, new request takes priority. */
  interrupt(): { interrupted: boolean; speechId?: string } {
    const id = this.current?.speechId;
    if (this.current) {
      eventBus.emit('speech.interrupted', 'SpeechOutputManager', { speechId: id, responseId: this.current.responseId });
      this.current = null;
      this.queue = [];
      this.emit(false);
      return { interrupted: true, speechId: id };
    }
    return { interrupted: false };
  }

  /** Mark the current speech as finished. */
  complete() {
    if (this.current) {
      eventBus.emit('speech.completed', 'SpeechOutputManager', { speechId: this.current.speechId });
      this.current = null;
      this.advance();
    }
  }

  status() {
    return {
      speaking: !!this.current,
      current: this.current ? { speechId: this.current.speechId, responseId: this.current.responseId, priority: this.current.priority } : null,
      queueDepth: this.queue.length,
      totalSpoken: this.spoken.size,
    };
  }

  onStateChange(cb: (s: { speaking: boolean; text?: string; speechId?: string }) => void) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }

  private emit(speaking: boolean) {
    this.listeners.forEach((l) =>
      l({ speaking, text: this.current?.text, speechId: this.current?.speechId })
    );
  }
}

/* ═══════════════ VOICE PIPELINE ═══════════════ */

export interface VoicePipelineState {
  mode: AudioMode;
  vad: { speaking: boolean; noiseFloor: number };
  wake: WakeOutcome;
  ownership: OwnershipVerdict | null;
  speech: ReturnType<SpeechOutputManager['status']>;
  privacy: { cloud: boolean; transcribed: boolean; retained: boolean };
  lastWakeAt: number | null;
  sessionActive: boolean;
}

/**
 * Voice Pipeline — the complete, correctly-gated always-available microphone.
 *
 *   MICROPHONE → LOCAL BUFFER → VAD → WAKE-WORD → OWNERSHIP → FINAL-ASR → INTENT
 *
 * In AMBIENT_STANDBY nothing is transcribed, nothing leaves the machine, and
 * nothing is retained. Only after a wake signal does ASR begin.
 */
export class VoicePipeline {
  private mode: AudioMode = 'AMBIENT_STANDBY';
  private vad = new VAD();
  private ownershipEngine = new ConversationOwnershipEngine();
  private speakerVerifier = new SpeakerVerifier();
  private speechManager = new SpeechOutputManager();
  private lastWakeAt: number | null = null;
  private sessionActive = false;
  private lastVad = { speaking: false, noiseFloor: 0.02 };
  private lastWakeOutcome: WakeOutcome = 'NOT_DETECTED';
  private lastOwnership: OwnershipVerdict | null = null;
  private sessionTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Explicit hard kill-switch. */
  setMuted(muted: boolean) {
    if (muted) {
      this.mode = 'MUTED';
      this.sessionActive = false;
      this.speechManager.interrupt();
      if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
    } else {
      this.mode = 'AMBIENT_STANDBY';
    }
    eventBus.emit('avatar.state_changed', 'VoicePipeline', { mode: this.mode });
  }

  /** Process a local audio frame. No transcription happens here. */
  processAudio(frame: AudioFrame): { transitioned: boolean; mode: AudioMode } {
    if (this.mode === 'MUTED') return { transitioned: false, mode: this.mode };

    const result = this.vad.observe(frame);
    this.lastVad = { speaking: result.speaking, noiseFloor: result.noiseFloor };

    // Speech detected in standby → arm, but do NOT transcribe yet
    if (result.started && this.mode === 'AMBIENT_STANDBY') {
      this.mode = 'LISTENING';
      return { transitioned: true, mode: this.mode };
    }

    // Speech ended → hand off for wake/ownership resolution
    if (result.ended && (this.mode === 'LISTENING' || this.mode === 'ACTIVE_CONVERSATION')) {
      this.mode = 'PROCESSING';
      return { transitioned: true, mode: this.mode };
    }

    return { transitioned: false, mode: this.mode };
  }

  /**
   * Resolve a FINAL transcript through the ownership gate.
   * This is the ONLY path from speech to execution.
   */
  resolveUtterance(
    transcript: string,
    isFinal: boolean,
    signals: Omit<OwnershipSignals, 'partialTranscript'> = {}
  ): { ownership: OwnershipVerdict; wake: WakeOutcome; execute: boolean } {
    const wake = this.ownershipEngine.wakeOutcome(transcript);
    this.lastWakeOutcome = wake;

    const ownership = this.ownershipEngine.decide(
      {
        ...signals,
        partialTranscript: transcript,
        wakeWordDetected: wake === 'WAKE_WORD',
        addressingPhrase: wake === 'ADDRESSING_PHRASE',
        sessionActive: this.sessionActive,
      },
      isFinal
    );
    this.lastOwnership = ownership;

    if (wake === 'WAKE_WORD') {
      this.lastWakeAt = Date.now();
      this.sessionActive = true;
      this.mode = 'ACTIVE_CONVERSATION';
      if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
      // Auto-close the session after inactivity
      this.sessionTimeout = setTimeout(() => {
        this.sessionActive = false;
        if (this.mode !== 'MUTED') this.mode = 'AMBIENT_STANDBY';
      }, 20000);
    } else if (!ownership.owned && !this.sessionActive) {
      this.mode = this.mode === 'MUTED' ? 'MUTED' : 'AMBIENT_STANDBY';
    }

    return { ownership, wake, execute: ownership.shouldExecute && isFinal };
  }

  /** Akansha speaks — exactly once per response. */
  speak(responseId: string, text: string, priority: SpeechRequest['priority'] = 'normal') {
    return this.speechManager.speak({
      speechId: `speech-${responseId}`,
      responseId,
      text,
      priority,
    });
  }

  /** User barged in — stop speaking instantly. */
  interruptSpeech() {
    return this.speechManager.interrupt();
  }

  getSpeakerVerifier() { return this.speakerVerifier; }
  getSpeechManager() { return this.speechManager; }

  getState(): VoicePipelineState {
    return {
      mode: this.mode,
      vad: this.lastVad,
      wake: this.lastWakeOutcome,
      ownership: this.lastOwnership,
      speech: this.speechManager.status(),
      privacy: AUDIO_MODE_PRIVACY[this.mode],
      lastWakeAt: this.lastWakeAt,
      sessionActive: this.sessionActive,
    };
  }
}

export const voicePipeline = new VoicePipeline();
