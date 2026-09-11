"use client";
import React, { useState, useEffect, useRef } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { AkanshaPresence, type AIState } from '../assistant/AkanshaPresence';
import { OrganicWaveform } from '../assistant/OrganicWaveform';
import { audioEngine, type VoiceState } from '../voice/AudioEngine';
import { Mic, Send, Loader2, Zap } from 'lucide-react';

interface CommandResult {
  ok: boolean;
  intent: string;
  tier: string;
  path: string;
  usedModel: boolean;
  response: string;
  status?: string;
  model?: { provider: string; modelId: string };
  matchedSkill?: { name: string; score: number } | null;
  memory?: { decision: string; score: number; stored: boolean; reasons: string[] };
  trace?: { candidates: any[]; selected: any; reasons: string[] };
  latencyMs?: number;
  error?: string;
}

export const CommandWorkspace = () => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [state, setState] = useState<AIState>('idle');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CommandResult | null>(null);
  const [messages, setMessages] = useState([
    { text: 'Good evening, Boss. Akansha is online. What are we working on today?', sender: 'akansha' },
  ]);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loginToken, setLoginToken] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('STANDBY');
  const [partial, setPartial] = useState('');
  const sendRef = useRef<(text: string) => void>(() => {});

  const login = async (passphrase: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json();
      if (data?.ok) { setNeedsAuth(false); return true; }
      return false;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!audioEngine) return;
    const offFinal = audioEngine.onFinalUtterance((u) => { setPartial(''); sendRef.current(u.transcript); });
    const offPartial = audioEngine.onPartial((t) => setPartial(t));
    const offState = audioEngine.onState((s) => setVoiceState(s.state));
    return () => { offFinal(); offPartial(); offState(); };
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setMessages((prev) => [...prev, { text: trimmed, sender: 'user' }]);
    setInput('');
    setBusy(true);
    setState('thinking');

    try {
      const res = await fetch('/api/akansha/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.status === 401) {
        setNeedsAuth(true);
        setBusy(false);
        setState('idle');
        return;
      }
      const data: CommandResult = await res.json();
      setLast(data);
      setState('working');

      if (data.status && data.status !== 'COMPLETED') setState('verifying');

      setTimeout(() => {
        const reply = data.response || data.error || 'No response.';
        setMessages((prev) => [...prev, { text: reply, sender: 'akansha' }]);
        setState(data.status === 'AI_PROVIDER_OFFLINE' ? 'error' : 'success');
        // Speak through the single authoritative path (deduped by responseId).
        if (audioEngine) audioEngine.speak(`resp-${Date.now()}`, reply);
        setTimeout(() => setState('idle'), 2200);
      }, 400);
    } catch (e: any) {
      setMessages((prev) => [...prev, { text: `Request failed: ${e.message}`, sender: 'akansha' }]);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    } finally {
      setBusy(false);
    }
  };
  sendRef.current = send;

  return (
    <div className="flex flex-col h-full relative">
      {needsAuth && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <GlassSurface className="p-6 rounded-2xl max-w-sm w-full mx-4">
            <h3 className="text-sm text-white/80 mb-1">Authentication required</h3>
            <p className="text-[11px] text-white/40 mb-4">
              Enter the local access token (from <code className="text-cyan-200/70">.akansha-auth.json</code>) to start a session.
            </p>
            <input
              type="password"
              value={loginToken}
              onChange={(e) => setLoginToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login(loginToken).then((ok) => ok && setLoginToken(''))}
              placeholder="access token"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40 mb-3"
            />
            <button
              onClick={async () => { const ok = await login(loginToken); if (ok) setLoginToken(''); }}
              className="w-full py-2 rounded-lg bg-gradient-to-br from-cyan-500/25 to-purple-500/25 text-cyan-200 text-sm hover:scale-[1.01] transition-transform">
              Unlock Akansha
            </button>
          </GlassSurface>
        </div>
      )}
      {/* Presence */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden py-4">
        <AkanshaPresence state={state} isListening={isListening} />
        <div className="w-full max-w-lg px-8 mt-4 mb-2">
          <OrganicWaveform isActive={isListening || state !== 'idle'} state={state} />
        </div>
        {!busy && !isListening && state === 'idle' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/30 text-xs tracking-[0.2em] uppercase">Speak or type a command</p>
            <div className="flex flex-wrap justify-center gap-2">
              {['What time is it in India?', 'Explain Kubernetes simply', 'Open Notepad and write Hello', 'Research local AI models'].map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/45 hover:text-white/80 hover:border-cyan-400/25 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live decision panel */}
      {last && (
        <div className="max-w-2xl w-full mx-auto px-4 mb-3">
          <GlassSurface className="p-4 rounded-2xl">
            <div className="flex items-center gap-3 mb-3">
              <Zap size={12} className="text-cyan-300/70" />
              <h3 className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-medium">Decision Trace</h3>
              <span className="text-[9px] text-white/20 ml-auto">{last.latencyMs}ms · {last.tier}</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-cyan-200/60">intent: {last.intent}</span>
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-white/45">path: {last.path}</span>
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-white/45">
                model: {last.usedModel && last.model ? `${last.model.provider}::${last.model.modelId}` : 'none (deterministic)'}
              </span>
              {last.matchedSkill && (
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-purple-200/60">
                  skill: {last.matchedSkill.name}
                </span>
              )}
              {last.memory && (
                <span className={`px-2 py-0.5 rounded-md border text-[9px] uppercase tracking-wider ${last.memory.stored ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200/70' : 'bg-white/5 border-white/8 text-white/30'}`}>
                  memory: {last.memory.decision} ({last.memory.score})
                </span>
              )}
            </div>
            {last.trace && last.trace.candidates.length > 0 && (
              <div className="space-y-1.5">
                {last.trace.candidates.slice(0, 4).map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className={`w-1 h-1 rounded-full flex-shrink-0 ${last.trace!.selected?.providerId === c.providerId ? 'bg-emerald-400' : 'bg-white/20'}`} />
                    <span className="text-[10px] font-mono text-white/50 flex-1 truncate">{c.providerId}::{c.modelId}</span>
                    <span className="text-[10px] text-cyan-200/50">{c.score}</span>
                  </div>
                ))}
                {last.trace.reasons.slice(0, 3).map((r: string, i: number) => (
                  <p key={i} className="text-[9px] text-white/25 pl-3.5">{r}</p>
                ))}
              </div>
            )}
          </GlassSurface>
        </div>
      )}

      {/* Conversation */}
      <div className="max-w-2xl w-full mx-auto px-4 space-y-2.5 mb-3 max-h-52 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <GlassSurface className={`max-w-[82%] px-4 py-2.5 rounded-2xl ${m.sender === 'user' ? 'border-cyan-400/20' : 'border-white/10'}`}>
              <p className="text-[13px] text-white/85 leading-relaxed">{m.text}</p>
            </GlassSurface>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-4 pb-6 max-w-2xl mx-auto w-full">
        <GlassSurface className="flex items-center gap-3 px-4 py-3 rounded-2xl">
          <button
            onClick={async () => {
              if (!audioEngine) return;
              if (isListening) { audioEngine.stopListening(); setIsListening(false); }
              else {
                const caps = audioEngine.capabilities();
                if (!caps.mic && !caps.asr) { setMessages((p) => [...p, { text: 'No microphone / speech recognition available in this browser.', sender: 'akansha' }]); return; }
                await audioEngine.start();
                audioEngine.startListening();
                setIsListening(true);
              }
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-cyan-500/20 text-cyan-300 animate-pulse' : 'bg-white/5 text-white/40 hover:text-white/70'}`}>
            <Mic size={17} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input);
              // Barge-in: typing while Akansha speaks cancels output.
              else if (audioEngine && (e.key.length === 1)) audioEngine.bargeIn();
            }}
            placeholder={isListening && partial ? partial : 'Talk to Akansha…'}
            disabled={busy}
            className="flex-1 bg-transparent text-white/90 placeholder:text-white/25 outline-none text-sm tracking-wide"
          />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-cyan-300 flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </GlassSurface>
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-cyan-400' : 'bg-white/20'}`} />
          <span className="text-[10px] uppercase tracking-[0.15em] text-white/30">
            voice: {voiceState}{audioEngine && !audioEngine.capabilities().asr ? ' · ASR unavailable' : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
