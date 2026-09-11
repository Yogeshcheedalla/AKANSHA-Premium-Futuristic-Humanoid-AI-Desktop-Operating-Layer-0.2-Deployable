import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type AIState = 'idle' | 'listening' | 'thinking' | 'working' | 'verifying' | 'success' | 'error';

export const AkanshaPresence = ({ state = 'idle', isListening = false }: { state?: AIState; isListening?: boolean }) => {
  const stateColors = {
    idle: 'rgba(0,240,255,0.35)',
    listening: 'rgba(0,240,255,0.75)',
    thinking: 'rgba(139,92,246,0.65)',
    working: 'rgba(94,234,212,0.65)',
    verifying: 'rgba(255,220,100,0.55)',
    success: 'rgba(0,255,150,0.65)',
    error: 'rgba(255,100,100,0.7)',
  };

  const stateLabels = {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    working: 'Working',
    verifying: 'Verifying',
    success: 'Complete',
    error: 'Error',
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      {/* Main holographic core */}
      <div className="relative w-48 h-48 md:w-72 md:h-72 flex items-center justify-center">
        {/* Outer glow rings */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-[-25px] rounded-full"
          style={{
            background: `radial-gradient(circle, ${stateColors[state]} 0%, transparent 70%)`,
            boxShadow: `0 0 80px 30px ${stateColors[state]}`,
          }}
        />
        
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-[-40px] rounded-full opacity-20"
          style={{ border: `1px solid ${stateColors[state]}`, borderTop: '1px solid transparent' }}
        />
        
        {/* Central avatar */}
        <motion.div
          animate={{ scale: state === 'listening' ? [1, 1.12, 1] : [1, 1.06, 1] }}
          transition={{ duration: state === 'listening' ? 0.9 : 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="relative z-10 w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden shadow-[0_0_60px_20px_rgba(0,240,255,0.15)]"
          style={{
            boxShadow: `inset 0 0 40px ${stateColors[state]}, 0 0 40px ${stateColors[state]}80`,
          }}
        >
          <img
            src="/images/akansha-avatar.png"
            alt="Akansha"
            className="w-full h-full object-cover opacity-90"
          />
          <div 
            className="absolute inset-0 mix-blend-overlay opacity-40"
            style={{ background: `radial-gradient(circle at 40% 30%, ${stateColors[state]} 0%, transparent 70%)` }}
          />
        </motion.div>
        
        {/* Orbit dots */}
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: stateColors[state],
              boxShadow: `0 0 8px ${stateColors[state]}`,
              top: '50%',
              left: '50%',
              transformOrigin: '0 0',
            }}
            animate={{
              rotate: 360,
              x: Math.cos((i * 60 * Math.PI) / 180) * 140,
              y: Math.sin((i * 60 * Math.PI) / 180) * 140,
            }}
            transition={{ duration: 12 + i * 0.5, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </div>
      
      {/* Status label */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8 text-center">
        <h2 className="text-4xl md:text-5xl font-extralight tracking-tighter text-white/95">Akansha</h2>
        <motion.p
          key={state}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-2 text-sm uppercase tracking-[0.2em] font-light"
          style={{ color: stateColors[state] }}
        >
          {stateLabels[state]}
          {isListening && ' — Listening to Boss'}
        </motion.p>
      </motion.div>
      
      {/* Sub tagline */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-3 text-xs text-white/20 tracking-[0.15em]">
        PREMIUM FUTURISTIC HUMANOID AI • MULTIMODAL • SELF-IMPROVING
      </motion.div>
    </div>
  );
};
