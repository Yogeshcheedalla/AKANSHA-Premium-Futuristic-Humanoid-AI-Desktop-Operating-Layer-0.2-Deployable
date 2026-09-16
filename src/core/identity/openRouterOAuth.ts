/**
 * OpenRouter OAuth — configuration + server-side flow glue.
 *
 * Per the current official OpenRouter OAuth PKCE documentation the flow needs NO
 * client_id — only a real callback URL. The callback is resolved in strict
 * precedence (never conflicting values):
 *   AKANSHA_OPENROUTER_REDIRECT_URI
 *     → else AKANSHA_PUBLIC_URL + /api/ai/online/callback
 *     → else the live request origin + /api/ai/online/callback
 * Akansha NEVER invents an identifier and NEVER handles the OpenRouter password.
 * beginOpenRouterAuth mints PKCE + state and returns the browser authorize URL;
 * completeOpenRouterAuth exchanges the code for the USER's own key, verifies it via
 * the authenticated GET /key, and stores it only as an opaque credential.
 */
import { beginOpenRouterAuth } from '@/integrations/openrouter/oauth';

const CALLBACK_PATH = '/api/ai/online/callback';

export interface OAuthConfig { clientId?: string; redirectUri?: string; keyLabel?: string; authorizeUrl?: string }

/** Resolve the callback/redirect URL. Explicit redirect URI always wins. */
export function resolveOAuthCallback(env: NodeJS.ProcessEnv = process.env, requestOrigin?: string): string | undefined {
  const explicit = env.AKANSHA_OPENROUTER_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const pub = env.AKANSHA_PUBLIC_URL?.trim();
  if (pub) return `${pub.replace(/\/$/, '')}${CALLBACK_PATH}`;
  if (requestOrigin) return `${requestOrigin.replace(/\/$/, '')}${CALLBACK_PATH}`;
  return undefined;
}

export function openRouterOAuthConfig(env: NodeJS.ProcessEnv = process.env, requestOrigin?: string): OAuthConfig {
  return {
    clientId: env.AKANSHA_OPENROUTER_CLIENT_ID?.trim() || undefined, // optional; never required, never invented
    redirectUri: resolveOAuthCallback(env, requestOrigin),
    keyLabel: env.AKANSHA_OPENROUTER_KEY_LABEL?.trim() || 'Akansha',
    authorizeUrl: env.AKANSHA_OPENROUTER_AUTHORIZE_URL?.trim() || undefined,
  };
}

/**
 * "Configured" now means we can build a real authorize URL — i.e. a callback URL is
 * resolvable. A client_id is NOT required.
 */
export function isOAuthConfigured(env: NodeJS.ProcessEnv = process.env, requestOrigin?: string): boolean {
  return !!resolveOAuthCallback(env, requestOrigin);
}

/** Returns the authorize URL + state, or { configured:false } when no callback URL. */
export function startOpenRouterConnect(env: NodeJS.ProcessEnv = process.env, requestOrigin?: string):
  | { configured: true; authorizeUrl: string; state: string; verifier: string; redirectUri: string }
  | { configured: false; reason: string } {
  const c = openRouterOAuthConfig(env, requestOrigin);
  if (!c.redirectUri) return { configured: false, reason: 'OPENROUTER CALLBACK URL NOT CONFIGURED (set AKANSHA_PUBLIC_URL or AKANSHA_OPENROUTER_REDIRECT_URI)' };
  const s = beginOpenRouterAuth({ redirectUri: c.redirectUri, keyLabel: c.keyLabel, clientId: c.clientId });
  return { configured: true, authorizeUrl: s.authorizeUrl, state: s.state, verifier: s.verifier, redirectUri: s.redirectUri };
}
