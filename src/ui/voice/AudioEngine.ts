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
import { AUDIO_CONSTRAINTS, readAudioHealth, decideEndpoint, decideBargeIn, type AudioHealth } from '@/core/voice/audioControl';

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
  | 'ASR_PROVIDER_MISSING'
  | 'ASR_TIMEOUT'
  | 'ASR_LOW_CONFIDENCE'
  | 'TTS_UNAVAILABLE'
  | 'TTS_TIMEOUT'
  | 'PLAYBACK_ERROR'
  | 'DEVICE_BUSY'
  | 'MODEL_UNAVAILABLE';

export type AsrMode = 'none' | 'web' | 'server';

/**
 * Continuous server-ASR segment gating (pure, unit-testable).
 * The packaged desktop app has no system speech service, so we record short
 * speech segments with MediaRecorder on the SAME microphone stream and send
 * each finished segment to /api/voice/transcribe. A segment starts when the
 * user begins speaking and stops after a sustained silence gap — this keeps
 * the session CONTINUOUS: the loop resumes listening after every command.
 * While Akansha herself is speaking (ttsSpeaking) we never open a new segment,
 * so her own voice can never echo back as a command.
 */
export function decideSegment(
  recording: boolean,
  speaking: boolean,
  silenceMs: number,
  opts: { ttsSpeaking: boolean; silenceStopMs?: number }
): 'start' | 'stop' | 'hold' {
  const stopAfter = opts.silenceStopMs ?? 700;
  if (recording) {
    if (opts.ttsSpeaking) return 'hold'; // never cut/extend mid-answer
    return silenceMs >= stopAfter ? 'stop' : 'hold';
  }
  if (opts.ttsSpeaking) return 'hold';
  return speaking ? 'start' : 'hold';
}

/**
 * Continuous voice NEVER auto-stops: a transcription failure keeps the session
 * armed (LISTENING) and only surfaces the reason, so the user can leave voice
 * on and keep talking. The session ends ONLY via an explicit stop (pill click,
 * Ctrl+Space again, Esc, or the spoken "stop the voice mode"). 'fatal' is
 * reserved for a hard microphone loss (no stream at all), which is not a
 * provider/route problem.
 */
export function serverAsrFailure(code: string, _consecutive: number): 'fatal' | 'retry' {
  if (code === 'MICROPHONE_LOST') return 'fatal';
  return 'retry';
}

/**
 * Spoken voice-session control. These are handled ON THE CLIENT (they control
 * the microphone session itself, so they must not be sent to the model). The
 * transcript is only ever executed when it is a FINAL ASR result.
 */
export function parseVoiceSessionCommand(transcript: string): 'stop' | 'start' | null {
  const t = String(transcript || '').toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(please\s+)?(stop|end|close|turn off|disable|quit)( the| this)?( voice| voice mode| listening| mic| microphone)?( mode)?( please| now)?$/.test(t)) return 'stop';
  if (/^(please\s+)?(start|resume|enable|turn on|begin|continue)( the| this)?( voice| voice mode| listening| mic| microphone)?( mode)?( please| now)?$/.test(t)) return 'start';
  if (/^(stop|resume) listening$/.test(t)) return t.startsWith('stop') ? 'stop' : 'start';
  return null;
}

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

type StateListener = (s: { state: VoiceState; error?: VoiceError; asrMode?: AsrMode; detail?: string }) => void;
type UtteranceListener = (u: FinalUtterance) => void;
type PartialListener = (text: string) => void;

export class AudioEngine {
  private state: VoiceState = 'STANDBY';
  private error?: VoiceError;
  private detail?: string;
  private asrMode: AsrMode = 'none';
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

  // Continuous server-ASR (packaged desktop: no system speech service).
  private serverAsrActive = false;
  private recorder: MediaRecorder | null = null;
  private segmentStartedAt = 0;
  private lastVoiceAt = 0;
  private asrFailures = 0;

  // Conversational audio control.
  readonly SILENCE_STOP_MS = 700;
  private audioHealth: AudioHealth | null = null;
  private speechStartAt = 0;
  private nearEndSpeechStart = 0;
  private partialStableAt = 0;
  private discardNext = false;

  /** The ACTUAL applied audio processing (AEC/NS/AGC), verified from the live track. */
  getAudioHealth(): AudioHealth | null { return this.audioHealth; }

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

  getState(): { state: VoiceState; error?: VoiceError; asrMode?: AsrMode; detail?: string } {
    return { state: this.state, error: this.error, asrMode: this.asrMode, detail: this.detail };
  }

  /** Which ASR path the live session is using ('' = no session). */
  getAsrMode(): AsrMode {
    return this.asrMode;
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

  private emitState() { this.stateListeners.forEach((l) => l({ state: this.state, error: this.error, asrMode: this.asrMode, detail: this.detail })); }

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
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      // VERIFY the audio processing the browser ACTUALLY applied (not assumed).
      try {
        const track = this.mediaStream.getAudioTracks()[0];
        if (track && typeof track.getSettings === 'function') this.audioHealth = readAudioHealth(track.getSettings());
      } catch { /* older impls: leave audioHealth null (unverified) */ }
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
        const now = Date.now();
        if (speaking) { if (!this.lastVoiceAt || now - this.lastVoiceAt > this.SILENCE_STOP_MS) this.speechStartAt = now; this.lastVoiceAt = now; }

        // BARGE-IN: while Akansha is speaking, sustained near-end speech stops TTS
        // and starts a new turn; a click/fan (short/low) does not.
        if (this.speaking && decideBargeIn({ assistantSpeaking: true, nearEndSpeechMs: now - (this.nearEndSpeechStart || now), energy: rms, threshold: 0.05, minSpeechMs: 260 })) {
          if (!this.nearEndSpeechStart) this.nearEndSpeechStart = now;
          if (now - this.nearEndSpeechStart >= 260) { this.nearEndSpeechStart = 0; this.bargeIn(); }
        } else if (!speaking) {
          this.nearEndSpeechStart = 0;
        }

        // Continuous server-ASR with real endpointing (not a fixed silence cut).
        if (this.serverAsrActive) {
          const speechMs = this.speechStartAt ? now - this.speechStartAt : 0;
          const trailingSilenceMs = this.lastVoiceAt ? now - this.lastVoiceAt : 0;
          if (!this.recorder && speaking) { this.beginSegment(); this.partialStableAt = now; if (this.state !== 'LISTENING') this.transition('LISTENING'); }
          else if (this.recorder) {
            const act = decideEndpoint({ speechMs, trailingSilenceMs, partialStableMs: now - (this.partialStableAt || now), minSpeechMs: 300, baseTrailingMs: this.SILENCE_STOP_MS });
            if (act === 'finalize') this.endSegment();
            else if (act === 'reject') this.discardSegment();
          }
        }
        if (!this.recorder) {
          const next = this.decideVad(this.state, speaking);
          if (next !== this.state) this.transition(next);
        }
      }, 120);
      this.transition('LISTENING');
      return { ok: true };
    } catch (e: any) {
      const err: VoiceError = /permission|denied/i.test(String(e?.name || e?.message)) ? 'MICROPHONE_PERMISSION_DENIED' : 'MICROPHONE_UNAVAILABLE';
      this.transition('ERROR', err);
      return { ok: false, error: err };
    }
  }

  // ── Real ASR (Web Speech API, with continuous server-ASR fallback) ───
  startListening(): { ok: boolean; error?: VoiceError } {
    const g = globalThis as any;
    const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
    if (!SR) {
      // Packaged desktop has no system speech service. If we already hold the
      // microphone, keep listening CONTINUOUSLY through Akansha's own provider
      // transcription — never a second mic, never a fake success.
      if (this.mediaStream && this.mediaStream.active) { this.startServerAsr(); return { ok: true }; }
      this.transition('ERROR', 'ASR_UNAVAILABLE');
      return { ok: false, error: 'ASR_UNAVAILABLE' };
    }
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
      const kind = e?.error;
      // Service-side failures are exactly where packaged Electron dies ('network').
      // Degrade to the server-ASR path on the SAME microphone stream.
      if ((kind === 'network' || kind === 'service-not-allowed' || kind === 'audio-capture') && this.mediaStream && this.mediaStream.active) {
        try { (this.recognition as any)?.abort?.(); } catch { /* ignore */ }
        this.recognition = null;
        this.startServerAsr();
        return;
      }
      const err: VoiceError = kind === 'not-allowed' ? 'MICROPHONE_PERMISSION_DENIED' : kind === 'no-speech' ? 'ASR_TIMEOUT' : 'ASR_UNAVAILABLE';
      this.transition('ERROR', err);
    };
    rec.onend = () => { if (this.state !== 'ERROR') this.transition('STANDBY'); };
    try { rec.start(); this.recognition = rec; this.asrMode = 'web'; this.transition('LISTENING'); return { ok: true }; }
    catch {
      // Cannot even start native SR — server-ASR on the live mic is still real.
      if (this.mediaStream && this.mediaStream.active) { this.startServerAsr(); return { ok: true }; }
      return { ok: false, error: 'DEVICE_BUSY' };
    }
  }

  // ── Continuous server-ASR (packaged desktop) ─────────────────────────
  private startServerAsr() {
    this.asrMode = 'server';
    this.serverAsrActive = true;
    this.asrFailures = 0;
    this.detail = undefined;
    if (this.state !== 'LISTENING') this.transition('LISTENING');
  }

  private beginSegment() {
    if (!this.mediaStream || this.recorder) return;
    try {
      const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const rec = mime ? new MediaRecorder(this.mediaStream, { mimeType: mime }) : new MediaRecorder(this.mediaStream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e: any) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        this.recorder = null;
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const discard = this.discardNext; this.discardNext = false;
        this.speechStartAt = 0; this.partialStableAt = 0;
        // Sub-300ms blips or an endpoint 'reject' are noise, not commands — drop honestly.
        if (discard || Date.now() - this.segmentStartedAt < 300 || blob.size < 1000) {
          if (this.state === 'LISTENING') this.transition('STANDBY');
          return;
        }
        void this.transcribeSegment(blob);
      };
      this.recorder = rec;
      this.segmentStartedAt = Date.now();
      rec.start();
    } catch { this.recorder = null; }
  }

  private endSegment() {
    if (this.recorder) { try { this.recorder.stop(); } catch { this.recorder = null; } }
  }

  /** Stop the current segment and DROP it (noise blip below the speech floor). */
  private discardSegment() {
    this.discardNext = true;
    if (this.recorder) { try { this.recorder.stop(); } catch { this.recorder = null; } }
  }

  private async transcribeSegment(blob: Blob) {
    this.transition('PROCESSING');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'speech.webm');
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd, credentials: 'same-origin' });
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) {
        this.asrFailures = 0;
        const text = String(json?.text ?? '').trim();
        if (text) {
          // FINAL transcript → the SAME executable pipeline as native SR.
          const utteranceId = `utt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          this.utteranceListeners.forEach((l) => l({ utteranceId, transcript: text }));
        }
        // Stay armed continuously; the answer's SPEAKING state takes over when it arrives.
        if (this.state === 'PROCESSING') this.transition('LISTENING');
        return;
      }
      const code = String(json?.code || (res.status === 503 ? 'NO_TRANSCRIPTION_PROVIDER' : 'UPSTREAM_ERROR'));
      this.asrFailures += 1;
      if (serverAsrFailure(code, this.asrFailures) === 'fatal') {
        this.serverAsrActive = false;
        this.asrMode = 'none';
        this.detail = String(json?.detail || code).slice(0, 160);
        this.transition('ERROR', code === 'NO_TRANSCRIPTION_PROVIDER' ? 'ASR_PROVIDER_MISSING' : 'ASR_UNAVAILABLE');
      } else {
        // Continuous: stay armed and listening, but tell the user WHY nothing
        // transcribed (e.g. no free ASR key yet). Never tear the session down.
        this.detail = String(json?.detail || code).slice(0, 160);
        if (this.state === 'PROCESSING') this.transition('LISTENING');
        this.emitState();
      }
    } catch {
      this.asrFailures += 1;
      if (serverAsrFailure('UNAVAILABLE', this.asrFailures) === 'fatal') {
        this.serverAsrActive = false; this.asrMode = 'none';
        this.detail = 'transcription endpoint unreachable';
        this.transition('ERROR', 'ASR_UNAVAILABLE');
      } else {
        this.detail = 'transcription endpoint unreachable — staying in continuous listening';
        if (this.state === 'PROCESSING') this.transition('LISTENING');
        this.emitState();
      }
    }
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
    if (this.recorder) { try { this.recorder.stop(); } catch {} this.recorder = null; }
    this.serverAsrActive = false;
    this.asrMode = 'none';
    if (this.vadTimer) { clearInterval(this.vadTimer); this.vadTimer = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach((t) => t.stop()); this.mediaStream = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.analyser = null;
    if (typeof window !== 'undefined' && this.capabilities().tts) { try { window.speechSynthesis.cancel(); } catch {} }
    this.speaking = false;
    this.transition('STANDBY');
  }

  // ── Real TTS through the single authoritative path ───────────────────
  speak(responseId: string, text: string, prosody?: { rate?: number; pitch?: number; style?: string }): { accepted: boolean; reason: string } {
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
      u.rate = prosody?.rate ?? 1.0;
      u.pitch = prosody?.pitch ?? 1.05;
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

/**
 * TTS voice selection — FEMALE by user preference.
 * Chromium/Electron load the voice list ASYNCHRONOUSLY: getVoices() is empty
 * on first call, so a naive lookup silently falls back to the OS default
 * (Windows: male "David"). We cache the list from voiceschanged and pick from
 * the cache at speak time; the preference order is explicit female voices,
 * then any en-* voice, then anything.
 */
let cachedVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const load = () => { try { cachedVoices = window.speechSynthesis.getVoices() || []; } catch { /* keep */ } };
  load();
  try { window.speechSynthesis.addEventListener('voiceschanged', load); } catch { /* older impls lack events */ }
}

const FEMALE_RANK = /(microsoft aria|zira|sonia|neerja|jenny|samantha|victoria|karen|moira|tessa|fiona|google uk english female|google us female|female)/i;

/** Pure selection order (exported for tests): female-en → female-any → en → first. */
export function chooseFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const femaleEn = voices.find((v) => FEMALE_RANK.test(v.name) && /^en[-_]/i.test(v.lang));
  const femaleAny = voices.find((v) => FEMALE_RANK.test(v.name));
  const en = voices.find((v) => /^en[-_]/i.test(v.lang));
  return femaleEn || femaleAny || en || voices[0] || null;
}

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return chooseFemaleVoice(cachedVoices.length ? cachedVoices : (window.speechSynthesis.getVoices() || []));
}

// Singleton — the ONE voice authority for the whole UI.
export const audioEngine = typeof window !== 'undefined' ? new AudioEngine() : (null as unknown as AudioEngine);
