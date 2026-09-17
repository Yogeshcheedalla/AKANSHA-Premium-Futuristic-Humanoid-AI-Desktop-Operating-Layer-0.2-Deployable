import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { isGoogleConfigured } from '@/core/auth/googleOAuth';
import { isSmtpConfigured } from '@/core/email/mailService';
import { permissionCatalog } from '@/core/execution/PermissionEngine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/security — an honest security & authorization posture for the Security
 * workspace. Reports ONLY real, non-sensitive facts: the verified identity behind the
 * current session (subject is masked, never the raw id/token), whether the Google
 * identity provider and transactional SMTP are configured, and the ACTUAL desktop
 * action→permission model the PermissionEngine uses to gate execution (read via a
 * read-only catalog export, so the UI cannot drift from the enforcing code).
 * It never exposes secrets, credential values, tokens, or raw session material.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const p = guard.principal;
    const maskSubject = (sub?: string | null) =>
      !sub ? null : sub.length <= 6 ? '••••••' : `${sub.slice(0, 3)}…${sub.slice(-3)}`;

    return NextResponse.json({
      ok: true,
      identity: {
        role: p?.role ?? null,
        provider: p?.provider ?? 'local',
        email: p?.email ?? null,
        name: p?.name ?? null,
        subjectMasked: maskSubject(p?.sub),
        sessionExpiresAt: p?.exp ?? null,
      },
      subsystems: {
        googleAuth: isGoogleConfigured(process.env),
        transactionalEmail: isSmtpConfigured(process.env),
      },
      desktopPermissions: permissionCatalog(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'security_unavailable' }, { status: 500 });
  }
}
