/**
 * OpenRouter OAuth (browser PKCE) — connect flow.
 *
 * The user authorizes in the SYSTEM browser on OpenRouter's OWN page; OpenRouter
 * redirects back to our callback with an authorization `code`. Akansha exchanges
 * the code for the USER's OWN API key via POST /api/v1/auth/keys (PKCE verifier
 * kept server-side), verifies that key against the authenticated GET /key, and
 * stores it ONLY as an opaque credentialRef in a ConnectedService (never the
 * OpenRouter password, never renderer state, never logs).
 *
 * We NEVER collect or handle the OpenRouter password, and we never auto-create an
 * account. Per the current official PKCE docs there is NO mandatory client_id —
 * the flow needs only a real callback URL, which the app derives from its public
 * URL configuration. CSRF is bound to the caller's authenticated session; an
 * optional `state` is also validated when the provider echoes it back.
 */
import { pkce, buildAuthorizeUrl, exchangeCodeForApiKey, verifyKey } from '@/integrations/openrouter/OpenRouter';
import { connectedServices } from '@/core/identity/ConnectedServices';

export interface OAuthStart { authorizeUrl: string; verifier: string; state: string; redirectUri: string }

/** Begin: mint PKCE verifier + state and the browser URL (no client_id needed). */
export function beginOpenRouterAuth(opts: { redirectUri: string; keyLabel?: string; clientId?: string }): OAuthStart {
  const verifier = pkce.createVerifier();
  const challenge = pkce.challengeFromVerifier(verifier, 'S256');
  const state = pkce.createState();
  const authorizeUrl = buildAuthorizeUrl({
    redirectUri: opts.redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    keyLabel: opts.keyLabel || 'Akansha',
    clientId: opts.clientId, // forwarded only if a real one is configured; never fabricated
    state,
  });
  return { authorizeUrl, verifier, state, redirectUri: opts.redirectUri };
}

/**
 * Parse + validate a callback query. Rejects an `error` response and a MISSING
 * authorization code. A `state` mismatch (when both present) is rejected as
 * possible CSRF; an absent state is tolerated because CSRF is additionally bound
 * to the caller's authenticated session (OpenRouter does not document echoing
 * state). Pure and offline-testable.
 */
export function parseCallback(query: URLSearchParams, expectedState?: string): { code: string } {
  const error = query.get('error');
  if (error) throw new Error(`OpenRouter authorization denied: ${error}`);
  const state = query.get('state');
  if (state && expectedState && !pkce.stateMatches(state, expectedState)) {
    throw new Error('OAuth state mismatch (possible CSRF) — aborting');
  }
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
