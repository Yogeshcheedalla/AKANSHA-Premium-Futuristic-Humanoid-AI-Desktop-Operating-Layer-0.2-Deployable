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
 * Live browser OAuth still requires a registered client_id (supplied by config,
 * never invented here) — without it the OAuth boundary stays honest/BLOCKED.
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

/** Build the browser-authorize URL. Requires a real clientId — never invented. */
export function buildAuthorizeUrl(opts: {
  clientId: string; redirectUri: string; state: string; codeChallenge: string;
  codeChallengeMethod?: 'S256' | 'plain'; scope?: string; authorizeUrl?: string;
}): string {
  if (!opts.clientId) throw new Error('OpenRouter client_id is required (configure it; never fabricated)');
  const u = new URL(opts.authorizeUrl || `${OPENROUTER.authBase}/auth`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('scope', opts.scope || 'model:read');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', opts.codeChallengeMethod || 'S256');
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

/** Exchange an OAuth code for an API key (authenticated POST). */
export async function exchangeCodeForApiKey(opts: {
  code: string; codeVerifier: string; fetcher?: typeof fetch;
}): Promise<{ key: string; userId?: number | null }> {
  const fetcher = opts.fetcher || globalThis.fetch;
  const res = await fetcher(`${OPENROUTER.authBase}/api/v1/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: opts.code, code_verifier: opts.codeVerifier }),
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
