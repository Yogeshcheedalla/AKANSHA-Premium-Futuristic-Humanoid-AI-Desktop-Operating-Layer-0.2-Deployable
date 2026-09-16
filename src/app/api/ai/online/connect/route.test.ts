/**
 * /api/ai/online/connect route tests — the corrected OpenRouter behavior at the edge:
 *   1. Unauthenticated -> 401 (guard).
 *   2. ACCOUNTLESS guest with a resolvable callback (derived from the request origin,
 *      NO client_id, NO env) -> 200 + a REAL authorize URL at openrouter.ai/auth
 *      carrying callback_url + PKCE S256 and NO invented client_id, plus a
 *      session-bound pending PKCE transaction for the callback to consume.
 *   3. AKANSHA_PUBLIC_URL pins the canonical production callback.
 * (The honest 501 gate still fires only when NO callback can be resolved — see the
 *  openRouterOAuth unit test for the configured:false path.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.AKANSHA_OPENROUTER_CLIENT_ID;
delete process.env.AKANSHA_OPENROUTER_REDIRECT_URI;
delete process.env.AKANSHA_PUBLIC_URL;

import { POST } from '@/app/api/ai/online/connect/route';
import { auth } from '@/core/auth/session';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

const URL_ = 'http://localhost:3000/api/ai/online/connect';

test('connect: unauthenticated request is rejected with 401', async () => {
  const res = await POST(new Request(URL_, { method: 'POST' }));
  assert.equal(res.status, 401);
});

test('connect: accountless guest, no client_id/env -> initiates the REAL PKCE flow (200, no 501)', async () => {
  const g = auth.issueGuest();
  assert.ok(g, 'guest session should be mintable');
  const res = await POST(new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, true);
  assert.ok(body.authorizeUrl.startsWith('https://openrouter.ai/auth'), 'points at OpenRouter /auth');
  assert.ok(body.authorizeUrl.includes('callback_url='), 'carries callback_url');
  assert.ok(body.authorizeUrl.includes('code_challenge_method=S256'), 'carries PKCE S256');
  assert.ok(!/[?&]client_id=/.test(body.authorizeUrl), 'does NOT fabricate a client_id');
  assert.ok(String(body.redirectUri).endsWith('/api/ai/online/callback'), 'callback derived from the request origin');
  const pend = pendingOAuth.takeForSub('guest');
  assert.equal(pend?.state, body.state, 'pending PKCE txn bound to this session');
});

test('connect: AKANSHA_PUBLIC_URL pins the canonical production callback', async () => {
  process.env.AKANSHA_PUBLIC_URL = 'https://akansha-gamma.vercel.app';
  try {
    const g = auth.issueGuest();
    const res = await POST(new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer ' + g!.token } }));
    const body: any = await res.json();
    assert.equal(body.redirectUri, 'https://akansha-gamma.vercel.app/api/ai/online/callback');
    assert.ok(body.authorizeUrl.includes(encodeURIComponent('https://akansha-gamma.vercel.app/api/ai/online/callback')), 'callback_url is the production callback (URL-encoded)');
  } finally {
    delete process.env.AKANSHA_PUBLIC_URL;
  }
});
