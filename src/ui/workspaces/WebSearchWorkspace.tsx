"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Search as SearchIcon, Globe, Loader2, CheckCircle, AlertTriangle, WifiOff, ExternalLink, RefreshCw } from 'lucide-react';

interface Result {
  title: string; url: string; snippet: string; source: string;
  engine?: string; publishedAt?: string; score?: number; relevance: number;
}
interface SearchData {
  ok: boolean; status: 'READY' | 'DEGRADED' | 'UNAVAILABLE'; query: string;
  count: number; results: Result[]; reason?: string; currentInfoEligible?: boolean;
}

const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  READY: { label: 'Web Search Ready', cls: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/5', icon: <CheckCircle size={14} /> },
  DEGRADED: { label: 'Search Degraded', cls: 'text-amber-300 border-amber-400/25 bg-amber-400/5', icon: <AlertTriangle size={14} /> },
  UNAVAILABLE: { label: 'Web Search Unavailable', cls: 'text-white/40 border-white/10 bg-white/5', icon: <WifiOff size={14} /> },
  CHECKING: { label: 'Checking…', cls: 'text-white/40 border-white/10 bg-white/5', icon: <Loader2 size={14} className="animate-spin" /> },
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/**
 * Web Search — Akansha's live-information capability (self-hosted SearXNG via
 * the existing provider mesh). The badge shows REAL provider health (probed on
 * mount + on demand), never an assumed state. Results are untrusted content:
 * rendered as text and links only (nofollow/noopener), never executed.
 */
export function WebSearchWorkspace() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchData | null>(null);
  const [status, setStatus] = useState<string>('CHECKING');
  const [statusReason, setStatusReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const res = await fetch('/api/search/health', { credentials: 'same-origin' });
      const d = await res.json();
      setStatus(d?.health?.status || 'UNAVAILABLE');
      setStatusReason(d?.health?.reason || '');
    } catch {
      setStatus('UNAVAILABLE');
      setStatusReason('health probe failed');
    } finally { setProbing(false); }
  }, []);

  // Probe REAL provider health once on mount (scheduled, not synchronous in the
  // effect body) and whenever the user hits "Check".
  useEffect(() => {
    const id = setTimeout(() => { void probe(); }, 0);
    return () => clearTimeout(id);
  }, [probe]);

  const run = useCallback(async (query: string) => {
    const qq = query.trim();
    if (!qq) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(qq)}`, { credentials: 'same-origin' });
      const d: SearchData = await res.json();
      setData(d);
      setStatus(d.status || (d.ok ? 'READY' : 'UNAVAILABLE'));
      setStatusReason(d.reason || '');
    } catch {
      setData(null);
      setStatus('UNAVAILABLE');
      setStatusReason('search request failed');
    } finally { setBusy(false); }
  }, []);

  const st = STATUS[status] || STATUS.UNAVAILABLE;

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-light text-white/90 tracking-tight">Web Search</h1>
        <button onClick={probe} disabled={probing} title="Re-check provider health"
          className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 border border-white/10 rounded-full px-2.5 py-1 transition-colors">
          <RefreshCw size={11} className={probing ? 'animate-spin' : ''} /> Check
        </button>
      </div>
      <p className="text-white/30 text-sm mb-5">Live information via Akansha&rsquo;s self-hosted SearXNG. The status badge reflects a real health probe — nothing is faked.</p>

      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs mb-5 ${st.cls}`} title={statusReason || undefined}>
        {st.icon}{st.label}
        {statusReason && status !== 'READY' ? <span className="text-white/30">· {statusReason}</span> : null}
      </div>

      <GlassSurface className="p-4 rounded-2xl mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(q); }}
              placeholder="What do you want to find?"
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white/85 placeholder:text-white/25 focus:border-cyan-400/40 outline-none"
            />
          </div>
          <button onClick={() => run(q)} disabled={busy || !q.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 disabled:opacity-40 hover:bg-cyan-500/20 transition-colors">
            {busy ? <Loader2 size={15} className="animate-spin" /> : 'Search'}
          </button>
        </div>
      </GlassSurface>

      {data && data.status === 'UNAVAILABLE' && (
        <div className="text-sm text-amber-300/90">
          Web search is currently unavailable{data.reason ? ` (${data.reason})` : ''}. Local AI still works — and no live claim is made without a live source.
        </div>
      )}
      {data && data.status === 'DEGRADED' && (
        <div className="text-sm text-amber-300/80">Search reachable but returned no results (rate limit or upstream issue). Try again shortly.</div>
      )}
      {data && data.status === 'READY' && data.results.length === 0 && (
        <div className="text-sm text-white/40">No results.</div>
      )}
      {data && data.results.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-white/30">
            {data.count} sources · untrusted content · rendered as text only
            {data.currentInfoEligible ? <span className="text-cyan-300/60 normal-case"> · routing: this query is web-eligible</span> : null}
          </div>
          {data.results.map((r, i) => (
            <GlassSurface key={r.url + i} className="p-4 rounded-2xl">
              <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-start gap-2 group">
                <Globe size={15} className="mt-0.5 text-cyan-300/70 shrink-0" />
                <div className="min-w-0">
                  <div className="text-white/85 text-sm font-medium group-hover:text-cyan-200 break-words">{r.title || r.url}</div>
                  {r.snippet && <div className="text-white/45 text-[12px] mt-1 leading-relaxed">{r.snippet}</div>}
                  <div className="text-white/30 text-[11px] mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="truncate">{hostOf(r.url)}</span>
                    <span>· {r.source}</span>
                    {r.engine && <span>· {r.engine}</span>}
                    {r.publishedAt && <span>· {r.publishedAt}</span>}
                    <ExternalLink size={11} className="shrink-0" />
                  </div>
                </div>
              </a>
            </GlassSurface>
          ))}
        </div>
      )}
    </div>
  );
}
