import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRouterOAuthConfig, isOAuthConfigured, startOpenRouterConnect, resolveOAuthCallback } from '@/core/identity/openRouterOAuth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

test('oauth: NOT configured when no callback URL is resolvable (client_id is NOT required)', () => {
  assert.equal(isOAuthConfigured({} as any), false);
  const s = startOpenRouterConnect({} as any);
  assert.equal(s.configured, false);
});

test('oauth: configured from a public URL ALONE (no client_id); derives the canonical callback', () => {
  const env = { AKANSHA_PUBLIC_URL: 'http://127.0.0.1:3000/' } as any;
  assert.equal(isOAuthConfigured(env), true);
  assert.equal(openRouterOAuthConfig(env).redirectUri, 'http://127.0.0.1:3000/api/ai/online/callback');
  assert.equal(resolveOAuthCallback(env), 'http://127.0.0.1:3000/api/ai/online/callback');
});

test('oauth: explicit redirect URI wins over public URL (no conflicting values)', () => {
  const env = { AKANSHA_PUBLIC_URL: 'http://127.0.0.1:3000', AKANSHA_OPENROUTER_REDIRECT_URI: 'https://akansha-gamma.vercel.app/api/ai/online/callback' } as any;
  assert.equal(openRouterOAuthConfig(env).redirectUri, 'https://akansha-gamma.vercel.app/api/ai/online/callback');
});

test('oauth: start returns a client_id-free authorize URL with PKCE + state; pending txn is session-bound + single-use', () => {
  const env = { AKANSHA_PUBLIC_URL: 'https://akansha-gamma.vercel.app' } as any;
  const s = startOpenRouterConnect(env);
  assert.equal(s.configured, true);
  if (s.configured) {
    assert.ok(s.authorizeUrl.startsWith('https://openrouter.ai/auth'));
    assert.ok(s.authorizeUrl.includes('callback_url=') && s.authorizeUrl.includes('code_challenge=') && s.authorizeUrl.includes('code_challenge_method=S256'));
    assert.ok(!/[?&]client_id=/.test(s.authorizeUrl), 'no invented client_id');
    assert.ok(s.state.length > 8);
    pendingOAuth.set(s.state, { verifier: s.verifier, redirectUri: s.redirectUri, sub: 'boss' });
    const taken = pendingOAuth.takeForSub('boss');
    assert.equal(taken?.verifier, s.verifier);
    assert.equal(taken?.state, s.state);
    assert.equal(pendingOAuth.takeForSub('boss'), undefined, 'single-use (replay rejected)');
    assert.equal(pendingOAuth.take(s.state), undefined, 'state also consumed');
  }
});
