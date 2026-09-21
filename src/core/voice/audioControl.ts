/**
 * Real-time conversational audio control — PURE decision logic, no browser APIs,
 * so it is unit-testable and provable. This is the audio/TURN layer; it does NOT
 * replace the VoiceStateMachine, AudioEngine, TTS, or MasterOrchestrator — it
 * drives them. Qwen/ASR do NOT provide these decisions; the system does.
 */

export type TurnState =
  | 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'USER_PAUSED'
  | 'FINALIZING' | 'THINKING' | 'ASSISTANT_SPEAKING' | 'BARGE_IN'
  | 'WAITING_FOR_USER' | 'RECOVERING' | 'STOPPING';

// Conversational getUserMedia constraints. The browser's APM applies AEC + noise
// suppression + AGC; the ACTUAL applied state is verified at runtime via
// MediaTrackSettings (never assumed).
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  // highPassFilter is applied by the browser APM alongside the above.
};

export interface EndpointInput {
  speechMs: number;          // total voiced duration in the current utterance
  trailingSilenceMs: number; // continuous silence since the last voiced frame
  partialStableMs: number;   // how long the (partial) transcript has been unchanged
  minSpeechMs: number;       // ignore blips shorter than this
  baseTrailingMs: number;    // baseline endpointing silence
}

/**
 * Endpointing: NOT just "N ms of silence". A short mid-sentence pause must NOT
 * finalize ("open YouTube … in Brave"), while a stable trailing silence must.
 * Returns 'finalize' | 'continue' (keep listening) | 'reject' (blip → discard).
 */
export function decideEndpoint(i: EndpointInput): 'finalize' | 'continue' | 'reject' {
  if (i.speechMs < i.minSpeechMs && i.trailingSilenceMs >= i.baseTrailingMs) return 'reject';
  if (i.speechMs < i.minSpeechMs) return 'continue';
  // Longer trailing window when the transcript has been unstable (still talking),
  // shorter once the partial has settled — reduces premature cut-offs.
  const trailingNeeded = i.partialStableMs >= 400 ? i.baseTrailingMs : i.baseTrailingMs + 500;
  return i.trailingSilenceMs >= trailingNeeded ? 'finalize' : 'continue';
}

export interface BargeInput {
  assistantSpeaking: boolean;
  nearEndSpeechMs: number;   // sustained near-end (post-AEC) speech duration
  energy: number;            // current frame RMS
  threshold: number;         // near-end speech energy gate
  minSpeechMs: number;       // ignore clicks/chairs/fans
}

/**
 * Barge-in: only GENUINE, sustained near-end speech interrupts TTS. A keyboard
 * click / chair / fan (short or low) must NOT. Echo is already suppressed by AEC;
 * we additionally require sustained energy above the gate before stopping speech.
 */
export function decideBargeIn(i: BargeInput): boolean {
  if (!i.assistantSpeaking) return false;
  return i.energy >= i.threshold && i.nearEndSpeechMs >= i.minSpeechMs;
}

/** Own-speech rejection: Akansha's own TTS must never re-trigger a command. */
export function shouldRejectOwnSpeech(opts: { isSpeaking: boolean; echoCancellationActive: boolean }): boolean {
  // With AEC verified active we still guard the turn layer: while the assistant
  // is speaking, do not treat its own audio as a new finalized utterance.
  return opts.isSpeaking;
}

export interface AudioHealth {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  verified: boolean; // true only when read from MediaTrackSettings (real evidence)
}

/** Read the ACTUAL applied audio processing from a live track's settings. */
export function readAudioHealth(settings: MediaTrackSettings): AudioHealth {
  return {
    echoCancellation: settings.echoCancellation === true,
    noiseSuppression: settings.noiseSuppression === true,
    autoGainControl: settings.autoGainControl === true,
    verified: true,
  };
}
