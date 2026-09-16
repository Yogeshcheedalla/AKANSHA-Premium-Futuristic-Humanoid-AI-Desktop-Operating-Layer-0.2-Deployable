/**
 * OpenRouter OAuth (browser PKCE) — connect flow.
 *
 * The user authorizes in the SYSTEM browser; OpenRouter redirects to a local
 * loopback callback with an authorization `code` + `state`; Akansha verifies the
 * state, exchanges the code for the USER's OWN API key via POST /api/v1/auth/keys,
 * verifies that key against the authenticated GET /key, and stores it ONLY as an
 * opaque credentialRef in a ConnectedService (never the Akansha password, never
 * renderer state, never logs).
 *
 * We NEVER collect or handle the OpenRouter password, and we never auto-create an
 * account. Live browser OAuth additionally needs a registered client_id —
 * without it this flow cannot complete and stays honestly BLOCKED (not faked).
 */
import { pkce, buildAuthorizeUrl, exchangeCodeForApiKey, verifyKey } from '@/integrations/openrouter/OpenRouter';
import { connectedServices } from '@/core/identity/ConnectedServices';

export interface OAuthStart { authorizeUrl: string; verifier: string; state: string; redirectUri: string }

/** Begin: mint PKCE verifier + state and the browser URL. */
export function beginOpenRouterAuth(opts: { clientId: string; redirectUri: string; scope?: string }): OAuthStart {
  const verifier = pkce.createVerifier();
  const challenge = pkce.challengeFromVerifier(verifier, 'S256');
  const state = pkce.createState();
  const authorizeUrl = buildAuthorizeUrl({ clientId: opts.clientId, redirectUri: opts.redirectUri, state, codeChallenge: challenge, codeChallengeMethod: 'S256', scope: opts.scope });
  return { authorizeUrl, verifier, state, redirectUri: opts.redirectUri };
}

/**
 * Parse + validate a callback query. Rejects a state mismatch (CSRF) and a
 * missing/`error` response. Pure and offline-testable.
 */
export function parseCallback(query: URLSearchParams, expectedState: string): { code: string } {
  const state = query.get('state');
  const error = query.get('error');
  if (error) throw new Error(`OpenRouter authorization denied: ${error}`);
  if (!pkce.stateMatches(state ?? undefined, expectedState)) throw new Error('OAuth state mismatch (possible CSRF) — aborting');
  const code = query.get('code');
  if (!code) throw new Error('no authorization code in callback');
  return { code };
}

/**
 * Full completion: exchange code -> key -> verify -> store as a connected service.
 * `fetcher` is injectable so tests run offline; production uses global fetch.
 * Returns only SAFE fields (label + masked), never the key.
 */
export async function completeOpenRouterAuth(opts: {
  code: string; verifier: string; fetcher?: typeof fetch;
}): Promise<{ connected: true; label?: string | null; verified: boolean; masked: string }> {
  const { key } = await exchangeCodeForApiKey({ code: opts.code, codeVerifier: opts.verifier, fetcher: opts.fetcher });
  const check = await verifyKey(key, opts.fetcher);
  if (!check.ok) throw new Error('OpenRouter key could not be verified');
  connectedServices.connect({ provider: 'openrouter', apiKey: key, label: check.label ?? undefined, verified: true });
  const masked = key.length > 10 ? `${key.slice(0, 6)}…(${key.length})` : `(${key.length})`;
  return { connected: true, label: check.label ?? null, verified: true, masked };
}
