import { NextResponse } from 'next/server';
import { auth, SESSION_TTL_MS } from '@/core/auth/session';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/session  { passphrase }
 *   Exchanges the local access/admin passphrase for a signed, expiring session
 *   token. The passphrase itself is never stored or logged.
 *
 * GET /api/auth/session
 *   Introspects the current session (requires a valid token).
 *
 * DELETE /api/auth/session
 *   Revokes the current session (jti added to the revocation set).
 */
export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* tolerate empty body */
  }
  const passphrase: string = (body?.passphrase || '').toString();

  // Accountless guest session — no Akansha signup needed for basic AI use.
  if (body?.guest === true) {
    const guest = auth.issueGuest();
    if (!guest) {
      return NextResponse.json({ ok: false, error: 'guests_disabled', message: 'A local Akansha session is required.' }, { status: 403 });
    }
    const gsecure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const gres = NextResponse.json({ ok: true, role: 'guest', expiresAt: guest.principal.exp, ttlMs: SESSION_TTL_MS });
    gres.headers.append('Set-Cookie', `akansha_session=${encodeURIComponent(guest.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${gsecure}`);
    return gres;
  }

  const result = auth.issue(passphrase || null);
  if (!result) {
    return NextResponse.json({ ok: false, error: 'invalid_passphrase' }, { status: 401 });
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const response = NextResponse.json({
    ok: true,
    role: result.principal.role,
    expiresAt: result.principal.exp,
    ttlMs: SESSION_TTL_MS,
  });
  response.headers.append(
    'Set-Cookie',
    `akansha_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
  return response;
}

export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, principal: guard.principal });
}

export async function DELETE(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  if (guard.principal) auth.revoke(guard.principal.jti);
  const response = NextResponse.json({ ok: true, revoked: true });
  response.headers.append('Set-Cookie', 'akansha_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return response;
}
