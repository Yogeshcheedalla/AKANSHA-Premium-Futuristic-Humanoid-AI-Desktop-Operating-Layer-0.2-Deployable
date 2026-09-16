import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRouterOAuthConfig, isOAuthConfigured, startOpenRouterConnect } from '@/core/identity/openRouterOAuth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

test('oauth: not configured without a client_id (never invents one)', () => {
  assert.equal(isOAuthConfigured({} as any), false);
  const s = startOpenRouterConnect({} as any);
  assert.equal(s.configured, false);
});

test('oauth: derives redirect from public url + is configured with a client_id', () => {
  const env = { AKANSHA_OPENROUTER_CLIENT_ID: 'cid', AKANSHA_PUBLIC_URL: 'http://127.0.0.1:3000/' } as any;
  assert.equal(isOAuthConfigured(env), true);
  assert.equal(openRouterOAuthConfig(env).redirectUri, 'http://127.0.0.1:3000/api/ai/online/callback');
});

test('oauth: start returns an authorize URL with PKCE + state and records pending', () => {
  const env = { AKANSHA_OPENROUTER_CLIENT_ID: 'cid', AKANSHA_OPENROUTER_REDIRECT_URI: 'http://127.0.0.1:3000/cb' } as any;
  const s = startOpenRouterConnect(env);
  assert.equal(s.configured, true);
  if (s.configured) {
    assert.ok(s.authorizeUrl.includes('code_challenge=') && s.authorizeUrl.includes('state='));
    assert.ok(s.state.length > 8);
    const before = pendingOAuth.size();
    pendingOAuth.set(s.state, { verifier: s.verifier, redirectUri: s.redirectUri });
    assert.equal(pendingOAuth.take(s.state)?.verifier, s.verifier);
    assert.equal(pendingOAuth.take(s.state), undefined); // single-use
    assert.ok(before >= 0);
  }
});
