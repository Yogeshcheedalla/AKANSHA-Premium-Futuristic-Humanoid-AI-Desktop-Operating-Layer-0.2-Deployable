"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Cpu, HardDrive, MemoryStick, Monitor, Boxes, Loader2, CheckCircle, AlertTriangle, XCircle, Download, Globe, WifiOff } from 'lucide-react';
import type { SetupViewModel, ModelCardVM, InstallResult } from '@/core/aiSetup/types';
import { toSearchCards, type SearchCard } from './modelSearchView';
import { resolveCardState } from '@/core/catalog/installState';

const RATING_STYLE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  EXCELLENT: { label: 'Excellent', cls: 'text-emerald-400', icon: <CheckCircle size={12} /> },
  GOOD: { label: 'Good', cls: 'text-emerald-400', icon: <CheckCircle size={12} /> },
  USABLE: { label: 'Usable', cls: 'text-amber-400', icon: <AlertTriangle size={12} /> },
  SLOW: { label: 'Slow', cls: 'text-orange-400', icon: <AlertTriangle size={12} /> },
  UNSUPPORTED: { label: 'Unsupported', cls: 'text-rose-400', icon: <XCircle size={12} /> },
};

function gb(bytes: number) { return bytes ? (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1) + ' GB' : '—'; }
function rating(m: ModelCardVM) { return RATING_STYLE[m.compatibility.rating] || { label: m.compatibility.rating, cls: 'text-white/50', icon: null }; }

/** Hardware-fit LADDER verdict — an evidence forecast, distinct from READY. */
const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  FIT: { label: '🟢 FIT', cls: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25' },
  POSSIBLE: { label: '🟡 POSSIBLE', cls: 'bg-amber-400/10 text-amber-300 border-amber-400/25' },
  UNSUPPORTED: { label: '🔴 UNSUPPORTED', cls: 'bg-rose-400/10 text-rose-300 border-rose-400/25' },
};
function FitChip({ fit }: { fit: ModelCardVM['fit'] }) {
  const v = VERDICT_STYLE[fit.verdict] || VERDICT_STYLE.POSSIBLE;
  const tip = `${v.label} (${fit.confidence} confidence)\n${fit.reasons.slice(0, 8).join('\n')}${fit.unknownRungs.length ? `\nunknown: ${fit.unknownRungs.join(', ')}` : ''}`;
  return <span title={tip} className={`shrink-0 inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border ${v.cls}`}>{v.label}</span>;
}

export function ModelCenter({ embedded = false }: { embedded?: boolean }) {
  const [vm, setVm] = useState<SetupViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [install, setInstall] = useState<Record<string, InstallResult | 'busy'>>({});
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchCards, setSearchCards] = useState<SearchCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // Continue with OpenRouter: kick off the secure PKCE flow server-side, then hand
  // off to OpenRouter's OWN authorization/signup page in a new tab. Akansha never
  // sees or stores the OpenRouter password and never creates the account itself.
  const connectOpenRouter = useCallback(async () => {
    setConnecting(true); setConnectMsg(null);
    try {
      const res = await fetch('/api/ai/online/connect', { method: 'POST', credentials: 'same-origin' });
      const d = await res.json();
      if (!res.ok || d.configured === false) { setConnectMsg('OPENROUTER CONNECTION NOT CONFIGURED'); return; }
      window.open(d.authorizeUrl, '_blank', 'noopener,noreferrer');
      setConnectMsg('Complete sign-in / sign-up on OpenRouter, then return here.');
    } catch {
      setConnectMsg('OPENROUTER CONNECTION UNAVAILABLE');
    } finally {
      setConnecting(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/setup');
      const data = await res.json();
      if (data.ok) setVm(data.setup); else setError(data.error || 'setup failed');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const chooseMode = async (m: 'offline' | 'cloud' | 'both') => {
    try {
      const res = await fetch('/api/ai/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }), credentials: 'same-origin' });
      const d = await res.json();
      if (d.ok) { setMode(m); await load(); }
    } catch { /* ignore; status reloaded below */ }
  };

  const doInstall = async (id: string) => {
    setInstall((s) => ({ ...s, [id]: 'busy' }));
    try {
      const res = await fetch('/api/ai/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: id }), credentials: 'same-origin' });
      const d: InstallResult = await res.json();
      setInstall((s) => ({ ...s, [id]: d }));
    } catch (e: any) {
      setInstall((s) => ({ ...s, [id]: { ok: false, usable: false, error: e.message } }));
    }
  };

  const doSearch = async () => {
    const q = searchQ.trim();
    if (!q) { setSearchCards(null); setSearchErr(null); return; }
    setSearching(true); setSearchErr(null);
    try {
      const res = await fetch(`/api/models/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!res.ok || !d.ok) { setSearchCards([]); setSearchErr(d?.error || 'Search unavailable'); return; }
      const catalogIds = (vm?.catalog.models || []).map((m) => m.id);
      setSearchCards(toSearchCards(d.results || [], catalogIds));
    } catch {
      setSearchCards([]); setSearchErr('Search is offline — no results.');
    } finally {
      setSearching(false);
    }
  };

  if (loading) return <div className="p-8 text-white/40 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Analyzing your device…</div>;
  if (error) return <div className="p-8 text-rose-400 text-sm">Setup unavailable: {error}</div>;
  if (!vm) return null;

  return (
    <div className={embedded ? '' : 'p-6 md:p-8 max-w-6xl mx-auto'}>
      {!embedded && <h1 className="text-3xl font-light text-white/90 mb-1 tracking-tight">Model Center</h1>}
      {!embedded && <p className="text-white/30 text-sm mb-6">Choose how Akansha thinks. Statuses reflect this device and your real configuration — nothing is faked.</p>}

      {/* Device */}
      <GlassSurface className="p-5 rounded-2xl mb-4">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Your device</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2"><Cpu size={15} className="text-cyan-300/70" /><span className="text-white/50">CPU</span><span className="text-white/80 ml-auto">{vm.device.cpuCores} cores</span></div>
          <div className="flex items-center gap-2"><MemoryStick size={15} className="text-cyan-300/70" /><span className="text-white/50">RAM</span><span className="text-white/80 ml-auto">{vm.device.ramGB} GB</span></div>
          <div className="flex items-center gap-2"><Monitor size={15} className="text-cyan-300/70" /><span className="text-white/50">GPU</span><span className="text-white/80 ml-auto">{vm.device.gpu.detected ? `${vm.device.gpu.vendor}${vm.device.gpu.vramGB ? ` ${vm.device.gpu.vramGB}GB` : ''}` : 'None detected'}</span></div>
          <div className="flex items-center gap-2"><HardDrive size={15} className="text-cyan-300/70" /><span className="text-white/50">Storage</span><span className="text-white/80 ml-auto">{vm.device.freeDiskGB} GB free</span></div>
        </div>
        <div className="text-[11px] text-white/30 mt-3">{vm.device.platform} · {vm.device.architecture} · {vm.device.cpuModel}</div>
      </GlassSurface>

      {vm.catalog.fixture && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm border border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200">
          <span className="font-semibold">DEVELOPMENT FIXTURE CATALOG</span> — these are test models, not production. Inference is never simulated; a model stays NOT READY until a real inference test passes.
        </div>
      )}

      {/* Runtime */}
      <div className={`rounded-xl px-4 py-3 mb-4 text-sm border ${vm.runtime.available ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300' : 'border-amber-400/20 bg-amber-400/5 text-amber-300'}`}>
        {vm.runtime.available ? <span className="flex items-center gap-2"><CheckCircle size={14} /> Inference runtime: {vm.runtime.name}{vm.runtime.version ? ` (${vm.runtime.version})` : ''}</span>
          : <span className="flex items-center gap-2"><WifiOff size={14} /> LOCAL RUNTIME NOT DETECTED — offline AI needs the llama.cpp runtime. Akansha will not fake inference.</span>}
      </div>

      {/* AI mode */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {([
          { id: 'cloud', label: 'Online AI', icon: <Globe size={16} />, desc: 'Connect OpenRouter' },
          { id: 'offline', label: 'Offline AI', icon: <Cpu size={16} />, desc: 'Local model, no internet for inference' },
          { id: 'both', label: 'Both', icon: <Boxes size={16} />, desc: 'Switch anytime (no auto-install)' },
        ] as const).map((o) => (
          <button key={o.id} onClick={() => chooseMode(o.id)} className={`text-left rounded-2xl border p-4 transition-colors ${mode === o.id ? 'border-cyan-400/40 bg-cyan-400/5' : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}>
            <div className="flex items-center gap-2 text-white/80 text-sm font-medium">{o.icon}{o.label}</div>
            <div className="text-[11px] text-white/40 mt-1">{o.desc}</div>
          </button>
        ))}
      </div>

      {/* Online status */}
      <GlassSurface className="p-4 rounded-2xl mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-white/80">Online AI — OpenRouter</div>
            <div className="text-[11px] text-white/40 mt-0.5">{vm.readiness.online}</div>
          </div>
          <span className={`shrink-0 text-xs px-3 py-1 rounded-full ${vm.online.connected && vm.online.verified ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-white/40'}`}>
            {vm.online.connected && vm.online.verified ? `Connected${vm.online.label ? ` · ${vm.online.label}` : ''}` : 'Not connected'}
          </span>
        </div>
        {vm.online.configured ? (
          <button onClick={connectOpenRouter} disabled={connecting}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
            {connecting ? <><Loader2 size={13} className="animate-spin" /> Redirecting…</>
              : <><Globe size={13} /> {vm.online.connected && vm.online.verified ? 'Reconnect OpenRouter' : 'Continue with OpenRouter'}</>}
          </button>
        ) : (
          <div className="mt-3 text-[11px] text-amber-300/80">OPENROUTER CONNECTION NOT CONFIGURED — set the public URL / callback (no client_id needed) to enable one-click sign-in/sign-up via OpenRouter.</div>
        )}
        {connectMsg && <div className="mt-2 text-[11px] text-white/50">{connectMsg}</div>}
        {vm.online.configured && <div className="mt-1.5 text-[10px] text-white/25">You sign in or create your account securely on OpenRouter — Akansha never sees your OpenRouter password.</div>}
      </GlassSurface>

      {/* Catalog / Model cards — consumed from the signed catalog, never hard-coded */}
      <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Recommended models</div>
      {vm.catalog.status === 'not-configured' && (
        <GlassSurface className="p-6 rounded-2xl text-center">
          <div className="text-white/60 text-sm mb-1">No signed model catalog is configured.</div>
          <div className="text-white/35 text-xs mb-3">Models must be added to the Akansha cloud catalog; Akansha will not invent model options. {vm.catalog.reasons.join('; ')}</div>
          <div className="text-white/25 text-[11px]">Configure AKANSHA_MODEL_CATALOG + a public key, or use Online AI.</div>
        </GlassSurface>
      )}
      {vm.catalog.status === 'invalid' && (
        <GlassSurface className="p-6 rounded-2xl text-center text-rose-300 text-sm">The model catalog signature is invalid — refusing to use it. {vm.catalog.reasons.join('; ')}</GlassSurface>
      )}
      {(vm.catalog.status === 'ready' || vm.catalog.status === 'fixture') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vm.catalog.models.map((m) => {
            const rs = rating(m);
            const inst = install[m.id];
            const cardState = resolveCardState({
              runnable: m.compatibility.runnable, runtimeAvailable: vm.runtime.available,
              installable: m.installable, result: inst && inst !== 'busy' ? inst : undefined,
            });
            return (
              <GlassSurface key={m.id} className="p-5 rounded-2xl flex flex-col">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-white/90 font-medium">{m.name}</div>
                    <div className="text-[11px] text-white/40 capitalize">{m.family} · {m.version} · {m.quantization || '—'} · {m.format}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <FitChip fit={m.fit} />
                    <div className={`flex items-center gap-1 text-[11px] font-medium ${rs.cls}`}>{rs.icon}{rs.label}</div>
                  </div>
                </div>
                <div className="mt-1"><span className="text-[10px] uppercase tracking-wide text-white/40">{cardState}</span></div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] text-white/50 mt-3">
                  <div>Size <span className="text-white/75">{gb(m.downloadSizeBytes)}</span></div>
                  <div>RAM <span className="text-white/75">{m.minimumRamGB}–{m.recommendedRamGB} GB</span></div>
                  <div>Storage <span className="text-white/75">{m.minimumStorageGB} GB</span></div>
                  <div>GPU <span className="text-white/75">{m.gpuRequirements?.required ? `req ${m.gpuRequirements.minVramGB || '?'} GB` : 'Optional'}</span></div>
                  <div>Context <span className="text-white/75">{m.contextLength}</span></div>
                  <div>Runtime <span className="text-white/75">{m.runtimeRequirement}</span></div>
                  <div>Coding <span className="text-white/75">{m.quality.coding}</span></div>
                  <div>Reasoning <span className="text-white/75">{m.quality.reasoning}</span></div>
                  <div>Offline <span className="text-white/75">{m.internetRequired ? 'No' : 'Yes'}</span></div>
                  <div>Perf <span className="text-white/75">{m.performanceLabel}{m.estimatedTokensPerSec ? ` ~${m.estimatedTokensPerSec} t/s` : ''}</span></div>
                </div>
                {(m.bestFor || m.drawbacks) && (
                  <div className="text-[11px] text-white/40 mt-2">
                    {m.bestFor && <div>Best for: {m.bestFor}</div>}
                    {m.drawbacks && <div>Drawbacks: {m.drawbacks}</div>}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3 text-[10px] text-white/40">
                  <span className={m.signed ? 'text-emerald-400' : 'text-rose-400'}>{m.signed ? 'signed ✓' : 'unsigned'}</span>
                  <span>·</span>
                  <span>{m.sha256Present ? 'checksum pinned' : 'no checksum'}</span>
                  <span>·</span>
                  <span>{m.license}</span>
                </div>
                {!m.compatibility.runnable && <div className="text-[11px] text-amber-300/80 mt-2">{m.compatibility.reasons.join(', ') || 'Not compatible with this device'}</div>}
                <div className="mt-3">
                  <button
                    disabled={!m.installable || inst === 'busy'}
                    onClick={() => doInstall(m.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-500/20 transition-colors"
                  >
                    {inst === 'busy' ? <><Loader2 size={13} className="animate-spin" /> Installing…</> : <><Download size={13} /> Install</>}
                  </button>
                  {inst && inst !== 'busy' && (
                    <div className={`text-[11px] mt-2 ${inst.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {inst.ok
                        ? `Stage: ${inst.stage}${inst.runtimeAvailable ? '' : ' · runtime required'}`
                        : `Blocked: ${inst.blocked || inst.error || 'not ready'}`}
                      {' '}<span className="text-white/30">READY only after a real inference test.</span>
                    </div>
                  )}
                </div>
              </GlassSurface>
            );
          })}
        </div>
      )}

      {/* Model Discovery — search the hub; INSTALL only for signed-catalog models (existing ModelManager) */}
      <div className="text-xs uppercase tracking-widest text-white/40 mb-3 mt-6">Search models</div>
      <div className="flex gap-2 mb-3">
        <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
          placeholder='e.g. "coding 7b", "vision", "qwen"'
          className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:border-cyan-400/40 outline-none" />
        <button onClick={doSearch} disabled={searching || !searchQ.trim()}
          className="px-4 py-2 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 disabled:opacity-40 hover:bg-cyan-500/20 transition-colors">
          {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
      </div>
      {searchErr && <div className="text-[11px] text-amber-300/80 mb-2">{searchErr}</div>}
      {searchCards && searchCards.length === 0 && !searching && !searchErr && <div className="text-[11px] text-white/40 mb-2">No models found (or search is offline).</div>}
      {searchCards && searchCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {searchCards.map((c) => (
            <GlassSurface key={c.id} className="p-5 rounded-2xl flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white/90 font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-white/40">{c.publisher} · {c.gguf ? 'GGUF' : 'non-GGUF'} · {c.downloads.toLocaleString()} dl · {c.likes} likes{c.license ? ` · ${c.license}` : ''}{c.multimodal ? ' · vision' : ''}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <FitChip fit={{ verdict: c.verdict, confidence: c.confidence, reasons: c.fitReasons, unknownRungs: [], rungs: [] }} />
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.installable ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-white/40'}`}>{c.installable ? 'In signed catalog' : 'Review source'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-[11px] text-white/45 mt-2">
                <div>Params <span className="text-white/70">{c.parameters}</span></div>
                <div>Arch <span className="text-white/70">{c.architecture}</span></div>
                <div>Quant <span className="text-white/70">{c.quantization}</span></div>
                <div>Size <span className="text-white/70">{c.size}</span></div>
                <div>Context <span className="text-white/70">{c.context}</span></div>
                <div>Runtime <span className="text-white/70">{c.runtime}</span></div>
              </div>
              <div className="text-[11px] text-white/45 mt-2">{c.installReason}</div>
              <div className="flex items-center gap-2 mt-3">
                <button disabled={!c.installable} onClick={() => doInstall(c.id)}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-500/20 transition-colors">
                  <Download size={13} /> Install
                </button>
                <a href={c.repoUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-white/10 text-white/60 hover:text-white/80 hover:border-white/20 transition-colors">
                  <Globe size={13} /> Source
                </a>
              </div>
              {install[c.id] && install[c.id] !== 'busy' && <div className="text-[11px] mt-2 text-white/40">READY only after a real inference test.</div>}
            </GlassSurface>
          ))}
        </div>
      )}

      <div className="mt-4 text-[11px] text-white/30">Offline AI status: <span className={vm.readiness.offline === 'OFFLINE AI READY' ? 'text-emerald-300' : 'text-white/50'}>{vm.readiness.offline}</span></div>
    </div>
  );
}
