'use client';

/**
 * AudioEngine — the REAL client-side voice transport for Akansha.
 *
 * Runs in the browser (the only place with microphone + speaker access) and
 * wires actual Web APIs to Akansha's server-side decision brain:
 *   getUserMedia + AudioContext + AnalyserNode  → capture + local VAD (RMS energy)
 *   SpeechRecognition (Web Speech API)          → ASR (partial = UI only, final = pipeline)
 *   speechSynthesis                             → TTS through ONE authoritative path
 *
 * The pure decision logic (state machine, duplicate-speech suppression,
 * barge-in, partial-vs-final gating) is isolated into side-effect-free methods
 * so it can be unit-tested in Node without any hardware. Browser APIs are only
 * touched inside guarded methods, so importing this module never crashes SSR.
 *
 * It NEVER fabricates readiness: if mic/ASR/TTS are unavailable, capabilities()
 * reports false and the UI must show the truth.
 */

export type VoiceState =
  | 'MUTED'
  | 'STANDBY'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SPEAKING'
  | 'INTERRUPTED'
  | 'ERROR';

export type VoiceError =
  | 'MICROPHONE_UNAVAILABLE'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'AUDIO_DEVICE_CHANGED'
  | 'ASR_UNAVAILABLE'
  | 'ASR_TIMEOUT'
  | 'ASR_LOW_CONFIDENCE'
  | 'TTS_UNAVAILABLE'
  | 'TTS_TIMEOUT'
  | 'PLAYBACK_ERROR'
  | 'DEVICE_BUSY'
  | 'MODEL_UNAVAILABLE';

const ALLOWED: Record<VoiceState, VoiceState[]> = {
  MUTED: ['STANDBY'],
  STANDBY: ['LISTENING', 'SPEAKING', 'MUTED', 'ERROR'],
  LISTENING: ['PROCESSING', 'STANDBY', 'SPEAKING', 'MUTED', 'ERROR'],
  PROCESSING: ['STANDBY', 'LISTENING', 'SPEAKING', 'ERROR'],
  SPEAKING: ['INTERRUPTED', 'STANDBY', 'LISTENING', 'ERROR'],
  INTERRUPTED: ['LISTENING', 'STANDBY', 'SPEAKING'],
  ERROR: ['STANDBY', 'MUTED', 'LISTENING'],
};

export interface VoiceCapabilities {
  mic: boolean;
  asr: boolean;
  tts: boolean;
}

export interface FinalUtterance {
  utteranceId: string;
  transcript: string;
}

type StateListener = (s: { state: VoiceState; error?: VoiceError }) => void;
type UtteranceListener = (u: FinalUtterance) => void;
type PartialListener = (text: string) => void;

export class AudioEngine {
  private state: VoiceState = 'STANDBY';
  private error?: VoiceError;
  private spokenResponseIds = new Set<string>();
  private speaking = false;
  private stateListeners = new Set<StateListener>();
  private utteranceListeners = new Set<UtteranceListener>();
  private partialListeners = new Set<PartialListener>();

  // Browser objects (only populated in the browser).
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private recognition: any = null;
  private currentResponseId: string | null = null;

  // ── Pure, testable logic (no DOM) ────────────────────────────────────
  canTransition(to: VoiceState): boolean {
    return this.state === to || ALLOWED[this.state].includes(to);
  }

  transition(to: VoiceState, err?: VoiceError): boolean {
    if (!this.canTransition(to)) return false;
    this.state = to;
    this.error = err;
    this.emitState();
    return true;
  }

  /** VAD gate: should we move from standby to listening on this frame? */
  decideVad(state: VoiceState, speaking: boolean): VoiceState {
    if (state === 'MUTED' || state === 'SPEAKING') return state;
    if (speaking && state === 'STANDBY') return 'LISTENING';
    if (!speaking && state === 'LISTENING') return 'STANDBY';
    return state;
  }

  /** Partial ASR must NEVER be treated as an executable command. */
  static isExecutable(isFinal: boolean): boolean {
    return isFinal === true;
  }

  /** Barge-in: user speech while we are speaking must cancel output. */
  decideBargeIn(state: VoiceState, userSpeaking: boolean): boolean {
    return state === 'SPEAKING' && userSpeaking;
  }

  /** Duplicate-speech suppression: one responseId speaks at most once. */
  shouldSpeak(responseId: string): boolean {
    if (this.spokenResponseIds.has(responseId)) return false;
    this.spokenResponseIds.add(responseId);
    return true;
  }

  getState(): { state: VoiceState; error?: VoiceError } {
    return { state: this.state, error: this.error };
  }

  capabilities(): VoiceCapabilities {
    if (typeof window === 'undefined') return { mic: false, asr: false, tts: false };
    const g = globalThis as any;
    return {
      mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      asr: !!(g.SpeechRecognition || g.webkitSpeechRecognition),
      tts: typeof window !== 'undefined' && 'speechSynthesis' in window,
    };
  }

  onState(cb: StateListener) { this.stateListeners.add(cb); return () => this.stateListeners.delete(cb); }
  onFinalUtterance(cb: UtteranceListener) { this.utteranceListeners.add(cb); return () => this.utteranceListeners.delete(cb); }
  onPartial(cb: PartialListener) { this.partialListeners.add(cb); return () => this.partialListeners.delete(cb); }

  private emitState() { this.stateListeners.forEach((l) => l({ state: this.state, error: this.error })); }

  // ── Real browser capture + VAD ───────────────────────────────────────
  async start(): Promise<{ ok: boolean; error?: VoiceError }> {
    if (typeof window === 'undefined') return { ok: false, error: 'MICROPHONE_UNAVAILABLE' };
    const caps = this.capabilities();
    if (!caps.mic) { this.transition('ERROR', 'MICROPHONE_UNAVAILABLE'); return { ok: false, error: 'MICROPHONE_UNAVAILABLE' }; }
    // Idempotent: exactly ONE microphone pipeline. If we already hold a live
    // stream, do NOT request a second one (this is what prevents duplicate
    // getUserMedia when both the header control and the Command workspace start).
    if (this.mediaStream && this.mediaStream.active) {
      if (this.state === 'ERROR' || this.state === 'STANDBY' || this.state === 'MUTED') this.transition('LISTENING');
      return { ok: true };
    }
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      const data = new Uint8Array(this.analyser.fftSize);
      this.vadTimer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const speaking = rms > 0.02;
        const next = this.decideVad(this.state, speaking);
        if (next !== this.state) this.transition(next);
      }, 120);
      this.transition('LISTENING');
      return { ok: true };
    } catch (e: any) {
      const err: VoiceError = /permission|denied/i.test(String(e?.name || e?.message)) ? 'MICROPHONE_PERMISSION_DENIED' : 'MICROPHONE_UNAVAILABLE';
      this.transition('ERROR', err);
      return { ok: false, error: err };
    }
  }

  // ── Real ASR (Web Speech API) ────────────────────────────────────────
  startListening(): { ok: boolean; error?: VoiceError } {
    const g = globalThis as any;
    const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
    if (!SR) { this.transition('ERROR', 'ASR_UNAVAILABLE'); return { ok: false, error: 'ASR_UNAVAILABLE' }; }
    if (this.recognition) return { ok: true };
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          // FINAL → executable pipeline, with a unique utteranceId.
          const utteranceId = `utt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          this.transition('PROCESSING');
          this.utteranceListeners.forEach((l) => l({ utteranceId, transcript: text.trim() }));
        } else {
          // PARTIAL → UI only, never executed.
          interim += text;
        }
      }
      if (interim) this.partialListeners.forEach((l) => l(interim));
    };
    rec.onerror = (e: any) => {
      const err: VoiceError = e?.error === 'not-allowed' ? 'MICROPHONE_PERMISSION_DENIED' : e?.error === 'no-speech' ? 'ASR_TIMEOUT' : 'ASR_UNAVAILABLE';
      this.transition('ERROR', err);
    };
    rec.onend = () => { if (this.state !== 'ERROR') this.transition('STANDBY'); };
    try { rec.start(); this.recognition = rec; this.transition('LISTENING'); return { ok: true }; }
    catch { return { ok: false, error: 'DEVICE_BUSY' }; }
  }

  stopListening() {
    if (this.recognition) { try { this.recognition.stop(); } catch {} this.recognition = null; }
    if (this.state !== 'MUTED') this.transition('STANDBY');
  }

  /**
   * Full stop for the persistent controller: stop ASR, tear down the VAD timer and
   * the microphone stream (no leaked tracks), and return to STANDBY. This is what
   * makes "Stop Listening" actually release the mic — and guarantees a later start()
   * opens exactly one fresh pipeline.
   */
  stop() {
    if (this.recognition) { try { this.recognition.stop(); } catch {} this.recognition = null; }
    if (this.vadTimer) { clearInterval(this.vadTimer); this.vadTimer = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach((t) => t.stop()); this.mediaStream = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.analyser = null;
    if (typeof window !== 'undefined' && this.capabilities().tts) { try { window.speechSynthesis.cancel(); } catch {} }
    this.speaking = false;
    this.transition('STANDBY');
  }

  // ── Real TTS through the single authoritative path ───────────────────
  speak(responseId: string, text: string): { accepted: boolean; reason: string } {
    if (!this.shouldSpeak(responseId)) return { accepted: false, reason: 'duplicate responseId suppressed' };
    const caps = this.capabilities();
    if (!caps.tts) { this.transition('ERROR', 'TTS_UNAVAILABLE'); return { accepted: false, reason: 'TTS_UNAVAILABLE' }; }
    this.currentResponseId = responseId;
    this.speaking = true;
    this.transition('SPEAKING');
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickFemaleVoice();
      if (voice) u.voice = voice;
      u.rate = 1.0; u.pitch = 1.05;
      u.onend = () => { this.speaking = false; this.currentResponseId = null; this.transition('STANDBY'); };
      u.onerror = () => { this.speaking = false; this.transition('ERROR', 'PLAYBACK_ERROR'); };
      window.speechSynthesis.speak(u);
      return { accepted: true, reason: 'speaking' };
    } catch {
      this.speaking = false; this.transition('ERROR', 'PLAYBACK_ERROR');
      return { accepted: false, reason: 'PLAYBACK_ERROR' };
    }
  }

  /** Barge-in: cancel output the instant the user starts speaking. */
  bargeIn(): boolean {
    if (!this.decideBargeIn(this.state, true)) return false;
    if (typeof window !== 'undefined' && this.capabilities().tts) { try { window.speechSynthesis.cancel(); } catch {} }
    this.speaking = false;
    this.transition('INTERRUPTED');
    this.transition('LISTENING');
    return true;
  }

  setMuted(muted: boolean) {
    if (muted) {
      if (typeof window !== 'undefined' && this.capabilities().tts) { try { window.speechSynthesis.cancel(); } catch {} }
      this.stopListening();
      this.state = 'MUTED'; this.emitState();
    } else {
      this.transition('STANDBY');
    }
  }

  dispose() {
    if (this.vadTimer) clearInterval(this.vadTimer);
    this.stopListening();
    if (this.mediaStream) this.mediaStream.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} }
  }
}

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const female = voices.find((v) => /(female|woman|zira|samantha|google uk english female|aria|jenny)/i.test(v.name));
  const en = voices.find((v) => /^en[-_]/i.test(v.lang));
  return female || en || voices[0] || null;
}

// Singleton — the ONE voice authority for the whole UI.
export const audioEngine = typeof window !== 'undefined' ? new AudioEngine() : (null as unknown as AudioEngine);
