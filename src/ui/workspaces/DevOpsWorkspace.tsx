import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Activity, Cpu, HardDrive, Wifi, ShieldCheck, CheckCircle } from 'lucide-react';

export const DevOpsWorkspace = () => {
  const services = [
    { name: 'Master Orchestrator', status: 'running', latency: '23ms', health: 100 },
    { name: 'Model Router', status: 'running', latency: '145ms', health: 99 },
    { name: 'Agent Manager', status: 'running', latency: '12ms', health: 100 },
    { name: 'Memory System', status: 'running', latency: '8ms', health: 100 },
    { name: 'Windows Bridge', status: 'running', latency: '34ms', health: 98 },
    { name: 'Voice Pipeline', status: 'online', latency: '67ms', health: 96 },
  ];

  const metrics = [
    { label: 'CPU', value: '28%', icon: <Cpu size={14} /> },
    { label: 'Memory', value: '62%', icon: <HardDrive size={14} /> },
    { label: 'Network', value: '1.2MB/s', icon: <Wifi size={14} /> },
    { label: 'Security', value: 'Active', icon: <ShieldCheck size={14} /> },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">DevOps Center</h1>
      <p className="text-white/30 text-sm mb-8">System health, service telemetry, and operational state</p>
      
      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {metrics.map((m) => (
          <GlassSurface key={m.label} className="p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-cyan-300/60">{m.icon}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{m.label}</span>
            </div>
            <div className="text-xl font-light text-white/90">{m.value}</div>
          </GlassSurface>
        ))}
      </div>
      
      {/* Service health */}
      <GlassSurface className="p-5 rounded-2xl mb-6">
        <h3 className="text-white/80 font-medium mb-4">Service Health</h3>
        <div className="space-y-2.5">
          {services.map((s) => (
            <div key={s.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full ${s.status === 'running' ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
                <span className="text-sm text-white/80">{s.name}</span>
              </div>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>{s.latency}</span>
                <span className="w-16 text-right">{s.health}%</span>
              </div>
            </div>
          ))}
        </div>
      </GlassSurface>
      
      {/* Pipeline visualization */}
      <GlassSurface className="p-5 rounded-2xl">
        <h3 className="text-white/80 font-medium mb-4">Deployment Pipeline</h3>
        <div className="flex items-center gap-2 md:gap-3">
          {['Build', 'Test', 'Deploy', 'Verify', 'Monitor'].map((stage, i) => (
            <React.Fragment key={stage}>
              <div className="flex-1 min-w-[80px]">
                <div className={`h-8 rounded-lg flex items-center justify-center text-xs font-medium ${i < 3 ? 'bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-cyan-300/90 border border-cyan-400/10' : 'bg-white/5 text-white/30 border border-white/5'}`}>
                  {stage}
                </div>
              </div>
              {i < 4 && <div className="flex-1 h-px bg-gradient-to-r from-cyan-400/30 via-purple-400/10 to-cyan-400/30" />}
            </React.Fragment>
          ))}
        </div>
      </GlassSurface>
    </div>
  );
};
