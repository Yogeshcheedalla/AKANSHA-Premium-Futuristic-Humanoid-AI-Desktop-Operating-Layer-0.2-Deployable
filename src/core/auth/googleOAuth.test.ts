import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGoogleConfigured, googleConfig, buildGoogleAuthUrl, challengeS256, randomToken,
  sealTx, openTx, exchangeCodeForTokens, fetchGoogleIdentity, GOOGLE, type Tx,
} from '@/core/auth/googleOAuth';

function mockFetch(handler: (url: string, init?: any) => any): typeof fetch {
  return (async (url: any, init?: any) => handler(String(url), init)) as unknown as typeof fetch;
}
const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('google: NOT configured without both id and secret', () => {
  assert.equal(isGoogleConfigured({} as any), false);
  assert.equal(isGoogleConfigured({ GOOGLE_CLIENT_ID: 'id' } as any), false); // secret missing
  assert.equal(isGoogleConfigured({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } as any), true);
});

test('google: redirect derives from AKANSHA_PUBLIC_URL + callback path', () => {
  const c = googleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', AKANSHA_PUBLIC_URL: 'https://akansha-gamma.vercel.app/' } as any);
  assert.equal(c.redirectUri, 'https://akansha-gamma.vercel.app/api/auth/google/callback');
});

test('google: authorize URL carries client_id, redirect, state, nonce, PKCE S256 + minimal scope', () => {
  const tx: Tx = { state: 'ST', verifier: 'V', nonce: 'N', exp: Date.now() + 60000 };
  const url = buildGoogleAuthUrl({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x/api/auth/google/callback' }, tx);
  assert.ok(url.startsWith(GOOGLE.auth));
  assert.ok(url.includes('client_id=cid') && url.includes('response_type=code'));
  assert.ok(url.includes('state=ST') && url.includes('nonce=N'));
  assert.ok(url.includes('code_challenge=' + challengeS256('V')) && url.includes('code_challenge_method=S256'));
  assert.ok(/scope=openid[+ ]email[+ ]profile/.test(url), 'smallest practical identity scope');
  assert.ok(!url.includes('sec'), 'client secret NEVER appears in the browser URL');
});

test('google: PKCE S256 matches the RFC 7636 vector; state/nonce are random', () => {
  assert.equal(challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.notEqual(randomToken(), randomToken());
});

test('google: encrypted tx cookie round-trips; expired + tampered are rejected', () => {
  const env = { AKANSHA_SECRET: 'k' } as any;
  const tx: Tx = { state: 'a', verifier: 'b', nonce: 'c', exp: Date.now() + 60000 };
  const sealed = sealTx(tx, env);
  assert.notEqual(sealed, JSON.stringify(tx), 'must be encrypted, not plaintext');
  assert.deepEqual(openTx(sealed, env)?.state, 'a');
  assert.equal(openTx(sealed, { AKANSHA_SECRET: 'different' } as any), null, 'wrong key cannot open');
  assert.equal(openTx(sealed.slice(0, -4) + 'AAAA', env), null, 'tamper rejected');
  assert.equal(openTx(sealTx({ ...tx, exp: Date.now() - 1 }, env), env), null, 'expired rejected');
});

test('google: code exchange posts verifier + secret to token endpoint; returns access token', async () => {
  let body = '';
  const cfg = { clientId: 'cid', clientSecret: 'SEC', redirectUri: 'https://x/cb' };
  const r = await exchangeCodeForTokens({ code: 'C', verifier: 'V', cfg, fetcher: mockFetch((u, init) => { body = init.body; return json({ access_token: 'ya29.tok' }); }) });
  assert.equal(r.accessToken, 'ya29.tok');
  assert.ok(body.includes('code_verifier=V') && body.includes('grant_type=authorization_code') && body.includes('client_secret=SEC'), 'server-only secret used in exchange');
});

test('google: exchange failure surfaces as an error (no fake token)', async () => {
  await assert.rejects(() => exchangeCodeForTokens({ code: 'C', verifier: 'V', cfg: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' }, fetcher: mockFetch(() => json({}, 400)) }), /HTTP 400/);
});

test('google: identity requires sub + email (fails safe otherwise)', async () => {
  const ok = await fetchGoogleIdentity('tok', mockFetch(() => json({ sub: 'g1', email: 'a@b.c', name: 'A', picture: 'u', email_verified: true })));
  assert.deepEqual({ sub: ok.sub, email: ok.email, name: ok.name, avatar: ok.avatar }, { sub: 'g1', email: 'a@b.c', name: 'A', avatar: 'u' });
  await assert.rejects(() => fetchGoogleIdentity('tok', mockFetch(() => json({ sub: 'g1' }))), /missing email/);
  await assert.rejects(() => fetchGoogleIdentity('tok', mockFetch(() => json({ email: 'a@b.c' }))), /missing subject/);
});
