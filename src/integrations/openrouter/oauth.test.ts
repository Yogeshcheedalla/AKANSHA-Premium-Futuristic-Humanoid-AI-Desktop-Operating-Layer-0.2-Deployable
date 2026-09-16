import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginOpenRouterAuth, parseCallback, completeOpenRouterAuth } from '@/integrations/openrouter/oauth';
import { ConnectedServices } from '@/core/identity/ConnectedServices';
import { OPENROUTER } from '@/integrations/openrouter/OpenRouter';

function mockFetch(handler: (url: string, init?: any) => any): typeof fetch {
  const f = async (url: any, init?: any) => handler(String(url), init);
  return f as unknown as typeof fetch;
}
const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('oauth begin: builds a client_id-FREE PKCE authorize url (callback_url + S256)', () => {
  const s = beginOpenRouterAuth({ redirectUri: 'https://akansha-gamma.vercel.app/api/ai/online/callback' });
  assert.ok(s.authorizeUrl.includes('https://openrouter.ai/auth'), 'points at OpenRouter /auth');
  assert.ok(s.authorizeUrl.includes('callback_url='), 'carries callback_url');
  assert.ok(s.authorizeUrl.includes('code_challenge=') && s.authorizeUrl.includes('code_challenge_method=S256'), 'carries PKCE S256');
  assert.ok(!/[?&]client_id=/.test(s.authorizeUrl), 'does NOT invent a client_id');
  assert.ok(s.verifier.length >= 43);
});

test('oauth parseCallback: rejects mismatch/missing-code, tolerates absent state (session-bound CSRF)', () => {
  assert.throws(() => parseCallback(new URLSearchParams('code=C&state=BAD'), 'GOOD'), /state mismatch/i);
  assert.throws(() => parseCallback(new URLSearchParams('error=access_denied&state=GOOD'), 'GOOD'), /denied/i);
  assert.throws(() => parseCallback(new URLSearchParams('state=GOOD'), 'GOOD'), /no authorization code/i); // missing code rejected
  assert.deepEqual(parseCallback(new URLSearchParams('code=C&state=GOOD'), 'GOOD'), { code: 'C' });
  // OpenRouter returns only `code` (no state) — accepted, because CSRF is bound to the session:
  assert.deepEqual(parseCallback(new URLSearchParams('code=C'), 'GOOD'), { code: 'C' });
});

test('oauth complete: exchanges code -> verifies key -> stores connected service; never returns the raw key', async () => {
  const goodKey = 'sk-or-v1-' + 'z'.repeat(30);
  const fetcher = mockFetch((u) => {
    if (u.includes('/auth/keys')) return json({ key: goodKey, user_id: 5 });
    if (u.includes('/key')) return json({ data: { label: 'personal', usage: 0 } });
    return json({}, 404);
  });
  const res = await completeOpenRouterAuth({ code: 'C', verifier: 'V', fetcher });
  assert.equal(res.connected, true);
  assert.equal(res.verified, true);
  assert.ok(!JSON.stringify(res).includes(goodKey), 'response must not contain the raw key');
  assert.ok(OPENROUTER.base.startsWith('https://'));
});

test('oauth complete: an unverifiable key is NOT stored as connected', async () => {
  const fetcher = mockFetch((u) => {
    if (u.includes('/auth/keys')) return json({ key: 'sk-or-v1-' + 'q'.repeat(30) });
    if (u.includes('/key')) return json({}, 401);
    return json({}, 404);
  });
  await assert.rejects(() => completeOpenRouterAuth({ code: 'C', verifier: 'V', fetcher }), /could not be verified/i);
});

test('connected services are independent instances (no cross-test leak in this file)', () => {
  const cs = new ConnectedServices();
  assert.equal(cs.get('openrouter'), undefined);
});
