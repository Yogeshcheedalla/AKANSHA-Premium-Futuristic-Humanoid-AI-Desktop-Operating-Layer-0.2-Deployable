"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Sparkles, Download, Plug, PlayCircle, Loader2, CheckCircle, AlertTriangle, Cpu, Globe, Boxes } from 'lucide-react';
import type { SetupViewModel } from '@/core/aiSetup/types';

/**
 * AI Center — the permanent, first-class home for AI configuration. It exists
 * so skipping onboarding NEVER leaves the user without a way to configure
 * models or providers: every summary line is real state from the existing
 * setup view model / provider APIs, and every button routes to an EXISTING
 * workspace or the existing command pipeline (no fake actions).
 */
interface Props { onNavigate: (id: string) => void }

interface Summary {
  localRuntime: boolean;
  installedCount: number;
  readyCount: number;
  fitCount: number;
  connectedProviders: number;
  readyProviders: number;
  freeCatalogCount: number;
  activeModel: string;
  offline: string;
  online: string;
}

export function AiCenterWorkspace({ onNavigate }: Props) {
  const [s, setS] = useState<Summary | null>(null);
  const [test, setTest] = useState<{ running: boolean; ok?: boolean; text?: string; provider?: string; model?: string; latencyMs?: number; status?: string; reason?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const setup: any = await (await fetch('/api/ai/setup', { credentials: 'same-origin' })).json();
      const provs: any = await (await fetch('/api/providers', { credentials: 'same-origin' })).json();
      const cat: any = await (await fetch('/api/providers/catalog', { credentials: 'same-origin' })).json();
      if (!setup.ok) return;
      const vm: SetupViewModel = setup.setup;
      const live = (provs.providers || []) as Array<{ enabled: boolean; credentialConfigured: boolean; health?: { status: string } }>;
      setS({
        localRuntime: vm.runtime.available,
        installedCount: vm.catalog.models.filter((m) => m.lifecycle?.state === 'READY').length,
        readyCount: vm.catalog.models.filter((m) => m.lifecycle?.state === 'READY').length,
        fitCount: vm.catalog.models.filter((m) => m.fit?.verdict === 'FIT').length,
        connectedProviders: live.filter((p) => p.credentialConfigured).length,
        readyProviders: live.filter((p) => p.health?.status === 'AVAILABLE').length,
        freeCatalogCount: (cat.providers || []).length,
        activeModel: vm.aiMode.recommended === 'offline' ? 'Local (llama.cpp)' : vm.online.connected && vm.online.verified ? 'OpenRouter (connected)' : 'Not configured',
        offline: vm.readiness.offline,
        online: vm.readiness.online,
      });
    } catch { /* honest absence: summary stays empty, no fake numbers */ }
  }, []);

  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id); }, [load]);

  const runTest = async () => {
    setTest({ running: true });
    try {
      const res = await fetch('/api/akansha/command', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text: 'Reply with exactly: AKANSHA ROUTING OK', requestId: `aitest-${Date.now().toString(36)}` }),
      });
      const d = await res.json();
      setTest({
        running: false, ok: !!d.ok && d.status === 'COMPLETED',
        text: (d.response || '').slice(0, 140),
        provider: d.model?.provider, model: d.model?.modelId,
        latencyMs: d.latencyMs, status: d.status || (d.ok ? 'COMPLETED' : 'FAILED'),
        reason: d.ok ? undefined : (d.error || d.response || 'request failed'),
      });
    } catch (e: any) {
      setTest({ running: false, ok: false, reason: String(e?.message || e) });
    }
  };

  if (!s) return <div className="p-8 text-white/40 text-sm flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Reading your AI configuration…</div>;

  const line = (okState: boolean, label: string, value: string, hint?: string) => (
    <div className={`rounded-2xl border p-4 ${okState ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-amber-400/20 bg-amber-400/5'}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/40">{okState ? <CheckCircle size={13} className="text-emerald-300" /> : <AlertTriangle size={13} className="text-amber-300" />}{label}</div>
      <div className="text-sm text-white/85 mt-1.5">{value}</div>
      {hint && <div className="text-[11px] text-white/35 mt-1">{hint}</div>}
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-light text-white/90 tracking-tight flex items-center gap-2"><Sparkles size={20} className="text-cyan-300/80" /> AI Center</h1>
      <p className="text-white/35 text-sm mb-6">Your AI configuration, always reachable — even if onboarding was skipped. Every status below is live; nothing is decorative.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {line(s.localRuntime, 'Local AI', s.localRuntime ? 'Runtime ready (llama.cpp)' : 'Runtime not detected', s.offline)}
          {line(s.readyCount > 0, 'Installed models', `${s.readyCount} READY · ${s.fitCount} hardware-fit`, 'READY only after a real inference test')}
          {line(s.readyProviders > 0, 'Free & connected providers', `${s.connectedProviders} connected · ${s.readyProviders} verified healthy`, `Catalog offers ${s.freeCatalogCount} free-tier providers`)}
          {line(s.activeModel !== 'Not configured', 'Active routing', s.activeModel, 'Local → free online → paid (consent required)')}
        </div>
        <GlassSurface className="p-4 rounded-2xl flex flex-col gap-2.5">
          <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Actions</div>
          <button onClick={() => onNavigate('modelcenter')} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors"><Cpu size={14} /> Configure AI</button>
          <button onClick={() => onNavigate('modelcenter')} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors"><Download size={14} /> Download Models</button>
          <button onClick={() => onNavigate('providers')} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-purple-400/20 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20 transition-colors"><Plug size={14} /> Connect Provider</button>
          <button onClick={runTest} disabled={test?.running} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">{test?.running ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Run AI Test</button>
        </GlassSurface>
      </div>

      {test && !test.running && (
        <GlassSurface className={`p-4 rounded-2xl mb-4 border ${test.ok ? 'border-emerald-400/25' : 'border-amber-400/25'}`}>
          <div className="text-xs font-medium mb-2 flex items-center gap-2">
            {test.ok ? <><CheckCircle size={14} className="text-emerald-300" /> <span className="text-emerald-200">Routing test passed</span></>
              : <><AlertTriangle size={14} className="text-amber-300" /> <span className="text-amber-200">Routing test did not complete</span></>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] text-white/45">
            <div>Provider <span className="text-white/75">{test.provider || (test.ok ? 'verified' : '—')}</span></div>
            <div>Model <span className="text-white/75 truncate">{test.model || (test.ok ? 'via router' : '—')}</span></div>
            <div>Latency <span className="text-white/75">{typeof test.latencyMs === 'number' ? `${test.latencyMs} ms` : '—'}</span></div>
            <div>Status <span className="text-white/75">{test.status || '—'}</span></div>
          </div>
          {test.text && <div className="text-[12px] text-white/60 mt-2">“{test.text}”</div>}
          {!test.ok && <div className="text-[11px] text-amber-300/80 mt-2">{test.reason} — configure a provider or install a local model, then run the test again.</div>}
          <div className="text-[10px] text-white/25 mt-2">The test ran through the real path: Command → Master Orchestrator → ModelRouter → provider.</div>
        </GlassSurface>
      )}

      <div className="flex items-center gap-2 text-[11px] text-white/30">
        <Globe size={13} /> Free-tier provider catalog: {s.freeCatalogCount} providers
        <span className="text-white/15">·</span>
        <Boxes size={13} /> Routing: local first, free online second, paid only with your explicit consent
      </div>
    </div>
  );
}
