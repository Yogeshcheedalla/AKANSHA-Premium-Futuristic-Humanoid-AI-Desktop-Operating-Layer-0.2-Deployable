/**
 * Akansha continuous-voice state machine (pure, typed).
 *
 * Models the CONVERSATION-level lifecycle the voice UI needs. It is a decision layer,
 * NOT a second audio pipeline: the single AudioEngine still owns mic/ASR/TTS. This maps
 * user/system events to allowed transitions and rejects invalid ones, and provides an
 * exactly-once guard so a duplicated event (double keypress, double ASR-final, double
 * TTS-complete, double barge-in) never causes a duplicate action.
 */
export type VoicePhase =
  | 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'THINKING' | 'SPEAKING'
  | 'WAITING_FOR_FOLLOWUP' | 'INTERRUPTED' | 'STOPPING'
  | 'ERROR' | 'PERMISSION_REQUIRED' | 'UNAVAILABLE';

export type VoiceEvent =
  | 'ACTIVATE' | 'PUSH_TO_TALK' | 'RELEASE_PTT' | 'FINAL_ASR' | 'TRANSCRIPT_ACCEPTED'
  | 'RESPONSE_READY' | 'TTS_COMPLETE' | 'USER_SPEECH' | 'BARGE_IN' | 'TTS_STOPPED'
  | 'STOP' | 'CLEANUP' | 'PERMISSION_ERROR' | 'PROVIDER_ERROR' | 'TIMEOUT';

type Table = { [S in VoicePhase]?: Partial<Record<VoiceEvent, VoicePhase>> };

const T: Table = {
  IDLE: { ACTIVATE: 'LISTENING', PUSH_TO_TALK: 'LISTENING', PERMISSION_ERROR: 'PERMISSION_REQUIRED', PROVIDER_ERROR: 'UNAVAILABLE' },
  LISTENING: { FINAL_ASR: 'TRANSCRIBING', STOP: 'STOPPING', BARGE_IN: 'INTERRUPTED', TIMEOUT: 'IDLE', PROVIDER_ERROR: 'ERROR' },
  TRANSCRIBING: { TRANSCRIPT_ACCEPTED: 'THINKING', STOP: 'STOPPING', PROVIDER_ERROR: 'ERROR' },
  THINKING: { RESPONSE_READY: 'SPEAKING', STOP: 'STOPPING', PROVIDER_ERROR: 'ERROR' },
  SPEAKING: { TTS_COMPLETE: 'WAITING_FOR_FOLLOWUP', BARGE_IN: 'INTERRUPTED', STOP: 'STOPPING', PROVIDER_ERROR: 'ERROR' },
  WAITING_FOR_FOLLOWUP: { USER_SPEECH: 'LISTENING', ACTIVATE: 'LISTENING', PUSH_TO_TALK: 'LISTENING', STOP: 'STOPPING', TIMEOUT: 'IDLE' },
  INTERRUPTED: { TTS_STOPPED: 'LISTENING', USER_SPEECH: 'LISTENING', FINAL_ASR: 'TRANSCRIBING', STOP: 'STOPPING' },
  STOPPING: { CLEANUP: 'IDLE' },
  ERROR: { ACTIVATE: 'LISTENING', STOP: 'STOPPING', CLEANUP: 'IDLE' },
  PERMISSION_REQUIRED: { ACTIVATE: 'LISTENING', STOP: 'STOPPING', CLEANUP: 'IDLE' },
  UNAVAILABLE: { ACTIVATE: 'LISTENING', CLEANUP: 'IDLE' },
};

/** Returns the next phase, or null if the transition is invalid (rejected). */
export function transition(phase: VoicePhase, event: VoiceEvent): VoicePhase | null {
  return T[phase]?.[event] ?? null;
}

export function isValidTransition(phase: VoicePhase, event: VoiceEvent): boolean {
  return transition(phase, event) !== null;
}

/**
 * Exactly-once guard: a stable id (utteranceId/requestId/speechId) is processed at most
 * once. A duplicate delivery returns false so callers skip the action — never 2+ executions.
 */
export class OnceGuard {
  private seen = new Set<string>();
  /** true the FIRST time an id is seen; false on duplicates. */
  claim(id: string): boolean {
    if (!id) return true; // no id → don't block (caller responsible)
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
  reset(): void { this.seen.clear(); }
  get size(): number { return this.seen.size; }
}
