import { NextResponse } from 'next/server';
import { googleConfig, isGoogleConfigured, buildGoogleAuthUrl, randomToken, createVerifier, sealTx, TX_COOKIE } from '@/core/auth/googleOAuth';

export const dynamic = 'force-dynamic';

function originOf(req: Request): string | undefined {
  try { const u = new URL(req.url); return `${u.protocol}//${u.host}`; } catch { return undefined; }
}

/**
 * GET /api/auth/google — begin the server-side Google Authorization Code + PKCE
 * flow. State/verifier/nonce are stored in a short-lived, ENCRYPTED, HttpOnly
 * transaction cookie (serverless-safe) and cleared on callback (single-use).
 * If Google is not configured, returns an honest "not configured" response and
 * NEVER a broken redirect — the rest of Akansha keeps working.
 */
export async function GET(request: Request) {
  if (!isGoogleConfigured(process.env)) {
    return NextResponse.json(
      { ok: false, configured: false, error: 'Google authentication is not configured' },
      { status: 501 }
    );
  }
  const cfg = googleConfig(process.env, originOf(request));
  const tx = { state: randomToken(16), verifier: createVerifier(), nonce: randomToken(16), exp: Date.now() + 10 * 60 * 1000 };
  const authorizeUrl = buildGoogleAuthUrl(cfg, tx);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const res = NextResponse.redirect(authorizeUrl);
  res.headers.append('Set-Cookie', `${TX_COOKIE}=${sealTx(tx, process.env)}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${secure}`);
  return res;
}
