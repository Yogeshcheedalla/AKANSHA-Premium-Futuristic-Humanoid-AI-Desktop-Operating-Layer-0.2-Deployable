"use client";
import React from 'react';
import { GlassSurface } from '../core/GlassSurface';
import { WorkspaceScaffold } from '../core/WorkspaceScaffold';
import { useApiResource } from '../core/useApiResource';
import { ShieldCheck } from 'lucide-react';

interface SecurityResponse {
  ok: boolean;
  identity: { role: string | null; provider: string | null; email: string | null; name: string | null; subjectMasked: string | null; sessionExpiresAt: number | null };
  subsystems: { googleAuth: boolean; transactionalEmail: boolean };
  desktopPermissions: { actionPermissions: Record<string, string[]>; autoRunKinds: string[]; confirmingKinds: string[] };
}

const Bool = ({ value }: { value: boolean }) => (
  <span className={`text-[11px] font-medium ${value ? 'text-emerald-300' : 'text-white/30'}`}>{value ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
);

export const SecurityWorkspace = () => {
  const { data, loading, error, needsAuth, retry } = useApiResource<SecurityResponse>('/api/security');

  return (
    <WorkspaceScaffold
      title="Security"
      subtitle="Session identity, subsystem posture, and the desktop actions Akansha may run"
      loading={loading} error={error} needsAuth={needsAuth} onRetry={retry}
      icon={<ShieldCheck size={22} className="text-emerald-300/80" />}
    >
      {data && (
        <>
          <GlassSurface className="p-6 rounded-2xl">
            <h3 className="text-white/80 font-medium text-sm mb-4">Current session</h3>
            <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <Row k="Signed in as" v={data.identity.email || data.identity.name || (data.identity.role === 'guest' ? 'Guest session' : '—')} />
              <Row k="Role" v={data.identity.role || '—'} />
              <Row k="Provider" v={data.identity.provider || '—'} />
              <Row k="Account (masked)" v={data.identity.subjectMasked || '—'} />
              <Row k="Expires" v={data.identity.sessionExpiresAt ? new Date(data.identity.sessionExpiresAt).toLocaleString('en-GB', { hour12: false }) : '—'} />
            </div>
            <p className="text-[10px] text-white/25 mt-4">Google is the only identity provider; the raw subject, token and all secrets are never sent to the browser.</p>
          </GlassSurface>

          <GlassSurface className="p-6 rounded-2xl">
            <h3 className="text-white/80 font-medium text-sm mb-4">Subsystem posture</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between"><span className="text-white/55">Google authentication</span><Bool value={data.subsystems.googleAuth} /></div>
              <div className="flex items-center justify-between"><span className="text-white/55">Transactional email (SMTP)</span><Bool value={data.subsystems.transactionalEmail} /></div>
            </div>
            {!data.subsystems.googleAuth && (
              <p className="text-[11px] text-amber-300/70 mt-3">Google auth is not configured on this server — protected sign-in will honestly report NOT CONFIGURED (501) rather than pretend.</p>
            )}
          </GlassSurface>

          <GlassSurface className="p-6 rounded-2xl">
            <h3 className="text-white/80 font-medium text-sm mb-1">Desktop action authorization</h3>
            <p className="text-[11px] text-white/35 mb-4">The exact action → OS-permission model the PermissionEngine enforces. Non-mutating actions run automatically; the rest require confirmation.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {Object.entries(data.desktopPermissions.actionPermissions).map(([action, perms]) => {
                const auto = data.desktopPermissions.autoRunKinds.includes(action);
                return (
                  <div key={action} className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${auto ? 'bg-emerald-400/70' : 'bg-amber-400/70'}`} />
                    <span className="text-xs text-white/70 flex-1">{action}</span>
                    <span className="text-[9px] uppercase tracking-wider text-white/30">{perms.join(' · ')}</span>
                  </div>
                );
              })}
            </div>
          </GlassSurface>
        </>
      )}
    </WorkspaceScaffold>
  );
};

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase tracking-wider text-white/30">{k}</span>
    <span className="text-white/80 mt-0.5 break-all">{v}</span>
  </div>
);
