import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pkce, buildAuthorizeUrl, verifyKey, exchangeCodeForApiKey, maskKey, OPENROUTER } from '@/integrations/openrouter/OpenRouter';

/* ── PKCE (RFC 7636 Appendix B test vector) ──────────────────────────────── */
test('pkce: S256 matches the RFC 7636 test vector', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(pkce.challengeFromVerifier(verifier, 'S256'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('pkce: verifier is URL-safe and state matches exactly', () => {
  assert.match(pkce.createVerifier(), /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(pkce.stateMatches('abc', 'abc'), true);
  assert.equal(pkce.stateMatches('abc', 'abd'), false);
});
test('authorize url uses OpenRouter PKCE shape: callback_url + challenge + S256 (no client_id)', () => {
  const url = buildAuthorizeUrl({ redirectUri: 'https://app.example/api/ai/online/callback', state: 'S', codeChallenge: 'CH', keyLabel: 'Akansha' });
  assert.ok(url.includes('https://openrouter.ai/auth'), 'must point at OpenRouter /auth');
  assert.ok(url.includes('callback_url=') && url.includes(encodeURIComponent('/api/ai/online/callback')) || url.includes('callback_url='), 'must carry callback_url');
  assert.ok(url.includes('code_challenge=CH') && url.includes('code_challenge_method=S256'), 'must carry PKCE challenge + S256');
  assert.ok(!/[?&]client_id=/.test(url), 'must NOT include a client_id when none is configured');
  assert.ok(url.includes('key_label=Akansha'), 'optional key_label forwarded');
});
test('authorize url REQUIRES a callback_url but NOT a client_id (never invented)', () => {
  // Missing callback_url is the only hard requirement now.
  assert.throws(() => buildAuthorizeUrl({ redirectUri: '', codeChallenge: 'C' } as any));
  // A real client_id, if configured, is forwarded — but is optional.
  const withCid = buildAuthorizeUrl({ redirectUri: 'https://x/cb', codeChallenge: 'C', clientId: 'real-cid' });
  assert.ok(withCid.includes('client_id=real-cid'));
});

/* ── verifyKey: uses the AUTHENTICATED /key, not public /models ───────────── */
function mockFetch(handler: (url: string, init?: any) => any): typeof fetch {
  const f = async (url: any, init?: any) => handler(String(url), init);
  return f as unknown as typeof fetch;
}
const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body });
const statusOnly = (status: number) => ({ ok: status < 400, status, json: async () => ({}) });

test('verifyKey: 200 /key => ok with label (real key)', async () => {
  let hit = '';
  const r = await verifyKey('sk-or-v1-' + 'a'.repeat(32), mockFetch((u) => { hit = u; return okJson({ data: { label: 'personal', usage: 3, limit: null } }); }));
  assert.equal(r.ok, true);
  assert.equal(r.label, 'personal');
  assert.ok(hit.endsWith('/key'), 'must hit authenticated /key, not public /models');
});

test('verifyKey: 401 /key => invalid (a bogus key is NOT accepted)', async () => {
  const r = await verifyKey('sk-or-v1-' + 'b'.repeat(32), mockFetch(() => statusOnly(401)));
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('verifyKey: fetches /key, never public /models', async () => {
  let path = '';
  await verifyKey('sk-or-v1-' + 'c'.repeat(32), mockFetch((u) => { path = u; return okJson({ data: {} }); }));
  assert.ok(!path.includes('/models'));
});

test('verifyKey: malformed key short-circuits before any network', async () => {
  let called = false;
  const r = await verifyKey('nope', mockFetch(() => { called = true; return okJson({}); }));
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

/* ── code exchange ───────────────────────────────────────────────────────── */
test('exchange: correct endpoint + body (code, code_verifier, code_challenge_method=S256); returns key once', async () => {
  let seenUrl = ''; let seenBody: any;
  const good = await exchangeCodeForApiKey({
    code: 'C', codeVerifier: 'V',
    fetcher: mockFetch((u, init) => { seenUrl = u; seenBody = JSON.parse(init.body); return okJson({ key: 'sk-or-result', user_id: 7 }); }),
  });
  assert.equal(good.key, 'sk-or-result');
  assert.equal(good.userId, 7);
  assert.ok(seenUrl.endsWith('/api/v1/auth/keys'), 'exchanges at POST /api/v1/auth/keys');
  assert.deepEqual(seenBody, { code: 'C', code_verifier: 'V', code_challenge_method: 'S256' }, 'body carries PKCE verifier + method, no invented fields');
  await assert.rejects(() => exchangeCodeForApiKey({ code: 'C', codeVerifier: 'V', fetcher: mockFetch(() => statusOnly(400)) }));
});

test('mask hides the secret middle; base url is https', () => {
  const m = maskKey('sk-or-v1-abcdef123456XYZ');
  assert.ok(!m.includes('abcdef123456'));
  assert.ok(OPENROUTER.base.startsWith('https://'));
});
