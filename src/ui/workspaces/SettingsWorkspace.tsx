"use client";
import React, { useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Shield, Power, Boxes, Link2 } from 'lucide-react';

const Toggle = ({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) => (
  <button
    type="button"
    aria-pressed={on}
    disabled={disabled}
    onClick={onClick}
    className={`w-11 h-6 rounded-full relative transition-colors duration-300 shrink-0 ${on ? 'bg-cyan-500/30' : 'bg-white/10'} border ${on ? 'border-cyan-400/30' : 'border-white/10'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
  >
    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-cyan-300 to-purple-300 transition-transform duration-300 ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

/**
 * Configuration. Only controls that are ACTUALLY wired are interactive here:
 *  - "Start with Windows" is real (desktop build only; hidden in the browser).
 * Everything that is not yet connected to the runtime is shown honestly disabled with
 * an explanation, rather than as a toggle that only looks alive. Voice is driven by the
 * header control; AI providers and connected services are managed in their own workspaces.
 */
export const SettingsWorkspace = () => {
  const [startup, setStartup] = useState<{ show: boolean; supported: boolean; enabled: boolean; busy: boolean; note?: string }>({ show: false, supported: false, enabled: false, busy: false });

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).akanshaDesktop : undefined;
    if (!bridge || typeof bridge.getStartup !== 'function') return;
    let alive = true;
    bridge.getStartup().then((s: any) => { if (alive) setStartup((p) => ({ ...p, show: true, supported: !!s?.supported, enabled: !!s?.enabled })); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const toggleStartup = async () => {
    const bridge = typeof window !== 'undefined' ? (window as any).akanshaDesktop : undefined;
    if (!bridge || !startup.supported) return;
    setStartup((p) => ({ ...p, busy: true }));
    try {
      const r: any = await bridge.setStartup(!startup.enabled);
      if (r?.ok) setStartup((p) => ({ ...p, enabled: !!r.enabled, busy: false }));
      else setStartup((p) => ({ ...p, busy: false, note: r?.reason === 'not-packaged' ? 'Available in the installed app' : (r?.reason || 'unavailable') }));
    } catch { setStartup((p) => ({ ...p, busy: false, note: 'unavailable' })); }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-light text-white/90 tracking-tight">Configuration</h1>
        <p className="text-white/30 text-sm">Only controls that are actually wired are enabled; everything else is honestly marked</p>
      </div>

      {startup.show ? (
        <GlassSurface className="p-5 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center text-cyan-300/80"><Power size={16} /></div>
            <div>
              <h3 className="text-sm font-medium text-white/90">Start with Windows</h3>
              <p className="text-xs text-white/30">{startup.note ? `Login item: ${startup.note}` : 'Launch Akansha at sign-in (single instance, tray-ready; does not auto-record)'}</p>
            </div>
          </div>
          <Toggle on={startup.enabled} onClick={toggleStartup} disabled={!startup.supported || startup.busy} />
        </GlassSurface>
      ) : (
        <GlassSurface className="p-5 rounded-2xl flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-white/30"><Power size={16} /></div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-white/60">Start with Windows</h3>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-white/35">Desktop app only</span>
          </div>
          <p className="text-xs text-white/30 ml-auto max-w-xs text-right">The auto-start login item is available in the installed desktop app, not in the web app.</p>
        </GlassSurface>
      )}

      {/* Honest disabled control: not yet wired to the single authoritative audio engine. */}
      <GlassSurface className="p-6 rounded-3xl border border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-white/30"><Shield size={24} /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-light text-white/70">Emergency privacy lock</h2>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">Coming soon</span>
            </div>
            <p className="text-sm text-white/35 mt-1">
              A global kill-switch that forces the microphone, camera and ambient monitoring off is not yet wired into the runtime, so it is shown disabled rather than pretending to work.
            </p>
          </div>
          <Toggle on={false} onClick={() => {}} disabled />
        </div>
      </GlassSurface>

      <GlassSurface className="p-5 rounded-2xl">
        <h3 className="text-white/70 font-medium text-sm mb-3">Managed elsewhere</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-3 text-white/50"><Boxes size={15} className="text-cyan-300/70" /> AI providers &amp; models → AI Providers / Model Center</div>
          <div className="flex items-center gap-3 text-white/50"><Link2 size={15} className="text-cyan-300/70" /> Connected services → Connectors</div>
        </div>
      </GlassSurface>
    </div>
  );
};
