"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassSurface } from '../ui/core/GlassSurface';
import { NeuralBackground } from '../ui/core/NeuralBackground';
import { FloatingDock } from '../ui/navigation/FloatingDock';
import { CommandWorkspace } from '../ui/workspaces/CommandWorkspace';
import { CognitiveWorkspace } from '../ui/workspaces/CognitiveWorkspace';
import { ScorecardWorkspace } from '../ui/workspaces/ScorecardWorkspace';
import { MissionsWorkspace } from '../ui/workspaces/MissionsWorkspace';
import { AgentsWorkspace } from '../ui/workspaces/AgentsWorkspace';
import { MemoryWorkspace } from '../ui/workspaces/MemoryWorkspace';
import { DevOpsWorkspace } from '../ui/workspaces/DevOpsWorkspace';
import { SettingsWorkspace } from '../ui/workspaces/SettingsWorkspace';
import { IntegrationsWorkspace } from '../ui/workspaces/IntegrationsWorkspace';
import { Download } from 'lucide-react';
import { ProvidersWorkspace } from '../ui/workspaces/ProvidersWorkspace';
import { ConnectorsWorkspace } from '../ui/workspaces/ConnectorsWorkspace';
import { GraphWorkspace } from '../ui/workspaces/GraphWorkspace';
import { RepositoriesWorkspace } from '../ui/workspaces/RepositoriesWorkspace';
import { AkanshaPresence, type AIState } from '../ui/assistant/AkanshaPresence';
import { Mic, Zap, ShieldCheck, Circle, Activity, Sparkles } from 'lucide-react';

export default function AkanshaPage() {
  const [workspace, setWorkspace] = useState('command');
  const [systemState, setSystemState] = useState<'online' | 'offline' | 'degraded'>('online');
  const [aiState, setAIState] = useState<AIState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [currentMission, setCurrentMission] = useState('No active missions');
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    // Startup sequence simulation
    const timer = setTimeout(() => {
      setAIState('idle');
      console.log('[AKANSHA] System initialized. Experiential Labs provider active.');
    }, 800);
    return () => clearTimeout(timer);
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
      case 'connectors': return <ConnectorsWorkspace />;
      case 'memory': return <MemoryWorkspace />;
      case 'devops': return <DevOpsWorkspace />;
      case 'security':
        return (
          <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Security & Audit</h1>
            <p className="text-white/30 text-sm mb-8">Permission architecture, audit center, and credential management</p>
            <GlassSurface className="p-8 rounded-2xl">
              <h2 className="text-xl font-light text-white/80 mb-6">Permission System</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { name: 'READ_FILES', risk: 'LOW', status: 'GRANTED' },
                  { name: 'WRITE_FILES', risk: 'MEDIUM', status: 'APPROVED' },
                  { name: 'EXECUTE_COMMANDS', risk: 'HIGH', status: 'REQUIRES_AUTH' },
                  { name: 'NETWORK_ACCESS', risk: 'LOW', status: 'GRANTED' },
                  { name: 'CAMERA_ACCESS', risk: 'HIGH', status: 'APPROVED' },
                  { name: 'DEVICE_CONTROL', risk: 'HIGH', status: 'APPROVED' },
                  { name: 'MESSAGE_SEND', risk: 'MEDIUM', status: 'APPROVED' },
                  { name: 'PURCHASE_ACTION', risk: 'HIGH', status: 'DENIED' },
                ].map((perm) => (
                  <div key={perm.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="text-xs font-medium text-white/70">{perm.name}</div>
                    <div className="text-[10px] text-white/30 mt-1">Risk: {perm.risk}</div>
                    <div className={`text-[10px] mt-1 font-medium ${perm.status === 'GRANTED' ? 'text-emerald-400' : perm.status === 'APPROVED' ? 'text-cyan-400' : perm.status === 'REQUIRES_AUTH' ? 'text-amber-400' : 'text-rose-400'}`}>{perm.status}</div>
                  </div>
                ))}
              </div>
            </GlassSurface>
          </div>
        );
      case 'scorecard': return <ScorecardWorkspace />;
      case 'settings': return <SettingsWorkspace />;
      default: return <CommandWorkspace />;
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-white selection:bg-cyan-500/20 selection:text-cyan-50">
      <NeuralBackground />
      
      {/* Global glass overlay on interaction */}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowOverlay(false)}
          >
            <GlassSurface className="p-8 max-w-lg mx-4 rounded-3xl text-center">
              <AkanshaPresence state="thinking" />
              <h2 className="text-xl font-light mt-4">Processing Request</h2>
              <p className="text-sm text-white/40 mt-2">Akansha is reasoning through your instruction...</p>
              <div className="mt-4 w-full h-1 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  animate={{ width: ['0%', '100%'] }}
                  transition={{ duration: 2, ease: 'easeInOut' }}
                  className="h-full bg-gradient-to-r from-cyan-400/60 to-purple-400/60"
                />
              </div>
            </GlassSurface>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Floating dock */}
      <FloatingDock activeWorkspace={workspace} onSelect={setWorkspace} />
      
      {/* Top status bar */}
      <header className="fixed top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(0,240,255,0.5)]" />
          <span className={`text-[10px] uppercase tracking-[0.15em] font-medium ${systemState === 'online' ? 'text-cyan-300' : systemState === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>
            {systemState}
          </span>
          <span className="text-[10px] text-white/20">|</span>
          <span className="text-[10px] text-white/30">Multi-Provider Runtime · Ollama · Gemini · OpenAI · Custom</span>
        </div>
        
        <div className="flex items-center gap-4 pointer-events-auto">
          <a
            href="/landing.html"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white/60 text-xs tracking-wide hover:text-white/90 hover:border-purple-400/30 transition-colors"
            title="Download & install Akansha on any device"
          >
            <Download size={14} />
            <span>Get Akansha</span>
          </a>
          <button
            onClick={() => {
              setAIState('listening');
              setIsListening(true);
              setShowOverlay(true);
              setTimeout(() => {
                setAIState('idle');
                setIsListening(false);
                setShowOverlay(false);
                setCurrentMission('Executing mission via capability graph...');
              }, 3000);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-400/20 text-cyan-300/90 text-xs tracking-wide hover:scale-[1.05] transition-transform"
          >
            <Mic size={14} />
            <span>Voice Command</span>
          </button>
        </div>
      </header>
      
      {/* Main content */}
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
      
      {/* Bottom status bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 px-6 py-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-6 text-[10px] text-white/20 tracking-wide">
          <span>AKANSHA v2.0</span>
          <span>•</span>
          <span>Master Orchestrator Active</span>
          <span>•</span>
          <span>{currentMission}</span>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <GlassSurface className="px-3 py-1.5 rounded-lg flex items-center gap-2 text-[10px]">
            <Zap size={10} className="text-cyan-300/60" />
            <span className="text-white/40">Experiential Labs</span>
          </GlassSurface>
        </div>
      </footer>
    </div>
  );
}
