"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { BrainCircuit, Database, GitBranch, Activity, Loader2, Cpu, ShieldCheck, RotateCcw } from 'lucide-react';

interface GraphData {
  models: { providers: { id: string; name: string; type: string; models: number }[]; totalModels: number; policy: string };
  capabilities: { id: string; name: string; category: string; reliability: number; latencyMs: number }[];
  skills: { id: string; name: string; provider: string; providers: string[]; riskLevel: string; reliability: number; recentSuccessRate: number | null }[];
  agents: { agentId: string; name: string; role: string; status: string; successRate: number }[];
  mcp: { total: number; available: number; byCategory: Record<string, number> };
  memory: { total: number; byType: Record<string, number>; working: number };
  lessons: { id: string; domain: string; strategy: string; outcome: string; confidence: number }[];
  traces: { traceId: string; requestId: string; kind: string; candidates: any[]; selected: any; reasons: string[] }[];
  events: { type: string; source: string; timestamp: number }[];
}

export const GraphWorkspace = () => {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    fetch('/api/graph', { signal: ctrl.signal, credentials: 'same-origin' })
      .then(async (r) => { const d = await r.json().catch(() => ({} as any)); if (!r.ok || !d?.ok) throw new Error(d?.error || `Request failed (HTTP ${r.status})`); return d as GraphData; })
      .then((d) => { setData(d); setError(null); })
      .catch((e: any) => setError(e?.name === 'AbortError' ? 'Timed out after 12s.' : (e?.message || 'Failed to load the graph.')))
      .finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  const retry = useCallback(() => { setLoading(true); setError(null); load(); }, [load]);

  useEffect(() => {
    const cleanup = load();
    const interval = setInterval(() => load(), 8000);
    return () => { cleanup(); clearInterval(interval); };
  }, [load]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-white/30 text-sm">
        <Loader2 size={14} className="animate-spin" /> Mapping capability fabric…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <GlassSurface className="p-8 rounded-2xl">
          <h2 className="text-lg font-light text-rose-300 mb-3">Could not load the architecture graph</h2>
          <p className="text-sm text-white/45 mb-6">{error || 'Unknown error.'}</p>
          <button onClick={retry} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-xs hover:bg-cyan-500/25"><RotateCcw size={13} /> Retry</button>
        </GlassSurface>
      </div>
    );
  }

  const memoryTypes = Object.entries(data.memory.byType);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-light text-white/90 tracking-tight">Architecture Graph</h1>
        <p className="text-white/30 text-sm mt-2">Live runtime topology — models, capabilities, agents, memory, and routing decisions</p>
      </div>

      {/* MASTER ORCHESTRATOR + three routers */}
      <GlassSurface className="p-8 rounded-3xl">
        <div className="flex flex-col items-center">
          <div className="px-6 py-3 rounded-full bg-gradient-to-br from-cyan-500/15 to-purple-500/15 border border-cyan-400/25 text-cyan-200 text-xs tracking-[0.15em] font-medium">
            AKANSHA MASTER ORCHESTRATOR
          </div>
          <div className="w-px h-8 bg-gradient-to-b from-cyan-400/30 to-transparent" />
          <div className="grid grid-cols-3 gap-4 md:gap-10 w-full max-w-2xl">
            {[
              { label: 'Model Router', sub: `${data.models.totalModels} models`, icon: <Cpu size={13} /> },
              { label: 'Agent Router', sub: `${data.agents.length} agents`, icon: <BrainCircuit size={13} /> },
              { label: 'Tool Router', sub: `${data.mcp.available} MCP`, icon: <Activity size={13} /> },
            ].map((n) => (
              <div key={n.label} className="flex flex-col items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-cyan-300/70">{n.icon}</div>
                <span className="text-[10px] uppercase tracking-widest text-white/50">{n.label}</span>
                <span className="text-[9px] text-white/25">{n.sub}</span>
              </div>
            ))}
          </div>
          <div className="w-px h-8 bg-gradient-to-b from-cyan-400/20 to-transparent" />
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/20">Execution Fabric → Observe → Verify → Learn</div>
        </div>
      </GlassSurface>

      {/* MODEL LAYER + MEMORY GRAPH */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-5">
            <Cpu size={15} className="text-cyan-300/80" />
            <h3 className="text-white/80 font-medium text-sm">Model Layer</h3>
            <span className="text-[9px] uppercase tracking-wider text-white/20 ml-auto">{data.models.policy}</span>
          </div>
          <div className="space-y-2.5">
            {data.models.providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/70 flex-shrink-0" />
                <span className="text-xs text-white/70 flex-1 truncate">{p.name}</span>
                <span className="text-[9px] uppercase tracking-wider text-white/25">{p.type}</span>
                <span className="text-xs text-cyan-200/70 w-8 text-right">{p.models}</span>
              </div>
            ))}
            {data.models.providers.length === 0 && <p className="text-xs text-white/25">No providers discovered.</p>}
          </div>
        </GlassSurface>

        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-5">
            <Database size={15} className="text-purple-300/80" />
            <h3 className="text-white/80 font-medium text-sm">Memory Graph</h3>
            <span className="text-[9px] uppercase tracking-wider text-white/20 ml-auto">{data.memory.total} total</span>
          </div>
          <div className="relative h-40">
            <svg viewBox="0 0 300 160" className="w-full h-full">
              <defs>
                <linearGradient id="memLink" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <circle cx="150" cy="80" r="18" fill="#8b5cf6" opacity="0.25" />
              <circle cx="150" cy="80" r="10" fill="#8b5cf6" opacity="0.7" />
              <text x="150" y="84" textAnchor="middle" fill="#e9d5ff" fontSize="7">USER</text>
              {memoryTypes.slice(0, 5).map(([, count], i) => {
                const angle = (i * 72 - 90) * (Math.PI / 180);
                const x = 150 + Math.cos(angle) * 92;
                const y = 80 + Math.sin(angle) * 52;
                return (
                  <g key={i}>
                    <line x1="150" y1="80" x2={x} y2={y} stroke="url(#memLink)" strokeWidth="0.6" opacity="0.45" />
                    <circle cx={x} cy={y} r={Math.min(14, 5 + count * 0.5)} fill="#00f0ff" opacity="0.5" />
                    <text x={x} y={y + 3} textAnchor="middle" fill="#a5f3fc" fontSize="6">{count}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {memoryTypes.map(([type, count]) => (
              <span key={type} className="px-2 py-1 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-white/45">
                {type}: {count}
              </span>
            ))}
            <span className="px-2 py-1 rounded-md bg-white/5 border border-white/8 text-[9px] uppercase tracking-wider text-white/30">
              working: {data.memory.working}
            </span>
          </div>
        </GlassSurface>
      </div>

      {/* CAPABILITY GRAPH + SKILLS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-5">
            <Activity size={15} className="text-emerald-300/80" />
            <h3 className="text-white/80 font-medium text-sm">Capability Graph</h3>
          </div>
          <div className="space-y-3">
            {data.capabilities.map((c) => (
              <div key={c.id}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-white/70">{c.name}</span>
                  <span className="text-white/25">{Math.round(c.reliability * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400/60 to-purple-400/60" style={{ width: `${c.reliability * 100}%` }} />
                </div>
                <div className="flex gap-2 mt-1.5 text-[9px] text-white/20 uppercase tracking-wider">
                  <span>{c.category}</span><span>{c.latencyMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </GlassSurface>

        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center gap-2 mb-5">
            <GitBranch size={15} className="text-cyan-300/80" />
            <h3 className="text-white/80 font-medium text-sm">Skills</h3>
            <ShieldCheck size={11} className="text-white/20 ml-auto" />
          </div>
          <div className="space-y-2.5">
            {data.skills.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.riskLevel === 'low' ? 'bg-emerald-400/70' : s.riskLevel === 'medium' ? 'bg-amber-400/70' : 'bg-rose-400/70'}`} />
                <span className="text-xs text-white/70 flex-1 truncate">{s.name}</span>
                <span className="text-[9px] text-white/25">{s.provider}</span>
                <span className="text-[9px] text-cyan-200/50 w-10 text-right">
                  {s.recentSuccessRate !== null ? `${Math.round(s.recentSuccessRate * 100)}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </GlassSurface>
      </div>

      {/* DECISION TRACES */}
      <GlassSurface className="p-6 rounded-3xl">
        <div className="flex items-center gap-2 mb-5">
          <BrainCircuit size={15} className="text-amber-300/80" />
          <h3 className="text-white/80 font-medium text-sm">Decision Traces</h3>
          <span className="text-[9px] uppercase tracking-wider text-white/20 ml-auto">why Akansha chose it</span>
        </div>
        {data.traces.length === 0 ? (
          <p className="text-xs text-white/25">No routing decisions recorded yet. Send a command to generate a trace.</p>
        ) : (
          <div className="space-y-2">
            {data.traces.map((t, i) => {
              const open = selectedTrace === i;
              return (
                <div key={t.traceId} className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
                  <button onClick={() => setSelectedTrace(open ? null : i)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 flex-shrink-0" />
                    <span className="text-xs text-white/70 flex-1 truncate">
                      {t.selected ? `${t.selected.providerId} → ${t.selected.modelId}` : 'no provider'}
                    </span>
                    <span className="text-[9px] text-white/25">{t.candidates?.length || 0} candidates</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 space-y-2.5">
                      {t.candidates?.map((c: any, j: number) => (
                        <div key={j} className="flex items-center gap-3">
                          <span className={`w-1 h-1 rounded-full flex-shrink-0 ${t.selected?.providerId === c.providerId ? 'bg-emerald-400' : 'bg-white/20'}`} />
                          <span className="text-[11px] text-white/60 font-mono flex-1 truncate">{c.providerId}::{c.modelId}</span>
                          <span className="text-[10px] text-cyan-200/60">{c.score}</span>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(t.reasons || []).map((r: string, j: number) => (
                          <span key={j} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] text-white/40">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassSurface>

      {/* EVENT STREAM */}
      <GlassSurface className="p-6 rounded-3xl">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={15} className="text-cyan-300/80" />
          <h3 className="text-white/80 font-medium text-sm">Event Stream</h3>
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {data.events.slice().reverse().map((e, i) => (
            <div key={i} className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-white/20 w-14">{new Date(e.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
              <span className="text-cyan-200/60 w-44 truncate">{e.type}</span>
              <span className="text-white/30 truncate">{e.source}</span>
            </div>
          ))}
        </div>
      </GlassSurface>
    </div>
  );
};
