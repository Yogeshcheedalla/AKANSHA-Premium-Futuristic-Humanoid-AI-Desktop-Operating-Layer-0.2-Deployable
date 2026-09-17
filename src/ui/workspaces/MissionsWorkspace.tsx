"use client";
import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { WorkspaceScaffold } from '../core/WorkspaceScaffold';
import { useApiResource } from '../core/useApiResource';
import { Zap } from 'lucide-react';

interface Mission {
  id: string; goal: string; status: string; stepCount: number; completedSteps: number;
  currentStep: string | null; artifacts: number; createdAt: number; updatedAt: number;
}
interface MissionsResponse { ok: boolean; active: Mission[]; }

const TONE: Record<string, string> = {
  RUNNING: 'text-emerald-300', EXECUTING: 'text-emerald-300', VERIFYING: 'text-cyan-300',
  PLANNING: 'text-purple-300', OBSERVING: 'text-cyan-300', WAITING: 'text-amber-300',
  RECOVERING: 'text-amber-300', NEEDS_CONFIRMATION: 'text-amber-300', QUEUED: 'text-white/40',
  FAILED: 'text-rose-300', REFUSED: 'text-rose-300',
};

export const MissionsWorkspace = () => {
  const { data, loading, error, needsAuth, retry } = useApiResource<MissionsResponse>('/api/missions', { intervalMs: 5000 });
  const isEmpty = !!data && data.active.length === 0;

  return (
    <WorkspaceScaffold
      title="Missions"
      subtitle="Active missions from the Master Orchestrator (plan → execute → observe → verify → learn)"
      loading={loading} error={error} needsAuth={needsAuth} onRetry={retry}
      empty={isEmpty}
      emptyMessage="No active missions. Start one from the Command workspace."
      icon={<Zap size={22} className="text-cyan-300/80" />}
    >
      {data && (
        <div className="space-y-3">
          {data.active.map((m) => (
            <GlassSurface key={m.id} className="p-5 rounded-2xl">
              <div className="flex items-center gap-3">
                <span className={`text-[10px] uppercase tracking-wider font-medium ${TONE[m.status] || 'text-white/40'}`}>{m.status}</span>
                <span className="text-sm text-white/85 font-medium flex-1 truncate">{m.goal}</span>
                <span className="text-[10px] text-white/30">{m.completedSteps}/{m.stepCount} steps</span>
              </div>
              {m.currentStep && <p className="text-xs text-cyan-200/60 mt-2">▸ {m.currentStep}</p>}
              <div className="h-1 rounded-full bg-white/5 mt-3 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-400/60 to-purple-400/60"
                  style={{ width: `${m.stepCount ? Math.round((m.completedSteps / m.stepCount) * 100) : 0}%` }} />
              </div>
            </GlassSurface>
          ))}
        </div>
      )}
    </WorkspaceScaffold>
  );
};
