import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { signToken, verifyToken, safeEquals, type Principal, type Role } from './tokens';
import { eventBus } from '../events/EventBus';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Auth session manager.
 *
 * Local-desktop pairing model: the server holds an access passphrase (user) and
 * an admin passphrase. If none are configured via env, a strong bootstrap token
 * is generated ONCE and persisted to a gitignored file so the local desktop app
 * can read it and exchange it for a signed, expiring session token. Passphrases
 * and tokens are NEVER logged; only opaque jti/role are audited.
 */
class AuthManager {
  private revoked = new Set<string>();
  private _bootstrap: string | null = null;

  private bootstrapFile(): string {
    return path.join(process.cwd(), '.akansha-auth.json');
  }

  /** The user access passphrase (env, or a generated+persisted bootstrap). */
  userPassphrase(): string {
    if (process.env.AKANSHA_ACCESS_TOKEN) return process.env.AKANSHA_ACCESS_TOKEN;
    return this.getOrCreateBootstrap();
  }

  adminPassphrase(): string | null {
    return process.env.AKANSHA_ADMIN_TOKEN || null;
  }

  private getOrCreateBootstrap(): string {
    if (this._bootstrap) return this._bootstrap;
    const file = this.bootstrapFile();
    try {
      if (fs.existsSync(file)) {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (j && typeof j.accessToken === 'string') {
          this._bootstrap = j.accessToken;
          return j.accessToken as string;
        }
      }
    } catch {
      /* fall through to regenerate */
    }
    const token = crypto.randomBytes(24).toString('base64url');
    try {
      fs.writeFileSync(file, JSON.stringify({ accessToken: token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    } catch {
      /* if we cannot persist, keep it in memory for this process */
    }
    this._bootstrap = token;
    eventBus.emit('auth.bootstrap_created', 'Auth', { note: 'generated local pairing token' });
    return token;
  }

  /** Exchange a passphrase for a signed session token. Returns null if rejected. */
  issue(passphrase: string | null | undefined): { token: string; principal: Principal } | null {
    let role: Role | null = null;
    if (passphrase && this.adminPassphrase() && safeEquals(passphrase, this.adminPassphrase() as string)) role = 'admin';
    else if (passphrase && safeEquals(passphrase, this.userPassphrase())) role = 'user';
    if (!role) {
      eventBus.emit('auth.rejected', 'Auth', { reason: 'bad passphrase' });
      return null;
    }
    const now = Date.now();
    const principal: Principal = {
      sub: role === 'admin' ? 'boss-admin' : 'boss',
      role,
      iat: now,
      exp: now + SESSION_TTL_MS,
      jti: crypto.randomBytes(12).toString('hex'),
    };
    eventBus.emit('auth.granted', 'Auth', { jti: principal.jti, role });
    return { token: signToken(principal), principal };
  }

  /** Resolve the principal from a request (Authorization: Bearer or cookie). */
  authenticate(req: Request): Principal | null {
    const header = req.headers.get('authorization');
    let token: string | null = null;
    if (header && header.toLowerCase().startsWith('bearer ')) token = header.slice(7).trim();
    if (!token) {
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)akansha_session=([^;]+)/.exec(cookie);
      if (m) token = decodeURIComponent(m[1]);
    }
    const principal = verifyToken(token);
    if (!principal) return null;
    if (this.revoked.has(principal.jti)) return null;
    return principal;
  }

  revoke(jti: string) {
    this.revoked.add(jti);
    eventBus.emit('auth.revoked', 'Auth', { jti });
  }

  authEnabled(): boolean {
    return process.env.AKANSHA_AUTH_DISABLED !== 'true';
  }
}

export const auth = new AuthManager();
