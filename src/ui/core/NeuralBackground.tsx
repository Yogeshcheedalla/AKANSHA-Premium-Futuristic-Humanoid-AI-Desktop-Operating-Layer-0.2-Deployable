import React from 'react';

export const NeuralBackground = () => {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Deep cosmic background */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(8,14,26,1) 0%, rgba(2,4,10,1) 50%, rgba(1,2,8,1) 100%)' }} />
      
      {/* Subtle atmospheric glow */}
      <div className="absolute top-[10%] left-[20%] w-[60vw] h-[60vh] rounded-full opacity-20" 
        style={{ background: 'radial-gradient(circle, rgba(0,240,255,0.15) 0%, transparent 70%)', filter: 'blur(100px)' }} />
      <div className="absolute bottom-[15%] right-[10%] w-[50vw] h-[50vh] rounded-full opacity-15" 
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)', filter: 'blur(120px)' }} />
      
      {/* Fine particle field */}
      <div className="absolute inset-0 opacity-[0.15]">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-[2px] h-[2px] rounded-full"
            style={{
              background: i % 3 === 0 ? 'rgba(0,240,255,0.6)' : i % 2 === 0 ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.3)',
              top: `${10 + (i * 2.3) % 80}%`,
              left: `${5 + (i * 3.1) % 90}%`,
              animation: `pulse 3s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
      
      {/* Subtle radial scan lines */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'repeating-radial-gradient(circle at center, transparent 0, transparent 20px, rgba(255,255,255,0.05) 20px, rgba(255,255,255,0.05) 21px)',
        }}
      />
    </div>
  );
};
