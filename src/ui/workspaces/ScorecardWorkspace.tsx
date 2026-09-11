"use client";
import React, { useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Loader2, ShieldCheck, Swords, RefreshCw, CheckCircle2, XCircle, Trophy } from 'lucide-react';

interface Fail { id: string; name: string; severity: string; expected: string; actual: string }
interface FuncData {
  summary: { totalTests: number; passed: number; failed: number; score: number; grade: string; criticalFailures: number };
  categories: { category: string; passed: number; total: number; score: number }[];
  allFailures: Fail[];
}
interface RedData {
  summary: { totalAttacks: number; blocked: number; escaped: number; criticalAttacks: number; criticalBlocked: number; criticalEscaped: number; score: number; grade: string };
  byCategory: Record<string, { blocked: number; total: number }>;
  escaped: { id: string; name: string; severity: string; vector: string; detail: string }[];
}

const bar = (pct: number) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

export const ScorecardWorkspace = () => {
  const [func, setFunc] = useState<FuncData | null>(null);
  const [red, setRed] = useState<RedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([
        fetch('/api/tests').then((x) => x.json()),
        fetch('/api/redteam').then((x) => x.json()),
      ]);
      if (f.ok) setFunc(f);
      if (r.ok) setRed(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const run = async () => { setBusy(true); await load(); setBusy(false); };

  if (loading || !func || !red) {
    return <div className="p-8 flex items-center justify-center gap-2 text-white/30 text-sm"><Loader2 size={14} className="animate-spin" /> Running test suites…</div>;
  }

  const f = func.summary, r = red.summary;
  const combined = Math.round((f.score + r.score) / 2);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-light text-white/90 tracking-tight">Scorecard</h1>
          <p className="text-white/30 text-sm mt-2">Functional verification and adversarial red-team testing</p>
        </div>
        <button onClick={run} disabled={busy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-cyan-200 text-[11px] hover:bg-cyan-500/25 disabled:opacity-40">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-run suites
        </button>
      </div>

      {/* OVERALL */}
      <GlassSurface active className="p-8 rounded-3xl text-center">
        <div className="flex items-center justify-center gap-2 mb-3"><Trophy size={16} className="text-amber-300/80" /><span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Combined score</span></div>
        <div className="text-6xl font-extralight bg-gradient-to-b from-white to-cyan-400/60 bg-clip-text text-transparent">{combined}</div>
        <div className="text-sm text-cyan-200/70 mt-1">{f.grade === 'A+' && r.grade === 'A+' ? 'A+' : f.grade}/{r.grade} · functional + adversarial</div>
        <div className="flex justify-center gap-8 mt-6 text-[10px] uppercase tracking-wider">
          <div><div className="text-xl font-light text-emerald-400">{f.passed}/{f.totalTests}</div><div className="text-white/25 mt-1">tests pass</div></div>
          <div><div className="text-xl font-light text-rose-400">{f.criticalFailures}</div><div className="text-white/25 mt-1">critical fails</div></div>
          <div><div className="text-xl font-light text-emerald-400">{r.blocked}/{r.totalAttacks}</div><div className="text-white/25 mt-1">attacks blocked</div></div>
          <div><div className="text-xl font-light text-rose-400">{r.criticalEscaped}</div><div className="text-white/25 mt-1">critical escapes</div></div>
        </div>
      </GlassSurface>

      {/* TWO SUITES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-300/80" /><h3 className="text-white/80 font-medium text-sm">Functional Suite</h3></div>
            <span className={`text-lg font-light ${f.score >= 95 ? 'text-emerald-400' : f.score >= 80 ? 'text-amber-400' : 'text-rose-400'}`}>{f.score}%</span>
          </div>
          <div className="space-y-3">
            {func.categories.map((c) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="text-white/70">{c.category}</span>
                  <span className="text-white/30">{c.passed}/{c.total}</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-cyan-400/60 transition-all duration-700" style={{ width: `${c.score}%` }} />
                </div>
              </div>
            ))}
          </div>
          {func.allFailures.length > 0 && (
            <div className="mt-5 pt-4 border-t border-white/[0.06] space-y-2">
              {func.allFailures.map((x) => (
                <div key={x.id} className="flex items-start gap-2">
                  <XCircle size={11} className="text-rose-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-white/70">{x.name}</p>
                    <p className="text-[10px] text-white/25">expected {x.expected} · got {x.actual}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2"><Swords size={15} className="text-rose-300/80" /><h3 className="text-white/80 font-medium text-sm">Adversarial Suite</h3></div>
            <span className={`text-lg font-light ${r.score >= 95 ? 'text-emerald-400' : r.score >= 80 ? 'text-amber-400' : 'text-rose-400'}`}>{r.score}%</span>
          </div>
          <div className="space-y-3">
            {Object.entries(red.byCategory).map(([cat, v]) => (
              <div key={cat}>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="text-white/70">{cat}</span>
                  <span className="text-white/30">{v.blocked}/{v.total}</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-rose-400/70 to-amber-400/60 transition-all duration-700" style={{ width: `${(v.blocked / v.total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          {red.escaped.length > 0 ? (
            <div className="mt-5 pt-4 border-t border-white/[0.06] space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-rose-300/60">Escaped attacks</p>
              {red.escaped.map((a) => (
                <div key={a.id} className="flex items-start gap-2">
                  <XCircle size={11} className="text-rose-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-white/70">{a.name}</p>
                    <p className="text-[10px] font-mono text-white/25 truncate">{a.vector}</p>
                    <p className="text-[10px] text-rose-200/40">{a.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-400" />
              <p className="text-[11px] text-emerald-200/60">All {r.totalAttacks} attacks blocked, including {r.criticalAttacks} critical.</p>
            </div>
          )}
        </GlassSurface>
      </div>

      <GlassSurface className="p-6 rounded-3xl">
        <h3 className="text-white/80 font-medium text-sm mb-4">Coverage</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          {[
            { k: 'Security', v: '10 tests' }, { k: 'Voice', v: '7 tests' },
            { k: 'Intelligence', v: '10 tests' }, { k: 'Memory', v: '5 tests' },
            { k: 'Learning', v: '3 tests' }, { k: 'Fabric', v: '5 tests' },
            { k: 'Explainability', v: '3 tests' }, { k: 'Red-team vectors', v: '21 attacks' },
          ].map((x) => (
            <div key={x.k} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-wider text-white/50">{x.k}</div>
              <div className="text-[11px] text-cyan-200/50 mt-1">{x.v}</div>
            </div>
          ))}
        </div>
      </GlassSurface>
    </div>
  );
};
