import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { isSmtpConfigured, smtpConfig, getTransport } from '@/core/email/mailService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/email/status — honest, credential-free SMTP readiness for the app.
 * Reports configuration + transport availability only. NEVER returns host/user/pass
 * or any secret. Requires an authenticated session (not public).
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const configured = isSmtpConfigured(process.env);
  const c = smtpConfig(process.env);
  const transportAvailable = configured ? !!getTransport(process.env) : false;
  return NextResponse.json({
    ok: true,
    configured,
    transportAvailable,
    port: c.port,
    secure: c.secure,
    status: !configured ? 'NOT CONFIGURED' : transportAvailable ? 'READY' : 'TRANSPORT UNAVAILABLE',
  });
}
