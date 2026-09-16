"use client";
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { GlassSurface } from '../core/GlassSurface';
import { ModelCenter } from '../workspaces/ModelCenterWorkspace';
import { Sparkles, ArrowRight } from 'lucide-react';

export const ONBOARD_FLAG = 'akan.onboarded.v1';

/**
 * First-run onboarding: welcome → device analysis → AI setup (Model Center),
 * all powered by the real /api/ai/setup view model — no fabricated readiness.
 * Completing just records a local preference so it shows once; the Model Center
 * stays permanently available from the dock.
 */
export function FirstRunOnboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const finish = () => { try { localStorage.setItem(ONBOARD_FLAG, '1'); } catch {} onDone(); };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-6">
        <div className="w-full max-w-4xl">
          <div className="text-center mt-6 mb-6">
            <div className="inline-flex items-center gap-2 text-cyan-300 text-xs tracking-[0.2em] uppercase mb-3"><Sparkles size={14} /> Welcome to Akansha</div>
            <h1 className="text-4xl font-light text-white tracking-tight">Set up your intelligence</h1>
            <p className="text-white/40 text-sm mt-2">We checked your device. Choose how Akansha thinks — nothing is installed or claimed without your action.</p>
            <div className="flex justify-center gap-2 mt-4">
              {['Welcome', 'Your device', 'Choose AI'].map((label, i) => (
                <div key={label} className={`h-1 w-16 rounded-full transition-colors ${i <= step ? 'bg-cyan-400/70' : 'bg-white/10'}`} />
              ))}
            </div>
          </div>

          {step === 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <GlassSurface className="p-8 rounded-3xl text-center">
                <p className="text-white/70 text-sm leading-relaxed max-w-md mx-auto">Akansha runs on your machine and can keep everything local, or use cloud models you authorize. Your OpenRouter key is stored only in the secure OS vault, separate from your Akansha account.</p>
                <button onClick={() => setStep(1)} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-400/30 text-cyan-100 text-sm hover:scale-[1.03] transition-transform">Begin <ArrowRight size={16} /></button>
              </GlassSurface>
            </motion.div>
          )}

          {step >= 1 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <GlassSurface className="p-6 rounded-3xl">
                <ModelCenter embedded />
              </GlassSurface>
              <div className="flex justify-end mt-4">
                <button onClick={finish} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/15 text-white/80 text-sm hover:bg-white/10 transition-colors">Enter Akansha <ArrowRight size={16} /></button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
