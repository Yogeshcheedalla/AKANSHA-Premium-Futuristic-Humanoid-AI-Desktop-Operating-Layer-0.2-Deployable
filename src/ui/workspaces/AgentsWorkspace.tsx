import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { BrainCircuit, Sparkles, Shield, Zap, Globe, Database, Terminal, Bot } from 'lucide-react';

export const AgentsWorkspace = () => {
  const agents = [
    { id: 'master', name: 'Master Orchestrator', role: 'Coordination', status: 'online', desc: 'Highest-level intelligence coordinator' },
    { id: 'planner', name: 'Planner Agent', role: 'Planning', status: 'online', desc: 'Mission planning and strategy' },
    { id: 'windows', name: 'Windows Agent', role: 'Desktop', status: 'online', desc: 'Application and desktop control' },
    { id: 'vision', name: 'Vision Agent', role: 'Vision', status: 'online', desc: 'Screen understanding and analysis' },
    { id: 'research', name: 'Research Agent', role: 'Knowledge', status: 'online', desc: 'Web research and synthesis' },
    { id: 'coding', name: 'Coding Agent', role: 'Development', status: 'online', desc: 'Code generation and debugging' },
    { id: 'terminal', name: 'Terminal Agent', role: 'Shell', status: 'online', desc: 'Command execution and scripts' },
  ];

  const icons = [BrainCircuit, Sparkles, Shield, Zap, Globe, Database, Terminal, Bot];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Agent Network</h1>
      <p className="text-white/30 text-sm mb-8">Intelligent agent ecosystem connected through capability routing</p>
      
      {/* Master agent visualization */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <GlassSurface className="w-40 h-40 rounded-3xl flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-purple-500/5 to-transparent" />
            <BrainCircuit size={36} className="text-cyan-300/90 mb-2" />
            <span className="text-sm font-medium text-white/90">Master</span>
            <span className="text-[10px] text-cyan-300/80 uppercase tracking-wider">Orchestrator</span>
          </GlassSurface>
          
          {/* Orbit connections */}
          <div className="absolute inset-0 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            {agents.slice(1).map((agent, i) => {
              const angle = (i * 360) / 6;
              const rad = (angle * Math.PI) / 180;
              return (
                <div
                  key={agent.id}
                  className="absolute w-32 h-32 pointer-events-none"
                  style={{
                    top: '50%',
                    left: '50%',
                    transformOrigin: '0 0',
                    transform: `rotate(${angle}deg) translateX(160px)`,
                  }}
                >
                  <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-cyan-400/20 to-transparent" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((agent, i) => {
          const Icon = icons[i] || BrainCircuit;
          return (
            <GlassSurface key={agent.id} className="p-4 rounded-xl hover:scale-[1.02] transition-transform duration-300">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-cyan-300/80" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-white/90 truncate">{agent.name}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-white/30">{agent.role}</span>
                  <p className="text-xs text-white/40 mt-1">{agent.desc}</p>
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400/80">{agent.status}</span>
                  </div>
                </div>
              </div>
            </GlassSurface>
          );
        })}
      </div>
    </div>
  );
};
