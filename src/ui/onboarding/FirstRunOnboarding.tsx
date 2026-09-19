"use client";
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GlassSurface } from '../core/GlassSurface';
import { ModelCenter } from '../workspaces/ModelCenterWorkspace';
import { Sparkles, ArrowRight, Check, CircleDashed, Minus, ShieldAlert } from 'lucide-react';
import { deriveOnboardingSteps, type OnboardingStep, type StepStatus } from '@/core/onboarding/onboardingFlow';
import type { SetupViewModel } from '@/core/aiSetup/types';

export const ONBOARD_FLAG = 'akan.onboarded.v1';

const STATUS_STYLE: Record<StepStatus, { icon: React.ReactNode; cls: string; label: string }> = {
  READY: { icon: <Check size={13} />, cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10', label: 'Ready' },
  AVAILABLE: { icon: <CircleDashed size={13} />, cls: 'text-cyan-200 border-cyan-400/30 bg-cyan-400/10', label: 'Available' },
  PENDING: { icon: <CircleDashed size={13} />, cls: 'text-amber-200 border-amber-400/30 bg-amber-400/10', label: 'Needs action' },
  BLOCKED: { icon: <ShieldAlert size={13} />, cls: 'text-amber-200 border-amber-400/30 bg-amber-400/10', label: 'Blocked' },
  UNAVAILABLE: { icon: <Minus size={13} />, cls: 'text-white/40 border-white/15 bg-white/5', label: 'Unavailable' },
  UNKNOWN: { icon: <Minus size={13} />, cls: 'text-white/40 border-white/15 bg-white/5', label: 'Unknown' },
};

/**
 * First-run onboarding: a truthful, ordered journey (device → capability → voice →
 * AI mode → models → install → enter) derived ONLY from real signals via
 * deriveOnboardingSteps + the existing /api/ai/setup view model. The interactive
 * Model Center (real install/inference) is embedded below. Nothing is claimed READY
 * without evidence; the Model Center stays permanently available from the dock.
 */
export function FirstRunOnboarding({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<SetupViewModel | null>(null);
  const [persistence, setPersistence] = useState(false);
  const [mic, setMic] = useState(false);
  const finish = () => { try { localStorage.setItem(ONBOARD_FLAG, '1'); } catch { /* ignore */ } onDone(); };

  useEffect(() => {
    // setState happens in .then (not synchronously in the effect body).
    void Promise.resolve().then(() => {
      fetch('/api/ai/setup').then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.ok && d.setup) setSetup(d.setup as SetupViewModel); })
        .catch(() => { /* offline: steps show PENDING */ });
      fetch('/api/health').then((r) => (r.ok ? r.json() : null))
        .then((h) => setPersistence(h?.persistence === 'enabled'))
        .catch(() => setPersistence(false));
      try { setMic(!!(navigator.mediaDevices && (navigator.mediaDevices as any).getUserMedia)); } catch { setMic(false); }
    });
  }, []);

  const steps: OnboardingStep[] = deriveOnboardingSteps({
    authenticated: true, // the app gate already required auth before this screen
    setup,
    voice: { available: mic, verified: false }, // never claim voice READY without a real round-trip
    installResults: {},
    persistenceEnabled: persistence,
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-6">
        <div className="w-full max-w-4xl">
          <div className="text-center mt-6 mb-6">
            <div className="inline-flex items-center gap-2 text-cyan-300 text-xs tracking-[0.2em] uppercase mb-3"><Sparkles size={14} /> Welcome to Akansha</div>
            <h1 className="text-4xl font-light text-white tracking-tight">Your AI operating layer</h1>
            <p className="text-white/40 text-sm mt-2">We checked your device. Nothing is installed or claimed without your action — readiness reflects real evidence only.</p>
          </div>

          <GlassSurface className="p-6 rounded-3xl mb-4">
            <div className="grid sm:grid-cols-2 gap-2.5">
              {steps.map((s) => {
                const st = STATUS_STYLE[s.status];
                return (
                  <div key={s.id} className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border ${st.cls}`}>
                    <span className="mt-0.5 shrink-0">{st.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-white/90">{s.title}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-70">{st.label}</span>
                      </div>
                      <p className="text-[11px] text-white/45 leading-snug mt-0.5">{s.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassSurface>

          <GlassSurface className="p-6 rounded-3xl">
            <ModelCenter embedded />
          </GlassSurface>

          <div className="flex justify-end mt-4 mb-8">
            <button onClick={finish} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-400/30 text-cyan-100 text-sm hover:scale-[1.03] transition-transform">
              Enter Akansha <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
