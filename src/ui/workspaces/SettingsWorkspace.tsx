import React, { useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Mic, Eye, Shield, Database, Zap, BrainCircuit, Volume2 } from 'lucide-react';

export const SettingsWorkspace = () => {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [privacyLock, setPrivacyLock] = useState(false);

  const settings = [
    { key: 'voice', label: 'Voice Interaction', desc: 'Always-available voice interface', enabled: voiceEnabled, toggle: () => setVoiceEnabled(!voiceEnabled), icon: <Mic size={16} /> },
    { key: 'ambient', label: 'Ambient Intelligence', desc: 'Environmental monitoring and event timeline', enabled: ambientEnabled, toggle: () => setAmbientEnabled(!ambientEnabled), icon: <Eye size={16} /> },
    { key: 'memory', label: 'Persistent Memory', desc: 'Long-term learning and knowledge storage', enabled: memoryEnabled, toggle: () => setMemoryEnabled(!memoryEnabled), icon: <Database size={16} /> },
    { key: 'models', label: 'AI Provider', desc: 'Experiential Labs — primary intelligence layer', enabled: true, toggle: () => {}, icon: <BrainCircuit size={16} /> },
  ];

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Configuration</h1>
      <p className="text-white/30 text-sm mb-8">System settings, privacy controls, and capability management</p>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {settings.map((s) => (
          <GlassSurface key={s.key} className="p-5 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center">
                <span className="text-cyan-300/80">{s.icon}</span>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white/90">{s.label}</h3>
                <p className="text-xs text-white/30">{s.desc}</p>
              </div>
            </div>
            <button
              onClick={s.toggle}
              className={`w-11 h-6 rounded-full relative transition-colors duration-300 ${s.enabled ? 'bg-cyan-500/30' : 'bg-white/10'} border ${s.enabled ? 'border-cyan-400/30' : 'border-white/10'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-cyan-300 to-purple-300 transition-transform duration-300 ${s.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </GlassSurface>
        ))}
      </div>
      
      {/* Emergency privacy lock */}
      <GlassSurface className={`p-6 rounded-3xl border-2 transition-all duration-500 ${privacyLock ? 'border-rose-500/40 bg-rose-500/5' : 'border-white/10'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${privacyLock ? 'bg-rose-500/20 text-rose-400' : 'bg-gradient-to-br from-cyan-500/15 to-purple-500/15 text-cyan-300/80'}`}>
              <Shield size={24} />
            </div>
            <div>
              <h2 className="text-xl font-light text-white/90">Emergency Privacy Lock</h2>
              <p className="text-sm text-white/40">Immediately disable microphone, camera, and ambient monitoring</p>
            </div>
          </div>
          <button
            onClick={() => setPrivacyLock(!privacyLock)}
            className={`px-6 py-3 rounded-xl font-medium text-sm tracking-wide transition-all duration-300 ${privacyLock ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-400/20 hover:scale-[1.02]'}`}
          >
            {privacyLock ? 'LOCKED' : 'ACTIVATE LOCK'}
          </button>
        </div>
        
        <div className="mt-4 flex gap-4 text-xs text-white/30">
          <span>Microphone: <strong className={privacyLock ? 'text-rose-400' : 'text-emerald-400'}>{privacyLock ? 'OFF' : 'ON'}</strong></span>
          <span>Camera: <strong className={privacyLock ? 'text-rose-400' : 'text-emerald-400'}>{privacyLock ? 'OFF' : 'ON'}</strong></span>
          <span>Ambient: <strong className={privacyLock ? 'text-rose-400' : 'text-emerald-400'}>{privacyLock ? 'OFF' : 'OFF'}</strong></span>
        </div>
      </GlassSurface>
    </div>
  );
};
