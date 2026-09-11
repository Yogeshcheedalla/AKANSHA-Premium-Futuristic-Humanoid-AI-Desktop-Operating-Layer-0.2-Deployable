import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export const OrganicWaveform = ({ isActive = false, state = 'idle' }: { isActive?: boolean; state?: string }) => {
  const [bars, setBars] = useState<number[]>(Array.from({ length: 40 }, () => 20));

  useEffect(() => {
    if (!isActive) {
      setBars(Array.from({ length: 40 }, () => 20));
      return;
    }
    
    const interval = setInterval(() => {
      setBars((prev) =>
        prev.map((h) => {
          const base = state === 'listening' ? 60 : state === 'thinking' ? 40 : 30;
          const noise = Math.random() * 80;
          const newHeight = Math.max(10, Math.min(100, base + noise - 30 + (h * 0.1)));
          return Math.round(newHeight);
        })
      );
    }, 100);
    
    return () => clearInterval(interval);
  }, [isActive, state]);

  const color =
    state === 'listening' ? 'rgba(0,240,255,0.8)' :
    state === 'thinking' ? 'rgba(139,92,246,0.8)' :
    state === 'working' ? 'rgba(94,234,212,0.8)' :
    'rgba(255,255,255,0.5)';

  return (
    <div className="flex items-center justify-center gap-[3px] h-16 md:h-20 w-full max-w-md mx-auto">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          animate={{ height: `${h}%` }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
          className="w-[3px] md:w-[4px] rounded-full"
          style={{
            background: `linear-gradient(to top, ${color}, ${color}40)`,
            opacity: 0.6 + (h / 100) * 0.4,
          }}
        />
      ))}
    </div>
  );
};
