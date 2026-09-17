"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Loader2, Mic, MicOff, ShieldCheck, Brain, Eye, Bell, Sparkles, AlertTriangle, Send, RotateCcw } from 'lucide-react';

interface CognitiveData {
  voice: {
    mode: string; modeLabel: string; sessionActive: boolean;
    privacy: { cloud: boolean; transcribed: boolean; retained: boolean };
    ownership: { owned: boolean; confidence: number; reason: string; shouldExecute: boolean } | null;
    wake: string;
    audioModes: { mode: string; label: string; privacy: { cloud: boolean; transcribed: boolean; retained: boolean } }[];
  };
  user: {
    state: string; confidence: number; signalsUsed: string[]; interruptibility: string; interruptible: boolean;
    profile: { communication: string[]; autonomy: string[]; boundaries: string[] };
    preferences: { capability: string; value: boolean; confidence: number; evidenceCount: number; riskTier: string }[];
  };
  memory: {
    stats: { total: number; byType: Record<string, number>; byTrust: Record<string, number> };
    selfReport: { preferences: string[]; habits: string[]; projects: string[]; procedures: string[]; hedged: string[] };
  };
  learning: {
    stats: { total: number; successes: number; failures: number; successRate: number; lessons: number; verificationRate: number };
    lessons: { domain: string; outcome: string; lesson: string; evidenceCount: number; confidence: number; recommendedChange: string }[];
    skillVersions: { totalVersions: number; byLifecycle: Record<string, number> };
  };
  ambient: {
    timeline: { type: string; title: string; detail?: string; urgency: number; importance: number; trustLevel: string; quarantined: boolean; at: number }[];
    stats: { total: number; quarantined: number; byType: Record<string, number> };
    anomalies: string[];
    whatIsHappening: string[];
  };
  interruption: { receptivenessScore: number; recentInterruptions: number };
  explanation: { whatAreYouDoing: string; whatDidYouLearn: { intro: string; lessons: string[] }; recentTraces: { traceId: string; intent: string; trigger: string; outcome: string; riskScore: number }[] };
}

const MODE_COLOR: Record<string, string> = {
  MUTED: 'text-rose-400', AMBIENT_STANDBY: 'text-cyan-300', LISTENING: 'text-cyan-200',
  ACTIVE_CONVERSATION: 'text-emerald-300', PROCESSING: 'text-purple-300', SPEAKING: 'text-teal-300',
};

export const CognitiveWorkspace = () => {
  const [data, setData] = useState<CognitiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [utterance, setUtterance] = useState('');
  const [isFinal, setIsFinal] = useState(true);
  const [resolveResult, setResolveResult] = useState<any>(null);
  const [notif, setNotif] = useState({ title: '', urgency: 0.5, importance: 0.6, relevance: 0.5, requiresAction: false });
  const [speakResult, setSpeakResult] = useState<any>(null);
  const [memQuery, setMemQuery] = useState('');
  const [memResults, setMemResults] = useState<any[]>([]);
  const [memContent, setMemContent] = useState('');
  const [memResult, setMemResult] = useState<any>(null);
  const [tab, setTab] = useState<'voice' | 'user' | 'memory' | 'learning' | 'ambient'>('voice');
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch('/api/cognitive', { signal: ctrl.signal, credentials: 'same-origin' });
      const d = await res.json().catch(() => ({} as any));
      if (!res.ok || !d?.ok) throw new Error(d?.error || (res.status === 401 ? 'Authentication required' : `Request failed (HTTP ${res.status})`));
      if (mounted.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (mounted.current) setError(e?.name === 'AbortError' ? 'Timed out after 12s.' : (e?.message || 'Failed to load the cognitive layer.'));
    } finally { clearTimeout(timer); if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const iv = setInterval(load, 6000);
    return () => { mounted.current = false; clearInterval(iv); };
  }, [load]);

  const post = async (body: any) => {
    setBusy(true);
    try {
      const res = await fetch('/api/cognitive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await res.json();
    } finally { setBusy(false); }
  };

  if (loading && !data) {
    return <div className="p-8 flex items-center justify-center gap-2 text-white/30 text-sm"><Loader2 size={14} className="animate-spin" /> Loading cognitive layer…</div>;
  }
  if (!data) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <GlassSurface className="p-8 rounded-2xl">
          <h2 className="text-lg font-light text-rose-300 mb-3">Could not load the cognitive layer</h2>
          <p className="text-sm text-white/45 mb-6">{error || 'Unknown error.'}</p>
          <button onClick={() => { setLoading(true); setError(null); load(); }} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-xs hover:bg-cyan-500/25"><RotateCcw size={13} /> Retry</button>
        </GlassSurface>
      </div>
    );
  }

  const v = data.voice;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-light text-white/90 tracking-tight">Cognitive Layer</h1>
        <p className="text-white/30 text-sm mt-2">
          Perception · user understanding · memory fabric · mistake learning · interruption intelligence
        </p>
      </div>

      {/* ═══ LIVE VOICE / PRIVACY STRIP ═══ */}
      <GlassSurface active className="p-6 rounded-3xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${
              v.mode === 'MUTED' ? 'bg-rose-500/15 border-rose-400/30' : 'bg-gradient-to-br from-cyan-500/20 to-purple-500/15 border-cyan-400/25'
            }`}>
              {v.mode === 'MUTED' ? <MicOff size={22} className="text-rose-300" /> : <Mic size={22} className="text-cyan-300" />}
            </div>
            <div>
              <div className={`text-sm font-medium ${MODE_COLOR[v.mode] || 'text-white/80'}`}>{v.mode.replace(/_/g, ' ')}</div>
              <div className="text-[11px] text-white/35 mt-0.5">{v.modeLabel}</div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider">
            {[
              { label: 'cloud', on: v.privacy.cloud },
              { label: 'transcribed', on: v.privacy.transcribed },
              { label: 'retained', on: v.privacy.retained },
            ].map((p) => (
              <div key={p.label} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${p.on ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span className={p.on ? 'text-amber-300/80' : 'text-emerald-300/70'}>{p.label}: {p.on ? 'yes' : 'no'}</span>
              </div>
            ))}
          </div>

          <button
            onClick={async () => { await post({ action: 'set_muted', muted: v.mode !== 'MUTED' }); load(); }}
            className={`px-5 py-2.5 rounded-full text-[11px] border transition-colors ${
              v.mode === 'MUTED'
                ? 'bg-rose-500/15 border-rose-400/30 text-rose-200 hover:bg-rose-500/25'
                : 'bg-white/[0.04] border-white/10 text-white/50 hover:text-white/80'
            }`}
          >
            {v.mode === 'MUTED' ? 'Unmute microphone' : 'Mute microphone'}
          </button>
        </div>

        <p className="text-[10px] text-white/25 mt-4 leading-relaxed">
          In standby, wake-word detection runs locally — nothing is transcribed, nothing leaves this machine, nothing is retained.
          Speech recognition begins only after a wake signal or an explicitly configured interaction condition.
        </p>
      </GlassSurface>

      {/* ═══ WHAT ARE YOU DOING / WHAT DID YOU LEARN ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-4"><Eye size={15} className="text-cyan-300/80" /><h3 className="text-white/80 font-medium text-sm">What are you doing?</h3></div>
          <p className="text-[12.5px] text-white/60 leading-relaxed">{data.explanation.whatAreYouDoing}</p>
        </GlassSurface>
        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-4"><Sparkles size={15} className="text-purple-300/80" /><h3 className="text-white/80 font-medium text-sm">What did you learn?</h3></div>
          <p className="text-[12.5px] text-white/60 leading-relaxed">{data.explanation.whatDidYouLearn.intro}</p>
          {data.learning.lessons.slice(0, 4).map((l, i) => (
            <div key={i} className="flex items-start gap-2 mt-2.5">
              <span className={`text-[10px] mt-0.5 ${l.outcome === 'failure' ? 'text-amber-400' : 'text-emerald-400'}`}>{l.outcome === 'failure' ? '⚠' : '✓'}</span>
              <p className="text-[11px] text-white/45 leading-relaxed flex-1">{l.lesson}</p>
              <span className="text-[9px] text-white/20 flex-shrink-0">{(l.confidence * 100).toFixed(0)}%</span>
            </div>
          ))}
        </GlassSurface>
      </div>

      {/* ═══ TABS ═══ */}
      <div className="flex gap-2 flex-wrap">
        {([['voice', 'Voice & Ownership'], ['user', 'User Model'], ['memory', 'Memory Fabric'], ['learning', 'Mistake Learning'], ['ambient', 'Ambient']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-full text-[11px] border transition-colors ${
              tab === k ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/70'
            }`}>{label}</button>
        ))}
      </div>

      {/* ───── VOICE TAB ───── */}
      {tab === 'voice' && (
        <div className="space-y-4">
          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-5"><ShieldCheck size={15} className="text-emerald-300/80" /><h3 className="text-white/80 font-medium text-sm">Conversation Ownership Gate</h3></div>
            <p className="text-[11px] text-white/30 mb-4">Test whether Akansha would treat an utterance as addressed to it. Partial transcripts never execute.</p>

            <div className="flex gap-3 mb-4">
              <input value={utterance} onChange={(e) => setUtterance(e.target.value)}
                placeholder='Try: "Akansha, open Notepad"  or  "for the whole structure…"'
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40" />
              <button onClick={async () => setResolveResult(await post({ action: 'resolve_utterance', transcript: utterance, isFinal, signals: {} }))}
                disabled={busy || !utterance.trim()}
                className="px-5 py-2.5 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-cyan-200 text-[11px] hover:bg-cyan-500/25 disabled:opacity-30 flex items-center gap-2">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Resolve
              </button>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-white/40 mb-4 cursor-pointer">
              <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} className="accent-cyan-400" />
              Treat as finalised transcript (uncheck to simulate partial ASR)
            </label>

            {resolveResult?.ownership && (
              <div className={`p-4 rounded-xl border ${
                resolveResult.execute
                  ? 'bg-emerald-500/[0.08] border-emerald-400/25'
                  : 'bg-white/[0.03] border-white/[0.08]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[11px] font-medium ${resolveResult.execute ? 'text-emerald-300' : 'text-white/50'}`}>
                    {resolveResult.execute ? 'WOULD EXECUTE' : 'WOULD NOT EXECUTE'}
                  </span>
                  <span className="text-[10px] text-white/30">confidence {(resolveResult.ownership.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">{resolveResult.ownership.reason}</p>
                <div className="flex gap-3 mt-3 text-[9px] uppercase tracking-wider text-white/25">
                  <span>wake: {resolveResult.wake}</span><span>mode: {resolveResult.modeLabel}</span>
                </div>
              </div>
            )}

            {/* Audio mode ladder */}
            <div className="mt-6 space-y-2">
              {v.audioModes.map((m) => (
                <div key={m.mode} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  m.mode === v.mode ? 'bg-cyan-500/10 border-cyan-400/25' : 'bg-white/[0.02] border-white/[0.06]'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    m.privacy.cloud ? 'bg-amber-400' : m.mode === 'MUTED' ? 'bg-rose-400' : 'bg-emerald-400'
                  }`} />
                  <span className="text-[11px] text-white/70 w-44">{m.mode.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-white/30 flex-1 truncate">{m.label}</span>
                  <span className="text-[9px] text-white/25 flex-shrink-0">
                    {m.privacy.cloud ? 'cloud' : m.mode === 'MUTED' ? 'off' : 'local'}
                  </span>
                </div>
              ))}
            </div>
          </GlassSurface>
        </div>
      )}

      {/* ───── USER MODEL TAB ───── */}
      {tab === 'user' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-5"><Brain size={15} className="text-cyan-300/80" /><h3 className="text-white/80 font-medium text-sm">User State</h3></div>
            <div className="text-2xl font-light text-white/90">{data.user.state.replace(/_/g, ' ')}</div>
            <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400/60 to-purple-400/60" style={{ width: `${data.user.confidence * 100}%` }} />
            </div>
            <p className="text-[10px] text-white/25 mt-2">state confidence {(data.user.confidence * 100).toFixed(0)}%</p>
            <div className="flex flex-wrap gap-1.5 mt-4">
              {data.user.signalsUsed.map((s, i) => (
                <span key={i} className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[9px] text-white/40">{s}</span>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wider text-white/25">Interruptibility</span>
              <div className="text-sm text-white/80 mt-1">{data.user.interruptibility}</div>
            </div>
          </GlassSurface>

          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-5"><ShieldCheck size={15} className="text-emerald-300/80" /><h3 className="text-white/80 font-medium text-sm">Assistance Profile</h3></div>
            {data.user.profile.communication.map((c, i) => (
              <p key={i} className="text-[11px] text-white/50 leading-relaxed mb-1.5">• {c}</p>
            ))}
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wider text-white/25 mb-2 block">Learned autonomy</span>
              {data.user.preferences.length === 0 ? (
                <p className="text-[11px] text-white/25">No learned preferences yet — Akansha falls back to stated preferences.</p>
              ) : data.user.preferences.slice(0, 6).map((p, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.riskTier === 'high' ? 'bg-rose-400/70' : p.value ? 'bg-emerald-400/70' : 'bg-amber-400/70'}`} />
                  <span className="text-[10px] text-white/60 flex-1 truncate">{p.capability}</span>
                  <span className="text-[9px] text-white/25">{p.value ? 'autonomous' : 'asks'}</span>
                  <span className="text-[9px] text-cyan-200/40 w-8 text-right">{(p.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wider text-white/25 mb-2 block">Hard boundaries</span>
              {data.user.profile.boundaries.slice(0, 6).map((b, i) => (
                <p key={i} className="text-[10px] text-emerald-200/40 leading-relaxed">✓ {b}</p>
              ))}
            </div>
          </GlassSurface>
        </div>
      )}

      {/* ───── MEMORY TAB ───── */}
      {tab === 'memory' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {Object.entries(data.memory.stats.byType).map(([type, count]) => (
              <GlassSurface key={type} className="p-4 rounded-2xl text-center">
                <div className="text-xl font-light text-white/90">{count}</div>
                <div className="text-[8px] uppercase tracking-wider text-white/25 mt-1">{type}</div>
              </GlassSurface>
            ))}
            {data.memory.stats.total === 0 && (
              <GlassSurface className="p-4 rounded-2xl col-span-6 text-center">
                <p className="text-[11px] text-white/25">Memory fabric is empty — store a memory below to see provenance and trust in action.</p>
              </GlassSurface>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GlassSurface className="p-6 rounded-3xl">
              <div className="flex items-center gap-2 mb-5"><ShieldCheck size={15} className="text-amber-300/80" /><h3 className="text-white/80 font-medium text-sm">Poisoning-Defended Write</h3></div>
              <div className="flex gap-3 mb-3">
                <input value={memContent} onChange={(e) => setMemContent(e.target.value)}
                  placeholder='Try: "user prefers dark mode"  or  "remember my password is hunter2"'
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40" />
                <button onClick={async () => { setMemResult(await post({ action: 'store_memory', content: memContent, type: 'preference', importance: 0.8, confidence: 0.9, sourceType: 'user_statement', userAuthored: true })); load(); }}
                  disabled={busy || !memContent.trim()}
                  className="px-4 py-2.5 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-cyan-200 text-[11px] hover:bg-cyan-500/25 disabled:opacity-30">Store</button>
              </div>
              {memResult?.result && (
                <div className={`p-3 rounded-xl border text-[11px] leading-relaxed ${
                  memResult.result.stored ? 'bg-emerald-500/[0.08] border-emerald-400/25 text-emerald-200/70' : 'bg-rose-500/[0.08] border-rose-400/25 text-rose-200/70'
                }`}>
                  <div className="font-medium mb-1">{memResult.result.stored ? 'STORED' : 'BLOCKED'}</div>
                  {memResult.result.blocked || (memResult.result.reasons || []).join('; ') || 'stored with provenance'}
                  {memResult.result.memory && (
                    <div className="mt-2 text-[10px] text-white/35">
                      trust: {memResult.result.memory.provenance.trustLevel} · sensitivity: {memResult.result.memory.sensitivity}
                    </div>
                  )}
                </div>
              )}
            </GlassSurface>

            <GlassSurface className="p-6 rounded-3xl">
              <div className="flex items-center gap-2 mb-5"><Brain size={15} className="text-purple-300/80" /><h3 className="text-white/80 font-medium text-sm">Hybrid Retrieval</h3></div>
              <div className="flex gap-3 mb-3">
                <input value={memQuery} onChange={(e) => setMemQuery(e.target.value)}
                  placeholder="Search memories…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40" />
                <button onClick={async () => { const r = await post({ action: 'retrieve_memory', query: memQuery }); setMemResults(r?.results || []); }}
                  disabled={busy || !memQuery.trim()}
                  className="px-4 py-2.5 rounded-full bg-purple-500/15 border border-purple-400/25 text-purple-200 text-[11px] hover:bg-purple-500/25 disabled:opacity-30">Search</button>
              </div>
              {memResults.length > 0 && (
                <div className="space-y-2">
                  {memResults.map((r, i) => (
                    <div key={i} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-[11px] text-white/70 flex-1">{r.phrasing}: {r.content}</p>
                        <span className="text-[9px] text-cyan-200/40 flex-shrink-0">{(r.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex gap-2 mt-1.5 text-[8px] uppercase tracking-wider text-white/25">
                        <span>{r.type}</span><span>{r.trust}</span>
                      </div>
                      {r.contributions && (
                        <div className="flex gap-2 mt-2 text-[8px] font-mono text-white/20">
                          <span>bm25 {r.contributions.bm25.toFixed(2)}</span>
                          <span>sem {r.contributions.semantic.toFixed(2)}</span>
                          <span>rec {r.contributions.recency.toFixed(2)}</span>
                          <span>trust {r.contributions.trust.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </GlassSurface>
          </div>

          {data.memory.selfReport.hedged.length > 0 && (
            <GlassSurface className="p-6 rounded-3xl">
              <div className="flex items-center gap-2 mb-4"><AlertTriangle size={14} className="text-amber-300/70" /><h3 className="text-white/80 font-medium text-sm">Low-confidence memories</h3></div>
              {data.memory.selfReport.hedged.map((h, i) => (
                <p key={i} className="text-[11px] text-white/40 leading-relaxed">"{h}"</p>
              ))}
              <p className="text-[10px] text-white/25 mt-3">Akansha hedges these rather than stating them as fact.</p>
            </GlassSurface>
          )}
        </div>
      )}

      {/* ───── LEARNING TAB ───── */}
      {tab === 'learning' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Experiences', value: data.learning.stats.total, color: 'text-white/90' },
              { label: 'Success rate', value: `${(data.learning.stats.successRate * 100).toFixed(0)}%`, color: 'text-emerald-400' },
              { label: 'Verified', value: `${(data.learning.stats.verificationRate * 100).toFixed(0)}%`, color: 'text-cyan-400' },
              { label: 'Lessons', value: data.learning.stats.lessons, color: 'text-purple-400' },
              { label: 'Failures', value: data.learning.stats.failures, color: 'text-amber-400' },
            ].map((s) => (
              <GlassSurface key={s.label} className="p-4 rounded-2xl text-center">
                <div className={`text-2xl font-light ${s.color}`}>{s.value}</div>
                <div className="text-[8px] uppercase tracking-wider text-white/25 mt-1">{s.label}</div>
              </GlassSurface>
            ))}
          </div>

          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-5"><Sparkles size={15} className="text-purple-300/80" /><h3 className="text-white/80 font-medium text-sm">Extracted Lessons</h3></div>
            {data.learning.lessons.length === 0 ? (
              <p className="text-[11px] text-white/25">No lessons extracted yet. Record an experience to seed the learning loop.</p>
            ) : (
              <div className="space-y-3">
                {data.learning.lessons.map((l, i) => (
                  <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="flex items-start gap-3">
                      <span className={`text-[11px] mt-0.5 ${l.outcome === 'failure' ? 'text-amber-400' : 'text-emerald-400'}`}>{l.outcome === 'failure' ? '⚠' : '✓'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11.5px] text-white/70 leading-relaxed">{l.lesson}</p>
                        <p className="text-[10px] text-cyan-200/40 mt-1.5">→ {l.recommendedChange}</p>
                        <div className="flex gap-3 mt-2 text-[9px] uppercase tracking-wider text-white/25">
                          <span>{l.domain}</span><span>{l.evidenceCount} observations</span><span>{(l.confidence * 100).toFixed(0)}% confidence</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassSurface>

          {data.learning.skillVersions.totalVersions > 0 && (
            <GlassSurface className="p-6 rounded-3xl">
              <h3 className="text-white/80 font-medium text-sm mb-4">Skill Version Control</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.learning.skillVersions.byLifecycle).map(([lifecycle, count]) => (
                  <span key={lifecycle} className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/50">
                    {lifecycle.replace(/_/g, ' ').toLowerCase()}: {count}
                  </span>
                ))}
              </div>
            </GlassSurface>
          )}
        </div>
      )}

      {/* ───── AMBIENT TAB ───── */}
      {tab === 'ambient' && (
        <div className="space-y-4">
          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-5"><Bell size={15} className="text-cyan-300/80" /><h3 className="text-white/80 font-medium text-sm">Interruption Intelligence</h3></div>
            <p className="text-[11px] text-white/30 mb-4">Akansha does not interrupt just because it has information.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input value={notif.title} onChange={(e) => setNotif({ ...notif, title: e.target.value })}
                placeholder='e.g. "Build failed"  or  "Instagram like received"'
                className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40" />
              <div className="flex gap-2">
                {[['urgency', notif.urgency], ['importance', notif.importance], ['relevance', notif.relevance]].map(([k, val]) => (
                  <label key={k as string} className="flex-1">
                    <span className="text-[8px] uppercase tracking-wider text-white/25 block mb-1">{k as string}</span>
                    <input type="range" min="0" max="1" step="0.05" value={val as number}
                      onChange={(e) => setNotif({ ...notif, [k as string]: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400" />
                    <span className="text-[9px] text-white/30">{(val as number).toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </div>
            <button onClick={async () => setSpeakResult(await post({ action: 'should_speak', notification: { ...notif, id: `n-${Date.now()}`, confidence: 0.9, timeSensitivity: notif.urgency, risk: 'low' } }))}
              disabled={busy || !notif.title.trim()}
              className="px-5 py-2.5 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-cyan-200 text-[11px] hover:bg-cyan-500/25 disabled:opacity-30">
              Should Akansha speak?
            </button>

            {speakResult?.result && (
              <div className={`mt-4 p-4 rounded-xl border ${
                speakResult.result.decision === 'SPEAK_NOW' ? 'bg-emerald-500/[0.08] border-emerald-400/25'
                : speakResult.result.decision === 'NEVER_INTERRUPT' ? 'bg-rose-500/[0.06] border-rose-400/20'
                : 'bg-white/[0.03] border-white/[0.08]'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-white/80">{speakResult.result.decision.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-white/30">score {speakResult.result.score}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {speakResult.result.reasons.map((r: string, i: number) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[9px] text-white/40">{r}</span>
                  ))}
                </div>
                <p className="text-[10px] text-white/25 mt-2.5">delivery: {speakResult.result.delivery}</p>
              </div>
            )}

            {speakResult?.result && (
              <div className="flex gap-2 mt-3">
                <button onClick={async () => { await post({ action: 'record_reaction', accepted: true }); setSpeakResult(null); load(); }}
                  className="px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-400/25 text-emerald-200 text-[10px] hover:bg-emerald-500/20">Good timing</button>
                <button onClick={async () => { await post({ action: 'record_reaction', accepted: false }); setSpeakResult(null); load(); }}
                  className="px-4 py-2 rounded-full bg-rose-500/10 border border-rose-400/25 text-rose-200 text-[10px] hover:bg-rose-500/20">Bad timing</button>
              </div>
            )}
          </GlassSurface>

          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white/80 font-medium text-sm">Background Timeline</h3>
              <span className="text-[9px] uppercase tracking-wider text-white/25">
                {data.ambient.stats.quarantined} quarantined
              </span>
            </div>
            <div className="space-y-2">
              {data.ambient.timeline.map((e, i) => (
                <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border ${
                  e.quarantined ? 'bg-rose-500/[0.06] border-rose-400/20' : 'bg-white/[0.02] border-white/[0.05]'
                }`}>
                  <span className="text-[9px] font-mono text-white/20 w-10 flex-shrink-0">
                    {new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${
                    e.quarantined ? 'bg-rose-400' : e.urgency > 0.5 ? 'bg-amber-400' : 'bg-cyan-400/50'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] ${e.quarantined ? 'text-rose-200/60' : 'text-white/65'}`}>{e.title}</p>
                    {e.detail && <p className="text-[10px] text-white/25 mt-0.5">{e.detail}</p>}
                  </div>
                  <span className="text-[8px] uppercase tracking-wider text-white/20 flex-shrink-0">{e.trustLevel.replace(/_/g, ' ').toLowerCase()}</span>
                </div>
              ))}
            </div>
            {data.ambient.anomalies.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                {data.ambient.anomalies.map((a, i) => (
                  <p key={i} className="text-[10px] text-amber-200/50 flex items-start gap-2"><AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />{a}</p>
                ))}
              </div>
            )}
          </GlassSurface>
        </div>
      )}
    </div>
  );
};
