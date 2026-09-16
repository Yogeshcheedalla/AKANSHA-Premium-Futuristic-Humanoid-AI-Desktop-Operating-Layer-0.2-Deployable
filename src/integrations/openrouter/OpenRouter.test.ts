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
test('authorize url carries PKCE + state + S256', () => {
  const url = buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1/cb', state: 'S', codeChallenge: 'CH' });
  assert.ok(url.includes('code_challenge=CH') && url.includes('code_challenge_method=S256') && url.includes('state=S'));
});
test('authorize url REQUIRES a client_id (never fabricated)', () => {
  assert.throws(() => buildAuthorizeUrl({ clientId: '', redirectUri: 'x', state: 'S', codeChallenge: 'C' } as any));
});

/* ── verifyKey: uses the AUTHENTICATED /key, not public /models ───────────── */
function mockFetch(handler: (url: string) => any): typeof fetch {
  const f = async (url: any) => handler(String(url));
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
test('exchange: returns the key once on success, throws otherwise', async () => {
  const good = await exchangeCodeForApiKey({ code: 'C', codeVerifier: 'V', fetcher: mockFetch(() => okJson({ key: 'sk-or-result', user_id: 7 })) });
  assert.equal(good.key, 'sk-or-result');
  assert.equal(good.userId, 7);
  await assert.rejects(() => exchangeCodeForApiKey({ code: 'C', codeVerifier: 'V', fetcher: mockFetch(() => statusOnly(400)) }));
});

test('mask hides the secret middle; base url is https', () => {
  const m = maskKey('sk-or-v1-abcdef123456XYZ');
  assert.ok(!m.includes('abcdef123456'));
  assert.ok(OPENROUTER.base.startsWith('https://'));
});
