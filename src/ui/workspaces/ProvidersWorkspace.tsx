"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Plus, RefreshCw, Trash2, Zap, Key, Cpu, Loader2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface Provider {
  providerId: string;
  name: string;
  type: string;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  fallbackPriority: number;
  capabilities: Record<string, boolean>;
  credentialConfigured: boolean;
  modelsDiscovered: number;
}

const TYPE_OPTIONS = [
  { value: 'openrouter', label: 'OpenRouter', hint: 'https://openrouter.ai/api/v1 — paste an API key from openrouter.ai/keys' },
  { value: 'ollama', label: 'Ollama (Local)', hint: 'http://127.0.0.1:11434' },
  { value: 'openai', label: 'OpenAI', hint: 'https://api.openai.com/v1' },
  { value: 'gemini', label: 'Google Gemini', hint: 'generativelanguage.googleapis.com' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible', hint: 'Any Base URL + API key' },
  { value: 'local', label: 'Local Server', hint: 'http://127.0.0.1:8080' },
  { value: 'custom', label: 'Custom', hint: 'Custom headers + endpoint' },
];

const healthIcon = (state?: string) => {
  if (state === 'AVAILABLE') return <CheckCircle size={12} className="text-emerald-400" />;
  if (state === 'AUTH_REQUIRED') return <Key size={12} className="text-amber-400" />;
  if (state === 'UNAVAILABLE') return <XCircle size={12} className="text-rose-400" />;
  return <AlertTriangle size={12} className="text-white/30" />;
};

export const ProvidersWorkspace = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelCount, setModelCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { health: any; models: any[] }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', type: 'openai-compatible', baseUrl: '', apiKey: '', defaultModel: '', fallbackPriority: 100,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      if (data.ok) {
        setProviders(data.providers);
        setModelCount(data.modelCount);
      } else setError(data.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const testProvider = async (providerId: string) => {
    setTesting(providerId);
    setError(null);
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }), credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) setError(data.error || `Test failed (HTTP ${res.status})`);
      else setTestResult((prev) => ({ ...prev, [providerId]: { health: data.health, models: data.models || [] } }));
    } catch (e: any) {
      setError('Test request failed: ' + (e?.message || e));
    } finally {
      setTesting(null);
      load();
    }
  };

  const addProvider = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form), credentials: 'same-origin',
      });
      const data = await res.json();
      if (!data.ok) setError(data.error || `Could not save provider (HTTP ${res.status})`);
      else { setShowAdd(false); setForm({ name: '', type: 'openai-compatible', baseUrl: '', apiKey: '', defaultModel: '', fallbackPriority: 100 }); await load(); }
    } catch (e: any) {
      setError('Save request failed: ' + (e?.message || e));
    } finally { setSaving(false); }
  };

  const toggleProvider = async (p: Provider) => {
    setError(null);
    try {
      const res = await fetch(`/api/providers/${p.providerId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !p.enabled }), credentials: 'same-origin',
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error || `Could not change "${p.name}" (HTTP ${res.status})`); }
    } catch (e: any) { setError('Toggle request failed: ' + (e?.message || e)); }
    load();
  };

  const removeProvider = async (providerId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/providers/${providerId}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error || `Could not remove the provider (HTTP ${res.status})`); }
    } catch (e: any) { setError('Delete request failed: ' + (e?.message || e)); }
    load();
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-light text-white/90 tracking-tight">AI Providers</h1>
          <p className="text-white/30 text-sm mt-2">
            Ollama · Gemini · OpenAI · OpenAI-compatible · local servers · custom Base URLs
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/5 border border-cyan-400/20 text-cyan-200 text-xs tracking-wide hover:bg-cyan-400/10 transition-colors"
        >
          <Plus size={14} /> Add Provider
        </button>
      </div>

      <div className="flex gap-6 text-[10px] uppercase tracking-[0.15em] text-white/25 mb-6">
        <span>{providers.length} providers</span>
        <span>{modelCount} models discovered</span>
        <span>routing policy: BALANCED</span>
      </div>

      {error && <div className="text-rose-400 text-xs mb-4">{error}</div>}

      {showAdd && (
        <GlassSurface className="p-6 rounded-3xl mb-6">
          <h3 className="text-white/80 font-medium text-sm mb-5">New Provider</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-widest text-white/30">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Provider"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40 transition-colors" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-widest text-white/30">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 outline-none focus:border-cyan-400/40">
                {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value} className="bg-[#0a0f1a]">{t.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-white/30">Base URL</span>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={TYPE_OPTIONS.find((t) => t.value === form.type)?.hint}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40 font-mono text-xs" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-widest text-white/30">API Key (stored in vault)</span>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="••••••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-widest text-white/30">Default Model (optional)</span>
              <input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                placeholder="auto-discover"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-cyan-400/40 font-mono text-xs" />
            </label>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={addProvider} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-xs hover:bg-cyan-500/25 transition-colors disabled:opacity-40">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Save Provider
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs hover:text-white/80 transition-colors">Cancel</button>
          </div>
        </GlassSurface>
      )}

      {loading ? (
        <div className="text-white/30 text-sm animate-pulse">Loading providers…</div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const result = testResult[p.providerId];
            return (
              <GlassSurface key={p.providerId} active={p.isDefault} className="p-5 rounded-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center flex-shrink-0">
                      <Cpu size={18} className="text-cyan-300/80" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-medium text-white/90">{p.name}</h3>
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] uppercase tracking-wider text-cyan-200/60">{p.type}</span>
                        {p.isDefault && <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/25 text-[9px] uppercase tracking-wider text-cyan-200">default</span>}
                      </div>
                      {p.baseUrl && <p className="text-[11px] text-white/25 font-mono mt-1.5 truncate">{p.baseUrl}</p>}
                      <div className="flex flex-wrap gap-3 mt-2.5 text-[10px] text-white/35">
                        <span>{healthIcon(result?.health?.state)} {result?.health?.state || 'UNKNOWN'}</span>
                        <span className="text-white/20">|</span>
                        <span>{p.modelsDiscovered} models</span>
                        <span className="text-white/20">|</span>
                        <span>{p.credentialConfigured ? 'credential set' : 'no credential'}</span>
                        <span className="text-white/20">|</span>
                        <span>priority {p.fallbackPriority}</span>
                        {result?.health?.latencyMs ? <><span className="text-white/20">|</span><span>{result.health.latencyMs}ms</span></> : null}
                      </div>
                      {result?.models && result.models.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {result.models.slice(0, 8).map((m: any) => (
                            <span key={m.id} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[9px] text-white/45 font-mono">{m.id}</span>
                          ))}
                          {result.models.length > 8 && <span className="text-[9px] text-white/25">+{result.models.length - 8}</span>}
                        </div>
                      )}
                      {result?.health?.detail && <p className="text-[10px] text-amber-300/60 mt-2">{result.health.detail}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => testProvider(p.providerId)} disabled={testing === p.providerId}
                      title="Test connection"
                      className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-cyan-300/70 hover:text-cyan-200 hover:border-cyan-400/30 transition-colors disabled:opacity-40">
                      {testing === p.providerId ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    </button>
                    <button onClick={() => toggleProvider(p)} title={p.enabled ? 'Disable' : 'Enable'}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${p.enabled ? 'bg-emerald-500/10 border border-emerald-400/25 text-emerald-300/80' : 'bg-white/5 border border-white/10 text-white/30'}`}>
                      <span className="text-[9px] uppercase tracking-wider">{p.enabled ? 'on' : 'off'}</span>
                    </button>
                    <button onClick={() => removeProvider(p.providerId)} title="Remove"
                      className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-rose-300/60 hover:text-rose-300 hover:border-rose-400/30 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </GlassSurface>
            );
          })}
        </div>
      )}
    </div>
  );
};
