/**
 * Minimal Akansha account model + repository.
 *
 * Google remains the identity provider; Akansha stores ONLY the minimum needed to
 * show a signed-in identity (subject, email, display name, avatar) — never a Google
 * password, access token or refresh token.
 *
 * PERSISTENCE IS HONEST-BY-DEFAULT: this build ships an in-memory repository for
 * development. When the deployment has NO database (Vercel currently reports
 * persistence:"disabled"), accounts are NOT durable across instances — the signed,
 * HttpOnly session token is the authoritative carrier of the identity for the active
 * session. A production AccountRepository backed by the existing Drizzle/Postgres
 * layer is documented but intentionally NOT claimed as live until a database is
 * configured. No fake "persistent accounts" are asserted.
 */
import type { GoogleIdentity } from '@/core/auth/googleOAuth';

export interface Account {
  id: string;
  googleSubject: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number;
}

export interface AccountRepository {
  upsertFromGoogle(identity: GoogleIdentity): Account;
  findBySubject(googleSubject: string): Account | null;
}

/** Development / stateless-safe implementation. NOT durable; see header. */
export class InMemoryAccountRepository implements AccountRepository {
  private bySubject = new Map<string, Account>();
  upsertFromGoogle(identity: GoogleIdentity): Account {
    const now = Date.now();
    const existing = this.bySubject.get(identity.sub);
    const acct: Account = existing
      ? { ...existing, email: identity.email ?? existing.email, displayName: identity.name ?? existing.displayName, avatarUrl: identity.avatar ?? existing.avatarUrl, updatedAt: now, lastLoginAt: now }
      : { id: `acct_${identity.sub}`, googleSubject: identity.sub, email: identity.email, displayName: identity.name, avatarUrl: identity.avatar, createdAt: now, updatedAt: now, lastLoginAt: now };
    this.bySubject.set(identity.sub, acct);
    return acct;
  }
  findBySubject(googleSubject: string): Account | null { return this.bySubject.get(googleSubject) ?? null; }
}

export const accountRepository: AccountRepository = new InMemoryAccountRepository();
