"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassSurface } from '@/ui/core/GlassSurface';
import { NeuralBackground } from '@/ui/core/NeuralBackground';
import { FloatingDock } from '@/ui/navigation/FloatingDock';
import { useWorkspaceRoute } from '@/ui/navigation/useWorkspaceRoute';
import { CommandWorkspace } from '@/ui/workspaces/CommandWorkspace';
import { CognitiveWorkspace } from '@/ui/workspaces/CognitiveWorkspace';
import { ScorecardWorkspace } from '@/ui/workspaces/ScorecardWorkspace';
import { MissionsWorkspace } from '@/ui/workspaces/MissionsWorkspace';
import { AgentsWorkspace } from '@/ui/workspaces/AgentsWorkspace';
import { MemoryWorkspace } from '@/ui/workspaces/MemoryWorkspace';
import { SecurityWorkspace } from '@/ui/workspaces/SecurityWorkspace';
import { SettingsWorkspace } from '@/ui/workspaces/SettingsWorkspace';
import { IntegrationsWorkspace } from '@/ui/workspaces/IntegrationsWorkspace';
import { ProvidersWorkspace } from '@/ui/workspaces/ProvidersWorkspace';
import { ConnectorsWorkspace } from '@/ui/workspaces/ConnectorsWorkspace';
import { GraphWorkspace } from '@/ui/workspaces/GraphWorkspace';
import { RepositoriesWorkspace } from '@/ui/workspaces/RepositoriesWorkspace';
import { ModelCenter } from '@/ui/workspaces/ModelCenterWorkspace';
import { FirstRunOnboarding, ONBOARD_FLAG } from '@/ui/onboarding/FirstRunOnboarding';
import { VoiceControl } from '@/ui/voice/VoiceControl';
import { Zap, Download, ArrowLeft } from 'lucide-react';

/**
 * The authenticated Akansha application UI. It is rendered by the /app SERVER gate
 * ONLY after a real account session exists (Google on the web; the local desktop
 * bootstrap on 127.0.0.1 so offline AI never depends on Google). Guests and
 * unauthenticated web visitors never reach this component — they see the Google
 * sign-in gate instead.
 */
export default function AppClient() {
  const { workspace, select } = useWorkspaceRoute();
  const [systemState] = useState<'online' | 'offline' | 'degraded'>('online');
  const [currentMission] = useState('No active missions');
  const [onboard, setOnboard] = useState(false);

  useEffect(() => {
    void Promise.resolve().then(() => {
      try { if (!localStorage.getItem(ONBOARD_FLAG)) setOnboard(true); } catch { /* SSR/no-storage: skip */ }
    });
  }, []);

  const renderWorkspace = () => {
    switch (workspace) {
      case 'command': return <CommandWorkspace />;
      case 'cognitive': return <CognitiveWorkspace />;
      case 'missions': return <MissionsWorkspace />;
      case 'graph': return <GraphWorkspace />;
      case 'repositories': return <RepositoriesWorkspace />;
      case 'agents': return <AgentsWorkspace />;
      case 'integrations': return <IntegrationsWorkspace />;
      case 'providers': return <ProvidersWorkspace />;
      case 'modelcenter': return <ModelCenter />;
      case 'connectors': return <ConnectorsWorkspace />;
      case 'memory': return <MemoryWorkspace />;
      case 'security': return <SecurityWorkspace />;
      case 'scorecard': return <ScorecardWorkspace />;
      case 'settings': return <SettingsWorkspace />;
      default: return <CommandWorkspace />;
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-white selection:bg-cyan-500/20 selection:text-cyan-50">
      <NeuralBackground />

      <AnimatePresence>
        {onboard && <FirstRunOnboarding onDone={() => setOnboard(false)} />}
      </AnimatePresence>

      <FloatingDock activeWorkspace={workspace} onSelect={select} />

      <header className="fixed top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <a
            href="/"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white/60 text-xs hover:text-white/90 transition-colors"
            title="Back to the Akansha home page"
          >
            <ArrowLeft size={13} />
            <span>Home</span>
          </a>
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(0,240,255,0.5)]" />
          <span className={`text-[10px] uppercase tracking-[0.15em] font-medium ${systemState === 'online' ? 'text-cyan-300' : systemState === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>
            {systemState}
          </span>
          <span className="text-[10px] text-white/20 hidden sm:inline">|</span>
          <span className="text-[10px] text-white/30 hidden sm:inline">Multi-Provider Runtime · Ollama · Gemini · OpenAI · Custom</span>
        </div>

        <div className="flex items-center gap-4 pointer-events-auto">
          <a
            href="/#download"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white/60 text-xs tracking-wide hover:text-white/90 hover:border-purple-400/30 transition-colors"
            title="Download & install Akansha on any device"
          >
            <Download size={14} />
            <span>Get Akansha</span>
          </a>
          <VoiceControl />
        </div>
      </header>

      <main className="relative z-10 min-h-screen pl-20 md:pl-24 pt-16 pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={workspace}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="min-h-[calc(100vh-8rem)]"
          >
            {renderWorkspace()}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-40 px-6 py-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-6 text-[10px] text-white/20 tracking-wide">
          <span>AKANSHA v3.0.0</span>
          <span>•</span>
          <span>Master Orchestrator Active</span>
          <span>•</span>
          <span>{currentMission}</span>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <GlassSurface className="px-3 py-1.5 rounded-lg flex items-center gap-2 text-[10px]">
            <Zap size={10} className="text-cyan-300/60" />
            <span className="text-white/40">Akansha Runtime</span>
          </GlassSurface>
        </div>
      </footer>
    </div>
  );
}
