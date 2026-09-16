"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Loader2, ExternalLink, ShieldAlert, Boxes, GitBranch, AlertOctagon, CheckCircle2, Clock, Layers, RotateCcw } from 'lucide-react';

interface Repo {
  id: string; slug: string; url: string; name: string; description: string;
  status: string; integrationMode: string; roleInAkansha: string;
  capabilitiesProvided: string[]; permissions: string[];
  sandboxRequired: boolean; windowsCompatible: string;
  fallbackFor: string[]; notes: string; rejectionReason?: string;
}
interface Layer {
  layer: string; label: string; description: string;
  integrated: number; adapterReady: number; rejected: number; repositories: Repo[];
}
interface Data {
  stats: { total: number; integrated: number; adapterReady: number; rejected: number; layers: number; capabilities: number; byStatus: Record<string, number> };
  layers: Layer[];
  pipeline: { id: string; label: string; description: string; capabilities: string[]; repositories: { id: string; name: string; status: string }[] }[];
  escalation: { level: number; label: string; reason: string; repository: { id: string; name: string; status: string } | null }[];
  securityGates: { repository: string; sandboxRequired: boolean; highPrivilege: boolean; permissions: string[] }[];
  rejections: { name: string; slug: string; reason: string }[];
  live: { capabilitiesRegistered: number; skillsRegistered: number };
}

const STATUS_STYLE: Record<string, string> = {
  INTEGRATED: 'bg-emerald-500/12 border-emerald-400/25 text-emerald-200',
  ADAPTER_READY: 'bg-cyan-500/12 border-cyan-400/25 text-cyan-200',
  ARCHITECTURAL: 'bg-purple-500/12 border-purple-400/25 text-purple-200',
  CATALOG: 'bg-white/5 border-white/12 text-white/50',
  REFERENCE: 'bg-white/5 border-white/12 text-white/40',
  REJECTED: 'bg-rose-500/12 border-rose-400/25 text-rose-200',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  INTEGRATED: <CheckCircle2 size={9} />,
  ADAPTER_READY: <Clock size={9} />,
  ARCHITECTURAL: <Layers size={9} />,
  CATALOG: <Boxes size={9} />,
  REFERENCE: <Boxes size={9} />,
  REJECTED: <AlertOctagon size={9} />,
};

export const RepositoriesWorkspace = () => {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'layers' | 'pipeline' | 'escalation' | 'security'>('layers');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    // Hard timeout so this can NEVER spin forever (the old code only cleared on a
    // successful d.ok response, so any 401/500/non-ok/rejected fetch hung here).
    const timer = setTimeout(() => ctrl.abort(), 12000);
    fetch('/api/repositories', { signal: ctrl.signal, credentials: 'same-origin' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({} as any));
        if (!r.ok || !d || d.ok !== true) {
          throw new Error(d?.error || (r.status === 401 ? 'Authentication required' : `Request failed (HTTP ${r.status})`));
        }
        return d as Data & { ok: true };
      })
      .then((d) => setData(d))
      .catch((e: any) => setError(e?.name === 'AbortError' ? 'Timed out after 12s — the repository service did not respond in time.' : (e?.message || 'Failed to load the repository fabric.')))
      .finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  const retry = useCallback(() => { setLoading(true); setError(null); load(); }, [load]);

  useEffect(() => load(), [load]);

  if (loading && !data) {
    return <div className="p-8 flex items-center justify-center gap-2 text-white/30 text-sm"><Loader2 size={14} className="animate-spin" /> Mapping repository fabric…</div>;
  }

  if (!data) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <GlassSurface className="p-8 rounded-2xl">
          <div className="flex items-center gap-2 text-rose-300 mb-3"><AlertOctagon size={16} /><h2 className="text-lg font-light">Could not map the repository fabric</h2></div>
          <p className="text-sm text-white/45 mb-6">{error || 'Unknown error.'}</p>
          <div className="flex items-center gap-3">
            <button onClick={retry} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-xs hover:bg-cyan-500/25 transition-colors">
              <RotateCcw size={13} /> Retry
            </button>
            <a href="/app" className="text-[11px] text-white/35 hover:text-white/60">Back to Command</a>
          </div>
        </GlassSurface>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-light text-white/90 tracking-tight">Repository Fabric</h1>
        <p className="text-white/30 text-sm mt-2">
          {data.stats.total} repositories · {data.stats.layers} layers · {data.stats.capabilities} capabilities — all behind one orchestrator
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Integrated', value: data.stats.integrated, color: 'text-emerald-400' },
          { label: 'Adapter Ready', value: data.stats.adapterReady, color: 'text-cyan-400' },
          { label: 'Architectural', value: data.stats.byStatus.ARCHITECTURAL || 0, color: 'text-purple-400' },
          { label: 'Reference', value: (data.stats.byStatus.REFERENCE || 0) + (data.stats.byStatus.CATALOG || 0), color: 'text-white/40' },
          { label: 'Rejected', value: data.stats.rejected, color: 'text-rose-400' },
        ].map((s) => (
          <GlassSurface key={s.label} className="p-4 rounded-2xl text-center">
            <div className={`text-2xl font-light ${s.color}`}>{s.value}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-white/25 mt-1">{s.label}</div>
          </GlassSurface>
        ))}
      </div>

      {/* View switcher */}
      <div className="flex gap-2 flex-wrap">
        {([
          ['layers', 'Layers'], ['pipeline', 'Pipeline'], ['escalation', 'Escalation'], ['security', 'Security'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 rounded-full text-[11px] border transition-colors ${view === k ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/70'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-white/25">
          <span>{data.live.capabilitiesRegistered} live capabilities</span>
          <span className="text-white/15">|</span>
          <span>{data.live.skillsRegistered} live skills</span>
        </div>
      </div>

      {/* LAYERS VIEW */}
      {view === 'layers' && (
        <div className="space-y-6">
          {data.layers.map((layer) => (
            <div key={layer.layer}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-medium text-white/85">{layer.label}</h2>
                <span className="text-[10px] text-white/25 flex-1 truncate hidden md:block">{layer.description}</span>
                <span className="text-[9px] uppercase tracking-wider text-white/25">
                  {layer.repositories.length} repos
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {layer.repositories.map((r) => (
                  <GlassSurface key={r.id} active={r.status === 'INTEGRATED'} className="p-5 rounded-2xl">
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-medium text-white/90">{r.name}</h3>
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-white/20 hover:text-cyan-300 transition-colors">
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <p className="text-[10px] font-mono text-white/25 mt-1">{r.slug}</p>
                      </div>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[8px] uppercase tracking-wider flex-shrink-0 ${STATUS_STYLE[r.status]}`}>
                        {STATUS_ICON[r.status]}{r.status.replace('_', ' ')}
                      </span>
                    </div>

                    <p className="text-[11px] text-white/45 leading-relaxed">{r.roleInAkansha}</p>

                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {r.capabilitiesProvided.slice(0, 4).map((c) => (
                        <span key={c} className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[9px] font-mono text-cyan-200/50">{c}</span>
                      ))}
                      {r.capabilitiesProvided.length > 4 && (
                        <span className="text-[9px] text-white/25 self-center">+{r.capabilitiesProvided.length - 4}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 mt-3 text-[9px] uppercase tracking-wider text-white/25">
                      <span>mode: {r.integrationMode}</span>
                      <span className="text-white/15">|</span>
                      <span>win: {r.windowsCompatible}</span>
                      {r.sandboxRequired && (<><span className="text-white/15">|</span><span className="text-amber-300/60">sandbox</span></>)}
                      {r.fallbackFor.length > 0 && (<><span className="text-white/15">|</span><span>fallback</span></>)}
                    </div>

                    {r.rejectionReason && (
                      <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/[0.07] border border-rose-400/15">
                        <AlertOctagon size={11} className="text-rose-300/70 mt-0.5 flex-shrink-0" />
                        <p className="text-[10px] text-rose-200/60 leading-relaxed">{r.rejectionReason}</p>
                      </div>
                    )}

                    {r.notes && (
                      <button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-[9px] text-white/25 hover:text-white/50 transition-colors mt-3 uppercase tracking-wider">
                        {open === r.id ? 'hide notes' : 'notes'}
                      </button>
                    )}
                    {open === r.id && r.notes && (
                      <p className="text-[10px] text-white/35 leading-relaxed mt-2 pl-3 border-l border-white/10">{r.notes}</p>
                    )}
                  </GlassSurface>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PIPELINE VIEW */}
      {view === 'pipeline' && (
        <GlassSurface className="p-8 rounded-3xl">
          <div className="flex items-center gap-2 mb-8">
            <GitBranch size={15} className="text-cyan-300/80" />
            <h3 className="text-white/80 font-medium text-sm">Request Pipeline</h3>
            <span className="text-[9px] uppercase tracking-wider text-white/20 ml-auto">repos mapped to stages</span>
          </div>
          <div className="space-y-1">
            {data.pipeline.map((stage, i) => (
              <div key={stage.id}>
                <div className="flex items-start gap-4 group">
                  <div className="flex flex-col items-center flex-shrink-0 pt-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium border ${
                      stage.repositories.some((r) => r.status === 'INTEGRATED')
                        ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200'
                        : 'bg-white/[0.05] border-white/10 text-white/40'}`}>
                      {i + 1}
                    </div>
                    {i < data.pipeline.length - 1 && <div className="w-px flex-1 min-h-[36px] bg-gradient-to-b from-cyan-400/25 to-transparent mt-1" />}
                  </div>
                  <div className="flex-1 pb-6 min-w-0">
                    <h4 className="text-xs font-medium text-white/85">{stage.label}</h4>
                    <p className="text-[10px] text-white/25 mt-0.5">{stage.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {stage.repositories.map((r) => (
                        <span key={r.id} className={`px-2 py-0.5 rounded-md border text-[9px] ${
                          r.status === 'INTEGRATED' ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200/70'
                          : r.status === 'ADAPTER_READY' ? 'bg-cyan-500/10 border-cyan-400/20 text-cyan-200/60'
                          : 'bg-white/[0.04] border-white/[0.08] text-white/35'}`}>
                          {r.name}
                        </span>
                      ))}
                    </div>
                    {stage.capabilities.length > 0 && (
                      <p className="text-[9px] font-mono text-white/20 mt-2 truncate">
                        {stage.capabilities.slice(0, 6).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassSurface>
      )}

      {/* ESCALATION VIEW */}
      {view === 'escalation' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassSurface className="p-6 rounded-3xl">
            <div className="flex items-center gap-2 mb-6">
              <GitBranch size={15} className="text-emerald-300/80" />
              <h3 className="text-white/80 font-medium text-sm">Browser Escalation Ladder</h3>
            </div>
            <div className="space-y-3">
              {data.escalation.map((r) => (
                <div key={r.level} className="flex items-start gap-3">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 border ${
                    r.repository ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200' : 'bg-white/[0.05] border-white/10 text-white/35'}`}>
                    {r.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-white/80">{r.label}</span>
                      {r.repository && (
                        <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase tracking-wider ${
                          r.repository.status === 'INTEGRATED' ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200/70' : 'bg-cyan-500/10 border-cyan-400/20 text-cyan-200/60'}`}>
                          {r.repository.name}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-white/30 mt-0.5">{r.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassSurface>

          <div className="space-y-4">
            <GlassSurface className="p-6 rounded-3xl">
              <div className="flex items-center gap-2 mb-5">
                <ShieldAlert size={15} className="text-amber-300/80" />
                <h3 className="text-white/80 font-medium text-sm">Security Gates</h3>
              </div>
              <div className="space-y-2.5">
                {data.securityGates.map((g) => (
                  <div key={g.repository} className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${g.highPrivilege ? 'bg-rose-400/80' : 'bg-amber-400/70'}`} />
                    <span className="text-[11px] text-white/70 flex-1 truncate">{g.repository}</span>
                    {g.sandboxRequired && <span className="text-[8px] uppercase tracking-wider text-amber-300/60">sandbox</span>}
                    {g.highPrivilege && <span className="text-[8px] uppercase tracking-wider text-rose-300/60">priv</span>}
                  </div>
                ))}
              </div>
            </GlassSurface>

            {data.rejections.length > 0 && (
              <GlassSurface className="p-6 rounded-3xl">
                <div className="flex items-center gap-2 mb-5">
                  <AlertOctagon size={15} className="text-rose-300/80" />
                  <h3 className="text-white/80 font-medium text-sm">Rejected</h3>
                </div>
                {data.rejections.map((r) => (
                  <div key={r.slug} className="mb-4 last:mb-0">
                    <p className="text-[11px] text-white/80">{r.name}</p>
                    <p className="text-[9px] font-mono text-white/25 mt-0.5">{r.slug}</p>
                    <p className="text-[10px] text-rose-200/50 leading-relaxed mt-2">{r.reason}</p>
                  </div>
                ))}
              </GlassSurface>
            )}
          </div>
        </div>
      )}

      {/* SECURITY VIEW */}
      {view === 'security' && (
        <div className="space-y-3">
          {data.securityGates.map((g) => (
            <GlassSurface key={g.repository} className="p-5 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white/90">{g.repository}</h3>
                <div className="flex gap-2">
                  {g.highPrivilege && <span className="px-2 py-0.5 rounded-md bg-rose-500/12 border border-rose-400/25 text-[8px] uppercase tracking-wider text-rose-200">high privilege</span>}
                  {g.sandboxRequired && <span className="px-2 py-0.5 rounded-md bg-amber-500/12 border border-amber-400/25 text-[8px] uppercase tracking-wider text-amber-200">sandbox</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.permissions.map((p) => (
                  <span key={p} className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[9px] font-mono text-white/45">{p}</span>
                ))}
              </div>
            </GlassSurface>
          ))}
        </div>
      )}
    </div>
  );
};
