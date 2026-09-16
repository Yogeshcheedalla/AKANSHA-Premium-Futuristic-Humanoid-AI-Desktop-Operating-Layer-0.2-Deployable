/**
 * Google OAuth (server-side Authorization Code + PKCE) — configuration + flow.
 *
 * Reuses Akansha's ONE auth engine for session issuance (see AuthManager.
 * issueIdentity); this module only speaks to Google and never becomes a second
 * authority. The client SECRET is used exclusively on the server, is never
 * returned to the browser, never logged, and never embedded in a token.
 *
 * CSRF/state + PKCE are carried in a short-lived, ENCRYPTED, HttpOnly transaction
 * COOKIE (not an in-memory map) so the flow is correct across serverless isolates
 * (the callback may land on a different instance than the start). The cookie is
 * cleared on callback, making each transaction single-use from the browser's view.
 */
import crypto from 'crypto';

export const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  scope: 'openid email profile',
} as const;

export interface GoogleConfig { clientId?: string; clientSecret?: string; redirectUri?: string }

const CALLBACK_PATH = '/api/auth/google/callback';

/** Resolve config. Redirect: explicit > AKANSHA_PUBLIC_URL + callback > request origin. */
export function googleConfig(env: NodeJS.ProcessEnv = process.env, requestOrigin?: string): GoogleConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
  const redirectUri =
    env.GOOGLE_REDIRECT_URI?.trim() ||
    (env.AKANSHA_PUBLIC_URL?.trim() ? `${env.AKANSHA_PUBLIC_URL.trim().replace(/\/$/, '')}${CALLBACK_PATH}` : undefined) ||
    (requestOrigin ? `${requestOrigin.replace(/\/$/, '')}${CALLBACK_PATH}` : undefined);
  return { clientId, clientSecret, redirectUri };
}

/** Configured only when BOTH the id and the secret exist (secret is server-only). */
export function isGoogleConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = googleConfig(env);
  return !!(c.clientId && c.clientSecret);
}

/* ── PKCE + state + nonce ─────────────────────────────────────────────────── */
const B64URL = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function createVerifier(len = 64): string { return B64URL(crypto.randomBytes(Math.min(96, Math.max(32, len)))).slice(0, 128); }
export function challengeS256(verifier: string): string { return B64URL(crypto.createHash('sha256').update(verifier, 'ascii').digest()); }
export function randomToken(bytes = 16): string { return B64URL(crypto.randomBytes(bytes)); }

export interface Tx { state: string; verifier: string; nonce: string; exp: number }

/** Build the Google authorize URL. Throws only if config is absent (caller gates first). */
export function buildGoogleAuthUrl(cfg: GoogleConfig, tx: Tx): string {
  if (!cfg.clientId || !cfg.redirectUri) throw new Error('Google OAuth not configured');
  const u = new URL(GOOGLE.auth);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE.scope);
  u.searchParams.set('state', tx.state);
  u.searchParams.set('nonce', tx.nonce);
  u.searchParams.set('code_challenge', challengeS256(tx.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/* ── Encrypted transaction cookie (AES-256-GCM) ───────────────────────────── */
function txKey(env: NodeJS.ProcessEnv): Buffer {
  const s = env.AKANSHA_SECRET || env.DATABASE_URL || 'akansha-local-development-auth-secret';
  return crypto.createHash('sha256').update(s).digest();
}
export const TX_COOKIE = 'akansha_goauth';

export function sealTx(tx: Tx, env: NodeJS.ProcessEnv = process.env): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', txKey(env), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(tx), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return B64URL(Buffer.concat([iv, tag, ct]));
}

export function openTx(sealed: string | undefined | null, env: NodeJS.ProcessEnv = process.env): Tx | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', txKey(env), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const tx = JSON.parse(pt.toString('utf8')) as Tx;
    if (!tx || typeof tx.exp !== 'number' || tx.exp < Date.now()) return null; // expired
    if (!tx.state || !tx.verifier) return null;
    return tx;
  } catch {
    return null;
  }
}

/* ── Code exchange + identity (fetch injectable) ──────────────────────────── */
export interface GoogleIdentity { sub: string; email?: string; name?: string; avatar?: string; emailVerified?: boolean }

export async function exchangeCodeForTokens(opts: {
  code: string; verifier: string; cfg: GoogleConfig; fetcher?: typeof fetch;
}): Promise<{ accessToken: string; idToken?: string }> {
  const fetcher = opts.fetcher || globalThis.fetch;
  if (!opts.cfg.clientId || !opts.cfg.clientSecret || !opts.cfg.redirectUri) throw new Error('Google OAuth not configured');
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.cfg.clientId,
    client_secret: opts.cfg.clientSecret,
    redirect_uri: opts.cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: opts.verifier,
  });
  const res = await fetcher(GOOGLE.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (HTTP ${res.status})`);
  const j: any = await res.json().catch(() => ({}));
  if (!j?.access_token) throw new Error('Google token exchange returned no access token');
  return { accessToken: String(j.access_token), idToken: j.id_token ? String(j.id_token) : undefined };
}

/** Fetch + validate the minimal identity. Fails safe if sub/email are absent. */
export async function fetchGoogleIdentity(accessToken: string, fetcher: typeof fetch = globalThis.fetch): Promise<GoogleIdentity> {
  const res = await fetcher(GOOGLE.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google userinfo failed (HTTP ${res.status})`);
  const j: any = await res.json().catch(() => ({}));
  const sub = j?.sub ? String(j.sub) : '';
  const email = j?.email ? String(j.email) : undefined;
  const emailVerified = j?.email_verified === true;
  if (!sub) throw new Error('Google identity missing subject');
  if (!email) throw new Error('Google identity missing email');
  return { sub, email, name: j?.name ? String(j.name) : undefined, avatar: j?.picture ? String(j.picture) : undefined, emailVerified };
}
