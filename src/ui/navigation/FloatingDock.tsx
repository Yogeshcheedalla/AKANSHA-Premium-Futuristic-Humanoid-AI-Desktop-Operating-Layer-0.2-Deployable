import React, { useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Mic, Compass, BrainCircuit, Database, Zap, ShieldCheck, Settings, Code2, Network, Boxes, Link2, Share2, Package, Gauge } from 'lucide-react';

export interface Workspace {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export const FloatingDock = ({
  activeWorkspace,
  onSelect,
}: {
  activeWorkspace: string;
  onSelect: (id: string) => void;
}) => {
  const workspaces: Workspace[] = [
    { id: 'command', label: 'Command', icon: <Compass size={18} /> },
    { id: 'cognitive', label: 'Cognitive Layer', icon: <BrainCircuit size={18} /> },
    { id: 'missions', label: 'Missions', icon: <Zap size={18} /> },
    { id: 'graph', label: 'Architecture Graph', icon: <Share2 size={18} /> },
    { id: 'repositories', label: 'Repository Fabric', icon: <Package size={18} /> },
    { id: 'agents', label: 'Agents', icon: <BrainCircuit size={18} /> },
    { id: 'integrations', label: 'Capability Fabric', icon: <Network size={18} /> },
    { id: 'providers', label: 'AI Providers', icon: <Boxes size={18} /> },
    { id: 'connectors', label: 'Connectors', icon: <Link2 size={18} /> },
    { id: 'memory', label: 'Memory', icon: <Database size={18} /> },
    { id: 'security', label: 'Security', icon: <ShieldCheck size={18} /> },
    { id: 'scorecard', label: 'Scorecard', icon: <Gauge size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  return (
    <nav className="fixed left-4 top-1/2 -translate-y-1/2 z-50 hidden md:flex flex-col gap-2">
      {workspaces.map((w) => (
        <button
          key={w.id}
          onClick={() => onSelect(w.id)}
          className="group relative"
          title={w.label}
        >
          <GlassSurface
            active={activeWorkspace === w.id}
            intensity={1.2}
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 hover:scale-110"
          >
            <span className={`transition-colors duration-300 ${activeWorkspace === w.id ? 'text-cyan-300' : 'text-white/50 group-hover:text-white/80'}`}>
              {w.icon}
            </span>
          </GlassSurface>
          <span className="absolute left-14 top-1/2 -translate-y-1/2 text-xs text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {w.label}
          </span>
        </button>
      ))}
    </nav>
  );
};
