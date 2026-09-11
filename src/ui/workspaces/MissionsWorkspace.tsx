import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Zap, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export const MissionsWorkspace = () => {
  const missions = [
    { id: 'm1', name: 'Analyze System Health', status: 'completed', progress: 100, steps: 5 },
    { id: 'm2', name: 'Organize Project Files', status: 'running', progress: 60, steps: 4 },
    { id: 'm3', name: 'Research Latest AI Developments', status: 'running', progress: 30, steps: 3 },
    { id: 'm4', name: 'Update Memory Profile', status: 'waiting', progress: 0, steps: 2 },
  ];

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    completed: { color: 'text-emerald-400', icon: <CheckCircle size={16} /> },
    running: { color: 'text-cyan-400', icon: <Clock size={16} /> },
    waiting: { color: 'text-amber-400', icon: <AlertCircle size={16} /> },
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Mission Control</h1>
      <p className="text-white/30 text-sm mb-8">Active autonomous missions and execution pipeline</p>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {missions.map((m) => (
          <GlassSurface key={m.id} className="p-5 rounded-2xl">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-white/90 font-medium text-sm">{m.name}</h3>
              <span className={`flex items-center gap-1.5 text-xs uppercase tracking-wider ${statusConfig[m.status].color}`}>
                {statusConfig[m.status].icon}
                {m.status}
              </span>
            </div>
            
            {/* Mission pipeline visualization */}
            <div className="flex items-center gap-2 mb-3">
              {['Plan', 'Execute', 'Observe', 'Verify', 'Learn'].map((step, i) => {
                const completed = i < Math.floor((m.progress / 100) * 5);
                const active = i === Math.floor((m.progress / 100) * 5) && m.progress < 100;
                return (
                  <React.Fragment key={step}>
                    <div className={`flex-1 h-1.5 rounded-full transition-all duration-500 ${completed ? 'bg-cyan-400/60' : active ? 'bg-cyan-400/30' : 'bg-white/5'}`} />
                    <div className={`w-1 h-1 rounded-full flex-shrink-0 ${completed ? 'bg-cyan-400' : active ? 'bg-cyan-400/50 animate-pulse' : 'bg-white/10'}`} />
                  </React.Fragment>
                );
              })}
            </div>
            
            <div className="flex items-center gap-4 text-xs text-white/40">
              <span>Progress: {m.progress}%</span>
              <span>Steps: {m.steps}</span>
            </div>
          </GlassSurface>
        ))}
      </div>
      
      {/* Pipeline architecture visualization */}
      <GlassSurface className="mt-6 p-6 rounded-2xl">
        <h3 className="text-white/80 font-medium mb-6">Execution Pipeline</h3>
        <div className="flex items-center justify-between gap-2 md:gap-4 text-xs text-white/50">
          {[
            { label: 'Request', desc: 'User intent' },
            { label: 'Planner', desc: 'Mission design' },
            { label: 'Agent', desc: 'Capability routing' },
            { label: 'Execute', desc: 'Tool action' },
            { label: 'Observe', desc: 'State capture' },
            { label: 'Verify', desc: 'Result check' },
            { label: 'Learn', desc: 'Memory update' },
          ].map((node, i) => (
            <React.Fragment key={node.label}>
              <div className="flex flex-col items-center gap-2 min-w-[60px]">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-400/20 flex items-center justify-center text-cyan-300/80 text-[10px] font-bold">
                  {i + 1}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-white/60">{node.label}</span>
                <span className="text-[9px] text-white/30">{node.desc}</span>
              </div>
              {i < 6 && <div className="flex-1 h-px bg-gradient-to-r from-cyan-400/20 via-purple-400/10 to-cyan-400/20" />}
            </React.Fragment>
          ))}
        </div>
      </GlassSurface>
    </div>
  );
};
