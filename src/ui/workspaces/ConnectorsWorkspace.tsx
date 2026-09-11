"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Link2, Unlink, Loader2, ShieldCheck, Zap } from 'lucide-react';

interface Definition {
  provider: string; name: string; category: string; authMethod: string;
  permissions: string[]; scopes: string[]; highRiskActions: string[]; requiresConfirmation: string[];
}
interface Connection {
  connectionId: string; provider: string; name: string; category: string; account: string | null;
  scopes: string[]; health: string; enabled: boolean; credentialConfigured: boolean;
}

const healthColor = (h: string) =>
  h === 'HEALTHY' ? 'text-emerald-400' : h === 'AUTH_REQUIRED' || h === 'EXPIRED' ? 'text-amber-400' : h === 'DISABLED' ? 'text-white/25' : 'text-rose-400';

export const ConnectorsWorkspace = () => {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [secret, setSecret] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/connectors');
      const data = await res.json();
      if (data.ok) { setDefinitions(data.definitions); setConnections(data.connections); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async (provider: string) => {
    setConnecting(provider);
    try {
      await fetch('/api/connectors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, secret: secret[provider] || '' }),
      });
      setSecret((s) => ({ ...s, [provider]: '' }));
      await load();
    } finally { setConnecting(null); }
  };

  const disconnect = async (connectionId: string) => {
    await fetch(`/api/connectors?connectionId=${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    load();
  };

  const toggle = async (c: Connection) => {
    await fetch('/api/connectors', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: c.connectionId, enabled: !c.enabled }),
    });
    load();
  };

  const byCategory = definitions.reduce<Record<string, Definition[]>>((acc, d) => {
    (acc[d.category] = acc[d.category] || []).push(d);
    return acc;
  }, {});
  const connectedFor = (p: string) => connections.find((c) => c.provider === p);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-light text-white/90 tracking-tight">Connectors</h1>
      <p className="text-white/30 text-sm mt-2 mb-2">
        Authenticate once — Akansha reuses the connection automatically on every future mission.
      </p>
      <div className="flex gap-6 text-[10px] uppercase tracking-[0.15em] text-white/25 mb-8">
        <span>{connections.filter((c) => c.health === 'HEALTHY').length} connected</span>
        <span>{definitions.length} available</span>
        <span>secrets in vault</span>
      </div>

      {loading ? (
        <div className="text-white/30 text-sm animate-pulse">Loading connectors…</div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byCategory).map(([category, defs]) => (
            <div key={category}>
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/25 mb-3">{category}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {defs.map((d) => {
                  const conn = connectedFor(d.provider);
                  return (
                    <GlassSurface key={d.provider} active={!!conn && conn.health === 'HEALTHY'} className="p-5 rounded-2xl">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-white/90">{d.name}</h3>
                          <p className="text-[10px] uppercase tracking-wider text-white/25 mt-1">
                            {d.authMethod.replace(/_/g, ' ')} · {d.permissions.join(' / ')}
                          </p>
                        </div>
                        {conn ? (
                          <span className={`text-[10px] uppercase tracking-wider ${healthColor(conn.health)}`}>{conn.health}</span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider text-white/20">not connected</span>
                        )}
                      </div>

                      {d.highRiskActions.length > 0 && (
                        <div className="flex items-start gap-1.5 mb-3">
                          <ShieldCheck size={11} className="text-amber-300/50 mt-0.5 flex-shrink-0" />
                          <p className="text-[10px] text-amber-200/40 leading-relaxed">
                            Requires confirmation: {d.requiresConfirmation.slice(0, 2).join(', ')}
                          </p>
                        </div>
                      )}

                      {conn ? (
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggle(conn)}
                            className={`px-4 py-2 rounded-full text-[11px] border transition-colors ${conn.enabled ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-200' : 'bg-white/5 border-white/10 text-white/40'}`}>
                            {conn.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                          <button onClick={() => disconnect(conn.connectionId)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-[11px] hover:text-rose-300 hover:border-rose-400/25 transition-colors">
                            <Unlink size={11} /> Disconnect
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="password" value={secret[d.provider] || ''}
                            onChange={(e) => setSecret((s) => ({ ...s, [d.provider]: e.target.value }))}
                            placeholder={d.authMethod === 'none' ? 'no credential needed' : 'token / key'}
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40"
                          />
                          <button onClick={() => connect(d.provider)} disabled={connecting === d.provider}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-cyan-200 text-[11px] hover:bg-cyan-500/25 transition-colors disabled:opacity-40">
                            {connecting === d.provider ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />} Connect
                          </button>
                        </div>
                      )}
                    </GlassSurface>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
