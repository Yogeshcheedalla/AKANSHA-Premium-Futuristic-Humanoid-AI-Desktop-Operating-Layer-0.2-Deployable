"use client";
import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { Loader2, RotateCcw, LockKeyhole } from 'lucide-react';

/**
 * Consistent header + loading / auth-expired / error / empty scaffolding for the
 * data-backed workspaces, so every panel renders honest states with one retry path
 * instead of bespoke spinners or fake content.
 */
export function WorkspaceScaffold(props: {
  title: string;
  subtitle: string;
  loading: boolean;
  error: string | null;
  needsAuth?: boolean;
  onRetry: () => void;
  empty?: boolean;
  emptyMessage?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, subtitle, loading, error, needsAuth, onRetry, empty, emptyMessage, icon, children } = props;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h1 className="text-3xl font-light text-white/90 tracking-tight">{title}</h1>
          <p className="text-white/30 text-sm mt-1">{subtitle}</p>
        </div>
      </div>

      {loading && !error && (
        <div className="flex items-center justify-center gap-2 text-white/30 text-sm py-16">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {error && (
        <GlassSurface className="p-8 rounded-2xl">
          <h2 className={`text-lg font-light mb-2 ${needsAuth ? 'text-amber-300' : 'text-rose-300'}`}>
            {needsAuth ? 'Sign-in required' : 'Could not load this view'}
          </h2>
          <p className="text-sm text-white/45 mb-6 flex items-center gap-2">
            {needsAuth && <LockKeyhole size={13} className="text-amber-300/70" />}{error}
          </p>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-xs hover:bg-cyan-500/25"
          >
            <RotateCcw size={13} /> Retry
          </button>
        </GlassSurface>
      )}

      {!loading && !error && empty && (
        <GlassSurface className="p-10 rounded-2xl text-center">
          <p className="text-sm text-white/40">{emptyMessage || 'Nothing to show yet.'}</p>
        </GlassSurface>
      )}

      {!loading && !error && !empty && children}
    </div>
  );
}
