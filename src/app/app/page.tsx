import { headers, cookies } from 'next/headers';
import { verifyToken } from '@/core/auth/tokens';
import { isGoogleConfigured } from '@/core/auth/googleOAuth';
import { decideAppAccess } from '@/core/auth/appAccess';
import AppClient from './AppClient';
import { AuthGate } from './AuthGate';

export const dynamic = 'force-dynamic';

/**
 * /app SERVER GATE.
 *
 * The hosted web application is Google-only and MANDATORY: no username/password,
 * no guest bypass. A valid account session (issued by the Google callback) is
 * verified here on the server; without it the visitor sees the Google sign-in gate
 * (or an honest "not configured" state). The desktop app runs a local backend on
 * 127.0.0.1 and authenticates via its local bootstrap so OFFLINE AI never depends
 * on Google — that path is detected by the request host.
 */
export default async function AppPage() {
  const h = await headers();
  const host = (h.get('host') || h.get('x-forwarded-host') || '').toLowerCase();
  const isDesktop = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
  if (isDesktop) return <AppClient />;

  const jar = await cookies();
  const raw = jar.get('akansha_session')?.value;
  const principal = raw ? verifyToken(decodeURIComponent(raw)) : null;
  const decision = decideAppAccess({ principal, googleConfigured: isGoogleConfigured(process.env) });

  if (decision.view === 'APP') return <AppClient />;
  return <AuthGate view={decision.view} reason={decision.reason} />;
}
