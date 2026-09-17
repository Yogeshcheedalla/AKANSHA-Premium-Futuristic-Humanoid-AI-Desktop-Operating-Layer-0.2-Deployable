import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Compass, BrainCircuit, Database, Zap, ShieldCheck, Settings, Network, Boxes, Link2, Share2, Package, Gauge, Sparkles } from 'lucide-react';
import { WORKSPACES } from './workspaces';

/** Presentation (icons) keyed by the canonical workspace id from `workspaces.ts`. */
const ICON_BY_ID: Record<string, React.ReactNode> = {
  command: <Compass size={18} />,
  cognitive: <BrainCircuit size={18} />,
  missions: <Zap size={18} />,
  graph: <Share2 size={18} />,
  repositories: <Package size={18} />,
  agents: <BrainCircuit size={18} />,
  integrations: <Network size={18} />,
  providers: <Boxes size={18} />,
  modelcenter: <Sparkles size={18} />,
  connectors: <Link2 size={18} />,
  memory: <Database size={18} />,
  security: <ShieldCheck size={18} />,
  scorecard: <Gauge size={18} />,
  settings: <Settings size={18} />,
};

export const FloatingDock = ({
  activeWorkspace,
  onSelect,
}: {
  activeWorkspace: string;
  onSelect: (id: string) => void;
}) => {
  return (
    <nav className="fixed left-4 top-1/2 -translate-y-1/2 z-50 hidden md:flex flex-col gap-2" aria-label="Akansha workspaces">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          onClick={() => onSelect(w.id)}
          className="group relative"
          title={w.label}
          aria-label={w.label}
          aria-current={activeWorkspace === w.id ? 'page' : undefined}
        >
          <GlassSurface
            active={activeWorkspace === w.id}
            intensity={1.2}
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 hover:scale-110"
          >
            <span className={`transition-colors duration-300 ${activeWorkspace === w.id ? 'text-cyan-300' : 'text-white/50 group-hover:text-white/80'}`}>
              {ICON_BY_ID[w.id]}
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

