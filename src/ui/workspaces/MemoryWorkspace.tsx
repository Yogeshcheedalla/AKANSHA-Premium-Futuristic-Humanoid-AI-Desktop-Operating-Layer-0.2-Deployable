import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Database, Search, BookOpen, User, Cog, Trash2 } from 'lucide-react';

export const MemoryWorkspace = () => {
  const categories = [
    { name: 'Project Memory', count: 42, color: 'text-cyan-300' },
    { name: 'Preferences', count: 18, color: 'text-purple-300' },
    { name: 'Knowledge Base', count: 156, color: 'text-emerald-300' },
    { name: 'Task Memory', count: 23, color: 'text-amber-300' },
    { name: 'Device Memory', count: 12, color: 'text-rose-300' },
  ];

  const memories = [
    { title: 'Preferred Development Stack', content: 'VS Code, Python, TypeScript, React', category: 'Preferences', time: '2h ago' },
    { title: 'Active Project: Akansha Agent', content: 'Multimodal desktop AI architecture with Experiential Labs integration', category: 'Project', time: '5h ago' },
    { title: 'Boss Voice Profile', content: 'Primary user recognized with 98.4% confidence. Warm, direct communication style.', category: 'Preferences', time: '1d ago' },
    { title: 'Window Automation Strategy', content: 'UI automation preferred over direct APIs for maximum compatibility', category: 'Knowledge', time: '3d ago' },
    { title: 'System Health Baseline', content: 'CPU: 34%, Memory: 62%, GPU: 12%', category: 'Task', time: '30m ago' },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 mb-2 tracking-tight">Memory Space</h1>
      <p className="text-white/30 text-sm mb-8">Persistent knowledge, preferences, and contextual awareness</p>
      
      {/* Category visualization */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {categories.map((cat) => (
          <GlassSurface key={cat.name} className="p-4 rounded-xl text-center">
            <div className="text-2xl font-light text-white/90">{cat.count}</div>
            <div className={`text-[10px] uppercase tracking-wider mt-1 ${cat.color}`}>{cat.name}</div>
          </GlassSurface>
        ))}
      </div>
      
      {/* Memory entries */}
      <div className="space-y-3">
        {memories.map((mem, i) => (
          <GlassSurface key={i} className="p-4 rounded-xl flex items-start gap-4 hover:border-cyan-400/20 transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center flex-shrink-0">
              {mem.category === 'Preferences' ? <Cog size={14} className="text-purple-300/80" /> :
               mem.category === 'Project' ? <BookOpen size={14} className="text-cyan-300/80" /> :
               mem.category === 'Knowledge' ? <Search size={14} className="text-emerald-300/80" /> :
               <Database size={14} className="text-amber-300/80" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-white/90">{mem.title}</h4>
              <p className="text-xs text-white/40 mt-1">{mem.content}</p>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-white/20">
                <span className="uppercase tracking-wider">{mem.category}</span>
                <span>•</span>
                <span>{mem.time}</span>
              </div>
            </div>
          </GlassSurface>
        ))}
      </div>
      
      {/* Knowledge graph visualization */}
      <GlassSurface className="mt-8 p-6 rounded-2xl">
        <h3 className="text-white/80 font-medium mb-4">Neural Memory Graph</h3>
        <div className="relative h-48 overflow-hidden">
          <svg viewBox="0 0 400 200" className="w-full h-full opacity-70">
            <defs>
              <linearGradient id="memGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            {/* Nodes */}
            <circle cx="60" cy="80" r="8" fill="#00f0ff" opacity="0.8" />
            <circle cx="160" cy="50" r="6" fill="#8b5cf6" opacity="0.8" />
            <circle cx="260" cy="100" r="9" fill="#5eead4" opacity="0.8" />
            <circle cx="340" cy="65" r="7" fill="#00f0ff" opacity="0.6" />
            <circle cx="200" cy="150" r="10" fill="#8b5cf6" opacity="0.9" />
            
            {/* Connections */}
            <line x1="60" y1="80" x2="160" y2="50" stroke="url(#memGrad)" strokeWidth="0.5" opacity="0.4" />
            <line x1="160" y1="50" x2="260" y2="100" stroke="#8b5cf6" strokeWidth="0.5" opacity="0.3" />
            <line x1="260" y1="100" x2="340" y2="65" stroke="#5eead4" strokeWidth="0.5" opacity="0.3" />
            <line x1="60" y1="80" x2="200" y2="150" stroke="#00f0ff" strokeWidth="0.5" opacity="0.2" />
            <line x1="200" y1="150" x2="340" y2="65" stroke="#8b5cf6" strokeWidth="0.5" opacity="0.2" />
            <line x1="160" y1="50" x2="200" y2="150" stroke="#00f0ff" strokeWidth="0.5" opacity="0.2" />
            
            {/* Labels */}
            <text x="60" y="105" fill="#00f0ff" fontSize="8" opacity="0.7">Boss Profile</text>
            <text x="260" y="125" fill="#5eead4" fontSize="8" opacity="0.7">Project</text>
            <text x="200" y="170" fill="#8b5cf6" fontSize="8" opacity="0.7">Capabilities</text>
          </svg>
        </div>
        <p className="text-xs text-white/20 mt-2">Semantic connections between memory nodes. Darker connections = stronger relevance.</p>
      </GlassSurface>
    </div>
  );
};
