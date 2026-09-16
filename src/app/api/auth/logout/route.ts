import { NextResponse } from 'next/server';
import { auth } from '@/core/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout — invalidate the current session (revoke its jti) and clear
 * the authentication cookie. Safe for any authenticated principal (guest/user/admin).
 * Never logs secrets.
 */
export async function POST(request: Request) {
  const principal = auth.authenticate(request);
  if (principal) auth.revoke(principal.jti);
  const response = NextResponse.json({ ok: true, loggedOut: true });
  response.headers.append('Set-Cookie', 'akansha_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return response;
}
