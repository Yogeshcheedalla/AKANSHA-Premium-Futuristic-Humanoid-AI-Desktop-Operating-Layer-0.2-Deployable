import { NextResponse } from 'next/server';
import { googleConfig, isGoogleConfigured, openTx, exchangeCodeForTokens, fetchGoogleIdentity, TX_COOKIE } from '@/core/auth/googleOAuth';
import { auth, SESSION_TTL_MS } from '@/core/auth/session';
import { accountRepository } from '@/core/identity/Account';
import { eventBus } from '@/core/events/EventBus';

export const dynamic = 'force-dynamic';

function readCookie(req: Request, name: string): string | undefined {
  const c = req.headers.get('cookie') || '';
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(c);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** Redirect back to the landing with an honest, non-sensitive reason (never a token). */
function fail(reason: string, clearTx: boolean) {
  const res = NextResponse.redirect(new URL(`/?auth=${reason}`, process.env.AKANSHA_PUBLIC_URL || 'https://akansha-gamma.vercel.app'));
  if (clearTx) res.headers.append('Set-Cookie', `${TX_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0`);
  return res;
}

/**
 * GET /api/auth/google/callback — validates the single-use state, exchanges the
 * authorization code SERVER-SIDE (using GOOGLE_CLIENT_SECRET, never exposed),
 * validates the returned identity, creates/updates the minimal account, issues a
 * secure HttpOnly session, and redirects to /app. On any failure it redirects to
 * the landing with a safe reason. The post-login destination is ALWAYS /app (fixed)
 * — no user-supplied URL is ever followed (open-redirect protection).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return fail('cancelled', true);

  if (!isGoogleConfigured(process.env)) return fail('not_configured', false);

  const tx = openTx(readCookie(request, TX_COOKIE), process.env);
  if (!tx) return fail('invalid_state', false);

  const state = url.searchParams.get('state') || '';
  if (!state || state !== tx.state) return fail('state_mismatch', true);

  const code = url.searchParams.get('code');
  if (!code) return fail('no_code', true);

  try {
    const cfg = googleConfig(process.env);
    const { accessToken } = await exchangeCodeForTokens({ code, verifier: tx.verifier, cfg });
    const identity = await fetchGoogleIdentity(accessToken);
    // Persist minimal account (dev/in-memory; session token is the durable carrier).
    accountRepository.upsertFromGoogle(identity);
    const session = auth.issueIdentity({ sub: identity.sub, provider: 'google', email: identity.email, name: identity.name, avatar: identity.avatar });

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const res = NextResponse.redirect(new URL('/app', process.env.AKANSHA_PUBLIC_URL || 'https://akansha-gamma.vercel.app'));
    res.headers.append('Set-Cookie', `akansha_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
    res.headers.append('Set-Cookie', `${TX_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0`); // single-use
    // Never log identity/tokens/secret — only an opaque success signal.
    eventBus.emit('auth.granted', 'Auth/google', { ok: true });
    return res;
  } catch {
    return fail('exchange_failed', true);
  }
}
