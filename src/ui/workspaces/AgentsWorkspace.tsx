"use client";
import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { WorkspaceScaffold } from '../core/WorkspaceScaffold';
import { useApiResource } from '../core/useApiResource';
import { BrainCircuit } from 'lucide-react';

interface Agent {
  agentId: string; name: string; role: string; capabilities: string[];
  permissions: string[]; status: 'idle' | 'busy' | 'paused' | 'terminated';
  currentTask: string | null; successRate: number;
}
interface AgentsResponse {
  ok: boolean;
  agents: Agent[];
  budget: { cpu: number; ram: number; gpu: number; parallelism?: number };
  canDispatch: { allowed: boolean; reason?: string };
}

const STATUS_TONE: Record<string, string> = {
  idle: 'bg-white/25', busy: 'bg-emerald-400', paused: 'bg-amber-400', terminated: 'bg-rose-400',
};

export const AgentsWorkspace = () => {
  const { data, loading, error, needsAuth, retry } = useApiResource<AgentsResponse>('/api/agents', { intervalMs: 6000 });
  const isEmpty = !!data && data.agents.length === 0;

  return (
    <WorkspaceScaffold
      title="Agents"
      subtitle="The live AgentSupervisor registry — statuses reflect real runtime state, not placeholders"
      loading={loading} error={error} needsAuth={needsAuth} onRetry={retry}
      empty={isEmpty}
      emptyMessage="No agents are registered right now."
      icon={<BrainCircuit size={22} className="text-cyan-300/80" />}
    >
      {data && (
        <>
          <GlassSurface className="p-4 rounded-xl flex items-center gap-4 text-[11px] text-white/45">
            <span>Parallelism <span className="text-white/80">{data.budget.parallelism ?? '—'}</span></span>
            <span>·</span>
            <span>Dispatch: {data.canDispatch.allowed
              ? <span className="text-emerald-300">ready</span>
              : <span className="text-amber-300">throttled — {data.canDispatch.reason || 'at capacity'}</span>}
            </span>
          </GlassSurface>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.agents.map((a) => (
              <GlassSurface key={a.agentId} className="p-5 rounded-2xl">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full ${STATUS_TONE[a.status] || 'bg-white/25'}`} />
                  <span className="text-sm text-white/85 font-medium">{a.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/30 ml-auto">{a.status}</span>
                </div>
                <p className="text-xs text-white/40 mt-2">{a.role}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {a.capabilities.map((c) => (
                    <span key={c} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] text-white/45">{c}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 text-[10px] text-white/30">
                  <span>{a.permissions.length ? a.permissions.join(', ') : 'no special permissions'}</span>
                  <span>{a.currentTask ? 'task active' : 'no task'}</span>
                </div>
              </GlassSurface>
            ))}
          </div>
        </>
      )}
    </WorkspaceScaffold>
  );
};
