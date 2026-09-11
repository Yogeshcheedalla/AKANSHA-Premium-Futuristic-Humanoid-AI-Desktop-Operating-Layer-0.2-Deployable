import crypto from 'crypto';

export type Role = 'user' | 'admin';

export interface Principal {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
  jti: string;
}

function secret(): Buffer {
  const s =
    process.env.AKANSHA_SECRET ||
    process.env.DATABASE_URL ||
    'akansha-local-development-auth-secret';
  return crypto.createHash('sha256').update(s).digest();
}

/** Sign a stateless, tamper-evident session token (HMAC-SHA256, base64url). */
export function signToken(p: Principal): string {
  const body = Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a session token. Returns the principal, or null if invalid/expired. */
export function verifyToken(token: string | null | undefined): Principal | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Principal;
    if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Constant-time compare of a presented passphrase against a configured secret. */
export function safeEquals(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
