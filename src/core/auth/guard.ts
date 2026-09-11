import { NextResponse } from 'next/server';
import { auth } from './session';
import type { Principal, Role } from './tokens';
import { eventBus } from '../events/EventBus';

export type AccessLevel = 'public' | 'authenticated' | 'sensitive' | 'admin';

const ROLE_RANK: Record<Role, number> = { user: 1, admin: 2 };
const LEVEL_RANK: Record<AccessLevel, number> = { public: 0, authenticated: 1, sensitive: 1, admin: 2 };

export type GuardResult = { ok: true; principal: Principal | null } | { ok: false; response: NextResponse };

/**
 * Server-side authorization. Returns an error response (401/403) that the route
 * must return immediately, or the verified principal. Never trusts any
 * client-supplied userId — identity comes only from the verified token.
 */
export function authorize(req: Request, level: AccessLevel): GuardResult {
  if (level === 'public') return { ok: true, principal: null };

  // Explicit dev bypass (localhost only, off by default).
  if (!auth.authEnabled()) {
    return { ok: true, principal: { sub: 'dev', role: 'admin', iat: 0, exp: Infinity, jti: 'dev-bypass' } };
  }

  const principal = auth.authenticate(req);
  if (!principal) {
    eventBus.emit('auth.denied', 'Auth', { level, reason: 'unauthenticated' });
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'authentication_required', level },
        { status: 401 }
      ),
    };
  }

  const need = LEVEL_RANK[level];
  const have = ROLE_RANK[principal.role];
  // sensitive requires at least a user principal (rank >= 1); admin requires rank 2.
  if (have < need) {
    eventBus.emit('auth.denied', 'Auth', { level, reason: 'insufficient_role', role: principal.role });
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'forbidden', level, role: principal.role },
        { status: 403 }
      ),
    };
  }

  return { ok: true, principal };
}
