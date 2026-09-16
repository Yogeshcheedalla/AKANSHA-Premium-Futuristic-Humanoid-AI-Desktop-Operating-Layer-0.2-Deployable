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

test('oauth begin: builds PKCE authorize url with a real client_id only', () => {
  const s = beginOpenRouterAuth({ clientId: 'cid', redirectUri: 'http://127.0.0.1:43110/callback' });
  assert.ok(s.authorizeUrl.includes('code_challenge=') && s.authorizeUrl.includes('code_challenge_method=S256'));
  assert.ok(s.verifier.length >= 43);
});

test('oauth parseCallback: rejects state mismatch (CSRF) and accepts a good code', () => {
  assert.throws(() => parseCallback(new URLSearchParams('code=C&state=BAD'), 'GOOD'), /state mismatch/i);
  assert.throws(() => parseCallback(new URLSearchParams('error=access_denied&state=GOOD'), 'GOOD'), /denied/i);
  assert.deepEqual(parseCallback(new URLSearchParams('code=C&state=GOOD'), 'GOOD'), { code: 'C' });
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
