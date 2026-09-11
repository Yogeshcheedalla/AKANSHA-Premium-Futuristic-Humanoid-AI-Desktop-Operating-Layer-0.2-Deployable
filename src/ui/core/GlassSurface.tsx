import React from 'react';
import { glass } from '../design/tokens';

export const GlassSurface = ({
  children,
  className = '',
  active = false,
  intensity = 1,
}: {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  intensity?: number;
}) => {
  const bg = active ? `rgba(255,255,255,${0.06 * intensity})` : `rgba(255,255,255,${0.035 * intensity})`;
  const border = active ? `rgba(255,255,255,${0.14 * intensity})` : `rgba(255,255,255,${0.08 * intensity})`;
  
  return (
    <div
      className={`relative overflow-hidden rounded-2xl backdrop-blur-[${glass.blur}] ${className}`}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: glass.shadow,
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 60%)',
        }}
      />
      {children}
    </div>
  );
};
