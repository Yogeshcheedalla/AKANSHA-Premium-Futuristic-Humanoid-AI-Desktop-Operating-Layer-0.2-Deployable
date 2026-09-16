/**
 * OpenRouter integration — cloud AI as a provider, never as the brain.
 *
 * Ported as a CONCEPT from the earlier prototype into Akansha's real
 * TypeScript architecture. Two things it deliberately gets right:
 *
 *  1. Key verification uses the AUTHENTICATED `GET /api/v1/key` (a bogus key →
 *     401). It does NOT count `GET /models`, which is PUBLIC and returns 200
 *     even with no auth — treating that as "verified" is a false success.
 *  2. PKCE (RFC 7636) for the browser OAuth "one-click connect" flow. Secrets
 *     resolved here are for the Node server only; they never reach the renderer,
 *     logs, or a model prompt.
 *
 * Live browser OAuth does NOT need a client_id — the current OpenRouter PKCE
 * docs require only a callback URL. The user signs in / signs up on OpenRouter's
 * own page; Akansha never handles the password and never invents an identifier.
 */
import { createHash, randomBytes } from 'node:crypto';

export const OPENROUTER = {
  base: 'https://openrouter.ai/api/v1',
  authBase: 'https://openrouter.ai',
  freeRoute: 'openrouter/free',
} as const;

const B64URL = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ── PKCE (RFC 7636) ─────────────────────────────────────────────────────── */
export const pkce = {
  createVerifier(len = 64): string {
    return B64URL(randomBytes(Math.min(96, Math.max(32, len)))).slice(0, 128);
  },
  challengeFromVerifier(verifier: string, method: 'S256' | 'plain' = 'S256'): string {
    if (method === 'plain') return verifier;
    return B64URL(createHash('sha256').update(verifier, 'ascii').digest());
  },
  createState(): string {
    return B64URL(randomBytes(16));
  },
  stateMatches(a?: string, b?: string): boolean {
    return !!a && !!b && a === b;
  },
};

/**
 * Build OpenRouter's browser-authorize URL.
 *
 * Per the current official OAuth PKCE docs, /auth requires ONLY `callback_url`
 * and accepts `code_challenge` + `code_challenge_method` (+ optional `key_label`).
 * There is NO mandatory `client_id` — Akansha must NOT invent one. An `clientId`
 * is added ONLY if a real one is supplied by config; `state` is forwarded so a
 * CSRF check still works if the provider echoes it back, but the flow does not
 * depend on that (the callback also binds to the caller's authenticated session).
 */
export function buildAuthorizeUrl(opts: {
  redirectUri: string; codeChallenge: string; state?: string;
  codeChallengeMethod?: 'S256' | 'plain'; keyLabel?: string; clientId?: string; authorizeUrl?: string;
}): string {
  if (!opts.redirectUri) throw new Error('OpenRouter callback_url is required (derived from the public URL / configured redirect)');
  const u = new URL(opts.authorizeUrl || `${OPENROUTER.authBase}/auth`);
  u.searchParams.set('callback_url', opts.redirectUri);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', opts.codeChallengeMethod || 'S256');
  if (opts.keyLabel) u.searchParams.set('key_label', opts.keyLabel);
  if (opts.state) u.searchParams.set('state', opts.state);
  if (opts.clientId) u.searchParams.set('client_id', opts.clientId); // only if a real one is configured; never fabricated
  return u.toString();
}

export interface VerifyResult { ok: boolean; label?: string | null; usage?: number | null; limit?: number | null; status?: number; error?: string }

/**
 * Authoritative key check: GET /api/v1/key returns the key's own metadata only
 * for a REAL key; a bogus/missing key → 401. `fetcher` is injectable so the
 * behaviour is unit-tested offline (no live network) with a mock 401/200.
 */
export async function verifyKey(key: string, fetcher: typeof fetch = globalThis.fetch): Promise<VerifyResult> {
  const clean = String(key || '').replace(/[^\x21-\x7e]/g, '').trim();
  if (!/^sk-or-[A-Za-z0-9_-]{16,}$/.test(clean)) {
    return { ok: false, error: 'malformed-key' };
  }
  try {
    const res = await fetcher(`${OPENROUTER.base}/key`, {
      headers: { Authorization: `Bearer ${clean}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'invalid key' };
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const d: any = (await res.json().catch(() => ({})))?.data || {};
    return { ok: true, label: d.label ?? null, usage: d.usage ?? null, limit: d.limit ?? null, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network' };
  }
}

/** Exchange an OAuth code for the user's own API key (PKCE; no client_id). */
export async function exchangeCodeForApiKey(opts: {
  code: string; codeVerifier: string; fetcher?: typeof fetch;
}): Promise<{ key: string; userId?: number | null }> {
  const fetcher = opts.fetcher || globalThis.fetch;
  const res = await fetcher(`${OPENROUTER.authBase}/api/v1/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: opts.code, code_verifier: opts.codeVerifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OpenRouter code exchange failed: HTTP ${res.status}`);
  const j: any = await res.json();
  const key = j?.key || j?.data?.key;
  if (!key) throw new Error('OpenRouter exchange returned no key');
  return { key, userId: j?.user_id ?? j?.data?.user_id ?? null };
}

export function maskKey(key: string): string {
  if (!key) return '';
  return key.length > 10 ? `${key.slice(0, 6)}…(${key.length})` : `(${key.length})`;
}
