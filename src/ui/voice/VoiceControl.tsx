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

  useEffect(() => {
    if (!audioEngine) return;
    // Subscribe only — no synchronous setState in the effect body.
    const off = audioEngine.onState((s) => { setState(s.state); setActive(isSessionActive(s.state)); });
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

  // Truthful, NON-clickable status indicator (voice is activated via keyboard now).
  return (
    <div
      role="status"
      aria-live="polite"
      title="Voice: Ctrl+Space toggle · Ctrl+Shift+Space push-to-talk · Esc stop"
      className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs tracking-wide ${
        state === 'ERROR'
          ? 'bg-rose-500/10 border-rose-400/30 text-rose-200'
          : active
          ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
          : 'bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-cyan-400/20 text-cyan-300/90'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${DOT[state]}`} />
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      <span>{LABEL[state]}</span>
      <span className="hidden lg:inline text-white/25 ml-1">Ctrl+Space</span>
    </div>
  );
}
