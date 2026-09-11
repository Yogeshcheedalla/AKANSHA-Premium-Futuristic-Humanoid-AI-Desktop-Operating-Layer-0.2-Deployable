"use client";
import React, { useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Bot, Globe, GitBranch, BrainCircuit, Activity, CheckCircle, AlertTriangle, XCircle, Cpu } from 'lucide-react';

interface Status {
  integrations: {
    openLLMVTuber: { state: string; capabilities: Record<string, boolean> };
    pageAgent: { state: string; capabilities: string[] };
    orca: { state: string; worktrees: number; agents: number };
  };
  mcpMesh: { total: number; available: number; byCategory: Record<string, number> };
  skills: number;
  agents: { total: number; busy: number };
  modelProvider: { available: boolean; provider: string };
}

const HealthIcon = ({ state }: { state: string }) => {
  if (state === 'AVAILABLE') return <CheckCircle size={14} className="text-emerald-400" />;
  if (state === 'STARTING' || state === 'DEGRADED') return <AlertTriangle size={14} className="text-amber-400" />;
  return <XCircle size={14} className="text-rose-400" />;
};

export const IntegrationsWorkspace = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setStatus(data.status);
        else setError(data.error);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const integrations = [
    {
      id: 'openllm-vtuber',
      name: 'Open-LLM-VTuber',
      role: 'Humanoid Interaction / Avatar / Voice-Presence',
      icon: <Bot size={18} />,
      state: status?.integrations.openLLMVTuber.state || 'STARTING',
      details: status?.integrations.openLLMVTuber.capabilities
        ? Object.entries(status.integrations.openLLMVTuber.capabilities).filter(([, v]) => v).map(([k]) => k).slice(0, 4)
        : [],
    },
    {
      id: 'page-agent',
      name: 'Alibaba Page Agent',
      role: 'Web Page Interaction Engine',
      icon: <Globe size={18} />,
      state: status?.integrations.pageAgent.state || 'STARTING',
      details: status?.integrations.pageAgent.capabilities?.slice(0, 4) || [],
    },
    {
      id: 'orca',
      name: 'StablyAI Orca',
      role: 'Coding / Parallel Agent Workspace',
      icon: <GitBranch size={18} />,
      state: status?.integrations.orca.state || 'STARTING',
      details: [`${status?.integrations.orca.worktrees || 0} worktrees`, `${status?.integrations.orca.agents || 0} agents`],
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Capability Fabric</h1>
      <p className="text-white/30 text-sm mb-8">
        One intelligence — specialized providers integrated under the Akansha Master Orchestrator
      </p>

      {loading && <div className="text-white/40 text-sm animate-pulse">Connecting to capability fabric...</div>}
      {error && <div className="text-rose-400 text-sm">Failed to load: {error}</div>}

      {/* Live Agent Graph */}
      <GlassSurface className="p-6 rounded-3xl mb-6">
        <div className="flex items-center gap-2 mb-5">
          <BrainCircuit size={16} className="text-cyan-300/80" />
          <h3 className="text-white/80 font-medium text-sm">Live Agent Graph</h3>
          <span className="text-[10px] text-white/20 ml-auto">derived from runtime state</span>
        </div>
        <div className="flex flex-col items-center">
          {/* Root */}
          <div className="flex flex-col items-center">
            <div className="px-5 py-2.5 rounded-full bg-gradient-to-br from-cyan-500/15 to-purple-500/15 border border-cyan-400/25 text-cyan-200 text-xs tracking-wide font-medium">
              AKANSHA MASTER ORCHESTRATOR
            </div>
          </div>
          <div className="w-px h-6 bg-gradient-to-b from-cyan-400/30 to-transparent" />
          {/* Branches */}
          <div className="grid grid-cols-3 gap-6 md:gap-12 w-full max-w-2xl">
            {[
              { label: 'Research', nodes: ['Web', 'Page Agent'] },
              { label: 'Coding', nodes: ['Orca', 'Agent A', 'Agent B'] },
              { label: 'Verification', nodes: ['Tests', 'Diff', 'Runtime'] },
            ].map((branch) => (
              <div key={branch.label} className="flex flex-col items-center">
                <div className="text-[10px] uppercase tracking-widest text-white/30 mb-2">{branch.label}</div>
                <div className="space-y-1.5">
                  {branch.nodes.map((n) => (
                    <div key={n} className="px-3 py-1 rounded-lg bg-white/4 border border-white/8 text-white/50 text-[11px] text-center">
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GlassSurface>

      {/* Integration providers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {integrations.map((it) => (
          <GlassSurface key={it.id} className="p-5 rounded-2xl">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center">
                <span className="text-cyan-300/80">{it.icon}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HealthIcon state={it.state} />
                <span className="text-[10px] uppercase tracking-wider text-white/40">{it.state}</span>
              </div>
            </div>
            <h3 className="text-sm font-medium text-white/90">{it.name}</h3>
            <p className="text-xs text-white/30 mt-1">{it.role}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {it.details.map((d) => (
                <span key={d} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[10px] text-cyan-200/60">
                  {d}
                </span>
              ))}
            </div>
          </GlassSurface>
        ))}
      </div>

      {/* MCP Mesh + System summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassSurface className="p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-cyan-300/80" />
            <h3 className="text-white/80 font-medium text-sm">MCP Mesh</h3>
          </div>
          {status?.mcpMesh ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-white/50">
                <span>Servers online</span>
                <span className="text-emerald-400">{status.mcpMesh.available}/{status.mcpMesh.total}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(status.mcpMesh.byCategory).map(([cat, count]) => (
                  <span key={cat} className="px-2 py-1 rounded-md bg-white/5 border border-white/8 text-[10px] text-white/50">
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-white/30 text-xs">Loading mesh...</div>
          )}
        </GlassSurface>

        <GlassSurface className="p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Cpu size={16} className="text-cyan-300/80" />
            <h3 className="text-white/80 font-medium text-sm">System Summary</h3>
          </div>
          <div className="space-y-2 text-xs text-white/50">
            <div className="flex justify-between">
              <span>Skills registered</span>
              <span className="text-white/70">{status?.skills ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Agents (busy)</span>
              <span className="text-white/70">{status?.agents.busy ?? 0}/{status?.agents.total ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Model provider</span>
              <span className="text-cyan-300">{status?.modelProvider.provider || 'experiential'}</span>
            </div>
          </div>
        </GlassSurface>
      </div>
    </div>
  );
};
