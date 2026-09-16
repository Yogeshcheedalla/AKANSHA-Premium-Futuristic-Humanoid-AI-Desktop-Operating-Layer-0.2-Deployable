/**
 * OpenRouter OAuth — configuration + server-side flow glue.
 *
 * The client_id and redirect must be supplied by deployment (env); Akansha NEVER
 * invents one and NEVER handles the OpenRouter password. beginOpenRouterAuth mints
 * PKCE + state and returns the browser authorize URL; completeOpenRouterAuth
 * exchanges the code for the USER's own key, verifies it via the authenticated
 * GET /key, and stores it only as an opaque credential in ConnectedServices.
 */
import { beginOpenRouterAuth } from '@/integrations/openrouter/oauth';

export interface OAuthConfig { clientId?: string; redirectUri?: string; scope?: string; authorizeUrl?: string }

export function openRouterOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  return {
    clientId: env.AKANSHA_OPENROUTER_CLIENT_ID || undefined,
    redirectUri: env.AKANSHA_OPENROUTER_REDIRECT_URI || (env.AKANSHA_PUBLIC_URL ? `${env.AKANSHA_PUBLIC_URL.replace(/\/$/, '')}/api/ai/online/callback` : undefined),
    scope: env.AKANSHA_OPENROUTER_SCOPE || 'model:read',
    authorizeUrl: env.AKANSHA_OPENROUTER_AUTHORIZE_URL || undefined,
  };
}

export function isOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!openRouterOAuthConfig(env).clientId;
}

/** Returns the authorize URL + state, or { configured:false } when no client_id. */
export function startOpenRouterConnect(env: NodeJS.ProcessEnv = process.env):
  | { configured: true; authorizeUrl: string; state: string; verifier: string; redirectUri: string }
  | { configured: false; reason: string } {
  const c = openRouterOAuthConfig(env);
  if (!c.clientId || !c.redirectUri) return { configured: false, reason: 'OPENROUTER CLIENT_ID/redirect not configured' };
  const s = beginOpenRouterAuth({ clientId: c.clientId, redirectUri: c.redirectUri, scope: c.scope });
  return { configured: true, authorizeUrl: s.authorizeUrl, state: s.state, verifier: s.verifier, redirectUri: s.redirectUri };
}
