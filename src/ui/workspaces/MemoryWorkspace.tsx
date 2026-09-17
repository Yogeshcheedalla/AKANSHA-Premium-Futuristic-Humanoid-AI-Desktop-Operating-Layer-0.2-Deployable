"use client";
import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { WorkspaceScaffold } from '../core/WorkspaceScaffold';
import { useApiResource } from '../core/useApiResource';
import { Database } from 'lucide-react';

interface MemoryItem {
  memoryId: string; type: string; content: string; importance: number;
  confidence: number; sensitivity: string; trust: string; source: string;
  userAuthored: boolean; tags: string[]; updatedAt: number; expiresAt: number | null;
}
interface MemoryResponse {
  ok: boolean;
  stats: { total: number; byType: Record<string, number>; byTrust: Record<string, number>; retention: Record<string, string> };
  working: number;
  items: MemoryItem[];
}

const ago = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const MemoryWorkspace = () => {
  const { data, loading, error, needsAuth, retry } = useApiResource<MemoryResponse>('/api/memory', { intervalMs: 6000 });

  const types = data ? Object.entries(data.stats.byType) : [];
  const isEmpty = !!data && data.items.length === 0;

  return (
    <WorkspaceScaffold
      title="Memory Space"
      subtitle="What Akansha currently recalls — read live from the single MemoryFabric (TTL-expired records are dropped)"
      loading={loading} error={error} needsAuth={needsAuth} onRetry={retry}
      empty={isEmpty}
      emptyMessage="No memories stored yet. Memories appear here after Akansha actually learns something from you."
      icon={<Database size={22} className="text-purple-300/80" />}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total" value={data.stats.total} tone="text-white/90" />
            <Stat label="Working" value={data.working} tone="text-cyan-300" />
            <Stat label="Long-term" value={types.filter(([t]) => ['semantic', 'procedural', 'preference'].includes(t)).reduce((a, [, c]) => a + c, 0)} tone="text-emerald-300" />
            <Stat label="Types" value={types.length} tone="text-purple-300" />
          </div>

          <GlassSurface className="p-6 rounded-2xl">
            <h3 className="text-white/80 font-medium text-sm mb-4">By type</h3>
            <div className="flex flex-wrap gap-2">
              {types.map(([type, count]) => (
                <span key={type} className="px-2.5 py-1 rounded-md bg-white/5 border border-white/8 text-[10px] uppercase tracking-wider text-white/50">
                  {type}: <span className="text-white/80">{count}</span>
                </span>
              ))}
            </div>
          </GlassSurface>

          <div className="space-y-3">
            {data.items.map((m) => (
              <GlassSurface key={m.memoryId} className="p-4 rounded-xl flex items-start gap-4 hover:border-purple-400/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-purple-200/80">{m.type}</span>
                    {m.sensitivity !== 'normal' && (
                      <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${m.sensitivity === 'never_store' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{m.sensitivity}</span>
                    )}
                    {m.userAuthored && <span className="text-[10px] text-white/30">you</span>}
                  </div>
                  <p className="text-sm text-white/80 mt-1.5 break-words">{m.content}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-white/25">
                    <span>trust {m.trust}</span>
                    <span>·</span>
                    <span>conf {(m.confidence * 100).toFixed(0)}%</span>
                    <span>·</span>
                    <span>{ago(m.updatedAt)}</span>
                    {m.expiresAt && <span>· expires {ago(m.expiresAt).replace(' ago', '')}</span>}
                  </div>
                </div>
              </GlassSurface>
            ))}
          </div>
        </>
      )}
    </WorkspaceScaffold>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <GlassSurface className="p-4 rounded-xl text-center">
    <div className={`text-2xl font-light ${tone}`}>{value}</div>
    <div className="text-[10px] uppercase tracking-wider mt-1 text-white/40">{label}</div>
  </GlassSurface>
);
