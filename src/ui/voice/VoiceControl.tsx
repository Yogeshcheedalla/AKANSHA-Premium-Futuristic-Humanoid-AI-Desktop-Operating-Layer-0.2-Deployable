'use client';
/**
 * VoiceControl — the ONE persistent voice controller in the header.
 *
 * It is a thin, honest view over the single `audioEngine` authority: it reflects the
 * REAL microphone/ASR/TTS state and toggles the voice session. It never shows a fake
 * "Processing Request" modal, and it never opens a second microphone pipeline (start()
 * is idempotent). Clicking starts a persistent LISTENING session; clicking again stops
 * and releases the mic. If the browser has no mic/ASR, it says so instead of pretending.
 */
import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Loader2, Volume2, AlertTriangle } from 'lucide-react';
import { audioEngine, type VoiceState } from './AudioEngine';
import { handleVoiceKeydown, handleVoiceKeyup } from '@/core/voice/voiceShortcuts';

const LABEL: Record<VoiceState, string> = {
  MUTED: 'Muted',
  STANDBY: 'Voice Command',
  LISTENING: 'Listening…',
  PROCESSING: 'Understanding…',
  SPEAKING: 'Akansha speaking',
  INTERRUPTED: 'Interrupted — listening',
  ERROR: 'Voice unavailable',
};

const DOT: Record<VoiceState, string> = {
  MUTED: 'bg-white/30',
  STANDBY: 'bg-cyan-400',
  LISTENING: 'bg-emerald-400 animate-pulse',
  PROCESSING: 'bg-amber-400 animate-pulse',
  SPEAKING: 'bg-purple-400 animate-pulse',
  INTERRUPTED: 'bg-amber-400',
  ERROR: 'bg-rose-500',
};

const isSessionActive = (s: VoiceState) => s === 'LISTENING' || s === 'PROCESSING' || s === 'SPEAKING' || s === 'INTERRUPTED';

export function VoiceControl() {
  const [state, setState] = useState<VoiceState>(() => (audioEngine ? audioEngine.getState().state : 'STANDBY'));
  const [active, setActive] = useState<boolean>(() => (audioEngine ? isSessionActive(audioEngine.getState().state) : false));
  const [asrMode, setAsrMode] = useState<string>(() => audioEngine?.getState().asrMode || 'none');
  const [errDetail, setErrDetail] = useState<string>(() => audioEngine?.getState().detail || '');
  const [asrLocal, setAsrLocal] = useState<boolean>(() => audioEngine?.getState().local || false);
  const [asrBundled, setAsrBundled] = useState<boolean>(() => audioEngine?.getState().bundled || false);

  useEffect(() => {
    if (!audioEngine) return;
    // Subscribe only — no synchronous setState in the effect body.
    const off = audioEngine.onState((s) => { setState(s.state); setActive(isSessionActive(s.state)); setAsrMode(s.asrMode || 'none'); setErrDetail(s.detail || ''); setAsrLocal(!!s.local); setAsrBundled(!!s.bundled); });
    return () => { off(); };
  }, []);

  const startSession = async () => {
    if (!audioEngine) return;
    const caps = audioEngine.capabilities();
    if (!caps.mic && !caps.asr) { setState('ERROR'); return; }
    await audioEngine.start();
    audioEngine.startListening();
  };
  const stopSession = () => {
    if (!audioEngine) return;
    audioEngine.stop();
    setActive(false);
    setState('STANDBY');
  };

  const toggle = async () => {
    if (!audioEngine) return;
    if (active || state === 'LISTENING' || state === 'PROCESSING' || state === 'SPEAKING' || state === 'INTERRUPTED') stopSession();
    else await startSession();
  };

  // Desktop bridge: the system tray drives the SAME authoritative AudioEngine
  // (never a second microphone); the real voice state mirrors back to the tray.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).akanshaDesktop : undefined;
    if (!bridge || typeof bridge.onVoiceCommand !== 'function') return;
    const off = bridge.onVoiceCommand(async (p: { action?: string }) => {
      if (p?.action === 'start') await startSession();
      else if (p?.action === 'stop') stopSession();
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).akanshaDesktop : undefined;
    if (bridge && typeof bridge.reportVoiceState === 'function') { try { bridge.reportVoiceState(state); } catch { /* ignore */ } }
  }, [state]);

  // Keyboard activation (the "Voice Enable" button was removed intentionally).
  // Ctrl/Cmd+Space toggles; Ctrl/Cmd+Shift+Space is push-to-talk; Escape stops.
  // Routed through the SAME session start/stop (single authority); auto-repeat is
  // ignored in handleVoiceKeydown, so a held key cannot start duplicate listeners.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const actions = {
      toggle: () => toggle(),
      startPushToTalk: () => startSession(),
      stopPushToTalk: () => stopSession(),
      stop: () => stopSession(),
    };
    const onDown = (e: KeyboardEvent) => {
      // Only intercept our specific chords; never swallow normal typing.
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') { e.preventDefault(); handleVoiceKeydown(e, actions); }
      else if (e.key === 'Escape') handleVoiceKeydown(e, actions);
    };
    const onUp = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.code === 'Space') handleVoiceKeyup(e, actions); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state]);

  const Icon = state === 'ERROR' ? AlertTriangle : state === 'SPEAKING' ? Volume2 : active ? Mic : state === 'MUTED' ? MicOff : Mic;
  const busy = state === 'PROCESSING';

  // A REAL button: click toggles the voice session (keyboard still works too —
  // Ctrl+Space can be swallowed by the Windows input-language bar, so the
  // button is the reliable primary control). State shown is always the real
  // engine state; errors say what failed instead of pretending.
  return (
    <button
      type="button"
      onClick={() => { void toggle(); }}
      aria-label={active ? 'Stop voice command' : 'Start voice command'}
      title={state === 'ERROR'
        ? (asrMode === 'none' && errDetail
            ? `Voice failed: ${errDetail}${audioEngine?.getState().error === 'ASR_PROVIDER_MISSING' ? ' — fix: Providers → connect a free Gemini or Groq API key, then press again.' : ''}`
            : 'Voice failed: microphone permission denied OR no transcription provider is connected. Open Providers and connect a free Gemini or Groq key, or type below. Ctrl+Space can also be captured by the Windows input-language bar — the button is the reliable control.')
        : active && asrMode === 'server'
        ? `Continuous listening: speak a command, pause — Akansha transcribes it ${asrLocal ? (asrBundled ? 'locally on this device (Whisper, offline — no internet, no API key)' : 'locally on this device (Whisper)') : 'through your connected provider'} and acts. Click or Esc to stop.`
        : 'Click to start/stop voice · Ctrl+Space toggle · Ctrl+Shift+Space push-to-talk · Esc stop'}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs tracking-wide transition-colors ${
        state === 'ERROR'
          ? 'bg-rose-500/10 border-rose-400/30 text-rose-200 hover:bg-rose-500/20'
          : active
          ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/20'
          : 'bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-cyan-400/20 text-cyan-300/90 hover:from-cyan-500/20 hover:to-purple-500/20'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${DOT[state]}`} />
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      <span>{LABEL[state]}</span>
      <span className="hidden lg:inline text-white/25 ml-1">
        {active && asrMode === 'server'
          ? (asrLocal ? `continuous · LOCAL${asrBundled ? ' · offline' : ''}` : 'continuous')
          : 'Ctrl+Space'}
      </span>
    </button>
  );
}
