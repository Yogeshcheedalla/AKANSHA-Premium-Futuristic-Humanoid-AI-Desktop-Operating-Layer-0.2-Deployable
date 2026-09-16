/**
 * /api/ai/online/callback route tests (offline-safe — they exercise the guard and
 * the session-bound pending-transaction gate, which run BEFORE any network call, so
 * no real OpenRouter request is made):
 *   1. Unauthenticated callback -> 401 (session required to complete).
 *   2. Authenticated but NO pending transaction for the session (expired / replay /
 *      started elsewhere) -> 400 and nothing is connected.
 *   3. Single-use: after the pending transaction is consumed, a second callback -> 400.
 * The full exchange -> GET /key -> vault path is covered with an injected fetcher in
 * src/integrations/openrouter/oauth.test.ts (never hits the network).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;

import { GET } from '@/app/api/ai/online/callback/route';
import { auth } from '@/core/auth/session';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

const cb = (q: string, tok?: string) =>
  new Request('https://akansha-gamma.vercel.app/api/ai/online/callback' + q, {
    headers: tok ? { authorization: 'Bearer ' + tok } : {},
  });

test('callback: unauthenticated -> 401', async () => {
  const res = await GET(cb('?code=xyz'));
  assert.equal(res.status, 401);
});

test('callback: authenticated but no pending txn (replay/missing) -> 400, nothing connected', async () => {
  const g = auth.issueGuest();
  const res = await GET(cb('?code=abc123', g!.token));
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.match(text, /No pending connection|different session/i);
});

test('callback: pending txn is single-use — second attempt is rejected', async () => {
  const g = auth.issueGuest();
  pendingOAuth.set('st-single-use', { verifier: 'v', redirectUri: 'https://x/callback', sub: 'guest' });
  // consume it via the store exactly as the handler would (takeForSub), then the
  // handler sees nothing pending and must reject WITHOUT contacting OpenRouter.
  const first = pendingOAuth.takeForSub('guest');
  assert.equal(first?.state, 'st-single-use');
  const res = await GET(cb('?code=abc123', g!.token));
  assert.equal(res.status, 400);
});
